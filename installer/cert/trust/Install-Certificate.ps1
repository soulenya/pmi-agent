# ============================================================
#  Trust Little Gerry - installs the publisher certificate
#  Run by each teammate ONCE (the .bat self-elevates to admin).
# ============================================================
#
#  Imports LittleGerry-PublicCert.cer (must be in this same folder) into:
#    * LocalMachine\Root            -> trust the signing root
#    * LocalMachine\TrustedPublisher-> trust this publisher's software
#
#  After this, the signed LittleGerry_Setup.exe runs without an
#  "unknown publisher" warning on this machine.
# ============================================================

$ErrorActionPreference = "Stop"
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$cer    = Join-Path $here "LittleGerry-PublicCert.cer"

if (-not (Test-Path $cer)) {
    Write-Host "  [ERROR] LittleGerry-PublicCert.cer not found next to this script." -ForegroundColor Red
    Write-Host "  Keep the .cer file in the same folder as this installer and try again."
    exit 1
}

Write-Host ""
Write-Host "  Trusting the Little Gerry publisher certificate..." -ForegroundColor Cyan

Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\Root"             | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher" | Out-Null

Write-Host ""
Write-Host "  Done. Little Gerry is now a trusted publisher on this PC." -ForegroundColor Green
Write-Host "  You can now run LittleGerry_Setup.exe normally."
Write-Host ""
