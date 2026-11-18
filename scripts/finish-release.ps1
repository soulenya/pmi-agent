#Requires -Version 5.1
<#
.SYNOPSIS
    Finish a release whose commit is already pushed: installer, hub, GitHub.

.DESCRIPTION
    Steps 3 to 6 of DEVELOPER_GUIDE section 14 in one run, in the only order
    that is safe:

      checks -> compile -> sign -> verify -> hub image -> hub deploy
      -> publish -> verify what the release serves

    Run it once the release commit (VERSION, CHANGELOG.md, version.ts,
    setup.iss) is on origin/master. It changes no tracked file and makes no
    commit.

    Nothing leaves this computer until the installer it has just compiled and
    signed reports the version in VERSION and passes update_verify.py, the
    check every installed copy runs before it will install an update. Both
    slips that guards against have happened: signing the previous build that
    was still in installer\Output, and publishing before signing had finished.

    The hub goes before the GitHub release because the release is what
    installed copies act on, and the notes say the hub is already updated.

.PARAMETER Migrate
    Passed to deploy-hub.ps1: run the database migrations. Needed when the
    release adds an alembic revision.

.PARAMETER SkipHub
    Leave the hub alone: no image build, no deploy.

.PARAMETER NotesFile
    The release notes. Default: installer\Output\notes-<version>.md.

.PARAMETER CheckOnly
    Run the checks and stop. Compiles, deploys and publishes nothing.

.EXAMPLE
    .\scripts\finish-release.ps1 -CheckOnly
    .\scripts\finish-release.ps1
    .\scripts\finish-release.ps1 -Migrate
