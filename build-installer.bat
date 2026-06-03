@echo off
:: ============================================================
::  Build Little Gerry Windows Installer (.exe)
::
::  Requires Inno Setup 6 (free): https://jrsoftware.org/isinfo.php
::
::  After downloading and installing Inno Setup, run this file
::  from the project root. It compiles installer\setup.iss into:
::
::      installer\Output\LittleGerry_Setup.exe
::
::  That single .exe is the full Windows installer — share it
::  with anyone who needs to install Little Gerry.
:: ============================================================

cd /d "%~dp0"
title Build Little Gerry Installer

echo.
echo  Building Little Gerry Windows installer...
echo.

:: Find Inno Setup Compiler (iscc.exe)
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\iscc.exe" (
    set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\iscc.exe"
) else if exist "%ProgramFiles%\Inno Setup 6\iscc.exe" (
    set "ISCC=%ProgramFiles%\Inno Setup 6\iscc.exe"
) else (
    echo  [ERROR] Inno Setup 6 not found.
    echo.
    echo  Please download and install it from:
    echo    https://jrsoftware.org/isdl.php
    echo.
    echo  Then re-run this file.
    echo.
    pause
    exit /b 1
)

echo  Found Inno Setup: %ISCC%
echo.

:: Compile the installer script
"%ISCC%" installer\setup.iss

if %ERRORLEVEL% neq 0 (
    echo.
    echo  [ERROR] Installer build failed. See output above.
    echo.
    pause
    exit /b 1
)

echo.
echo  ====================================================
echo   SUCCESS — Installer created:
echo   installer\Output\LittleGerry_Setup.exe
echo.
echo   Share this file to install Little Gerry on any
echo   Windows 10/11 machine.
echo  ====================================================
echo.
pause
