@echo off
:: ============================================================
::  Little Gerry - Start All Services
::  Precisian Medical Instruments / VACTOR Program
:: ============================================================

cd /d "%~dp0"
title Little Gerry - Starting...

:: Refresh PATH so freshly-installed tools (docker, node, ollama) are found
set "PATH=%PATH%;%ProgramFiles%\Docker\Docker\resources\bin;%ProgramFiles%\nodejs;%USERPROFILE%\AppData\Local\Programs\Python\Python314;%USERPROFILE%\AppData\Local\Programs\Python\Python314\Scripts;%USERPROFILE%\.local\bin"

echo.
echo  ====================================================
echo   Little Gerry - Starting Services
echo  ====================================================
echo.

:: ── 1. Docker Desktop ─────────────────────────────────────
echo  [1/5] Checking Docker...
docker info >nul 2>&1
if %ERRORLEVEL% equ 0 goto docker_ready

echo        Starting Docker Desktop...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
) else if exist "%LOCALAPPDATA%\Docker\Docker Desktop.exe" (
    start "" "%LOCALAPPDATA%\Docker\Docker Desktop.exe"
) else (
    echo  [ERROR] Docker Desktop not found. Please install it from https://docker.com
    pause
    exit /b 1
)
echo        Waiting for Docker to be ready (up to 90s)...
set DOCKER_WAIT=0
:docker_wait
set /a DOCKER_WAIT+=1
if %DOCKER_WAIT% gtr 30 (
    echo  [ERROR] Docker did not start in time. Please start Docker Desktop manually.
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

:: ── 3. Ollama ─────────────────────────────────────────────
echo  [3/5] Checking Ollama...
tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if %ERRORLEVEL% neq 0 (
    echo        Starting Ollama service...
    start "" /min ollama serve
    timeout /t 3 /nobreak >nul
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
