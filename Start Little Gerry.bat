@echo off
setlocal EnableDelayedExpansion
:: ============================================================
::  Little Gerry - Start All Services
::  Precisian Medical Instruments / VACTOR Program
:: ============================================================

cd /d "%~dp0"
title Little Gerry - Starting...

:: Refresh PATH so freshly-installed tools (docker, node, ollama) are found
set "PATH=%PATH%;%ProgramFiles%\Docker\Docker\resources\bin;%ProgramFiles%\nodejs;%USERPROFILE%\AppData\Local\Programs\Python\Python314;%USERPROFILE%\AppData\Local\Programs\Python\Python314\Scripts;%USERPROFILE%\.local\bin"

:: ── First-run setup (runs if .venv is missing) ─────────────
if exist "%~dp0backend\.venv\Scripts\activate.bat" goto :launch

echo.
echo  ====================================================
echo   Little Gerry - First Run Setup
echo   This takes 2-5 minutes. Please wait...
echo  ====================================================
echo.

echo  [Setup 1/5] Installing Python dependencies...
:: Force-delete .venv (even if empty/broken) using PowerShell for reliability
powershell -Command "if (Test-Path '%~dp0backend\.venv') { Remove-Item '%~dp0backend\.venv' -Recurse -Force }"
cd /d "%~dp0backend"
:: Explicitly point uv at the known Python 3.14 location
uv sync --python "%USERPROFILE%\AppData\Local\Programs\Python\Python314\python.exe"
if !ERRORLEVEL! neq 0 (
    echo  [ERROR] uv sync failed. Is Python and uv installed?
    pause & exit /b 1
)

echo  [Setup 2/5] Creating backend .env...
if not exist "%~dp0backend\.env" (
    if exist "%~dp0backend\.env.example" (
        copy "%~dp0backend\.env.example" "%~dp0backend\.env" >nul
    )
)

echo  [Setup 3/5] Starting database and running migrations...
:: Start Docker Desktop service then wait until the daemon is actually responsive
sc start com.docker.service >nul 2>&1

echo  Waiting for Docker Desktop to be ready (up to 90s)...
set DOCKER_READY=0
for /L %%i in (1,1,30) do (
    if !DOCKER_READY! equ 0 (
        docker info >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            set DOCKER_READY=1
            echo  Docker Desktop is ready.
        ) else (
            timeout /t 3 /nobreak >nul
        )
    )
)
if !DOCKER_READY! equ 0 (
    echo.
    echo  [ERROR] Docker Desktop did not start in time.
    echo  Please open Docker Desktop manually, wait for it to show "Engine running",
    echo  then run "Start Little Gerry.bat" again.
    echo.
    pause & exit /b 1
)

cd /d "%~dp0"
docker compose up -d --remove-orphans
if !ERRORLEVEL! neq 0 (
    echo  [ERROR] docker compose up failed. Is Docker Desktop running?
    pause & exit /b 1
)

echo  Waiting for PostgreSQL to accept connections (up to 60s)...
set PG_READY=0
for /L %%i in (1,1,20) do (
    if !PG_READY! equ 0 (
        docker exec pmi_postgres pg_isready -U pmi -d pmi_dev >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            set PG_READY=1
            echo  PostgreSQL is ready.
        ) else (
            timeout /t 3 /nobreak >nul
        )
    )
)
if !PG_READY! equ 0 (
    echo  [ERROR] PostgreSQL did not become ready in time. Check Docker Desktop logs.
    pause & exit /b 1
)

cd /d "%~dp0backend"
call .venv\Scripts\activate.bat
alembic upgrade head
if !ERRORLEVEL! neq 0 (
    echo  [ERROR] Migrations failed. Is Docker running?
    pause & exit /b 1
)

echo  [Setup 4/5] Creating your admin account...
    echo.
    echo  Enter your details for the Little Gerry login:
    echo.
    set /p PMI_ADMIN_EMAIL= "  Your company email: "
    set /p PMI_ADMIN_NAME=  "  Your display name : "
    set /p PMI_ADMIN_PASSWORD= "  Choose a password  : "
    echo.
python scripts\seed_admin.py

echo  [Setup 5/5] Installing frontend dependencies...
cd /d "%~dp0frontend"
npm install
if !ERRORLEVEL! neq 0 (
    echo  [ERROR] npm install failed. Is Node.js installed?
    pause & exit /b 1
)

echo  [Setup] Creating frontend .env...
if not exist "%~dp0frontend\.env" (
    (echo VITE_API_BASE=http://127.0.0.1:8000) > "%~dp0frontend\.env"
    (echo VITE_WS_BASE=ws://127.0.0.1:8000) >> "%~dp0frontend\.env"
)

echo.
echo  ====================================================
echo   Setup complete! Little Gerry is launching...
echo   The app window will appear in a moment.
echo  ====================================================
echo.

:launch
:: ── Launch Little Gerry (hidden, splash screen + system tray) ──────────────
cd /d "%~dp0"
start "" "%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0launcher.py"
timeout /t 5 /nobreak >nul
