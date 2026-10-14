<#
.SYNOPSIS
    Set up Little Gerry for a new company: brand.json, Google Cloud, signing,
    GitHub secrets and (optionally) the hub VM.

.DESCRIPTION
    Interactive. Performs WHITE-LABEL-PLAN.md §4.1–4.9 with gcloud, gsutil,
    gh and PowerShell, re-runnable: anything that already exists is kept.
    Three steps are console-only (OAuth consent screen, OAuth clients, the
    HTTPS load balancer + IAP); the script stops at each, prints the exact
    instructions with the values filled in, and continues when you paste the
    result.

    Run from the fork's checkout, signed in to gcloud (an account that can
    create projects under the company's billing account) and to gh (the fork).

.PARAMETER Answers
    A JSON file with the answers (same keys the prompts ask for) to run
    without prompting. Missing keys are still prompted.

.PARAMETER DryRun
    Print every external command instead of running it. Nothing is created.

.PARAMETER SkipHub
    Stop after GitHub + signing; do not create the hub VM.

.EXAMPLE
    .\scripts\new-company\bootstrap.ps1
    .\scripts\new-company\bootstrap.ps1 -Answers .\noctu-answers.json -DryRun
#>
[CmdletBinding()]
param(
    [string]$Answers = "",
    [switch]$DryRun,
    [switch]$SkipHub
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

# ── Helpers ─────────────────────────────────────────────────────────────────
$script:A = @{}
if ($Answers -and (Test-Path $Answers)) {
    (Get-Content $Answers -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $script:A[$_.Name] = $_.Value }
}

function Ask([string]$key, [string]$prompt, [string]$default = "", [switch]$Secret) {
    if ($script:A.ContainsKey($key)) { return "$($script:A[$key])" }
    $suffix = if ($default) { " [$default]" } else { "" }
    if ($Secret) {
        $s = Read-Host -AsSecureString "  $prompt"
        $v = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    } else {
        $v = Read-Host "  $prompt$suffix"
    }
    if (-not $v) { $v = $default }
    $script:A[$key] = $v
    return $v
}

function Step([string]$title) { Write-Host "`n== $title ==" -ForegroundColor Cyan }
function Note([string]$text) { Write-Host "  $text" -ForegroundColor Gray }
function Ok([string]$text) { Write-Host "  [OK] $text" -ForegroundColor Green }

function Run {
    # Run an external command unless -DryRun; returns stdout. No declared
    # parameters on purpose: tool flags such as -c or -l must reach the tool.
    $Cmd = @($args | ForEach-Object { $_ })
    if ($DryRun) { Write-Host "  > $($Cmd -join ' ')" -ForegroundColor DarkYellow; return "" }
    $exe, $rest = $Cmd
    $out = & $exe @rest 2>&1
    if ($LASTEXITCODE -ne 0) { throw "command failed ($LASTEXITCODE): $($Cmd -join ' ')`n$out" }
    return ($out -join "`n")
}

function Exists([string[]]$Cmd) {
    if ($DryRun) { return $false }
    $exe, $rest = $Cmd
    & $exe @rest *> $null
    return $LASTEXITCODE -eq 0
}

function Pause-ForConsole([string]$what, [string[]]$instructions) {
    Write-Host ""
    Write-Host "  CONSOLE STEP — $what" -ForegroundColor Yellow
    $instructions | ForEach-Object { Write-Host "    $_" }
    if (-not $DryRun) { Read-Host "  Press Enter when done" | Out-Null }
}

function Rand([int]$bytes = 32) {
    $b = New-Object byte[] $bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
}

foreach ($tool in @("gcloud", "gsutil", "gh", "git")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH. Install it and sign in first." }
}

# ── 1. Brand ────────────────────────────────────────────────────────────────
Step "1. The company (brand/brand.json)"
$company   = Ask company "Company legal name"
$short     = Ask company_short "Short name (used in prose, e.g. PMI)" ($company -split ' ')[0]
$slug      = (Ask slug "Slug (lowercase, letters/digits/dashes; folder and asset names)" ($short.ToLower() -replace '[^a-z0-9-]', '')).ToLower()
$descr     = Ask company_descriptor "One-line descriptor, lowercase, starts with 'a' (e.g. a medical device startup)"
$website   = Ask company_website "Website (https://...)"
$domains   = (Ask domains "Sign-in email domains, comma separated (e.g. acme.com,acme.co)") -split '\s*,\s*' | Where-Object { $_ }
$adminMail = Ask admin_email "Administrator email (first admin; receives feedback)"
$repo      = Ask github_repo "GitHub repository (owner/name) of this fork"
$flagship  = Ask product_name "Flagship product or programme name (blank if none)" ""
$hubUrl    = Ask hub_url "Hub URL (https://hub.<domain>; blank to skip the hub)" ""
$erpDefault = Ask erp_default "ERP default provider (odoo | none)" "none"
$features = @{
    regulatory = $false; qms_agent = $false; drive_restrictions = $false; investor_relations = $false
    budgets = $true; invoices = $true; erp = $true; meetings = $true; hub = [bool]$hubUrl
}
foreach ($f in @("regulatory", "qms_agent", "investor_relations")) {
    $features[$f] = ((Ask "feature_$f" "Enable $f? (y/n)" "n") -match '^y')
}
$appId = Ask windows_app_id "Windows AppId GUID (blank = generate)" ""
if (-not $appId) { $appId = "{" + ([guid]::NewGuid().ToString().ToUpper()) + "}" }
$tld = ($domains[0] -split '\.')[-1]; $dom2 = ($domains[0] -split '\.')[0]
$bundleId = Ask macos_bundle_id "macOS bundle id" "$tld.$dom2.littlegerry"
$project  = Ask gcp_project "Google Cloud project id (new or existing)" "$slug-littlegerry"
$region   = Ask gcp_region "GCP region" "us-central1"
$zone     = Ask gcp_zone "GCP zone" "$region-a"

$brand = [ordered]@{
    slug = $slug; product_name = "Little Gerry"; assistant_name = "Gerry"
    publisher = $company; company_name = $company; company_short = $short; company_descriptor = $descr
    company_website = $website
    product = if ($flagship) { [ordered]@{ name = $flagship; one_liner = ""; engineering_context = "" } } else { [ordered]@{} }
    domains = @($domains); admin_email = $adminMail; support_email = $adminMail
    vapid_subject = "mailto:$adminMail"; github_repo = $repo; hub_url = $hubUrl
    windows = [ordered]@{ app_id = $appId; install_dir_name = "Little Gerry ($short)"; setup_name = "LittleGerry_${short}_Setup" -replace '[^A-Za-z0-9_]', ''; cert_cn = $company }
    macos = [ordered]@{ bundle_id = $bundleId; pkg_name = "LittleGerry-$short" -replace '[^A-Za-z0-9_-]', '' }
    data_dir_name = ".littlegerry-$slug"; keyring_service = "littlegerry-$slug"
    db = [ordered]@{ name = "littlegerry"; superuser = "lg"; app_role = "lg_app"; audit_role = "lg_audit"; api_container = "lg_api"; postgres_container = "lg_postgres" }
    drive = [ordered]@{ company_context = ""; templates_folder = ""; workrooms_share_folder = ""; budgets_folder = ""; invoices_folder = ""; backups_folder = ""; app_clients_folder = ""; restricted_folders = @(); shared_drive_name = ""; hub_client_file = ""; oauth_client_download_url = ""; stt_key_download_url = "" }
    gcp = [ordered]@{ stt_bucket = "$slug-stt"; drive_backup_bucket = "$slug-drive-backup"; project = $project; region = $region; zone = $zone; hub_vm = "hub"; registry = "$region-docker.pkg.dev"; image_repo = $slug; hub_backup_bucket = "$slug-hub-backup"; iap_audience = "" }
    features = $features
    erp = [ordered]@{ providers = @("odoo"); default = $erpDefault }
    agents = @("executive_assistant", "house_manager", "research", "operations", "engineering") + $(if ($features.qms_agent) { @("qms") } else { @() }) + $(if ($features.regulatory) { @("regulatory") } else { @() }) + $(if ($features.investor_relations) { @("ir") } else { @() })
}
$brandPath = Join-Path $root "brand\brand.json"
$json = $brand | ConvertTo-Json -Depth 6
if ($DryRun) { Write-Host $json -ForegroundColor DarkYellow } else {
    New-Item -ItemType Directory -Force -Path (Split-Path $brandPath) | Out-Null
    [IO.File]::WriteAllText($brandPath, $json + "`n", (New-Object Text.UTF8Encoding $false))
    Ok "wrote brand/brand.json"
}

# ── 2. Google Cloud project ─────────────────────────────────────────────────
Step "2. Google Cloud project $project"
if (-not (Exists @("gcloud", "projects", "describe", $project))) {
    $billing = Ask gcp_billing_account "Billing account id (XXXXXX-XXXXXX-XXXXXX)"
    Run gcloud projects create $project --name="$company Assistant"
    Run gcloud billing projects link $project --billing-account=$billing
    Ok "project created"
} else { Ok "project exists" }
Run gcloud config set project $project
$apis = "drive.googleapis.com gmail.googleapis.com calendar-json.googleapis.com people.googleapis.com docs.googleapis.com sheets.googleapis.com slides.googleapis.com tasks.googleapis.com speech.googleapis.com texttospeech.googleapis.com storage.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com compute.googleapis.com iap.googleapis.com cloudresourcemanager.googleapis.com" -split ' '
Run gcloud services enable @apis
Ok "APIs enabled"
$projectNumber = if ($DryRun) { "<project-number>" } else { (Run gcloud projects describe $project --format="value(projectNumber)").Trim() }

Pause-ForConsole "OAuth consent screen" @(
    "https://console.cloud.google.com/apis/credentials/consent?project=$project",
    "User type: Internal. App name: Little Gerry. Support email: $adminMail.",
    "Scopes: the 17 in backend/services/google_service.py (Drive, Gmail, Calendar, Contacts, Docs, Sheets, Slides, Tasks, userinfo).",
    "Publishing status must be 'In production' (in Testing, refresh tokens expire after 7 days)."
)
Pause-ForConsole "OAuth clients" @(
    "https://console.cloud.google.com/apis/credentials?project=$project",
    "1) Desktop app  -> download JSON as google_credentials.json (each user uploads it on the login page).",
    "2) Web application 'Hub web' -> redirect URI https://$($hubUrl -replace '^https?://','')/api/auth/google/callback (hub only). Download JSON.",
    "3) Desktop app 'Hub desktop (IAP)' (hub only) -> download as hub_client.json; later added to IAP's programmatic access allowlist."
)
$webClientJson = ""
if ($hubUrl) {
    $p = Ask hub_web_client_json_path "Path to the downloaded Hub web client JSON" ""
    if ($p -and (Test-Path $p)) { $webClientJson = (Get-Content $p -Raw) -replace '\s+', '' }
}

# Speech-to-Text service account + bucket
$sttSa = "stt-batch@$project.iam.gserviceaccount.com"
if (-not (Exists @("gcloud", "iam", "service-accounts", "describe", $sttSa))) {
    Run gcloud iam service-accounts create stt-batch --display-name="STT batch"
}
if (-not (Exists @("gsutil", "ls", "-b", "gs://$($brand.gcp.stt_bucket)"))) {
    Run gsutil mb -l us -b on "gs://$($brand.gcp.stt_bucket)"
    $lc = Join-Path $env:TEMP "lg-stt-lifecycle.json"
    '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' | Set-Content $lc
    Run gsutil lifecycle set $lc "gs://$($brand.gcp.stt_bucket)"
}
Run gcloud projects add-iam-policy-binding $project --member="serviceAccount:$sttSa" --role=roles/speech.client
Run gsutil iam ch "serviceAccount:${sttSa}:objectAdmin" "gs://$($brand.gcp.stt_bucket)"
$sttKey = Join-Path $root "backend\google_stt_sa.json"
if (-not (Test-Path $sttKey)) {
    Run gcloud iam service-accounts keys create $sttKey --iam-account=$sttSa
    Note "wrote backend/google_stt_sa.json (gitignored) — distribute via the app-clients Drive folder; users upload it in Meetings."
}
Ok "speech-to-text ready"

# Drive backup monitor bucket + viewer SA
$dbb = $brand.gcp.drive_backup_bucket
if (-not (Exists @("gsutil", "ls", "-b", "gs://$dbb"))) {
    Run gsutil mb -c nearline -l us -b on "gs://$dbb"
    Run gsutil versioning set on "gs://$dbb"
}
$viewerSa = "backup-viewer@$project.iam.gserviceaccount.com"
if (-not (Exists @("gcloud", "iam", "service-accounts", "describe", $viewerSa))) {
    Run gcloud iam service-accounts create backup-viewer --display-name="Drive backup viewer"
}
Run gsutil iam ch "serviceAccount:${viewerSa}:objectViewer" "gs://$dbb"
Ok "drive-backup bucket ready (set up the Drive→GCS transfer job in the console when wanted)"

# ── 3. GitHub: update token + secrets ───────────────────────────────────────
Step "3. GitHub ($repo)"
$pat = Ask update_token "Fine-grained PAT for $repo (Contents: read) used by the installed app to poll releases" -Secret
if ($pat) { if (-not $DryRun) { $pat | gh secret set UPDATE_TOKEN --repo $repo } else { Note "> gh secret set UPDATE_TOKEN" }; Ok "UPDATE_TOKEN set" }
Run gh variable set UPSTREAM_REPO --repo $repo --body "soulenya/pmi-agent"
Ok "UPSTREAM_REPO variable set (Sync upstream workflow)"

# ── 4. Windows code signing ─────────────────────────────────────────────────
Step "4. Windows code signing"
$pfx = Join-Path $root "installer\cert\LittleGerry-Signing.pfx"
if (-not (Test-Path $pfx)) {
    Note "Creating a self-signed certificate (CN=$company). You will be asked for a password to protect the .pfx."
    if (-not $DryRun) { & (Join-Path $root "installer\cert\1-Create-Signing-Certificate.ps1") }
} else { Ok "signing certificate exists" }
if (Test-Path $pfx) {
    $pfxPass = Ask windows_cert_password "The .pfx password (stored as the Actions secret WINDOWS_CERT_PASSWORD)" -Secret
    if (-not $DryRun) {
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfx)) | gh secret set WINDOWS_CERT_PFX_BASE64 --repo $repo
        $pfxPass | gh secret set WINDOWS_CERT_PASSWORD --repo $repo
        & (Join-Path $root "installer\cert\3-Make-Trust-Bat.ps1")
    }
    Ok "signing secrets set; trust batch built"
}

