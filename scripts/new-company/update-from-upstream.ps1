<#
.SYNOPSIS
    Bring a company's Little Gerry up to date with PMI's repository, publish
    the release, and update the hub. Run from the company's checkout.

.DESCRIPTION
    1. Merges upstream (soulenya/pmi-agent) master into the current branch.
       On conflict: workflow files take upstream's version, brand/brand.json
       keeps the company's; anything else stops for a manual merge.
    2. Pushes to the company repository.
    3. Creates the GitHub release v<VERSION> (CI builds and signs installers;
       installed copies update on their next launch).
    4. Hub (when brand.hub_url is set): checks the API-key secrets for junk,
       rebuilds and pushes the linux/amd64 image, deploys it, pushes the new
       startup script to the VM and re-runs it (new backup script, fresh .env).

    Re-runnable; each step checks what is already done. Windows PowerShell 5+
    or pwsh 7 (macOS/Linux).

.PARAMETER SkipHub
    Steps 1-3 only.
.PARAMETER NoRelease
    Steps 1-2 only (merge and push).
#>
[CmdletBinding()]
param([switch]$SkipHub, [switch]$NoRelease)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
Set-Location $root
$IsWin = ($env:OS -eq "Windows_NT")
$gcloud = if ($IsWin) { "gcloud.cmd" } else { "gcloud" }