#>
[CmdletBinding()]
param(
    [switch]$Migrate,
    [switch]$SkipHub,
    [string]$NotesFile = "",
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Stop-Release([string]$Message) {
    Write-Host ""
    Write-Host "  [STOP] $Message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Find-Tool([string]$Name, [string[]]$Fallbacks = @()) {
    $cmd = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    foreach ($p in $Fallbacks) { if (Test-Path $p) { return $p } }
    Stop-Release "$Name was not found. Install it or put it on PATH."
}

function Pick($Value, [string]$Default) {
    if ($null -ne $Value -and "$Value" -ne "") { "$Value" } else { $Default }
}

function Step([string]$Text) { Write-Host "  $Text" -ForegroundColor Cyan }

# -- Where things are ---------------------------------------------------------
$root      = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$brandFile = Join-Path $root "brand\brand.json"
$brandDefs = Join-Path $root "installer\brand-defines.ps1"
$issFile   = Join-Path $root "installer\setup.iss"
$signPs1   = Join-Path $root "installer\cert\2-Sign-LittleGerry.ps1"
$deployPs1 = Join-Path $root "scripts\hub\deploy-hub.ps1"

$b = if (Test-Path $brandFile) { Get-Content $brandFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$product   = Pick $b.product_name "Little Gerry"
$repo      = Pick $b.github_repo ""
$project   = Pick $b.gcp.project "pmi-littlegerry-hub"
$region    = Pick $b.gcp.region "us-central1"
$registry  = Pick $b.gcp.registry "$region-docker.pkg.dev"
$imageRepo = Pick $b.gcp.image_repo "littlegerry"
$image     = "$registry/$project/$imageRepo/backend"

$setupName = & $brandDefs -SetupNameOnly
$exe       = Join-Path $root "installer\Output\$setupName.exe"
$trustBat  = Get-ChildItem (Join-Path $root "installer\cert\dist\Trust-*.bat") -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName

$version = (Get-Content (Join-Path $root "VERSION") -Raw).Trim()
$tag     = "v$version"
if (-not $NotesFile) { $NotesFile = Join-Path $root "installer\Output\notes-$version.md" }

$git    = Find-Tool "git"
$gh     = Find-Tool "gh"
$iscc   = Find-Tool "iscc" @("C:\Program Files\Inno Setup 7\ISCC.exe", "C:\Program Files (x86)\Inno Setup 6\ISCC.exe")
$docker = if ($SkipHub) { "" } else { Find-Tool "docker" }
$venvPy = Join-Path $root "backend\.venv\Scripts\python.exe"
$python = if (Test-Path $venvPy) { $venvPy } else { Find-Tool "python" }

# -- Checks -------------------------------------------------------------------
function Test-ReleaseExists {
    # gh says "release not found" on stderr; under "Stop" Windows PowerShell
    # would turn that redirected line into a terminating error.
    $ErrorActionPreference = "Continue"
    & $gh release view $tag --repo $repo --json tagName *> $null
    return ($LASTEXITCODE -eq 0)
}

function Test-Installer {
    # The two things that make an installer the one for this release.
    $found = "$((Get-Item $exe).VersionInfo.ProductVersion)".Trim()
    if ($found -ne $version) {
        return "it is version '$found', not $version"
    }
    $code = 'import json, pathlib, sys; sys.path.insert(0, sys.argv[1]); import update_verify as u; ' +
            'v = u.verify_installer(pathlib.Path(sys.argv[2]), json.loads(pathlib.Path(sys.argv[3]).read_text(encoding=''utf-8''))); ' +
            'print((''OK '' if v.ok else ''REFUSED '') + v.reason)'
    $verdict = "$(& $python -c $code $root $exe $brandFile | Select-Object -Last 1)"
    if ($LASTEXITCODE -ne 0 -or $verdict -notlike "OK *") {
        return "installed copies would refuse it: $($verdict -replace '^REFUSED ', '')"
    }
    return ""
}

Write-Host ""
Step "Finishing $product $version"

if ($version -notmatch '^\d+\.\d+\.\d+$') { Stop-Release "VERSION holds '$version', not a version like 1.2.3." }
if (-not $repo) { Stop-Release "brand.json has no github_repo to publish to." }

$issVersion = [regex]::Match((Get-Content $issFile -Raw), '#define\s+AppVersion\s+"([^"]+)"').Groups[1].Value
if ($issVersion -ne $version) {
    Stop-Release "installer\setup.iss says AppVersion $issVersion but VERSION says $version."
}
if (-not (Select-String -Path (Join-Path $root "CHANGELOG.md") -SimpleMatch "### $tag " -Quiet)) {
    Stop-Release "CHANGELOG.md has no '### $tag' entry. Finish the release commit first."
}
if (-not (Test-Path $NotesFile) -or -not "$(Get-Content $NotesFile -Raw)".Trim()) {
    Stop-Release "No release notes at $NotesFile. Write them, or pass -NotesFile."
}

# The installer is built from the files on disk, so they must be the commit
# the release tag will point at.
$dirty = @(& $git -C $root status --porcelain --untracked-files=no)
if ($dirty.Count -gt 0) {
    Stop-Release "There are uncommitted changes to tracked files ($($dirty.Count)). Commit or discard them first."
}
& $git -C $root fetch --quiet origin master
if ($LASTEXITCODE -ne 0) { Stop-Release "Could not fetch origin/master." }
$head   = "$(& $git -C $root rev-parse HEAD)".Trim()
$remote = "$(& $git -C $root rev-parse origin/master)".Trim()
if ($head -ne $remote) {
    Stop-Release "This checkout ($($head.Substring(0,7))) is not origin/master ($($remote.Substring(0,7))). Push the release commit, or pull."
}
$mirror = "$(& $git -C $root ls-remote --heads origin dev/v1.5)".Trim()
if ($mirror -and -not $mirror.StartsWith($head)) {
    Write-Host "  [note] origin/dev/v1.5 is not at this commit: git push origin master:dev/v1.5" -ForegroundColor Yellow
}

if (Test-ReleaseExists) {
    Stop-Release "$tag is already published. Bump VERSION for a new release; to replace an asset use 'gh release upload --clobber'."
}

Write-Host "    commit   $($head.Substring(0,7)) (origin/master)"
Write-Host "    notes    $NotesFile"
Write-Host "    hub      $(if ($SkipHub) { 'skipped' } else { "${image}:$version$(if ($Migrate) { ', with migrations' })" })"
Write-Host "    publish  $tag on $repo$(if (-not $trustBat) { ' (no Trust-*.bat in installer\cert\dist; publishing without it)' })"

if ($CheckOnly) {
    Write-Host ""
    Write-Host "  Checks passed. Nothing was built or published." -ForegroundColor Green
    Write-Host ""
    exit 0
}

# -- 1. Compile ---------------------------------------------------------------
Write-Host ""
Step "[1/5] Compiling the installer"
# Remove the last build first: if the compile fails there must be nothing
# left in Output to sign by mistake.
if (Test-Path $exe) { Remove-Item $exe -Force }
$defs = @(& $brandDefs)
& $iscc /Q @defs $issFile
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { Stop-Release "The installer did not compile." }

# -- 2. Sign ------------------------------------------------------------------
Step "[2/5] Signing (asks for the .pfx password)"
& powershell -NoProfile -ExecutionPolicy Bypass -File $signPs1

$problem = Test-Installer
if ($problem) {
    Stop-Release "The installer cannot be published: $problem. Nothing was deployed or published."
}
Write-Host "        version $version, signature accepted by update_verify.py" -ForegroundColor Green

# -- 3 and 4. Hub -------------------------------------------------------------
if ($SkipHub) {
    Step "[3/5] Hub image: skipped"
    Step "[4/5] Hub deploy: skipped"
} else {
    Step "[3/5] Building and pushing the hub image"
    & $docker buildx build --platform linux/amd64 -f (Join-Path $root "backend\Dockerfile") `
        -t "${image}:$version" -t "${image}:latest" --push $root
    if ($LASTEXITCODE -ne 0) {
        Stop-Release "The hub image did not build or push. Nothing was deployed or published."
    }

    Step "[4/5] Deploying the hub"
    $deployArgs = @{ Tag = $version }
    if ($Migrate) { $deployArgs.Migrate = $true }
    $deployOut = @()
    try {
        # 6>&1 brings the script's own messages into the pipeline; the remote
        # output (where "health=" is) is already there.
        & $deployPs1 @deployArgs 6>&1 | Tee-Object -Variable deployOut
    } catch {
        Stop-Release "The hub deploy failed: $($_.Exception.Message) Nothing was published."
    }
    if (-not (($deployOut | Out-String) -match 'health=200')) {
        Stop-Release "The hub did not report health=200 after the deploy. Nothing was published; check the hub before trying again."
    }
}

# -- 5. Publish ---------------------------------------------------------------
Step "[5/5] Publishing $tag"
$assets = @($exe)
if ($trustBat) { $assets += $trustBat }
& $gh release create $tag @assets --repo $repo --target $head --title "$product $version" --notes-file $NotesFile
if ($LASTEXITCODE -ne 0) {
    Stop-Release "gh release create failed, so $tag is not published$(if (-not $SkipHub) { ' (the hub is already on it)' }). Fix the cause and run this script again."
}

# What installed copies will download must be the file that was just verified.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("lg-release-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
& $gh release download $tag --repo $repo --pattern "$setupName.exe" --dir $tmp
$served = Join-Path $tmp "$setupName.exe"
$same = ($LASTEXITCODE -eq 0) -and (Test-Path $served) -and
        ((Get-FileHash $served).Hash -eq (Get-FileHash $exe).Hash)
Remove-Item -Recurse -Force $tmp
if (-not $same) {
    Stop-Release "$tag is published, but the installer it serves is not the one just signed. Replace it now: gh release upload $tag `"$exe`" --repo $repo --clobber"
}

Write-Host ""
Write-Host "  Released $tag. The release serves the signed installer; installed copies update at their next launch." -ForegroundColor Green
Write-Host "  Still to do: approve the macOS job (Actions -> the run -> Review deployments -> release)."
Write-Host ""
