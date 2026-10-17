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
    Windows PowerShell 5+ or PowerShell 7 (pwsh) on macOS/Linux; the signing
    certificate is made with the Windows certificate store or openssl.

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
$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
Set-Location $root
$IsWin = ($env:OS -eq "Windows_NT")
# On Windows PowerShell resolves `gcloud` to the SDK's .ps1 wrapper, which turns stderr into errors.
$script:gcloud = if ($IsWin) { "gcloud.cmd" } else { "gcloud" }
$tmpDir = [IO.Path]::GetTempPath()

# ── Helpers ─────────────────────────────────────────────────────────────────
$script:A = @{}
if ($Answers -and (Test-Path $Answers)) {
    (Get-Content $Answers -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $script:A[$_.Name] = $_.Value }
}

function Ask([string]$key, [string]$prompt, [string]$default = "", [switch]$Secret, [string]$Pattern = "", [string]$Hint = "") {
    if ($script:A.ContainsKey($key)) { return "$($script:A[$key])" }
    $suffix = if ($default) { " [$default]" } else { "" }
    $tries = 0
    while ($true) {
        if ([Console]::IsInputRedirected) {
            # Unattended (stdin is a file or nul): take the default, never loop.
            $v = $default; break
        }
        if ($Secret) {
            $s = Read-Host -AsSecureString "  $prompt"
            $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
        } else {
            $v = Read-Host "  $prompt$suffix"
        }
        $v = "$v".Trim()
        if (-not $v) { $v = $default }
        $tries++
        # A multi-line paste (a sample curl command, a key with its label) would
        # otherwise be spread over this and the following prompts.
        if ($v -match '[\r\n]' -or ($Secret -and $v -match '\s')) {
            if ($tries -ge 3) { $v = ""; break }
            Write-Host "  That contains line breaks or spaces - paste only the value." -ForegroundColor Yellow; continue
        }
        if ($v -and $Pattern -and $v -notmatch $Pattern) {
            if ($tries -ge 3) { $v = ""; break }
            Write-Host "  Not the expected form$(if ($Hint) { " ($Hint)" }). Blank to skip." -ForegroundColor Yellow; continue
        }
        break
    }
    $script:A[$key] = $v
    return $v
}

function Ask-Required([string]$key, [string]$prompt, [string]$default = "", [string]$Pattern = "", [string]$Hint = "") {
    while ($true) {
        $v = Ask $key $prompt $default -Pattern $Pattern -Hint $Hint
        if ($v) { return $v }
        if ([Console]::IsInputRedirected) { throw "answer '$key' is required (add it to the -Answers file)." }
        $script:A.Remove($key); Write-Host "  Required." -ForegroundColor Yellow
    }
}

function Retry([int]$times, [int]$waitSec, [scriptblock]$body) {
    # IAM reads a new service account a few seconds after create returns.
    for ($i = 1; $i -le $times; $i++) {
        try { return (& $body) } catch { if ($i -eq $times) { throw }; Start-Sleep -Seconds ($waitSec * $i) }
    }
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
    if ($exe -eq "gcloud") { $exe = $script:gcloud }
    $out = & $exe @rest 2>&1
    if ($LASTEXITCODE -ne 0) { throw "command failed ($LASTEXITCODE): $($Cmd -join ' ')`n$out" }
    return ($out -join "`n")
}

function Exists([string[]]$Cmd) {
    if ($DryRun) { return $false }
    $exe, $rest = $Cmd
    if ($exe -eq "gcloud") { $exe = $script:gcloud }
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

foreach ($tool in @("gcloud", "gsutil", "gh", "git", "docker")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH. Install it first: https://cli.github.com , https://cloud.google.com/sdk/docs/install , https://www.docker.com/products/docker-desktop" }
}
if (-not $IsWin -and -not (Get-Command openssl -ErrorAction SilentlyContinue)) { throw "openssl is not on PATH (needed to create the signing certificate)." }

# ── 0. Sign-ins ─────────────────────────────────────────────────────────────
Step "0. Sign-ins"
$ghUser = "<gh-user>"; $acct = "<gcloud-account>"
if (-not $DryRun) {
    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) {
        Note "Signing in to GitHub (a browser window opens; use the account that will own the company's repository)."
        & gh auth login --web --git-protocol https --scopes "repo,workflow"
        if ($LASTEXITCODE -ne 0) { throw "GitHub sign-in failed." }
    }
    $ghUser = (& gh api user --jq .login 2>$null)
    Ok "GitHub: signed in as $ghUser"
    $acct = (& $gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null)
    if (-not $acct) {
        Note "Signing in to Google Cloud (a browser window opens; use the Workspace account that administers the company)."
        & $gcloud auth login --brief
        if ($LASTEXITCODE -ne 0) { throw "Google Cloud sign-in failed." }
        $acct = (& $gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null)
    }
    Ok "Google Cloud: signed in as $acct"
}

