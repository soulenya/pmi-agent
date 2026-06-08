# ============================================================
#  Little Gerry - Step 1: Create the code-signing certificate
#  (Run this ONCE, on your machine only. Keep the .pfx secret.)
# ============================================================
#
#  Produces two files in this folder:
#    * LittleGerry-PublicCert.cer  -> SHARE this with teammates (public, safe)
#    * LittleGerry-Signing.pfx     -> KEEP SECRET (private key). Never commit
#                                     or email this. Anyone with it + the
#                                     password can sign software as you.
#
#  Usage (PowerShell):
#    cd installer\cert
#    powershell -NoProfile -ExecutionPolicy Bypass -File .\1-Create-Signing-Certificate.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$subject = "CN=Precisian Medical Instruments, O=Precisian Medical Instruments, OU=Little Gerry"
$cerPath = Join-Path $here "LittleGerry-PublicCert.cer"
$pfxPath = Join-Path $here "LittleGerry-Signing.pfx"

Write-Host ""
Write-Host "  Creating a self-signed code-signing certificate for Little Gerry..." -ForegroundColor Cyan
Write-Host ""

# Prompt for a password to protect the private key (.pfx)
$pfxPass = Read-Host -AsSecureString "  Enter a password to protect the private key (.pfx)"

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy Exportable `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(5)

# Export the PUBLIC certificate (no private key) -> distribute to teammates
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

# Export the PRIVATE key (.pfx) -> keep this secret; used only to sign
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pfxPass | Out-Null

Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host "    Public  (share with team) : $cerPath"
Write-Host "    Private (KEEP SECRET)      : $pfxPath"
Write-Host "    Thumbprint                 : $($cert.Thumbprint)"
Write-Host ""
Write-Host "  Next:" -ForegroundColor Yellow
Write-Host "    1. Build the installer (build-installer.bat)."
Write-Host "    2. Sign it:  powershell -File .\2-Sign-LittleGerry.ps1"
Write-Host "    3. Give teammates the 'Trust Little Gerry' folder (public .cer + Trust batch)."
Write-Host ""
