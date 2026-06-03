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

:: Kill frontend dev server (node/vite)
echo  [1/5] Stopping frontend...
taskkill /fi "windowtitle eq Little Gerry - Frontend*" /f >nul 2>&1
echo  [1/5] Done.

:: Kill backend uvicorn
echo  [2/5] Stopping backend...
taskkill /fi "windowtitle eq Little Gerry - Backend*" /f >nul 2>&1
echo  [2/5] Done.

:: Stop PostgreSQL container
echo  [3/5] Stopping PostgreSQL...
docker compose stop >nul 2>&1
echo  [3/5] Done.

:: Stop Ollama
echo  [4/5] Stopping Ollama...
taskkill /f /im ollama.exe >nul 2>&1
echo  [4/5] Done.

:: Stop Docker engine service
echo  [5/5] Stopping Docker engine...
sc stop com.docker.service >nul 2>&1
echo  [5/5] Done.

echo.
echo  All services stopped. Goodbye!
echo.
timeout /t 2 /nobreak >nul
