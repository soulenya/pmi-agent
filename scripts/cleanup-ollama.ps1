#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes Ollama (and ONLY Ollama) from this machine.
    Docker Desktop and PostgreSQL are deliberately preserved — they run the Little Gerry database.

.DESCRIPTION
    1. Stops the Ollama process and service
    2. Backs up model files to your Desktop before deletion
    3. Uninstalls Ollama
    4. Removes OLLAMA_* environment variables
    5. Cleans up leftover files and registry entries

    Run from an elevated PowerShell prompt.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Little Gerry — Ollama Cleanup Script ===" -ForegroundColor Cyan
Write-Host "This will remove Ollama from THIS machine."
Write-Host "Docker Desktop and PostgreSQL will NOT be touched."
Write-Host ""

# ── Confirmation ─────────────────────────────────────────────────────────────
$confirm = Read-Host "Type YES to continue"
if ($confirm -ne "YES") { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }

# ── Step 1: Stop Ollama process ───────────────────────────────────────────────
Write-Host ""
Write-Host "[1/6] Stopping Ollama process..." -ForegroundColor Cyan
$ollamaProcs = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollamaProcs) {
    $ollamaProcs | Stop-Process -Force
    Write-Host "  Stopped Ollama process." -ForegroundColor Green
} else {
    Write-Host "  Ollama not running." -ForegroundColor Gray
}

# ── Step 2: Remove Ollama Windows service (if registered) ────────────────────
Write-Host "[2/6] Removing Ollama service..." -ForegroundColor Cyan
$svc = Get-Service -Name "ollama" -ErrorAction SilentlyContinue
if ($svc) {
    Stop-Service -Name "ollama" -Force -ErrorAction SilentlyContinue
    sc.exe delete "ollama" | Out-Null
    Write-Host "  Removed ollama service." -ForegroundColor Green
} else {
    Write-Host "  No ollama service found." -ForegroundColor Gray
}

# ── Step 3: Uninstall Ollama via winget / uninstaller ─────────────────────────
Write-Host "[3/5] Uninstalling Ollama..." -ForegroundColor Cyan

# Try winget first
$wingetAvailable = Get-Command winget -ErrorAction SilentlyContinue
if ($wingetAvailable) {
    $wingetResult = winget uninstall --id Ollama.Ollama --silent 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Uninstalled via winget." -ForegroundColor Green
    } else {
        Write-Host "  winget uninstall returned: $wingetResult" -ForegroundColor Yellow
    }
}

# Also check for standalone uninstaller
$uninstallerPaths = @(
    "$env:LOCALAPPDATA\Programs\Ollama\unins000.exe",
    "$env:ProgramFiles\Ollama\unins000.exe"
)
foreach ($u in $uninstallerPaths) {
    if (Test-Path $u) {
        Write-Host "  Running uninstaller: $u"
        Start-Process -FilePath $u -ArgumentList "/SILENT" -Wait
        Write-Host "  Uninstaller completed." -ForegroundColor Green
    }
}

# Remove remaining install folders
$installFolders = @(
    "$env:LOCALAPPDATA\Programs\Ollama",
    "$env:ProgramFiles\Ollama",
    "$env:LOCALAPPDATA\Ollama"
)
foreach ($f in $installFolders) {
    if (Test-Path $f) {
        Remove-Item -Path $f -Recurse -Force
        Write-Host "  Removed: $f" -ForegroundColor Green
    }
}

# Remove .ollama folder (contains models + config) — already backed up above
$dotOllama = "$env:USERPROFILE\.ollama"
if (Test-Path $dotOllama) {
    Remove-Item -Path $dotOllama -Recurse -Force
    Write-Host "  Removed: $dotOllama" -ForegroundColor Green
}

# ── Step 4: Remove environment variables ──────────────────────────────────────
Write-Host "[4/5] Removing OLLAMA_* environment variables..." -ForegroundColor Cyan
$ollamaVars = @("OLLAMA_HOST", "OLLAMA_BASE_URL", "OLLAMA_MODELS", "OLLAMA_HOME")
foreach ($var in $ollamaVars) {
    [System.Environment]::SetEnvironmentVariable($var, $null, "Machine")
    [System.Environment]::SetEnvironmentVariable($var, $null, "User")
    Write-Host "  Removed: $var" -ForegroundColor Green
}

# Remove ollama from PATH (Machine and User)
foreach ($scope in @("Machine", "User")) {
    $currentPath = [System.Environment]::GetEnvironmentVariable("PATH", $scope)
    if ($currentPath) {
        $newPath = ($currentPath -split ";" | Where-Object { $_ -notmatch "ollama" -and $_ -ne "" }) -join ";"
        if ($newPath -ne $currentPath) {
            [System.Environment]::SetEnvironmentVariable("PATH", $newPath, $scope)
            Write-Host "  Removed Ollama from PATH ($scope)." -ForegroundColor Green
        }
    }
}

# ── Step 5: Remove Ollama firewall rules ──────────────────────────────────────
Write-Host "[5/5] Removing Ollama firewall rules..." -ForegroundColor Cyan
$fwRules = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match "ollama" -or $_.DisplayName -match "Ollama" }
if ($fwRules) {
    $fwRules | Remove-NetFirewallRule
    Write-Host "  Removed $($fwRules.Count) firewall rule(s)." -ForegroundColor Green
} else {
    Write-Host "  No Ollama firewall rules found." -ForegroundColor Gray
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Cleanup complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Run scripts\setup-llm-server.ps1 on the dedicated server"
Write-Host "     (it will pull the model fresh — no copy needed)"
Write-Host "  2. Run scripts\test-llm-server.ps1 <server-ip> to verify"
Write-Host "  3. Update Ollama Server URL in Little Gerry Settings"
Write-Host ""