# ── 1. GitHub repository ────────────────────────────────────────────────────
Step "1. The company's GitHub repository"
Note "The code lives in a private repository the company owns. An organisation is optional;"
Note "create one first at https://github.com/organizations/plan if you want one, or use the personal account."
$owner    = Ask github_owner "Repository owner (organisation or user)" $ghUser
$repoName = Ask github_repo_name "Repository name" "little-gerry"
$repo     = "$owner/$repoName"
if (Exists @("gh", "repo", "view", $repo)) {
    Ok "repository $repo exists"
} else {
    Note "Creating private repository $repo from this checkout and pushing master."
    Run gh repo create $repo --private --description "Little Gerry - $owner" --disable-wiki
    if (-not $DryRun) {
        & git remote get-url company *> $null
        if ($LASTEXITCODE -ne 0) { & git remote add company "https://github.com/$repo.git" }
        & git push -u company HEAD:master
        if ($LASTEXITCODE -ne 0) { throw "push to $repo failed" }
    } else { Note "> git remote add company https://github.com/$repo.git; git push -u company HEAD:master" }
    Ok "repository created and pushed (remote 'company')"
}
$upstream = "soulenya/pmi-agent"
if (-not $DryRun) {
    & git remote get-url upstream *> $null
    if ($LASTEXITCODE -ne 0) { & git remote add upstream "https://github.com/$upstream.git" *> $null }
}
Run gh variable set UPSTREAM_REPO --repo $repo --body $upstream
Ok "UPSTREAM_REPO = $upstream (the Sync upstream workflow pulls PMI's fixes into a pull request)"
# The upstream is private: the sync workflow needs a read token on it.
$hasUp = (-not $DryRun) -and ((& gh secret list --repo $repo 2>$null) -match '^UPSTREAM_TOKEN\b')
if (-not $hasUp) {
    $upTok = Ask upstream_token "Read-only token on $upstream for the Sync upstream workflow (ask PMI; blank to skip)" -Secret
    if ($upTok) { if (-not $DryRun) { $upTok | gh secret set UPSTREAM_TOKEN --repo $repo } else { Note "> gh secret set UPSTREAM_TOKEN" }; Ok "UPSTREAM_TOKEN set" }
}

