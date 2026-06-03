@echo off
:: ============================================================
::  Little Gerry — Start All Services
::  Precisian Medical Instruments / VACTOR Program
::
::  Starts: Docker (PostgreSQL) + Ollama + FastAPI backend
::          + Vite frontend dev server, then opens the browser.
::
::  For daily use — double-click or use the desktop shortcut.
:: ============================================================

cd /d "%~dp0"
title Little Gerry — Starting...

echo.
echo  ====================================================
echo   Little Gerry — Starting Services
echo  ====================================================
echo.

:: ── 1. Docker Desktop ─────────────────────────────────────
echo  [1/5] Checking Docker...
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo        Starting Docker Desktop...
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    echo        Waiting for Docker to be ready (up to 60s)...
    :docker_wait
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if %ERRORLEVEL% neq 0 goto docker_wait
)
echo  [1/5] Docker is running.

:: ── 2. PostgreSQL (Docker Compose) ────────────────────────
echo  [2/5] Starting PostgreSQL...
docker compose up -d >nul 2>&1
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

:: ── 4. FastAPI Backend ────────────────────────────────────
echo  [4/5] Starting FastAPI backend (port 8000)...
start "Little Gerry — Backend" /min cmd /k "cd /d "%~dp0backend" && .venv\Scripts\activate && uvicorn main:app --host 127.0.0.1 --port 8000"

:: Give the backend a moment to initialise
timeout /t 4 /nobreak >nul

:: ── 5. Frontend Dev Server ────────────────────────────────
echo  [5/5] Starting frontend dev server (port 5173)...
start "Little Gerry — Frontend" /min cmd /k "cd /d "%~dp0frontend" && npm run dev"

:: Wait for the frontend to be ready then open browser
echo.
echo  Waiting for frontend to start...
timeout /t 6 /nobreak >nul

echo  Opening browser at http://localhost:5173 ...
start "" "http://localhost:5173"

title Little Gerry — Running
echo.
echo  ====================================================
echo   Little Gerry is running!
echo.
echo   Open  : http://localhost:5173
echo   Login : admin@precisian.local / Admin1234!
echo.
echo   Close this window only AFTER stopping services,
echo   or run "Stop Little Gerry.bat" to shut down cleanly.
echo  ====================================================
echo.
pause
