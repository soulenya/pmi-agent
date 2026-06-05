@echo off
:: ============================================================
::  Little Gerry - Install
::  Precisian Medical Instruments / VACTOR Program
::
::  Double-click this file to set up the entire application.
::  Requires internet access and ~5 GB disk space.
::
::  Runs as Administrator automatically if needed.
:: ============================================================

:: Auto-elevate if not already admin
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process cmd -ArgumentList '/c cd /d \"%~dp0\" && \"%~f0\"' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
title Little Gerry - Installer

echo.
echo  ====================================================
echo   Little Gerry AI Executive Assistant - Installer
echo   Precisian Medical Instruments / VACTOR Program
echo  ====================================================
echo.
echo  This will install all required components:
echo    - Docker Desktop (PostgreSQL database)
echo    - Python 3.14 + uv
echo    - Node.js 20 LTS
echo    - All application dependencies
echo.
echo  NOTE: Ollama (local LLM) is NOT installed here.
echo  It runs on a separate dedicated server.
echo  Configure the server URL in Settings after first launch.
echo  Until then, use Anthropic or OpenAI (API key required).
echo.
echo  Estimated time: 5-10 minutes
echo  Disk space required: ~1 GB
echo.
set /p CONFIRM="Press ENTER to begin installation, or Ctrl+C to cancel... "

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"

if %ERRORLEVEL% neq 0 (
    echo.
    echo  [ERROR] Installation encountered a problem.
    echo  Check the output above for details.
    echo.
    pause
    exit /b 1
)

echo.
echo  Installation finished. Press any key to launch Little Gerry now...
pause >nul

call "%~dp0Start Little Gerry.bat"