# ── 2. Brand ────────────────────────────────────────────────────────────────
Step "2. The company (brand/brand.json)"
$company   = Ask-Required company "Company legal name"
$short     = Ask-Required company_short "Short name (used in prose, e.g. PMI)" ($company -split ' ')[0]
$slug      = (Ask-Required slug "Slug (lowercase, letters/digits/dashes; folder and asset names)" ($short.ToLower() -replace '[^a-z0-9-]', '') -Pattern '^[a-z0-9][a-z0-9-]*$' -Hint "lowercase letters, digits, dashes").ToLower()
$descr     = Ask company_descriptor "One-line descriptor, lowercase, starts with 'a' (e.g. a medical device startup)"
$website   = Ask company_website "Website (https://...)" -Pattern '^https?://\S+$' -Hint "https://..."
$domains   = @((Ask-Required domains "Sign-in email domains, comma separated (e.g. acme.com,acme.co)" -Pattern '^[a-z0-9.-]+\.[a-z]{2,}(\s*,\s*[a-z0-9.-]+\.[a-z]{2,})*$' -Hint "acme.com,acme.co") -split '\s*,\s*' | Where-Object { $_ })
$adminMail = Ask-Required admin_email "Administrator email (first admin; receives feedback)" -Pattern '^[^@\s]+@[^@\s]+\.[^@\s]+$' -Hint "name@$($domains[0])"
$flagship  = Ask product_name "Flagship product or programme name (blank if none)" ""
$hubUrl    = Ask hub_url "Hub URL (https://hub.<domain>; blank to skip the hub)" "" -Pattern '^https://[a-z0-9.-]+$' -Hint "https://hub.$($domains[0])"
$erpDefault = Ask erp_default "ERP default provider (odoo | none)" "none" -Pattern '^(odoo|none)$' -Hint "odoo or none"
$features = @{
    regulatory = $false; qms_agent = $false; drive_restrictions = $false; investor_relations = $false
    budgets = $true; invoices = $true; erp = $true; meetings = $true; hub = [bool]$hubUrl
}
foreach ($f in @("regulatory", "qms_agent", "investor_relations")) {
    $features[$f] = ((Ask "feature_$f" "Enable $f? (y/n)" "n") -match '^y')
}
$appId = Ask windows_app_id "Windows AppId GUID (blank = generate)" "" -Pattern '^\{?[0-9A-Fa-f-]{36}\}?$' -Hint "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
if (-not $appId) { $appId = "{" + ([guid]::NewGuid().ToString().ToUpper()) + "}" }
# Reverse-DNS of the first sign-in domain: acme.co -> co.acme.littlegerry
$domParts = @($domains[0] -split '\.' | Where-Object { $_ }); [array]::Reverse($domParts)
$revDomain = $domParts -join '.'
$bundleId = Ask macos_bundle_id "macOS bundle id" "$revDomain.littlegerry" -Pattern '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' -Hint "co.acme.littlegerry"
$project  = Ask gcp_project "Google Cloud project id (new or existing)" "$slug-littlegerry" -Pattern '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' -Hint "6-30 chars, lowercase letters, digits, dashes"
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
$brandPath = Join-Path $root "brand/brand.json"
$json = $brand | ConvertTo-Json -Depth 6
if ($DryRun) { Write-Host $json -ForegroundColor DarkYellow } else {
    New-Item -ItemType Directory -Force -Path (Split-Path $brandPath) | Out-Null
    [IO.File]::WriteAllText($brandPath, $json + "`n", (New-Object Text.UTF8Encoding $false))
    Ok "wrote brand/brand.json"
}

