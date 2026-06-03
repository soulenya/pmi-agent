@echo off
:: ============================================================
::  Little Gerry — Stop All Services
::  Gracefully shuts down backend, frontend, and PostgreSQL.
:: ============================================================

cd /d "%~dp0"
title Little Gerry — Stopping...

echo.
echo  Stopping Little Gerry services...
echo.

:: Kill frontend dev server (node/vite)
echo  [1/3] Stopping frontend server...
taskkill /fi "windowtitle eq Little Gerry -- Frontend*" /f >nul 2>&1
echo  [1/3] Done.

:: Kill backend uvicorn
echo  [2/3] Stopping backend API...
taskkill /fi "windowtitle eq Little Gerry -- Backend*" /f >nul 2>&1
echo  [2/3] Done.

:: Stop PostgreSQL container (leave Ollama running — it's lightweight)
echo  [3/3] Stopping PostgreSQL...
docker compose stop >nul 2>&1
echo  [3/3] Done.

echo.
echo  All services stopped. Goodbye!
echo.
timeout /t 2 /nobreak >nul
