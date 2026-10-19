<#
.SYNOPSIS
    Deploy the current backend image to the company's hub VM.

.DESCRIPTION
    The sequence used for every Little Gerry release, read from brand/brand.json
    (gcp.project, gcp.zone, gcp.hub_vm, gcp.registry, gcp.image_repo, db.*):

      backup -> registry login -> pull -> [alembic upgrade head as the DB
      superuser] -> docker compose up -d --force-recreate api -> verify
      (image digest, alembic head, /health/live)

    Runs over `gcloud compute ssh` (IAP tunnel). Requires a signed-in gcloud.

.PARAMETER Migrate
    Run database migrations before recreating the API. Needed whenever the
    release adds an alembic revision; harmless otherwise.

.PARAMETER Tag
    Image tag to deploy (default: latest).

.PARAMETER UpdateStartupScript
    Push scripts/hub-startup.sh to the VM as its startup-script and set the
    hub-* metadata from the brand (does not run it; the next boot or
    `sudo google_metadata_script_runner startup` applies it).

.PARAMETER VerifyOnly
    Only print image / alembic head / health.

.EXAMPLE
    .\scripts\hub\deploy-hub.ps1
    .\scripts\hub\deploy-hub.ps1 -Migrate
    .\scripts\hub\deploy-hub.ps1 -UpdateStartupScript
#>
[CmdletBinding()]
param(
    [switch]$Migrate,
    [string]$Tag = "latest",
    [switch]$UpdateStartupScript,
    [switch]$VerifyOnly,
    [string]$BrandFile = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $BrandFile) { $BrandFile = Join-Path $root "brand\brand.json" }

# ── Brand → coordinates (PMI's when a key is missing) ───────────────────────
$b = if (Test-Path $BrandFile) { Get-Content $BrandFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
function Pick($value, $default) { if ($null -ne $value -and "$value" -ne "") { "$value" } else { $default } }
$project   = Pick $b.gcp.project "pmi-littlegerry-hub"
$zone      = Pick $b.gcp.zone "us-central1-a"
$vm        = Pick $b.gcp.hub_vm "hub"
$region    = Pick $b.gcp.region "us-central1"
$registry  = Pick $b.gcp.registry "$region-docker.pkg.dev"
$imageRepo = Pick $b.gcp.image_repo "littlegerry"
$image     = "$registry/$project/$imageRepo/backend:$Tag"
$dbName    = Pick $b.db.name "pmi_dev"
$dbSuper   = Pick $b.db.superuser "pmi"
$apiCtr    = Pick $b.db.api_container "pmi_api"
$pgCtr     = Pick $b.db.postgres_container "pmi_postgres"
$hubDomain = (Pick $b.hub_url "https://hub.precisianmedical.com") -replace '^https?://', ''
$backupBkt = Pick $b.gcp.hub_backup_bucket "$project-backup"
$iapAud    = Pick $b.gcp.iap_audience ""
$vapidSubj = Pick $b.vapid_subject ""

$gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $gcloud) {
    $candidate = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
    if (Test-Path $candidate) { $gcloud = $candidate } else { throw "gcloud not found on PATH." }
} else { $gcloud = $gcloud.Source }
# The SDK's gcloud.ps1 wrapper turns stderr notices into terminating errors; use the .cmd beside it.
if ($gcloud -like "*.ps1") { $gcloud = $gcloud -replace '\.ps1$', '.cmd' }

function Remote([string]$script) {
    # Base64 keeps quoting out of the way; the VM decodes and runs as root.
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script.Replace("`r`n", "`n")))
    & $gcloud compute ssh $vm --project $project --zone $zone --quiet --command="echo $b64 | base64 -d | sudo bash"
    if ($LASTEXITCODE -ne 0) { throw "remote step failed ($LASTEXITCODE)" }
}

Write-Host "== hub deploy: $vm ($project/$zone) image $image" -ForegroundColor Cyan

if ($UpdateStartupScript) {
    $startup = Join-Path $root "scripts\hub-startup.sh"
    $meta = @(
        "project=$project", "region=$region", "registry=$registry", "image=$image",
        "hub-domain=$hubDomain", "backup-bucket=$backupBkt",
        "db-name=$dbName", "db-superuser=$dbSuper",
        "db-app-role=$(Pick $b.db.app_role 'pmi_app')", "db-audit-role=$(Pick $b.db.audit_role 'pmi_audit')",
        "api-container=$apiCtr", "postgres-container=$pgCtr"
    )
    if ($iapAud) { $meta += "iap-audience=$iapAud" }
    if ($vapidSubj) { $meta += "vapid-subject=$vapidSubj" }
    Write-Host "  setting metadata: $($meta -join ', ')"
    $metaArg = "--metadata=" + ($meta -join ",")
    $fileArg = "--metadata-from-file=startup-script=$startup"
    & $gcloud compute instances add-metadata $vm --project $project --zone $zone $metaArg $fileArg
    if ($LASTEXITCODE -ne 0) { throw "add-metadata failed" }
    Write-Host "  startup script updated. It applies on the next boot (or: sudo google_metadata_script_runner startup)."
    return
}

$verify = @"
echo "== verify"
docker inspect --format '{{.Image}}' $apiCtr
docker exec $pgCtr psql -U $dbSuper -d $dbName -tAc 'select version_num from alembic_version'
curl -s -o /dev/null -w "health=%{http_code}\n" localhost:8000/health/live
"@

if ($VerifyOnly) { Remote $verify; return }

$migrateStep = ""
if ($Migrate) {
    $migrateStep = @"
echo "== blockers (idle in transaction)"
docker exec $pgCtr psql -U $dbSuper -d $dbName -tAc "select count(*) from pg_stat_activity where datname='$dbName' and state='idle in transaction'"
echo "== migrate"
API_IMAGE=$image docker compose up -d postgres 2>&1 | tail -1
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do docker exec $pgCtr pg_isready -U $dbSuper -d $dbName >/dev/null 2>&1 && break; sleep 5; done
sudo bash -c 'PW=`$(sed -n "s/^POSTGRES_SUPERUSER_PASSWORD=//p" /opt/littlegerry/.env); docker run --rm --network littlegerry_default --env-file /opt/littlegerry/.env -e PGPASSWORD=`$PW -e DATABASE_URL=postgresql+asyncpg://$dbSuper@postgres:5432/$dbName -e DATABASE_URL_SYNC=postgresql://$dbSuper@postgres:5432/$dbName --entrypoint alembic $image upgrade head' 2>&1 | tail -3
"@
}

$script = @"
cd /opt/littlegerry
echo "== backup"
sudo bash /opt/littlegerry/scripts/backup.sh 2>&1 | tail -1
echo "== login"
sudo bash -c 'curl -sf -H Metadata-Flavor:Google http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | jq -r .access_token | docker login -u oauth2accesstoken --password-stdin https://$registry' 2>&1 | tail -1
echo "== pull"
API_IMAGE=$image docker compose pull -q api 2>&1 | tail -1
$migrateStep
echo "== recreate"
API_IMAGE=$image docker compose up -d --force-recreate api 2>&1 | tail -1
sleep 10
$verify
"@
Remote $script
