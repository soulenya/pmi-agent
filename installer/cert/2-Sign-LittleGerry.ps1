# ============================================================
#  Little Gerry - Step 2: Sign the installer
#  (Run AFTER building LittleGerry_Setup.exe and after step 1.)
# ============================================================
#
#  Signs installer\Output\LittleGerry_Setup.exe with your private key
#  using a trusted timestamp (so the signature stays valid after the
#  certificate expires).
#
#  Usage (PowerShell):
#    cd installer\cert
#    powershell -NoProfile -ExecutionPolicy Bypass -File .\2-Sign-LittleGerry.ps1
# ============================================================

param(
    # Installer to sign; defaults to this brand's installer\Output\<setup_name>.exe.
    [string]$ExePath = "",
    # Private key file; defaults to LittleGerry-Signing.pfx beside this script.
    [string]$PfxPath = "",
    # Password for unattended use (CI). Prompted when omitted.
    [string]$PfxPassword = ""
)

$ErrorActionPreference = "Stop"
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$root    = Resolve-Path (Join-Path $here "..\..")
if (-not $PfxPath) { $PfxPath = Join-Path $here "LittleGerry-Signing.pfx" }
$pfxPath = $PfxPath
if (-not $ExePath) {
    $setupName = & (Join-Path $root "installer\brand-defines.ps1") -SetupNameOnly
    $ExePath = Join-Path $root "installer\Output\$setupName.exe"
}
$exePath = $ExePath

if (-not (Test-Path $pfxPath)) {
    Write-Host "  [ERROR] $pfxPath not found. Run 1-Create-Signing-Certificate.ps1 first." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $exePath)) {
    Write-Host "  [ERROR] $exePath not found. Build the installer first (build-installer.bat)." -ForegroundColor Red
    exit 1
}

$pfxPass = if ($PfxPassword) { ConvertTo-SecureString $PfxPassword -AsPlainText -Force } else { Read-Host -AsSecureString "  Enter the private key (.pfx) password" }
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
    $pfxPath, $pfxPass,
    [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::DefaultKeySet)

Write-Host ""
Write-Host "  Signing $exePath ..." -ForegroundColor Cyan

$sig = Set-AuthenticodeSignature `
    -FilePath $exePath `
    -Certificate $cert `
    -HashAlgorithm SHA256 `
    -TimestampServer "http://timestamp.digicert.com"

Write-Host ""
if ($sig.Status -eq "Valid") {
    Write-Host "  Signed successfully. Status: $($sig.Status)" -ForegroundColor Green
} else {
    Write-Host "  Signing finished with status: $($sig.Status)" -ForegroundColor Yellow
    Write-Host "  ($($sig.StatusMessage))"
}
Write-Host ""
