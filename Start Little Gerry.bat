@echo off
:: ============================================================
::  Little Gerry - Start All Services
::  Precisian Medical Instruments / VACTOR Program
:: ============================================================

cd /d "%~dp0"
title Little Gerry - Starting...

:: Refresh PATH so freshly-installed tools (docker, node, ollama) are found
set "PATH=%PATH%;%ProgramFiles%\Docker\Docker\resources\bin;%ProgramFiles%\nodejs;%USERPROFILE%\AppData\Local\Programs\Python\Python314;%USERPROFILE%\AppData\Local\Programs\Python\Python314\Scripts;%USERPROFILE%\.local\bin"

:: ── First-run setup (runs if .venv is missing) ─────────────
if not exist "%~dp0backend\.venv\Scripts\activate.bat" (
    echo.
    echo  ====================================================
    echo   Little Gerry - First Run Setup
    echo   This takes 2-5 minutes. Please wait...
    echo  ====================================================
    echo.

    echo  [Setup 1/5] Installing Python dependencies...
    cd /d "%~dp0backend"
    uv sync
    if %ERRORLEVEL% neq 0 (
        echo  [ERROR] uv sync failed. Is Python and uv installed?
        pause & exit /b 1
    )

    echo  [Setup 2/5] Creating backend .env...
    if not exist "%~dp0backend\.env" (
        if exist "%~dp0backend\.env.example" (
            copy "%~dp0backend\.env.example" "%~dp0backend\.env" >nul
        )
    )

    echo  [Setup 3/5] Running database migrations...
    call "%~dp0backend\.venv\Scripts\activate.bat"
    cd /d "%~dp0backend"
    alembic upgrade head
    if %ERRORLEVEL% neq 0 (
        echo  [ERROR] Migrations failed. Is PostgreSQL running?
        pause & exit /b 1
    )

    echo  [Setup 4/5] Seeding admin user...
    set PMI_ADMIN_EMAIL=admin@precisian.local
    set PMI_ADMIN_PASSWORD=Admin1234!
    set PMI_ADMIN_NAME=PMI Admin
    python scripts\seed_admin.py

    echo  [Setup 5/5] Installing frontend dependencies...
    cd /d "%~dp0frontend"
    npm install
    if %ERRORLEVEL% neq 0 (
        echo  [ERROR] npm install failed. Is Node.js installed?
        pause & exit /b 1
    )

    echo  [Setup] Creating frontend .env...
    if not exist "%~dp0frontend\.env" (
        echo VITE_API_BASE=http://127.0.0.1:8000 > "%~dp0frontend\.env"
        echo VITE_WS_BASE=ws://127.0.0.1:8000 >> "%~dp0frontend\.env"
    )

    echo.
    echo  [Setup] Complete! Starting Little Gerry...
    echo.
    cd /d "%~dp0"
)

echo.
echo  ====================================================
echo   Little Gerry - Starting Services
echo  ====================================================
echo.

:: ── 1. Docker Engine (background service, no GUI) ───────────
echo  [1/5] Checking Docker...
docker info >nul 2>&1
if %ERRORLEVEL% equ 0 goto docker_ready

echo        Starting Docker engine (background)...
:: Try starting the Docker engine Windows service directly (no GUI)
sc start com.docker.service >nul 2>&1
if %ERRORLEVEL% neq 0 (
    :: Fallback: start Docker Desktop minimised if service not available
    if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
        start "" /min "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    ) else if exist "%LOCALAPPDATA%\Docker\Docker Desktop.exe" (
        start "" /min "%LOCALAPPDATA%\Docker\Docker Desktop.exe"
    ) else (
        echo  [ERROR] Docker not found. Please install Docker Desktop.
        pause
        exit /b 1
    )
)
echo        Waiting for Docker to be ready (up to 90s)...
set DOCKER_WAIT=0
:docker_wait
set /a DOCKER_WAIT+=1
if %DOCKER_WAIT% gtr 30 (
    echo  [ERROR] Docker did not start in time.
    pause
    exit /b 1
)
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 goto docker_wait

:docker_ready
echo  [1/5] Docker is running.

:: ── 2. PostgreSQL (Docker Compose) ────────────────────────
echo  [2/5] Starting PostgreSQL...
docker compose up -d --remove-orphans
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] docker compose failed. Is Docker running?
    pause
    exit /b 1
)
echo  [2/5] PostgreSQL ready.

:: ── 3. Ollama (hidden background process) ───────────────────
echo  [3/5] Checking Ollama...
tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if %ERRORLEVEL% neq 0 (
    echo        Starting Ollama in background...
    powershell -WindowStyle Hidden -Command "Start-Process ollama -ArgumentList serve -WindowStyle Hidden" >nul 2>&1
    timeout /t 4 /nobreak >nul
)
echo  [3/5] Ollama is running.

:: ── 4. FastAPI Backend ─────────────────────────────────────
echo  [4/5] Starting FastAPI backend (port 8000)...
set BACKEND=%~dp0backend
start "Little Gerry - Backend" cmd /k "cd /d "%BACKEND%" && call .venv\Scripts\activate.bat && uvicorn main:app --host 127.0.0.1 --port 8000"

:: Give the backend a moment to initialise
timeout /t 5 /nobreak >nul

:: ── 5. Frontend Dev Server ─────────────────────────────────
echo  [5/5] Starting frontend dev server (port 5173)...
set FRONTEND=%~dp0frontend
start "Little Gerry - Frontend" cmd /k "cd /d "%FRONTEND%" && npm run dev"

:: Wait for frontend then open browser
echo.
echo  Waiting for frontend to start...
timeout /t 8 /nobreak >nul

echo  Opening browser at http://localhost:5173 ...
start "" "http://localhost:5173"

title Little Gerry - Running
echo.
echo  ====================================================
echo   Little Gerry is running!
echo.
echo   Open  : http://localhost:5173
echo   Login : admin@precisian.local / Admin1234!
echo.
echo   Two terminal windows (Backend + Frontend) are
echo   running in the background - don't close them.
echo   Run "Stop Little Gerry.bat" to shut down cleanly.
echo  ====================================================
echo.
pause
pause
