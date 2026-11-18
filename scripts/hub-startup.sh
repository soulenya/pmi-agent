#!/bin/bash
# Little Gerry hub bootstrap. Runs on every boot; safe to re-run.
# NOTE: no `set -x` anywhere — the log would capture the secrets.
set -euo pipefail
exec > >(tee -a /var/log/hub-startup.log) 2>&1
echo "=== hub startup $(date -Is) ==="

# Instance metadata attribute, or the default (PMI's values) when unset.
# Set with: gcloud compute instances add-metadata hub --metadata=key=value,...
meta() {
  local v
  v=$(curl -sf -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null || true)
  printf '%s' "${v:-$2}"
}

PROJECT=$(meta project pmi-littlegerry-hub)
REGION=$(meta region us-central1)
REGISTRY=$(meta registry "${REGION}-docker.pkg.dev")
IMAGE=$(meta image "${REGISTRY}/${PROJECT}/littlegerry/backend:latest")
HUB_DOMAIN=$(meta hub-domain hub.precisianmedical.com)
IAP_AUDIENCE=$(meta iap-audience /projects/200809642986/global/backendServices/3249219135556043655)
BACKUP_BUCKET=$(meta backup-bucket pmi-littlegerry-hub-backup)
DB_NAME=$(meta db-name pmi_dev)
DB_SUPERUSER=$(meta db-superuser pmi)
DB_APP_ROLE=$(meta db-app-role pmi_app)
DB_AUDIT_ROLE=$(meta db-audit-role pmi_audit)
API_CONTAINER=$(meta api-container pmi_api)
PG_CONTAINER=$(meta postgres-container pmi_postgres)
VAPID_SUBJECT=$(meta vapid-subject mailto:morganjkeane@precisianmedical.com)
# GBrain, the shared company brain (docs/GBRAIN.md): off unless this is set to
# an image built from gbrain/Dockerfile.
GBRAIN_IMAGE=$(meta gbrain-image "")
APP=/opt/littlegerry

if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg jq
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

TOKEN=$(curl -sf -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | jq -r .access_token)

# Prints a secret on stdout. Never log the result.
secret() {
  # Keys pasted into a Windows console arrive with a trailing CR, which .env
  # would keep as part of the value and every auth header would then be wrong.
  curl -sf -H "Authorization: Bearer ${TOKEN}" \
    "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/$1/versions/latest:access" \
    | jq -r '.payload.data' | base64 -d | tr -d '\r'
}

echo "${TOKEN}" | docker login -u oauth2accesstoken --password-stdin "https://${REGISTRY}"

mkdir -p "${APP}/scripts"
cd "${APP}"

cat > scripts/init_db.sql <<SQLEOF
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_APP_ROLE}') THEN
        CREATE ROLE ${DB_APP_ROLE} LOGIN PASSWORD 'placeholder_replaced_at_init';
    END IF;
END
\$\$;

DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_AUDIT_ROLE}') THEN
        CREATE ROLE ${DB_AUDIT_ROLE} LOGIN PASSWORD 'placeholder_replaced_at_init';
    END IF;
END
\$\$;

GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_APP_ROLE};
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_AUDIT_ROLE};
GRANT USAGE ON SCHEMA public TO ${DB_APP_ROLE};
GRANT USAGE ON SCHEMA public TO ${DB_AUDIT_ROLE};
SQLEOF

cat > scripts/init_db_hub.sh <<SHEOF
#!/bin/bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "\$POSTGRES_USER" --dbname "\$POSTGRES_DB" <<-EOSQL
    ALTER ROLE ${DB_APP_ROLE}   WITH PASSWORD '\${PMI_APP_PASSWORD}';
    ALTER ROLE ${DB_AUDIT_ROLE} WITH PASSWORD '\${PMI_AUDIT_PASSWORD}';
EOSQL
SHEOF
chmod +x scripts/init_db_hub.sh