# ── 3. Google Cloud project ───────────────────────────────────────────────────────────────────
Step "3. Google Cloud project $project"
if (-not (Exists @("gcloud", "projects", "describe", $project))) {
    # Billing: pick an open account, or create one in the console (payment method = web only).
    $billing = if ($script:A.ContainsKey("gcp_billing_account")) { "$($script:A.gcp_billing_account)" } else { "" }
    if (-not $billing -and -not $DryRun) {
        $accounts = @(& $gcloud billing accounts list --filter=open=true --format="value(name,displayName)" 2>$null)
        while (-not $accounts) {
            Pause-ForConsole "Billing account" @(
                "No open billing account is visible to $acct.",
                "Create one (card or invoice) at https://console.cloud.google.com/billing/create",
                "or ask the owner of an existing account to grant $acct the 'Billing Account User' role."
            )
            $accounts = @(& $gcloud billing accounts list --filter=open=true --format="value(name,displayName)" 2>$null)
        }
        if ($accounts.Count -eq 1) {
            $billing = ($accounts[0] -split "`t")[0] -replace '^billingAccounts/', ''
            Note "Using billing account $($accounts[0] -replace "`t", ' - ')"
        } else {
            Write-Host "  Billing accounts:"
            for ($i = 0; $i -lt $accounts.Count; $i++) { Write-Host "    [$($i+1)] $($accounts[$i] -replace "`t", ' - ')" }
            $n = [int](Ask gcp_billing_choice "Choose one" "1")
            $billing = ($accounts[$n - 1] -split "`t")[0] -replace '^billingAccounts/', ''
        }
    }
    if (-not $billing) { $billing = Ask gcp_billing_account "Billing account id (XXXXXX-XXXXXX-XXXXXX)" }
    Run gcloud projects create $project --name="$company Assistant"
    Run gcloud billing projects link $project --billing-account=$billing
    Ok "project created and linked to billing"
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
    $lc = Join-Path $tmpDir "lg-stt-lifecycle.json"
    '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' | Set-Content $lc
    Run gsutil lifecycle set $lc "gs://$($brand.gcp.stt_bucket)"
}
Retry 5 4 { Run gcloud projects add-iam-policy-binding $project --member="serviceAccount:$sttSa" --role=roles/speech.client }
Retry 5 4 { Run gsutil iam ch "serviceAccount:${sttSa}:objectAdmin" "gs://$($brand.gcp.stt_bucket)" }
$sttKey = Join-Path $root "backend/google_stt_sa.json"
if (-not (Test-Path $sttKey)) {
    try {
        Retry 5 4 { Run gcloud iam service-accounts keys create $sttKey --iam-account=$sttSa }
    } catch {
        if ("$_" -notmatch 'disableServiceAccountKeyCreation') { throw }
        # New organisations enforce this constraint by default; a super-admin is
        # not automatically an Org Policy Administrator.
        $orgId = if ($DryRun) { "<org-id>" } else { (& $gcloud projects get-ancestors $project --format="value(id,type)" 2>$null | Where-Object { $_ -match 'organization' } | ForEach-Object { ($_ -split "\s+")[0] } | Select-Object -First 1) }
        Note "Your organisation blocks service-account keys (constraints/iam.disableServiceAccountKeyCreation)."
        $lift = Ask lift_sa_key_policy "Allow key creation in project $project only? (y/n)" "y"
        if ($lift -match '^y') {
            if ($orgId) { & $gcloud organizations add-iam-policy-binding $orgId --member="user:$acct" --role=roles/orgpolicy.policyAdmin --condition=None *> $null }
            Run gcloud resource-manager org-policies disable-enforce iam.disableServiceAccountKeyCreation --project=$project
            Start-Sleep -Seconds 20
            Retry 5 6 { Run gcloud iam service-accounts keys create $sttKey --iam-account=$sttSa }
        } else {
            Pause-ForConsole "Service-account key policy" @(
                "Ask an Organization Policy Administrator to run:",
                "gcloud resource-manager org-policies disable-enforce iam.disableServiceAccountKeyCreation --project=$project",
                "then press Enter."
            )
            Retry 5 6 { Run gcloud iam service-accounts keys create $sttKey --iam-account=$sttSa }
        }
    }
    Note "wrote backend/google_stt_sa.json (gitignored) - distribute via the app-clients Drive folder; users upload it in Meetings."
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
Retry 5 4 { Run gsutil iam ch "serviceAccount:${viewerSa}:objectViewer" "gs://$dbb" }
Ok "drive-backup bucket ready (set up the Drive→GCS transfer job in the console when wanted)"

# ── 4. GitHub: auto-update token ────────────────────────────────────────────
Step "4. GitHub auto-update token ($repo)"
$hasToken = (-not $DryRun) -and ((& gh secret list --repo $repo 2>$null) -match '^UPDATE_TOKEN\b')
if ($hasToken) { Ok "UPDATE_TOKEN already set" } else {
    Pause-ForConsole "Read-only token for the installed app" @(
        "The installed app polls this repository's releases with a fine-grained token (GitHub cannot mint these from the CLI).",
        "https://github.com/settings/personal-access-tokens/new",
        "Token name: little-gerry-updates. Resource owner: $owner. Expiration: 1 year (set a reminder).",
        "Repository access: Only select repositories -> $repoName.",
        "Permissions -> Repository permissions -> Contents: Read-only. Nothing else.",
        "Generate, copy it, and paste it at the next prompt."
    )
    $pat = Ask update_token "Paste the token (blank to skip; installs then cannot self-update)" -Secret
    if ($pat) { if (-not $DryRun) { $pat | gh secret set UPDATE_TOKEN --repo $repo } else { Note "> gh secret set UPDATE_TOKEN" }; Ok "UPDATE_TOKEN set" }
}

# ── 5. Windows code signing ─────────────────────────────────────────────────
Step "5. Windows code signing"
$pfx = Join-Path $root "installer/cert/LittleGerry-Signing.pfx"
if (-not (Test-Path $pfx)) {
    Note "Creating a self-signed certificate (CN=$company). You will be asked for a password to protect the .pfx."
    if (-not $DryRun) { & (Join-Path $root "installer/cert/1-Create-Signing-Certificate.ps1") }
} else { Ok "signing certificate exists" }
if (Test-Path $pfx) {
    $pfxPass = Ask windows_cert_password "The .pfx password (stored as the Actions secret WINDOWS_CERT_PASSWORD)" -Secret
    if (-not $DryRun) {
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfx)) | gh secret set WINDOWS_CERT_PFX_BASE64 --repo $repo
        $pfxPass | gh secret set WINDOWS_CERT_PASSWORD --repo $repo
        & (Join-Path $root "installer/cert/3-Make-Trust-Bat.ps1")
    }
    Ok "signing secrets set; trust batch built"
}

