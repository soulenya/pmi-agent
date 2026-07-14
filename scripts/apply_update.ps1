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

# ── Logging ──────────────────────────────────────────────────────────────
# Without this, a failed update is impossible to diagnose in the field.
$logDir = Join-Path $AppDir "backend\logs"
try { New-Item -ItemType Directory -Force -Path $logDir | Out-Null } catch {}
$logFile = Join-Path $logDir "apply_update.log"

function Write-Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

function Start-App {
    $startBat = Join-Path $AppDir "Start Little Gerry.bat"
    if (Test-Path $startBat) {
        Write-Log "Relaunching via: $startBat"
        Start-Process -FilePath $startBat -WorkingDirectory $AppDir
    } else {
        Write-Log "ERROR: Start bat not found at $startBat"
    }
}

Write-Log "=== apply_update started ==="
Write-Log "Installer: $Installer"
Write-Log "AppDir:    $AppDir"

try {
    # Give the launcher a moment to exit and release file locks.
    Start-Sleep -Seconds 2

    # 1. Stop all running services so the installer can replace files.
    $stopBat = Join-Path $AppDir "Stop Little Gerry.bat"
    if (Test-Path $stopBat) {
        Write-Log "Stopping services via: $stopBat"
        & cmd.exe /c "`"$stopBat`"" 2>&1 | Out-Null
    } else {
        Write-Log "WARN: Stop bat not found at $stopBat"
    }

    # The Stop bat does not kill the pythonw launcher process; do it here so
    # the installer can overwrite launcher.py and friends without file locks.
    try {
        Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe'" |
            Where-Object { $_.CommandLine -like "*launcher.py*" } |
            ForEach-Object {
                Write-Log "Killing launcher pythonw PID $($_.ProcessId)"
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    } catch { Write-Log "WARN: could not enumerate pythonw: $($_.Exception.Message)" }

    Start-Sleep -Seconds 2

    # 2. Install the update silently. The installer is signed and (on trusted
    #    machines) elevates with a clean publisher prompt. The Inno [Code]
    #    message boxes are SuppressibleMsgBox, so /SUPPRESSMSGBOXES will NOT
    #    block here.
    if (Test-Path $Installer) {
        $innoLog = Join-Path $logDir "inno_update.log"
        Write-Log "Running installer (silent). Inno log: $innoLog"
        try {
            $proc = Start-Process -FilePath $Installer `
                -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCANCEL', "/LOG=`"$innoLog`"" `
                -Verb RunAs -Wait -PassThru
            Write-Log "Installer exit code: $($proc.ExitCode)"
            if ($proc.ExitCode -eq 0) {
                # Success: clear the failed-attempt marker so the launcher's
                # retry guard resets (see launcher.py UPDATE_MARKER_FILE).
                Remove-Item (Join-Path $logDir "update_attempt.json") -Force -ErrorAction SilentlyContinue
                Write-Log "Install succeeded - cleared update attempt marker."
            }
        } catch {
            # Most common causes: the user declined the UAC elevation prompt, or
            # an Application Control policy (Windows Smart App Control) blocked
            # the installer. Record the reason so the launcher can tell the user
            # what to do instead of retrying forever.
            $errMsg = $_.Exception.Message
            Write-Log "Installer did not run (elevation declined or blocked): $errMsg"
            try {
                $markerPath = Join-Path $logDir "update_attempt.json"
                if (Test-Path $markerPath) {
                    $m = Get-Content $markerPath -Raw | ConvertFrom-Json
                    $m | Add-Member -NotePropertyName last_error -NotePropertyValue $errMsg -Force
                    $m | ConvertTo-Json -Compress | Set-Content $markerPath -Encoding UTF8
                }
            } catch {}
        }
        Remove-Item $Installer -Force -ErrorAction SilentlyContinue
    } else {
        Write-Log "ERROR: Installer not found at $Installer"
    }
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
}
finally {
    # 3. ALWAYS relaunch, even if the install step threw, so the user is never
    #    left with the app permanently down.
    Start-App
    Write-Log "=== apply_update finished ==="
}