cat > docker-compose.yml <<YMLEOF
services:
  postgres:
    image: pgvector/pgvector:pg16@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f
    container_name: ${PG_CONTAINER}
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_SUPERUSER}
      POSTGRES_PASSWORD: \${POSTGRES_SUPERUSER_PASSWORD:?required}
      POSTGRES_DB: ${DB_NAME}
      PMI_APP_PASSWORD: \${PMI_APP_PASSWORD:?required}
      PMI_AUDIT_PASSWORD: \${PMI_AUDIT_PASSWORD:?required}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init_db.sql:/docker-entrypoint-initdb.d/01_init.sql:ro
      - ./scripts/init_db_hub.sh:/docker-entrypoint-initdb.d/02_passwords.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_SUPERUSER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    image: \${API_IMAGE:-${IMAGE}}
    container_name: ${API_CONTAINER}
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql+asyncpg://${DB_APP_ROLE}:\${PMI_APP_PASSWORD}@postgres:5432/${DB_NAME}
      DATABASE_URL_SYNC: postgresql://${DB_APP_ROLE}:\${PMI_APP_PASSWORD}@postgres:5432/${DB_NAME}
      DB_APP_ROLE: ${DB_APP_ROLE}
      JWT_SECRET: \${JWT_SECRET:?required}
      FERNET_KEY: \${FERNET_KEY:?required}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      VOYAGE_API_KEY: \${VOYAGE_API_KEY:-}
      GOOGLE_API_KEY: \${GOOGLE_API_KEY:-}
      VAPID_PUBLIC_KEY: \${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: \${VAPID_PRIVATE_KEY:-}
      VAPID_SUBJECT: \${VAPID_SUBJECT:-}
      CORS_ORIGINS: \${CORS_ORIGINS:-["https://${HUB_DOMAIN}"]}
      HUB_MODE: "true"
      IAP_AUDIENCE: ${IAP_AUDIENCE}
      GOOGLE_WEB_CLIENT_JSON: \${GOOGLE_WEB_CLIENT_JSON:-}
      # The company brain; both empty unless this hub runs GBrain (docs/GBRAIN.md).
      GBRAIN_MCP_URL: \${GBRAIN_MCP_URL:-}
      GBRAIN_MCP_TOKEN: \${GBRAIN_MCP_TOKEN:-}
      STORAGE_ROOT: /data/documents
      HOST: 0.0.0.0
      PORT: "8000"
    volumes:
      - appdata:/data
    ports:
      - "8000:8000"

  # The shared company brain (docs/GBRAIN.md). Behind a profile, so nothing
  # above starts or stops it; the block at the end of hub-startup.sh does.
  gbrain:
    profiles: ["gbrain"]
    image: \${GBRAIN_IMAGE:-${GBRAIN_IMAGE:-${IMAGE%/*}/gbrain:latest}}
    container_name: gbrain
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      # sslmode=disable: GBrain requires TLS of any Postgres that is not on
      # localhost, and this connection never leaves the compose network.
      GBRAIN_DATABASE_URL: postgresql://gbrain:\${GBRAIN_DB_PASSWORD:-}@postgres:5432/gbrain?sslmode=disable
    volumes:
      - gbrain_data:/data
    # No ports, like Postgres: MCP is http://gbrain:3131/mcp on this network only.

volumes:
  postgres_data:
    driver: local
  appdata:
    driver: local
  gbrain_data:
    driver: local
YMLEOF

umask 077
{
  echo "POSTGRES_SUPERUSER_PASSWORD=$(secret db-superuser-password)"
  echo "PMI_APP_PASSWORD=$(secret db-password)"
  echo "PMI_AUDIT_PASSWORD=$(secret db-audit-password)"
  echo "JWT_SECRET=$(secret jwt-secret)"
  echo "FERNET_KEY=$(secret fernet-key)"
  echo "ANTHROPIC_API_KEY=$(secret anthropic-api-key || true)"
  # Embeddings and speech run the same providers as the desktop app, so the hub
  # keeps the same routing rather than falling back to a different model.
  echo "VOYAGE_API_KEY=$(secret voyage-api-key || true)"
  echo "GOOGLE_API_KEY=$(secret google-api-key || true)"
  # One line, no quoting: compose reads .env values literally to end of line.
  echo "GOOGLE_WEB_CLIENT_JSON=$(secret google-oauth-client | tr -d '\n' || true)"
  # Web push (optional secrets; the subject comes from metadata / the brand).
  echo "VAPID_PUBLIC_KEY=$(secret vapid-public-key || true)"
  echo "VAPID_PRIVATE_KEY=$(secret vapid-private-key || true)"
  echo "VAPID_SUBJECT=${VAPID_SUBJECT}"
  if [[ -n "${GBRAIN_IMAGE}" ]]; then
    echo "GBRAIN_DB_PASSWORD=$(secret gbrain-db-password || true)"
    # What the API uses to reach the brain. The token is minted from the
    # running brain, so it is absent the first time; the API then reports the
    # brain as not set up until the secret exists and this script runs again.
    echo "GBRAIN_MCP_URL=http://gbrain:3131/mcp"
    echo "GBRAIN_MCP_TOKEN=$(secret gbrain-mcp-token || true)"
  fi
} > .env
chmod 600 .env

# Values the helper scripts below need (they run from cron/systemd, not here).
cat > scripts/hub.env <<ENVEOF
BACKUP_BUCKET=${BACKUP_BUCKET}
DB_NAME=${DB_NAME}
DB_SUPERUSER=${DB_SUPERUSER}
API_CONTAINER=${API_CONTAINER}
PG_CONTAINER=${PG_CONTAINER}
GBRAIN_DB=${GBRAIN_IMAGE:+gbrain}
ENVEOF

# ── Nightly backup ──────────────────────────────────────────────────────
# Installed before the image pull so a registry hiccup can't skip it.
cat > scripts/backup.sh <<'BAKEOF'
#!/bin/bash
# Nightly hub backup: database dump + uploaded files to GCS.
# Retention is a 30-day bucket lifecycle rule, not this script's job.
set -euo pipefail
. /opt/littlegerry/scripts/hub.env
BUCKET=${BACKUP_BUCKET}
STAMP=$(date -u +%Y%m%d-%H%M%S)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

token() {
  curl -sf -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
    | jq -r .access_token
}

upload() {  # upload <local-file> <object-name>
  curl -sf -X POST --data-binary @"$1" \
    -H "Authorization: Bearer $(token)" \
    -H "Content-Type: application/octet-stream" \
    "https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=$2" \
    >/dev/null
}

# Only this one value is needed; never `source .env` - a quote in any secret
# would break the shell, and compose reads the file literally anyway.
POSTGRES_SUPERUSER_PASSWORD=$(sed -n 's/^POSTGRES_SUPERUSER_PASSWORD=//p' /opt/littlegerry/.env)

docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "${PG_CONTAINER}" \
  pg_dump -U "${DB_SUPERUSER}" -d "${DB_NAME}" --no-owner --no-acl \
  | gzip -9 > "$TMP/db.sql.gz"
upload "$TMP/db.sql.gz" "db/${DB_NAME}-${STAMP}.sql.gz"

# Documents, regulatory store and conversation backups all live under /data.
VOL=$(docker inspect "${API_CONTAINER}" -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
docker run --rm -v "${VOL}:/data:ro" -v "$TMP:/out" alpine \
  tar czf /out/data.tar.gz -C /data .
upload "$TMP/data.tar.gz" "files/data-${STAMP}.tar.gz"

# The brain's database, on hubs that run GBrain. Last, so a problem here
# cannot cost the two uploads above. Unlike the main dump it keeps owners and
# grants (its role name never varies), and it sits under its own prefix so the
# restore drill's "newest object under db/" stays the app database.
GBRAIN_NOTE=""
if [[ -n "${GBRAIN_DB:-}" ]]; then
  docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "${PG_CONTAINER}" \
    pg_dump -U "${DB_SUPERUSER}" -d "${GBRAIN_DB}" \
    | gzip -9 > "$TMP/gbrain.sql.gz"
  upload "$TMP/gbrain.sql.gz" "gbrain/${GBRAIN_DB}-${STAMP}.sql.gz"
  GBRAIN_NOTE=" gbrain=$(stat -c%s "$TMP/gbrain.sql.gz")"
fi

echo "backup ok ${STAMP} db=$(stat -c%s "$TMP/db.sql.gz") files=$(stat -c%s "$TMP/data.tar.gz")${GBRAIN_NOTE}"
BAKEOF
chmod 700 scripts/backup.sh

cat > scripts/restore.sh <<'RSTEOF'
#!/bin/bash
# Restore a database backup from GCS.
#   restore.sh                        newest backup -> scratch DB (a drill)
#   restore.sh db/<db>-X.sql.gz <db>  real restore, API stopped first
#   restore.sh gbrain/gbrain-X.sql.gz gbrain   the brain, GBrain stopped first
set -euo pipefail
. /opt/littlegerry/scripts/hub.env
BUCKET=${BACKUP_BUCKET}
OBJ=${1:-}
TARGET=${2:-restore_test}

token() {
  curl -sf -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
    | jq -r .access_token
}

if [[ -z "${OBJ}" ]]; then
  OBJ=$(curl -sf -H "Authorization: Bearer $(token)" \
    "https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=db/" \
    | jq -r '.items | sort_by(.name) | last | .name')
fi
echo "restoring ${OBJ} into ${TARGET}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -sf -H "Authorization: Bearer $(token)" \
  "https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/$(jq -rn --arg o "${OBJ}" '$o|@uri')?alt=media" \
  -o "$TMP/db.sql.gz"

POSTGRES_SUPERUSER_PASSWORD=$(sed -n 's/^POSTGRES_SUPERUSER_PASSWORD=//p' /opt/littlegerry/.env)
PG="docker exec -e PGPASSWORD=${POSTGRES_SUPERUSER_PASSWORD} ${PG_CONTAINER}"

# Which container holds the target open, and who owns it once restored.
# GBrain's dump carries its owners, so its database must be its role's again.
STOP=""
OWNER=${DB_SUPERUSER}
if [[ "${TARGET}" == "${DB_NAME}" ]]; then
  STOP=${API_CONTAINER}
elif [[ -n "${GBRAIN_DB:-}" && "${TARGET}" == "${GBRAIN_DB}" ]]; then
  STOP=gbrain
  OWNER=${GBRAIN_DB}
fi

if [[ -n "${STOP}" ]]; then
  docker stop "${STOP}"
fi

${PG} psql -U "${DB_SUPERUSER}" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"${TARGET}\"" \
  -c "CREATE DATABASE \"${TARGET}\" OWNER ${OWNER}" >/dev/null
gunzip -c "$TMP/db.sql.gz" \
  | docker exec -i -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" "${PG_CONTAINER}" \
      psql -U "${DB_SUPERUSER}" -d "${TARGET}" -q -v ON_ERROR_STOP=1 >/dev/null

TABLES=$(${PG} psql -U "${DB_SUPERUSER}" -d "${TARGET}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "restored ${OBJ} -> ${TARGET}: ${TABLES} tables"

if [[ -n "${STOP}" ]]; then
  docker start "${STOP}"
fi
RSTEOF
chmod 700 scripts/restore.sh

cat > /etc/systemd/system/littlegerry-backup.service <<'SVCEOF'
[Unit]
Description=Little Gerry hub backup
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/littlegerry/scripts/backup.sh
SVCEOF

cat > /etc/systemd/system/littlegerry-backup.timer <<'TMREOF'
[Unit]
Description=Nightly Little Gerry hub backup

[Timer]
# 08:00 UTC — 03:00 Central.
OnCalendar=*-*-* 08:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
TMREOF

systemctl daemon-reload
systemctl enable --now littlegerry-backup.timer

# Artifact Registry's token endpoint returns the occasional 502.
for attempt in 1 2 3; do
  docker compose pull -q && break
  echo "pull attempt ${attempt} failed; retrying"
  sleep 10
done
docker compose up -d

# ── GBrain ──────────────────────────────────────────────────────────────
# Last, and never fatal: the hub is up by now, and a brain that cannot start
# must not take it down.

# GBrain connects as an ordinary role, so the things its schema needs from a
# superuser are done for it here: the extensions, BYPASSRLS, and the event
# trigger that turns row-level security on for every table it creates (the SQL
# is upstream's AUTO_RLS_DBA_SQL). Safe to re-run; the password follows the
# secret. Nobody else may connect to its database.
provision_gbrain_db() {
  GBRAIN_DB_PASSWORD="$1" docker exec -i -e GBRAIN_DB_PASSWORD "${PG_CONTAINER}" \
    psql -q -v ON_ERROR_STOP=1 -U "${DB_SUPERUSER}" -d postgres <<SQLEOF
\getenv pw GBRAIN_DB_PASSWORD
SELECT 'CREATE ROLE gbrain LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gbrain')\gexec
ALTER ROLE gbrain WITH BYPASSRLS PASSWORD :'pw';
SELECT 'CREATE DATABASE gbrain OWNER gbrain' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gbrain')\gexec
REVOKE CONNECT ON DATABASE gbrain FROM PUBLIC;
\connect gbrain
SET client_min_messages = warning;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO \$do\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'auto_rls_on_create_table') THEN
    CREATE OR REPLACE FUNCTION public.auto_enable_rls() RETURNS event_trigger
      LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS \$f\$
      DECLARE obj record;
      BEGIN
        FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
          WHERE object_type = 'table' AND schema_name = 'public'
        LOOP
          EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
        END LOOP;
      END;
      \$f\$;
    ALTER FUNCTION public.auto_enable_rls() OWNER TO gbrain;
    CREATE EVENT TRIGGER auto_rls_on_create_table ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      EXECUTE FUNCTION public.auto_enable_rls();
  END IF;
END
\$do\$;
SQLEOF
}

start_gbrain() {
  local pw attempt
  pw=$(sed -n 's/^GBRAIN_DB_PASSWORD=//p' .env)
  # It goes into a connection URL as it is, so it has to be URL-safe.
  if [[ ! "${pw}" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then
    echo "gbrain: secret gbrain-db-password is missing, or is not 16+ URL-safe characters (openssl rand -hex 32)"
    return 1
  fi
  # Postgres restarts once while it initialises a new volume; retry across it.
  for attempt in 1 2 3 4 5 6; do
    if provision_gbrain_db "${pw}"; then
      break
    fi
    if [[ "${attempt}" == 6 ]]; then
      echo "gbrain: could not prepare its database"
      return 1
    fi
    sleep 5
  done
  docker compose --profile gbrain up -d gbrain
}

if [[ -n "${GBRAIN_IMAGE}" ]]; then
  if start_gbrain; then
    echo "gbrain: started"
  else
    echo "WARNING: gbrain did not start (see above); the hub itself is unaffected"
  fi
fi

echo "=== hub startup complete $(date -Is) ==="