function Commit-Brand {
    # brand.json and the trust batch belong in the company's repository.
    if ($DryRun) { Note "> git add brand/brand.json installer/cert/dist; git commit; git push company"; return }
    & git add brand/brand.json installer/cert/dist 2>$null
    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        & git commit -q -m "brand: $company"
        & git push -q company HEAD:master 2>$null
        if ($LASTEXITCODE -ne 0) { & git push -q origin HEAD:master }
        Ok "brand/brand.json committed and pushed to $repo"
    }
}

# ── 6. The hub ──────────────────────────────────────────────────────────────────────────
if ($SkipHub -or -not $hubUrl) {
    Commit-Brand
    Step "Done (no hub)"
    Note "Publish a release: gh release create v`$(cat VERSION) --repo $repo --generate-notes   (the tag is the VERSION file; bump its patch digit for your own changes)"
    Note "The Windows (and macOS, if signing secrets are set) workflows attach the installers."
    return
}

Step "6. The hub ($hubUrl)"
$registry = $brand.gcp.registry
if (-not (Exists @("gcloud", "artifacts", "repositories", "describe", $slug, "--location=$region"))) {
    Run gcloud artifacts repositories create $slug --repository-format=docker --location=$region
}
Run gcloud auth configure-docker $registry --quiet
$image = "$registry/$project/$slug/backend:latest"
Note "Building and pushing the backend image ($image) - a few minutes."
# The VM is amd64; a plain `docker build` on Apple Silicon would produce an arm64 image it cannot run.
Run docker buildx build --platform linux/amd64 -f backend/Dockerfile -t $image --push .
Ok "image pushed (linux/amd64)"

# Secrets
$secretNames = "db-superuser-password db-password db-audit-password jwt-secret fernet-key anthropic-api-key voyage-api-key google-api-key google-oauth-client vapid-public-key vapid-private-key" -split ' '
foreach ($s in $secretNames) {
    if (-not (Exists @("gcloud", "secrets", "describe", $s))) { Run gcloud secrets create $s --replication-policy=automatic }
}
function AddVersion([string]$name, [string]$value) {
    if (-not $value) { return }
    if ($DryRun) { Note "> gcloud secrets versions add $name"; return }
    $tmp = New-TemporaryFile; [IO.File]::WriteAllText($tmp, $value); & $gcloud secrets versions add $name --data-file=$tmp *> $null; Remove-Item $tmp
    if ($LASTEXITCODE -ne 0) { throw "could not add a version to secret $name" }
}
function HasValue([string]$name) {
    # A secret whose latest version is empty or destroyed counts as missing.
    if ($DryRun) { return $false }
    $v = & $gcloud secrets versions access latest --secret=$name 2>$null
    return ($LASTEXITCODE -eq 0) -and ("$v".Trim().Length -gt 0)
}
function FernetKey {
    # 32 random bytes, urlsafe-base64 - what cryptography.fernet.Fernet.generate_key() produces.
    $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return ([Convert]::ToBase64String($b) -replace '\+', '-' -replace '/', '_')
}
# Each core secret is checked on its own: an earlier run that stopped part-way
# must not leave one of them without a version.
$generated = @()
foreach ($pair in @(@("db-superuser-password", 32), @("db-password", 32), @("db-audit-password", 32), @("jwt-secret", 48))) {
    if (-not (HasValue $pair[0])) { AddVersion $pair[0] (Rand $pair[1]); $generated += $pair[0] }
}
if (-not (HasValue "fernet-key")) { AddVersion "fernet-key" (FernetKey); $generated += "fernet-key" }
if ($generated) { Ok "generated: $($generated -join ', ')" } else { Ok "core secrets already have values" }

