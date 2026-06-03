@echo off
:: ============================================================
::  Little Gerry - Stop All Services
::  Gracefully shuts down backend, frontend, PostgreSQL,
::  Ollama, and Docker engine.
:: ============================================================

cd /d "%~dp0"
title Little Gerry - Stopping...

echo.
echo  Stopping Little Gerry services...
echo.

:: Kill frontend dev server (node/vite on port 5173)
echo  [1/5] Stopping frontend...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173 "') do taskkill /f /pid %%a >nul 2>&1
taskkill /fi "windowtitle eq Little Gerry - Frontend*" /f >nul 2>&1
echo  [1/5] Done.

:: Kill backend uvicorn (port 8000)
echo  [2/5] Stopping backend...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000 "') do taskkill /f /pid %%a >nul 2>&1
taskkill /fi "windowtitle eq Little Gerry - Backend*" /f >nul 2>&1
echo  [2/5] Done.

:: Stop PostgreSQL container
echo  [3/5] Stopping PostgreSQL...
docker stop pmi_postgres >nul 2>&1
docker compose stop >nul 2>&1
echo  [3/5] Done.

:: Stop Ollama
echo  [4/5] Stopping Ollama...
taskkill /f /im ollama.exe >nul 2>&1
taskkill /f /im "ollama app.exe" >nul 2>&1
echo  [4/5] Done.

:: Stop Docker engine service
echo  [5/5] Stopping Docker engine...
sc stop com.docker.service >nul 2>&1
echo  [5/5] Done.

echo.
echo  All services stopped. Goodbye!
echo.
timeout /t 2 /nobreak >nul
