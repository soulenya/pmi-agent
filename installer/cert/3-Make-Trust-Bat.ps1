# ============================================================
#  Little Gerry - Step 3: Build the self-contained trust batch
#  Bakes LittleGerry-PublicCert.cer into a single distributable
#  "Trust-Little-Gerry.bat" (no loose .cer/.ps1 needed).
#
#  Re-run this whenever the certificate changes.
#
#  Usage:
#    cd installer\cert
#    powershell -NoProfile -ExecutionPolicy Bypass -File .\3-Make-Trust-Bat.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$cer    = Join-Path $here "LittleGerry-PublicCert.cer"
$outBat = Join-Path $here "dist\Trust-Little-Gerry.bat"

if (-not (Test-Path $cer)) {
    Write-Host "  [ERROR] LittleGerry-PublicCert.cer not found. Run step 1 first." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path (Split-Path $outBat) | Out-Null

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($cer))

$bat = @"
@echo off
:: ============================================================
::  Trust Little Gerry  (one-click, self-contained)
::  Double-click this BEFORE downloading LittleGerry_Setup.exe.
::  Approve the admin prompt once. That's it.
:: ============================================================
title Trust Little Gerry

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  Requesting administrator permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "CER=%TEMP%\LittleGerry-PublicCert.cer"
> "%CER%.b64" echo $b64
certutil -decode "%CER%.b64" "%CER%" >nul
del "%CER%.b64" >nul 2>&1

echo.
echo  Trusting the Little Gerry publisher certificate...
powershell -NoProfile -Command "Import-Certificate -FilePath '%CER%' -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null; Import-Certificate -FilePath '%CER%' -CertStoreLocation 'Cert:\LocalMachine\TrustedPublisher' | Out-Null"

del "%CER%" >nul 2>&1

echo.
echo  Done. Little Gerry is now a trusted publisher on this PC.
echo  You can now download and run LittleGerry_Setup.exe normally.
echo.
pause
"@

Set-Content -Path $outBat -Value $bat -Encoding ASCII
Write-Host ""
Write-Host "  Created: $outBat" -ForegroundColor Green
Write-Host "  This single file is the one to distribute / upload to the release." -ForegroundColor Yellow
Write-Host ""