function AskKey([string]$key, [string]$prompt, [string]$pattern, [string]$hint) {
    $v = Ask $key "$prompt (blank to skip)" -Secret -Pattern $pattern -Hint $hint
    if ($v) { AddVersion $key.Replace('_', '-') $v; Ok "$($key.Replace('_', '-')) set" }
}
AskKey anthropic_api_key "Anthropic API key for the hub" '^sk-ant-[A-Za-z0-9_-]{20,}$' "starts with sk-ant-"
AskKey voyage_api_key "Voyage API key for the hub" '^pa-[A-Za-z0-9_-]{20,}$' "starts with pa-"
AskKey google_api_key "Google API key (Speech/TTS) for the hub" '^AIza[A-Za-z0-9_-]{30,}$' "starts with AIza"
if ($webClientJson) { AddVersion "google-oauth-client" $webClientJson }
$vapidPub = Ask vapid_public_key "VAPID public key (from: python3 -m py_vapid --gen; blank to skip push)" "" -Pattern '^[A-Za-z0-9_-]{80,100}$' -Hint "87 urlsafe-base64 characters"
if ($vapidPub) { AddVersion "vapid-public-key" $vapidPub; AddVersion "vapid-private-key" (Ask vapid_private_key "VAPID private key" -Secret -Pattern '^[A-Za-z0-9_-]{40,50}$' -Hint "43 urlsafe-base64 characters") }

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
$startup = Join-Path $root "scripts/hub-startup.sh"
if (-not (Exists @("gcloud", "compute", "instances", "describe", "hub", "--zone=$zone"))) {
    Run gcloud compute instances create hub --zone=$zone --machine-type=e2-standard-2 `
        --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud --boot-disk-size=50GB `
        --no-address --scopes=cloud-platform --metadata=$meta `
        --metadata-from-file="startup-script=$startup"
    Ok "VM created"
} else {
    Run gcloud compute instances add-metadata hub --zone=$zone --metadata=$meta --metadata-from-file="startup-script=$startup"
    Ok "VM metadata updated"
}
if (-not (Exists @("gcloud", "compute", "routers", "describe", "nat-router", "--region=$region"))) {
    Run gcloud compute routers create nat-router --network=default --region=$region
    Run gcloud compute routers nats create nat --router=nat-router --region=$region --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
}
Ok "outbound NAT ready"

# ── HTTPS load balancer + IAP (gcloud; the console UI keeps changing) ───────
# Mirrors PMI's hub: unmanaged group with named port http:8000 -> HTTP backend
# service (timeout 3600 s so streaming/WebSocket chat is not cut off) -> URL
# map -> HTTPS proxy with a Google-managed certificate -> static IP.
Step "6b. Load balancer and Identity-Aware Proxy"
if (-not (Exists @("gcloud", "compute", "firewall-rules", "describe", "hub-allow-health-checks"))) {
    Run gcloud compute firewall-rules create hub-allow-health-checks --network=default --direction=INGRESS --allow=tcp:8000 --source-ranges=130.211.0.0/22,35.191.0.0/16
}
if (-not (Exists @("gcloud", "compute", "firewall-rules", "describe", "hub-allow-iap-ssh"))) {
    Run gcloud compute firewall-rules create hub-allow-iap-ssh --network=default --direction=INGRESS --allow=tcp:22 --source-ranges=35.235.240.0/20
}
if (-not (Exists @("gcloud", "compute", "instance-groups", "unmanaged", "describe", "hub-ig", "--zone=$zone"))) {
    Run gcloud compute instance-groups unmanaged create hub-ig --zone=$zone
    Run gcloud compute instance-groups unmanaged add-instances hub-ig --zone=$zone --instances=hub
}
Run gcloud compute instance-groups unmanaged set-named-ports hub-ig --zone=$zone --named-ports=http:8000
if (-not (Exists @("gcloud", "compute", "health-checks", "describe", "hub-hc"))) {
    Run gcloud compute health-checks create http hub-hc --port=8000 --request-path=/health/live --check-interval=10s --timeout=5s
}
if (-not (Exists @("gcloud", "compute", "backend-services", "describe", "hub-backend", "--global"))) {
    Run gcloud compute backend-services create hub-backend --global --load-balancing-scheme=EXTERNAL --protocol=HTTP --port-name=http --health-checks=hub-hc --timeout=3600
    Run gcloud compute backend-services add-backend hub-backend --global --instance-group=hub-ig --instance-group-zone=$zone
}
if (-not (Exists @("gcloud", "compute", "url-maps", "describe", "hub-url-map", "--global"))) {
    Run gcloud compute url-maps create hub-url-map --default-service=hub-backend --global
}
if (-not (Exists @("gcloud", "compute", "ssl-certificates", "describe", "hub-cert", "--global"))) {
    Run gcloud compute ssl-certificates create hub-cert --domains=$hubDomain --global
}
if (-not (Exists @("gcloud", "compute", "target-https-proxies", "describe", "hub-https-proxy", "--global"))) {
    Run gcloud compute target-https-proxies create hub-https-proxy --url-map=hub-url-map --ssl-certificates=hub-cert --global
}
if (-not (Exists @("gcloud", "compute", "addresses", "describe", "hub-ip", "--global"))) {
    Run gcloud compute addresses create hub-ip --global --ip-version=IPV4
}
if (-not (Exists @("gcloud", "compute", "forwarding-rules", "describe", "hub-fr", "--global"))) {
    Run gcloud compute forwarding-rules create hub-fr --global --load-balancing-scheme=EXTERNAL --address=hub-ip --target-https-proxy=hub-https-proxy --ports=443
}
$hubIp = if ($DryRun) { "<hub-ip>" } else { (Run gcloud compute addresses describe hub-ip --global --format="value(address)").Trim() }
Ok "load balancer created; public IP $hubIp"

Pause-ForConsole "DNS record" @(
    "At the registrar for $($hubDomain -replace '^[^.]+\.', ''): add  A  $hubDomain  ->  $hubIp",
    "The Google-managed certificate turns ACTIVE 15-60 minutes after the name resolves; the hub answers after that.",
    "Press Enter once the record is saved (the certificate keeps provisioning in the background)."
)

# IAP: Google-managed OAuth client; sign-in allowed for the company's Workspace domain(s).
if (-not (Exists @("gcloud", "iap", "web", "get-iam-policy", "--resource-type=backend-services", "--service=hub-backend"))) {
    Run gcloud services enable iap.googleapis.com
}
try { Run gcloud iap web enable --resource-type=backend-services --service=hub-backend } catch {
    if ("$_" -notmatch 'already') { throw }
}
foreach ($d in $domains) {
    Run gcloud iap web add-iam-policy-binding --resource-type=backend-services --service=hub-backend --member="domain:$d" --role=roles/iap.httpsResourceAccessor
}
Run gcloud iap web add-iam-policy-binding --resource-type=backend-services --service=hub-backend --member="user:$adminMail" --role=roles/iap.httpsResourceAccessor
# The desktop app signs in to IAP with its own OAuth client (hub_client.json from console step B.3).
$desktopClientId = ""
$p = Ask hub_desktop_client_json_path "Path to the downloaded 'Hub desktop (IAP)' client JSON (hub_client.json; blank to add later)" ""
if ($p -and (Test-Path $p)) {
    $cj = Get-Content $p -Raw | ConvertFrom-Json
    $desktopClientId = "$(if ($cj.installed) { $cj.installed.client_id } elseif ($cj.web) { $cj.web.client_id })"
}
if ($desktopClientId) {
    $iapYaml = Join-Path $tmpDir "lg-iap-settings.yaml"
    "accessSettings:`n  oauthSettings:`n    programmaticClients:`n    - $desktopClientId`n" | Set-Content $iapYaml
    Run gcloud iap settings set $iapYaml --resource-type=backend-services --service=hub-backend
    Ok "IAP programmatic access: $desktopClientId"
} else {
    Note "Add the desktop client later:  gcloud iap settings set <yaml> --resource-type=backend-services --service=hub-backend  (accessSettings.oauthSettings.programmaticClients)"
}
$backendId = if ($DryRun) { "<backend-id>" } else { (Run gcloud compute backend-services describe hub-backend --global --format="value(id)").Trim() }
if ($backendId) {
    $aud = "/projects/$projectNumber/global/backendServices/$backendId"
    $brand.gcp.iap_audience = $aud
    Run gcloud compute instances add-metadata hub --zone=$zone --metadata="iap-audience=$aud"
    if (-not $DryRun) {
        [IO.File]::WriteAllText($brandPath, ($brand | ConvertTo-Json -Depth 6) + "`n", (New-Object Text.UTF8Encoding $false))
        try { Run gcloud compute ssh hub --zone=$zone --tunnel-through-iap --quiet --command="sudo google_metadata_script_runner startup" } catch { Note "startup re-run failed ($_); reboot the VM instead." }
    }
    Ok "IAP audience $aud set; startup script re-run on the VM"
}

Commit-Brand
Step "Done"
Note "Publish a release: gh release create v`$(cat VERSION) --repo $repo --generate-notes   (the tag is the VERSION file; bump its patch digit for your own changes)"
Note "Verify the hub once the certificate is ACTIVE (gcloud compute ssl-certificates describe hub-cert --global):"
Note "  scripts/hub/deploy-hub.ps1 -Migrate   (first deploy creates the database schema)   then   https://$hubDomain/health/live"
