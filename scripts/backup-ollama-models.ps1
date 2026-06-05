<#
.SYNOPSIS
    Backs up Ollama model files to a destination you choose (USB drive, NAS, network share, etc.)
    Run this NOW, before the dedicated server arrives, so you don't have to re-download models.

.DESCRIPTION
    gemma3:27b is ~17 GB. This script:
      1. Finds your Ollama model files
      2. Shows sizes so you know how much space you need
      3. Copies them to a destination you specify
      4. Verifies the copy with a file count check
      5. Writes a restore-info.txt so the server setup script can find the right files

.EXAMPLE
    # Back up to a USB drive
    .\backup-ollama-models.ps1 -Destination "E:\OllamaBackup"

    # Back up to a network share
    .\backup-ollama-models.ps1 -Destination "\\MYNAS\backups\OllamaBackup"

    # No destination = saves to Desktop
    .\backup-ollama-models.ps1
#>
param(
    [string]$Destination = "$env:USERPROFILE\Desktop\OllamaModels_Backup"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Ollama Model Backup ===" -ForegroundColor Cyan
Write-Host "Destination: $Destination"
Write-Host ""

# ── Find model files ──────────────────────────────────────────────────────────
$searchPaths = @(
    "$env:USERPROFILE\.ollama\models",
    "$env:LOCALAPPDATA\Ollama\models"
)

$sourceDir = $null
foreach ($p in $searchPaths) {
    if (Test-Path $p) { $sourceDir = $p; break }
}

if (-not $sourceDir) {
    Write-Host "No Ollama model files found. Is Ollama installed and has a model been pulled?" -ForegroundColor Red
    Write-Host "Expected locations:"
    $searchPaths | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host "Found model directory: $sourceDir" -ForegroundColor Green

# ── Show what's there ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Contents:" -ForegroundColor Yellow
$totalBytes = 0
Get-ChildItem -Path $sourceDir -Recurse -File | ForEach-Object {
    $totalBytes += $_.Length
}
$totalGB = [math]::Round($totalBytes / 1GB, 2)
Write-Host "  Total size: $totalGB GB  ($($totalBytes.ToString("N0")) bytes)"

# Show installed models via Ollama CLI if available
$ollamaExe = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaExe) {
    Write-Host ""
    Write-Host "  Installed models:"
    ollama list 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
}

# ── Check destination has enough space ───────────────────────────────────────
Write-Host ""
Write-Host "Checking destination space..." -ForegroundColor Cyan
try {
    # Get drive root from destination
    $destRoot = Split-Path -Qualifier $Destination -ErrorAction SilentlyContinue
    if ($destRoot) {
        $drive = Get-PSDrive -Name $destRoot.TrimEnd(':') -ErrorAction SilentlyContinue
        if ($drive -and $drive.Free) {
            $freeGB = [math]::Round($drive.Free / 1GB, 2)
            Write-Host "  Free space on destination: $freeGB GB"
            if ($drive.Free -lt $totalBytes) {
                Write-Host "  WARNING: Not enough free space! Need $totalGB GB, have $freeGB GB." -ForegroundColor Red
                $proceed = Read-Host "Proceed anyway? [y/N]"
                if ($proceed.ToLower() -ne "y") { exit 1 }
            } else {
                Write-Host "  Sufficient space available." -ForegroundColor Green
            }
        }
    }
} catch {
    Write-Host "  (Could not check free space — proceeding)" -ForegroundColor Gray
}

# ── Confirm ───────────────────────────────────────────────────────────────────
Write-Host ""
$confirm = Read-Host "Copy $totalGB GB to '$Destination'? [y/N]"
if ($confirm.ToLower() -ne "y") { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }

# ── Copy ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Copying..." -ForegroundColor Cyan

New-Item -ItemType Directory -Path $Destination -Force | Out-Null

$modelsDestDir = Join-Path $Destination "models"

# Use robocopy for reliable large-file transfer with progress
$robocopyArgs = @(
    $sourceDir,
    $modelsDestDir,
    "/E",           # copy subdirectories including empty ones
    "/COPYALL",     # preserve attributes
    "/R:3",         # 3 retries
    "/W:5",         # 5 second wait between retries
    "/NP",          # no progress percentage (cleaner output)
    "/NDL"          # no directory listing
)

robocopy @robocopyArgs
$rc = $LASTEXITCODE
# robocopy exit codes: 0=no files, 1=files copied OK, 2-7=warnings, 8+=errors
if ($rc -ge 8) {
    Write-Host "robocopy reported errors (exit code $rc). Check output above." -ForegroundColor Red
    exit 1
}

# ── Write restore-info.txt ────────────────────────────────────────────────────
$restoreInfo = @"
Ollama Model Backup
===================
Backed up from : $env:COMPUTERNAME
Source path    : $sourceDir
Backup date    : $(Get-Date -Format "yyyy-MM-dd HH:mm")
Total size     : $totalGB GB

To restore on the new server:
  1. Copy the 'models' folder from this backup to: C:\Users\<username>\.ollama\models
  2. Or run scripts\setup-llm-server.ps1 and let it re-pull if internet is fast enough.

Models backed up:
$(if ($ollamaExe) { ollama list 2>&1 | Out-String } else { "(ollama CLI not available at backup time)" })
"@

Set-Content -Path (Join-Path $Destination "restore-info.txt") -Value $restoreInfo

# ── Verify ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Verifying..." -ForegroundColor Cyan
$srcCount  = (Get-ChildItem -Path $sourceDir  -Recurse -File).Count
$destCount = (Get-ChildItem -Path $modelsDestDir -Recurse -File).Count

if ($destCount -ge $srcCount) {
    Write-Host "  Verification passed: $destCount files in destination (source had $srcCount)." -ForegroundColor Green
} else {
    Write-Host "  WARNING: Source has $srcCount files but destination has $destCount. Some files may be missing." -ForegroundColor Yellow
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Backup complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Backup saved to: $Destination" -ForegroundColor Yellow
Write-Host "  models\      — model weights (copy to new server's .ollama\models)"
Write-Host "  restore-info.txt — notes for migration day"
Write-Host ""
Write-Host "Next step: keep this backup safe until the new server is set up."
Write-Host "On migration day, run: scripts\migrate-to-server.ps1"
Write-Host ""
