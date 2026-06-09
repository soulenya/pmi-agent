#Requires -Version 5.1
<#
.SYNOPSIS
    Little Gerry - publish a new release (build, sign, upload).

    One command to ship an update to every installed copy:
      1. Bumps the VERSION file and the installer's version.
      2. Commits + pushes those bumps.
      3. Builds the installer (Inno Setup).
      4. Signs it with the code-signing certificate (prompts for the .pfx password).
      5. Creates a new GitHub Release tagged v<Version> and uploads the signed
         installer (+ the Trust bat). Installed apps auto-update to it on next launch.

.PARAMETER Version
    The new semantic version, e.g. 1.0.1. Must be higher than the current VERSION.

.PARAMETER Notes
    Optional release notes (plain text). Shown on the GitHub release.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-release.ps1 -Version 1.0.1 -Notes "Fix Voyage embeddings"
#>
param(
    [Parameter(Mandatory = $true)] [string]$Version,
    [string]$Notes = ""
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "  [ERROR] Version must look like 1.2.3 (got '$Version')." -ForegroundColor Red
    exit 1
}

$root      = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$verFile   = Join-Path $root "VERSION"
$issFile   = Join-Path $root "installer\setup.iss"
$signPs1   = Join-Path $root "installer\cert\2-Sign-LittleGerry.ps1"
$trustBat  = Join-Path $root "installer\cert\dist\Trust-Little-Gerry.bat"
$exeOut    = Join-Path $root "installer\Output\LittleGerry_Setup.exe"
$tag       = "v$Version"

# Resolve external tools (PATH first, then common install locations).
function Find-Tool($name, $fallbacks) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in $fallbacks) { if (Test-Path $p) { return $p } }
    throw "Could not find $name"
}
$git  = Find-Tool "git"  @("C:\Program Files\Git\cmd\git.exe")
$gh   = Find-Tool "gh"   @("C:\Program Files\GitHub CLI\gh.exe")
$iscc = Find-Tool "iscc" @("C:\Program Files (x86)\Inno Setup 6\iscc.exe")

# Guard: new version must be higher than the current one.
$current = (Get-Content $verFile -Raw).Trim()
function To-Tuple($v) { ($v.TrimStart('v','V').Split('.') | ForEach-Object { [int]($_ -replace '\D','') }) }
$cur = To-Tuple $current; $new = To-Tuple $Version
for ($i = 0; $i -lt 3; $i++) {
    if ($new[$i] -gt $cur[$i]) { break }
    if ($new[$i] -lt $cur[$i]) { throw "New version $Version is lower than current $current." }
    if ($i -eq 2) { throw "New version $Version equals current $current — bump it." }
}

Write-Host ""
Write-Host "  Publishing Little Gerry $current -> $Version" -ForegroundColor Cyan
Write-Host ""

# 1. Bump VERSION + installer version.
Set-Content -Path $verFile -Value $Version -Encoding ASCII -NoNewline
Add-Content -Path $verFile -Value "`n" -NoNewline
$iss = Get-Content $issFile -Raw
$iss = $iss -replace '(#define\s+AppVersion\s+")[^"]+(")', "`${1}$Version`${2}"
Set-Content -Path $issFile -Value $iss -Encoding UTF8
Write-Host "  [1/5] Bumped VERSION and setup.iss" -ForegroundColor Green

# 2. Commit + push the bump.
& $git -C $root add "VERSION" "installer/setup.iss" | Out-Null
& $git -C $root commit -m "Release $tag" | Out-Null
& $git -C $root push origin master | Out-Null
Write-Host "  [2/5] Committed and pushed version bump" -ForegroundColor Green

# 3. Build the installer.
& $iscc $issFile | Out-Null
if (-not (Test-Path $exeOut)) { throw "Installer build failed — $exeOut not found." }
Write-Host "  [3/5] Built installer" -ForegroundColor Green

# 4. Sign it (prompts for the .pfx password).
Write-Host "  [4/5] Signing installer..." -ForegroundColor Yellow
& powershell -NoProfile -ExecutionPolicy Bypass -File $signPs1
$sig = Get-AuthenticodeSignature $exeOut
if ($sig.SignerCertificate -eq $null) { throw "Installer is not signed." }
Write-Host "        Signed by: $($sig.SignerCertificate.Subject.Split(',')[0])" -ForegroundColor Green

# 5. Create the GitHub release and upload assets.
$assets = @($exeOut)
if (Test-Path $trustBat) { $assets += $trustBat }

if ($Notes) {
    $notesFile = Join-Path $env:TEMP "lg_release_notes.md"
    Set-Content -Path $notesFile -Value $Notes -Encoding UTF8
    & $gh release create $tag @assets --title "Little Gerry $Version" --notes-file $notesFile
    Remove-Item $notesFile -ErrorAction SilentlyContinue
} else {
    & $gh release create $tag @assets --title "Little Gerry $Version" --generate-notes
}

Write-Host ""
Write-Host "  Released $tag. Installed apps will auto-update on next launch." -ForegroundColor Green
Write-Host ""