function Step([string]$t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Note([string]$t) { Write-Host "  $t" -ForegroundColor Gray }
function Fail([string]$t) { Write-Host "  [STOP] $t" -ForegroundColor Red; exit 1 }
function RunGit { & git @args; if ($LASTEXITCODE -ne 0) { Fail "git $($args -join ' ') failed" } }

foreach ($tool in @("git", "gh")) { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is not on PATH" } }
$brand = Get-Content (Join-Path $root "brand/brand.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$repo = $brand.github_repo
$upstream = "soulenya/pmi-agent"
if ($repo -eq $upstream) { Fail "brand/brand.json says github_repo = $upstream; this script is for a company's copy." }

# ── 1. Merge upstream ────────────────────────────────────────────────────────
Step "1. Merge PMI's latest ($upstream) into $repo"
& git diff --quiet; $clean = ($LASTEXITCODE -eq 0)
& git diff --cached --quiet; $clean = $clean -and ($LASTEXITCODE -eq 0)
if (-not $clean) { Fail "uncommitted changes in this checkout - commit or stash them first (git status)." }

& git remote get-url upstream *> $null
if ($LASTEXITCODE -ne 0) { RunGit remote add upstream "https://github.com/$upstream.git" }
# The company's remote: 'company' (set by the bootstrap) or an origin that is not PMI.
$companyRemote = ""
foreach ($r in @("company", "origin")) {
    $u = & git remote get-url $r 2>$null
    if ($u -and $u -notmatch [regex]::Escape($upstream)) { $companyRemote = $r; break }
}
if (-not $companyRemote) { RunGit remote add company "https://github.com/$repo.git"; $companyRemote = "company" }
Note "company remote: $companyRemote ($(& git remote get-url $companyRemote))"

RunGit fetch -q upstream master
RunGit fetch -q $companyRemote master
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "master") { RunGit checkout -q master }
& git merge-base --is-ancestor "$companyRemote/master" HEAD *> $null
if ($LASTEXITCODE -ne 0) { RunGit pull -q --ff-only $companyRemote master }

& git merge-base --is-ancestor upstream/master HEAD *> $null
if ($LASTEXITCODE -eq 0) {
    Ok "already up to date with upstream"
} else {
    & git merge --no-edit upstream/master 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $conflicts = @(& git diff --name-only --diff-filter=U)
        foreach ($f in $conflicts) {
            if ($f -like ".github/workflows/*") { RunGit checkout --theirs -- $f; RunGit add -- $f; Note "took upstream's $f" }
            elseif ($f -eq "brand/brand.json") { RunGit checkout --ours -- $f; RunGit add -- $f; Note "kept the company's $f" }
        }
        $left = @(& git diff --name-only --diff-filter=U)
        if ($left) {
            Write-Host "  Conflicts that need a person:" -ForegroundColor Yellow
            $left | ForEach-Object { Write-Host "    $_" }
            Fail "resolve them (edit, git add), run  git commit , then run this script again."
        }
        RunGit commit -q --no-edit
    }
    Ok "merged upstream/master -> $((& git rev-parse --short HEAD).Trim())"
}

# ── 2. Push ──────────────────────────────────────────────────────────────────
Step "2. Push to $repo"
RunGit push -q $companyRemote master
Ok "pushed"
if ($NoRelease) { return }

# ── 3. Release ───────────────────────────────────────────────────────────────
$version = (Get-Content (Join-Path $root "VERSION") -Raw).Trim()
$tag = "v$version"
Step "3. Release $tag on $repo"
& gh release view $tag --repo $repo *> $null
if ($LASTEXITCODE -eq 0) {
    Ok "release $tag already exists"
} else {
    & gh release create $tag --repo $repo --target master --title "Little Gerry $version" --generate-notes
    if ($LASTEXITCODE -ne 0) { Fail "gh release create failed" }
    Ok "release created - the Windows and macOS workflows attach the installers (Actions tab, ~10-40 min)"
}
Note "Installed copies pick up $tag on their next launch."
if ($SkipHub -or -not $brand.hub_url) { Step "Done"; return }

# ── 4. Hub ───────────────────────────────────────────────────────────────────
Step "4. Hub ($($brand.hub_url))"
foreach ($tool in @("gcloud", "docker")) { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is not on PATH" } }
$project = $brand.gcp.project; $zone = $brand.gcp.zone; $region = $brand.gcp.region
$image = "$($brand.gcp.registry)/$project/$($brand.gcp.image_repo)/backend:latest"
& $gcloud config set project $project *> $null

# 4a. Secrets that may hold a bad paste: a key must be one token with the provider's prefix.
$checks = @(@("anthropic-api-key", '^sk-ant-[A-Za-z0-9_-]{20,}$'), @("voyage-api-key", '^pa-[A-Za-z0-9_-]{20,}$'), @("google-api-key", '^AIza[A-Za-z0-9_-]{30,}$'))
foreach ($c in $checks) {
    $name, $pattern = $c
    $v = & $gcloud secrets versions access latest --secret=$name 2>$null
    if ($LASTEXITCODE -ne 0 -or -not "$v") { Note "$name : no value (fine - the hub treats it as blank)"; continue }
    if ("$v".Trim() -match $pattern) { Ok "$name looks valid"; continue }
    Write-Host "  $name holds something that is not a key (starts: '$("$v".Trim().Substring(0, [Math]::Min(12, "$v".Trim().Length)))...')" -ForegroundColor Yellow
    $a = Read-Host "  Destroy its versions so the hub treats it as blank? (y/n) [y]"
    if (-not $a -or $a -match '^y') {
        $vers = @(& $gcloud secrets versions list $name --filter="state=enabled" --format="value(name)")
        foreach ($n in $vers) { & $gcloud secrets versions destroy $n --secret=$name --quiet *> $null }
        Ok "$name cleared ($($vers.Count) version(s) destroyed). Add the real key later with: gcloud secrets versions add $name --data-file=<file>"
    }
}

# 4b. Image for the VM's processor.
Note "Building and pushing $image (linux/amd64) - a few minutes."
& $gcloud auth configure-docker $brand.gcp.registry --quiet *> $null
& docker buildx build --platform linux/amd64 -f backend/Dockerfile -t $image --push .
if ($LASTEXITCODE -ne 0) { Fail "docker buildx build failed (is Docker Desktop running?)" }
Ok "image pushed"

# 4c. New startup script (backup fix) + deploy the image.
$deploy = Join-Path $root "scripts/hub/deploy-hub.ps1"
& $deploy -UpdateStartupScript
& $deploy -Migrate
if ($LASTEXITCODE -ne 0) { Fail "deploy-hub failed" }

# 4d. Re-run the startup script on the VM so backup.sh and .env are regenerated.
Note "Re-running the startup script on the VM (regenerates .env from Secret Manager and installs the new backup script)."
& $gcloud compute ssh $brand.gcp.hub_vm --zone=$zone --tunnel-through-iap --quiet --command="sudo google_metadata_script_runner startup >/dev/null 2>&1; sudo bash /opt/littlegerry/scripts/backup.sh"
if ($LASTEXITCODE -ne 0) { Note "startup re-run or backup failed - reboot the VM from the console and run  scripts/hub/deploy-hub.ps1 -VerifyOnly" }
& $deploy -VerifyOnly
Step "Done"
Note "Check https://$($brand.hub_url -replace '^https?://','')/health/live"
