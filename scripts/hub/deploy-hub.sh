#!/bin/bash
# Deploy the current backend image to the company's hub VM (macOS/Linux twin of
# deploy-hub.ps1). Coordinates come from brand/brand.json; PMI's when absent.
#
#   scripts/hub/deploy-hub.sh              pull latest, recreate api, verify
#   scripts/hub/deploy-hub.sh --migrate    also run alembic upgrade head as the DB superuser
#   scripts/hub/deploy-hub.sh --tag 5.22.0
#   scripts/hub/deploy-hub.sh --verify
#   scripts/hub/deploy-hub.sh --update-startup-script
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRAND="$ROOT/brand/brand.json"

MIGRATE=0; VERIFY=0; UPDATE_STARTUP=0; TAG=latest
while [ $# -gt 0 ]; do
  case "$1" in
    --migrate) MIGRATE=1 ;;
    --verify) VERIFY=1 ;;
    --update-startup-script) UPDATE_STARTUP=1 ;;
    --tag) TAG="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

pick() { python3 -c "import json,sys
try: b=json.load(open('$BRAND'))
except Exception: b={}
v=b
for k in sys.argv[1].split('.'): v=v.get(k) if isinstance(v,dict) else None
print(v if v not in (None,'') else sys.argv[2])" "$1" "$2"; }

PROJECT=$(pick gcp.project pmi-littlegerry-hub)
ZONE=$(pick gcp.zone us-central1-a)
VM=$(pick gcp.hub_vm hub)
REGION=$(pick gcp.region us-central1)
REGISTRY=$(pick gcp.registry "${REGION}-docker.pkg.dev")
IMAGE_REPO=$(pick gcp.image_repo littlegerry)
IMAGE="${REGISTRY}/${PROJECT}/${IMAGE_REPO}/backend:${TAG}"
DB_NAME=$(pick db.name pmi_dev); DB_SUPER=$(pick db.superuser pmi)
API_CTR=$(pick db.api_container pmi_api); PG_CTR=$(pick db.postgres_container pmi_postgres)
HUB_DOMAIN=$(pick hub_url https://hub.precisianmedical.com | sed -E 's#^https?://##')
BACKUP_BKT=$(pick gcp.hub_backup_bucket "${PROJECT}-backup")
IAP_AUD=$(pick gcp.iap_audience "")
VAPID_SUBJ=$(pick vapid_subject "")

remote() {  # run a root shell script on the VM over IAP ssh
  local b64; b64=$(printf '%s' "$1" | base64 | tr -d '\n')
  gcloud compute ssh "$VM" --project "$PROJECT" --zone "$ZONE" --quiet --command="echo $b64 | base64 -d | sudo bash"
}

echo "== hub deploy: $VM ($PROJECT/$ZONE) image $IMAGE"

if [ "$UPDATE_STARTUP" = 1 ]; then
  META="project=$PROJECT,region=$REGION,registry=$REGISTRY,image=$IMAGE,hub-domain=$HUB_DOMAIN,backup-bucket=$BACKUP_BKT"
  META="$META,db-name=$DB_NAME,db-superuser=$DB_SUPER,db-app-role=$(pick db.app_role pmi_app),db-audit-role=$(pick db.audit_role pmi_audit)"
  META="$META,api-container=$API_CTR,postgres-container=$PG_CTR"
  [ -n "$IAP_AUD" ] && META="$META,iap-audience=$IAP_AUD"
  [ -n "$VAPID_SUBJ" ] && META="$META,vapid-subject=$VAPID_SUBJ"
  gcloud compute instances add-metadata "$VM" --project "$PROJECT" --zone "$ZONE" \
    --metadata="$META" --metadata-from-file="startup-script=$ROOT/scripts/hub-startup.sh"
  echo "  startup script updated. It applies on the next boot (or: sudo google_metadata_script_runner startup)."
  exit 0
fi

VERIFY_SCRIPT="echo '== verify'
docker inspect --format '{{.Image}}' $API_CTR
docker exec $PG_CTR psql -U $DB_SUPER -d $DB_NAME -tAc 'select version_num from alembic_version'
curl -s -o /dev/null -w 'health=%{http_code}\n' localhost:8000/health/live"

if [ "$VERIFY" = 1 ]; then remote "$VERIFY_SCRIPT"; exit 0; fi

MIGRATE_SCRIPT=""
if [ "$MIGRATE" = 1 ]; then
  MIGRATE_SCRIPT="echo '== migrate'
API_IMAGE=$IMAGE docker compose up -d postgres 2>&1 | tail -1
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do docker exec $PG_CTR pg_isready -U $DB_SUPER -d $DB_NAME >/dev/null 2>&1 && break; sleep 5; done
sudo bash -c 'PW=\$(sed -n \"s/^POSTGRES_SUPERUSER_PASSWORD=//p\" /opt/littlegerry/.env); docker run --rm --network littlegerry_default --env-file /opt/littlegerry/.env -e PGPASSWORD=\$PW -e DATABASE_URL=postgresql+asyncpg://$DB_SUPER@postgres:5432/$DB_NAME -e DATABASE_URL_SYNC=postgresql://$DB_SUPER@postgres:5432/$DB_NAME --entrypoint alembic $IMAGE upgrade head' 2>&1 | tail -3"
fi

remote "cd /opt/littlegerry
echo '== backup'
sudo bash /opt/littlegerry/scripts/backup.sh 2>&1 | tail -1
echo '== login'
sudo bash -c 'curl -sf -H Metadata-Flavor:Google http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | jq -r .access_token | docker login -u oauth2accesstoken --password-stdin https://$REGISTRY' 2>&1 | tail -1
echo '== pull'
API_IMAGE=$IMAGE docker compose pull -q api 2>&1 | tail -1
$MIGRATE_SCRIPT
echo '== recreate'
API_IMAGE=$IMAGE docker compose up -d --force-recreate api 2>&1 | tail -1
sleep 10
$VERIFY_SCRIPT"
