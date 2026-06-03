@echo off
:: ============================================================
::  Little Gerry — Update
::  Pulls the latest version from GitHub and restarts.
::
::  Double-click to update, or run silently:
::    "Update Little Gerry.bat" /silent
:: ============================================================

cd /d "%~dp0"
title Little Gerry — Updating...

echo.
echo  ====================================================
echo   Little Gerry — Checking for updates...
echo  ====================================================
echo.

:: Stop running services first
call "%~dp0Stop Little Gerry.bat" >nul 2>&1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1"

if %ERRORLEVEL% neq 0 (
    echo.
    echo  [ERROR] Update failed. See output above.
    echo.
    pause
    exit /b 1
)

pause
