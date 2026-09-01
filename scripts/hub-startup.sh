#!/bin/bash
# Little Gerry hub bootstrap. Runs on every boot; safe to re-run.
# NOTE: no `set -x` anywhere — the log would capture the secrets.
set -euo pipefail
exec > >(tee -a /var/log/hub-startup.log) 2>&1
echo "=== hub startup $(date -Is) ==="

PROJECT=pmi-littlegerry-hub
REGISTRY=us-central1-docker.pkg.dev
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
  curl -sf -H "Authorization: Bearer ${TOKEN}" \
    "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/$1/versions/latest:access" \
    | jq -r '.payload.data' | base64 -d
}

echo "${TOKEN}" | docker login -u oauth2accesstoken --password-stdin "https://${REGISTRY}"

mkdir -p "${APP}/scripts"
cd "${APP}"

cat > scripts/init_db.sql <<'SQLEOF'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pmi_app') THEN
        CREATE ROLE pmi_app LOGIN PASSWORD 'placeholder_replaced_at_init';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pmi_audit') THEN
        CREATE ROLE pmi_audit LOGIN PASSWORD 'placeholder_replaced_at_init';
    END IF;
END
$$;

GRANT CONNECT ON DATABASE pmi_dev TO pmi_app;
GRANT CONNECT ON DATABASE pmi_dev TO pmi_audit;
GRANT USAGE ON SCHEMA public TO pmi_app;
GRANT USAGE ON SCHEMA public TO pmi_audit;
SQLEOF

cat > scripts/init_db_hub.sh <<'SHEOF'
#!/bin/bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    ALTER ROLE pmi_app   WITH PASSWORD '${PMI_APP_PASSWORD}';
    ALTER ROLE pmi_audit WITH PASSWORD '${PMI_AUDIT_PASSWORD}';
EOSQL
SHEOF
chmod +x scripts/init_db_hub.sh

cat > docker-compose.yml <<'YMLEOF'
services:
  postgres:
    image: pgvector/pgvector:pg16@sha256:00ba258a66dac104fd5171074a0084462a64a1369d8513f3d0a634e2f24d15bc
    container_name: pmi_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: pmi
      POSTGRES_PASSWORD: ${POSTGRES_SUPERUSER_PASSWORD:?required}
      POSTGRES_DB: pmi_dev
      PMI_APP_PASSWORD: ${PMI_APP_PASSWORD:?required}
      PMI_AUDIT_PASSWORD: ${PMI_AUDIT_PASSWORD:?required}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init_db.sql:/docker-entrypoint-initdb.d/01_init.sql:ro
      - ./scripts/init_db_hub.sh:/docker-entrypoint-initdb.d/02_passwords.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pmi -d pmi_dev"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    image: ${API_IMAGE:-us-central1-docker.pkg.dev/pmi-littlegerry-hub/littlegerry/backend:latest}
    container_name: pmi_api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql+asyncpg://pmi_app:${PMI_APP_PASSWORD}@postgres:5432/pmi_dev
      DATABASE_URL_SYNC: postgresql://pmi_app:${PMI_APP_PASSWORD}@postgres:5432/pmi_dev
      JWT_SECRET: ${JWT_SECRET:?required}
      FERNET_KEY: ${FERNET_KEY:?required}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      CORS_ORIGINS: ${CORS_ORIGINS:-["https://hub.precisianmedical.com"]}
      HUB_MODE: "true"
      IAP_AUDIENCE: /projects/200809642986/global/backendServices/3249219135556043655
      STORAGE_ROOT: /data/documents
      HOST: 0.0.0.0
      PORT: "8000"
    volumes:
      - appdata:/data
    ports:
      - "8000:8000"

volumes:
  postgres_data:
    driver: local
  appdata:
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
} > .env
chmod 600 .env

# ── Nightly backup ──────────────────────────────────────────────────────
# Installed before the image pull so a registry hiccup can't skip it.
cat > scripts/backup.sh <<'BAKEOF'
#!/bin/bash
# Nightly hub backup: database dump + uploaded files to GCS.
# Retention is a 30-day bucket lifecycle rule, not this script's job.
set -euo pipefail
BUCKET=pmi-littlegerry-hub-backup
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

set -a
. /opt/littlegerry/.env
set +a

docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" pmi_postgres \
  pg_dump -U pmi -d pmi_dev --no-owner --no-acl \
  | gzip -9 > "$TMP/db.sql.gz"
upload "$TMP/db.sql.gz" "db/pmi_dev-${STAMP}.sql.gz"

# Documents, regulatory store and conversation backups all live under /data.
VOL=$(docker inspect pmi_api -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
docker run --rm -v "${VOL}:/data:ro" -v "$TMP:/out" alpine \
  tar czf /out/data.tar.gz -C /data .
upload "$TMP/data.tar.gz" "files/data-${STAMP}.tar.gz"

echo "backup ok ${STAMP} db=$(stat -c%s "$TMP/db.sql.gz") files=$(stat -c%s "$TMP/data.tar.gz")"
BAKEOF
chmod 700 scripts/backup.sh

cat > scripts/restore.sh <<'RSTEOF'
#!/bin/bash
# Restore a database backup from GCS.
#   restore.sh                        newest backup -> scratch DB (a drill)
#   restore.sh db/pmi_dev-X.sql.gz pmi_dev   real restore, API stopped first
set -euo pipefail
BUCKET=pmi-littlegerry-hub-backup
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

set -a
. /opt/littlegerry/.env
set +a
PG="docker exec -e PGPASSWORD=${POSTGRES_SUPERUSER_PASSWORD} pmi_postgres"

if [[ "${TARGET}" == "pmi_dev" ]]; then
  docker stop pmi_api
fi

${PG} psql -U pmi -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"${TARGET}\"" \
  -c "CREATE DATABASE \"${TARGET}\" OWNER pmi" >/dev/null
gunzip -c "$TMP/db.sql.gz" \
  | docker exec -i -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" pmi_postgres \
      psql -U pmi -d "${TARGET}" -q -v ON_ERROR_STOP=1 >/dev/null

TABLES=$(${PG} psql -U pmi -d "${TARGET}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "restored ${OBJ} -> ${TARGET}: ${TABLES} tables"

if [[ "${TARGET}" == "pmi_dev" ]]; then
  docker start pmi_api
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

echo "=== hub startup complete $(date -Is) ==="