# ── 5. The hub ──────────────────────────────────────────────────────────────
if ($SkipHub -or -not $hubUrl) { Step "Done (no hub)"; Note "Commit brand/brand.json and publish a release; the workflows build the installers."; return }

Step "5. The hub ($hubUrl)"
$registry = $brand.gcp.registry
if (-not (Exists @("gcloud", "artifacts", "repositories", "describe", $slug, "--location=$region"))) {
    Run gcloud artifacts repositories create $slug --repository-format=docker --location=$region
}
Run gcloud auth configure-docker $registry --quiet
$image = "$registry/$project/$slug/backend:latest"
Note "Building and pushing the backend image ($image) — a few minutes."
Run docker build -f backend/Dockerfile -t $image .
Run docker push $image
Ok "image pushed"

# Secrets
$secretNames = "db-superuser-password db-password db-audit-password jwt-secret fernet-key anthropic-api-key voyage-api-key google-api-key google-oauth-client vapid-public-key vapid-private-key" -split ' '
foreach ($s in $secretNames) {
    if (-not (Exists @("gcloud", "secrets", "describe", $s))) { Run gcloud secrets create $s --replication-policy=automatic }
}
function AddVersion([string]$name, [string]$value) {
    if (-not $value) { return }
    if ($DryRun) { Note "> gcloud secrets versions add $name"; return }
    $tmp = New-TemporaryFile; [IO.File]::WriteAllText($tmp, $value); & gcloud secrets versions add $name --data-file=$tmp *> $null; Remove-Item $tmp
}
if (-not (Exists @("gcloud", "secrets", "versions", "access", "latest", "--secret=jwt-secret"))) {
    AddVersion "db-superuser-password" (Rand 32); AddVersion "db-password" (Rand 32); AddVersion "db-audit-password" (Rand 32)
    AddVersion "jwt-secret" (Rand 48)
    $fernet = if ($DryRun) { "" } else { (& python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())" 2>$null) }
    if (-not $fernet) { $fernet = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ })) -replace '\+', '-' -replace '/', '_' }
    AddVersion "fernet-key" $fernet
    Ok "database, JWT and Fernet secrets generated"
} else { Ok "core secrets already have versions" }
AddVersion "anthropic-api-key" (Ask anthropic_api_key "Anthropic API key for the hub (blank to skip)" -Secret)
AddVersion "voyage-api-key" (Ask voyage_api_key "Voyage API key for the hub (blank to skip)" -Secret)
AddVersion "google-api-key" (Ask google_api_key "Google API key (Speech/TTS) for the hub (blank to skip)" -Secret)
if ($webClientJson) { AddVersion "google-oauth-client" $webClientJson }
$vapidPub = Ask vapid_public_key "VAPID public key (from: python -m py_vapid --gen; blank to skip push)" ""
if ($vapidPub) { AddVersion "vapid-public-key" $vapidPub; AddVersion "vapid-private-key" (Ask vapid_private_key "VAPID private key" -Secret) }

