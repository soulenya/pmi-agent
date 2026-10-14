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
#
#  macOS / Linux (pwsh): the same command; the certificate is made with
#  openssl instead of the Windows certificate store. -OpenSsl forces that path.
# ============================================================

param([switch]$OpenSsl)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:OS -ne "Windows_NT") { $OpenSsl = $true }

# Subject from brand\brand.json (windows.cert_cn, publisher); PMI's when absent.
$brandFile = Join-Path $here "../../brand/brand.json"
$cn = "Precisian Medical Instruments"
if (Test-Path $brandFile) {
    $b = Get-Content $brandFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($b.windows.cert_cn) { $cn = $b.windows.cert_cn } elseif ($b.publisher) { $cn = $b.publisher }
}
$subject = "CN=$cn, O=$cn, OU=Little Gerry"
$cerPath = Join-Path $here "LittleGerry-PublicCert.cer"
$pfxPath = Join-Path $here "LittleGerry-Signing.pfx"

Write-Host ""
Write-Host "  Creating a self-signed code-signing certificate for Little Gerry..." -ForegroundColor Cyan
Write-Host ""

# Prompt for a password to protect the private key (.pfx)
$pfxPass = Read-Host -AsSecureString "  Enter a password to protect the private key (.pfx)"

if ($OpenSsl) {
    if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) { throw "openssl is not on PATH." }
    $keyPath = Join-Path $here "LittleGerry-Signing.key"
    $pemPath = Join-Path $here "LittleGerry-Signing.pem"
    $cfgPath = Join-Path $here "LittleGerry-Signing.cnf"
    # Subject via config so commas and spaces in the company name need no escaping.
    @(
        "[req]", "distinguished_name = dn", "x509_extensions = ext", "prompt = no",
        "[dn]", "CN = $cn", "O = $cn", "OU = Little Gerry",
        "[ext]", "keyUsage = critical, digitalSignature", "extendedKeyUsage = codeSigning",
        "basicConstraints = CA:FALSE", "subjectKeyIdentifier = hash"
    ) | Set-Content $cfgPath
    $env:LG_PFX_PASS = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pfxPass))
    try {
        & openssl req -x509 -newkey rsa:2048 -sha256 -days 1826 -nodes -keyout $keyPath -out $pemPath -config $cfgPath 2>$null
        if ($LASTEXITCODE -ne 0) { throw "openssl req failed" }
        & openssl x509 -in $pemPath -outform DER -out $cerPath
        if ($LASTEXITCODE -ne 0) { throw "openssl x509 failed" }
        & openssl pkcs12 -export -inkey $keyPath -in $pemPath -out $pfxPath -passout env:LG_PFX_PASS
        if ($LASTEXITCODE -ne 0) { throw "openssl pkcs12 failed" }
        $thumb = ((& openssl x509 -in $pemPath -noout -fingerprint -sha1) -split '=')[-1] -replace ':', ''
    } finally {
        $env:LG_PFX_PASS = $null
        Remove-Item $keyPath, $pemPath, $cfgPath -ErrorAction SilentlyContinue
    }
} else {
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
    $thumb = $cert.Thumbprint
}

Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host "    Public  (share with team) : $cerPath"
Write-Host "    Private (KEEP SECRET)      : $pfxPath"
Write-Host "    Thumbprint                 : $thumb"
Write-Host ""
Write-Host "  Next:" -ForegroundColor Yellow
Write-Host "    1. Build the installer (build-installer.bat)."
Write-Host "    2. Sign it:  powershell -File .\2-Sign-LittleGerry.ps1"
Write-Host "    3. Give teammates the 'Trust Little Gerry' folder (public .cer + Trust batch)."
Write-Host ""
