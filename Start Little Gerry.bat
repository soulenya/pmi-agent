@echo off
setlocal EnableDelayedExpansion
:: ============================================================
::  Little Gerry - Start All Services
::  Precisian Medical Instruments / VACTOR Program
:: ============================================================

cd /d "%~dp0"
title Little Gerry - Starting...

:: Refresh PATH so freshly-installed tools (docker, node) are found
set "PATH=%PATH%;%ProgramFiles%\Docker\Docker\resources\bin;%ProgramFiles%\nodejs;%USERPROFILE%\AppData\Local\Programs\Python\Python314;%USERPROFILE%\AppData\Local\Programs\Python\Python314\Scripts;%ProgramFiles%\Python314;%ProgramFiles%\Python314\Scripts;%APPDATA%\Python\Python314\Scripts;%USERPROFILE%\.local\bin"
:: Python 3.14 may be per-user or machine-wide depending on how winget ran.
set "PY314=%USERPROFILE%\AppData\Local\Programs\Python\Python314\python.exe"
if not exist "%PY314%" set "PY314=%ProgramFiles%\Python314\python.exe"
if not exist "%PY314%" set "PY314="

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

:: ── Locate uv, bootstrapping it if this machine doesn't have it yet ───────
set "UV_EXE="
call :find_uv
if not defined UV_EXE (
    echo  uv is not installed yet - installing it now...
    if defined PY314 (
        "!PY314!" -m pip install uv --quiet --disable-pip-version-check
    ) else (
        python -m pip install uv --quiet --disable-pip-version-check
    )
    call :find_uv
)
if not defined UV_EXE (
    echo  Trying the standalone uv installer...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    call :find_uv
)
if not defined UV_EXE (
    echo.
    echo  [ERROR] Could not find or install uv automatically.
    echo  Make sure Python 3.14 is installed - re-run the Little Gerry installer,
    echo  or install Python from python.org - then run "Start Little Gerry" again.
    echo.
    pause & exit /b 1
)

:: Build the environment. If Python isn't in a known location, let uv find a
:: suitable 3.12+ interpreter anywhere on the machine - or download one itself.
if defined PY314 (
    "%UV_EXE%" sync --python "!PY314!"
) else (
    echo  Python 3.14 not found in the usual locations - uv will locate or
    echo  download a suitable Python automatically...
    "%UV_EXE%" sync --python 3.14
)
if !ERRORLEVEL! neq 0 (
    echo  Retrying with any compatible Python...
    "%UV_EXE%" sync
)
if !ERRORLEVEL! neq 0 (
    echo  [ERROR] uv sync failed. Re-run the Little Gerry installer to set up
    echo  prerequisites, then start Little Gerry again.
    pause & exit /b 1
)

echo  [Setup 2/5] Creating backend .env...
if not exist "%~dp0backend\.env" (
    if exist "%~dp0backend\.env.example" (
        copy "%~dp0backend\.env.example" "%~dp0backend\.env" >nul
    )
)

echo  [Setup 3/5] Starting database and running migrations...
:: Try to start Docker — first via the Windows service, then by launching Docker Desktop.exe directly
sc start com.docker.service >nul 2>&1
docker info >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo  Launching Docker Desktop...
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
)

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
:: Self-heal: remove a leftover pmi_postgres container from another project
:: (e.g. a dev checkout) that would otherwise cause a name conflict.
for /f %%c in ('docker compose ps -q postgres 2^>nul') do set "PG_OWNED=%%c"
if not defined PG_OWNED docker rm -f pmi_postgres >nul 2>&1
set "PG_OWNED="
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

echo  [Setup 4/5] Installing frontend dependencies...
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
goto :eof

:: ── Subroutine: set UV_EXE to a usable uv, checking PATH then the known
::    install locations (winget Python Scripts, pip --user Scripts, astral). ──
:find_uv
where uv >nul 2>&1
if !ERRORLEVEL! equ 0 (
    set "UV_EXE=uv"
    goto :eof
)
if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python314\Scripts\uv.exe" (
    set "UV_EXE=%USERPROFILE%\AppData\Local\Programs\Python\Python314\Scripts\uv.exe"
    goto :eof
)
if exist "%APPDATA%\Python\Python314\Scripts\uv.exe" (
    set "UV_EXE=%APPDATA%\Python\Python314\Scripts\uv.exe"
    goto :eof
)
if exist "%USERPROFILE%\.local\bin\uv.exe" (
    set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"
    goto :eof
)
goto :eof
