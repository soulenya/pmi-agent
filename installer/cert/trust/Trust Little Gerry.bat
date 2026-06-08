@echo off
:: ============================================================
::  Trust Little Gerry - one-click certificate installer
::  Double-click this. It will ask for admin once, then trust
::  the Little Gerry publisher so the app installs without the
::  "unknown publisher" / false-positive warning.
:: ============================================================

title Trust Little Gerry

:: Self-elevate to administrator if not already
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo  Requesting administrator permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Certificate.ps1"

echo.
pause