# Hub backup bucket + VM service account roles
$hbb = $brand.gcp.hub_backup_bucket
if (-not (Exists @("gsutil", "ls", "-b", "gs://$hbb"))) { Run gsutil mb -l us -b on "gs://$hbb" }
$vmSa = "$projectNumber-compute@developer.gserviceaccount.com"
Run gcloud projects add-iam-policy-binding $project --member="serviceAccount:$vmSa" --role=roles/secretmanager.secretAccessor
Run gcloud projects add-iam-policy-binding $project --member="serviceAccount:$vmSa" --role=roles/artifactregistry.reader
Run gsutil iam ch "serviceAccount:${vmSa}:objectCreator" "gs://$hbb"

# VM + NAT
$hubDomain = $hubUrl -replace '^https?://', ''
$meta = "project=$project,region=$region,registry=$registry,image=$image,hub-domain=$hubDomain,backup-bucket=$hbb,db-name=$($brand.db.name),db-superuser=$($brand.db.superuser),db-app-role=$($brand.db.app_role),db-audit-role=$($brand.db.audit_role),api-container=$($brand.db.api_container),postgres-container=$($brand.db.postgres_container),vapid-subject=mailto:$adminMail"
if (-not (Exists @("gcloud", "compute", "instances", "describe", "hub", "--zone=$zone"))) {
    Run gcloud compute instances create hub --zone=$zone --machine-type=e2-standard-2 `
        --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud --boot-disk-size=50GB `
        --no-address --scopes=cloud-platform --metadata=$meta `
        --metadata-from-file="startup-script=$root\scripts\hub-startup.sh"
    Ok "VM created"
} else {
    Run gcloud compute instances add-metadata hub --zone=$zone --metadata=$meta --metadata-from-file="startup-script=$root\scripts\hub-startup.sh"
    Ok "VM metadata updated"
}
if (-not (Exists @("gcloud", "compute", "routers", "describe", "nat-router", "--region=$region"))) {
    Run gcloud compute routers create nat-router --network=default --region=$region
    Run gcloud compute routers nats create nat --router=nat-router --region=$region --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
}
Ok "outbound NAT ready"

Pause-ForConsole "HTTPS load balancer + IAP" @(
    "https://console.cloud.google.com/net-services/loadbalancing/list?project=$project",
    "Unmanaged instance group containing 'hub' (zone $zone, port 8000) -> backend service (health check GET /health/live on 8000)",
    "-> URL map -> HTTPS proxy with a Google-managed certificate for $hubDomain -> global forwarding rule.",
    "DNS: A $hubDomain -> the forwarding rule's IP.",
    "Enable IAP on the backend service; grant roles/iap.httpsResourceAccessor to the Workspace domain(s): $($domains -join ', ').",
    "IAP -> programmatic access: add the 'Hub desktop (IAP)' OAuth client id.",
    "Note the backend service's numeric id."
)
$backendId = Ask iap_backend_service_id "Backend service id (numeric)" ""
if ($backendId) {
    $aud = "/projects/$projectNumber/global/backendServices/$backendId"
    $brand.gcp.iap_audience = $aud
    Run gcloud compute instances add-metadata hub --zone=$zone --metadata="iap-audience=$aud"
    if (-not $DryRun) {
        [IO.File]::WriteAllText($brandPath, ($brand | ConvertTo-Json -Depth 6) + "`n", (New-Object Text.UTF8Encoding $false))
        try { Run gcloud compute ssh hub --zone=$zone --quiet --command="sudo google_metadata_script_runner startup" } catch { Note "startup re-run failed ($_); reboot the VM instead." }
    }
    Ok "IAP audience set; startup script re-run on the VM"
}

Step "Done"
Note "Next: git add brand/brand.json && git commit -m 'brand' && git push; then publish a release (gh release create vX.Y.Z --generate-notes)."
Note "Verify the hub: scripts/hub/deploy-hub.ps1 -VerifyOnly  and  https://$hubDomain/health/live"
