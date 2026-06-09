#Requires -Version 5.1
<#
.SYNOPSIS
    Little Gerry - apply a downloaded update.

    Launched (detached) by launcher.py when a newer signed installer is found.
    Stops the running app, installs the update silently, then relaunches.

.PARAMETER Installer
    Full path to the downloaded, signed LittleGerry_Setup.exe.

.PARAMETER AppDir
    The application install directory (project root).
#>
param(
    [Parameter(Mandatory = $true)] [string]$Installer,
    [Parameter(Mandatory = $true)] [string]$AppDir
)

$ErrorActionPreference = "Continue"

# Give the launcher a moment to exit and release file locks.
Start-Sleep -Seconds 2

# 1. Stop all running services so the installer can replace files.
$stopBat = Join-Path $AppDir "Stop Little Gerry.bat"
if (Test-Path $stopBat) {
    & cmd.exe /c "`"$stopBat`"" 2>&1 | Out-Null
}
Start-Sleep -Seconds 2

# 2. Install the update silently. The installer is signed and (on trusted
#    machines) elevates with a clean publisher prompt.
if (Test-Path $Installer) {
    Start-Process -FilePath $Installer `
        -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCANCEL' `
        -Verb RunAs -Wait
    Remove-Item $Installer -Force -ErrorAction SilentlyContinue
}

# 3. Relaunch the app.
$startBat = Join-Path $AppDir "Start Little Gerry.bat"
if (Test-Path $startBat) {
    Start-Process -FilePath $startBat -WorkingDirectory $AppDir
}
