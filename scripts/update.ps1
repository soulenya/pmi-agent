#Requires -Version 5.1
<#
.SYNOPSIS
    Little Gerry - Pull latest code from GitHub and restart.

.PARAMETER ProjectRoot
    Path to the project root. Defaults to the parent of this script's directory.

.PARAMETER SkipRestart
    If set, stops after updating dependencies without restarting services.
#>
param(
    [string]$ProjectRoot = "",
    [switch]$SkipRestart
)

$ErrorActionPreference = "Continue"


if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path $PSScriptRoot -Parent
}
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$BackendDir  = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

function Write-Step { param($msg) Write-Host "`n== $msg ==" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "  [XX] $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "       $msg" -ForegroundColor Gray }

Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  Little Gerry -- Update" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""

Set-Location $ProjectRoot

# ── Record current commit ─────────────────────────────────────────────────────
$before = & git rev-parse --short HEAD 2>&1
Write-Info "Current version : $before"

# ── Pull latest code ──────────────────────────────────────────────────────────
Write-Step "Step 1 of 4 - Pulling latest code from GitHub"
$gitFetch = & git fetch origin 2>&1; $gitFetch | ForEach-Object { Write-Info $_ }
$gitReset = & git reset --hard origin/master 2>&1; $gitReset | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "git pull failed. Check your internet connection."
    exit 1
}
$after = & git rev-parse --short HEAD 2>&1
Write-OK "Updated : $before -> $after"

# ── Update Python dependencies ────────────────────────────────────────────────
Write-Step "Step 2 of 4 - Updating Python dependencies"
Set-Location $BackendDir
$uvResult = & uv sync 2>&1
$uvResult | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) { Write-Fail "uv sync failed"; exit 1 }
Write-OK "Python dependencies up to date"

# ── Run database migrations ───────────────────────────────────────────────────
Write-Step "Step 3 of 4 - Running database migrations"

# Ensure Docker service is running
Write-Info "Ensuring Docker is running..."
& sc.exe start com.docker.service 2>&1 | Out-Null
$dockerReady = $false
for ($i = 0; $i -lt 15; $i++) {
    $di = & docker info 2>&1
    if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
    Start-Sleep -Seconds 3
}
if (-not $dockerReady) { Write-Fail "Docker did not start in time"; exit 1 }

# Ensure pmi_postgres container is running
Write-Info "Ensuring PostgreSQL container is running..."
$containerState = (& docker inspect --format "{{.State.Status}}" pmi_postgres 2>&1)
if ($containerState -eq "running") {
    Write-Info "PostgreSQL already running"
} elseif ($containerState -eq "exited") {
    & docker start pmi_postgres 2>&1 | Out-Null
    Start-Sleep -Seconds 4
} else {
    Set-Location $ProjectRoot
    & docker compose up -d --remove-orphans 2>&1 | Out-Null
    Set-Location $BackendDir
    Start-Sleep -Seconds 8
}

# Wait for PostgreSQL to accept connections
Write-Info "Waiting for PostgreSQL to be ready..."
Start-Sleep -Seconds 3

$alembicResult = & uv run alembic upgrade head 2>&1; $alembicResult | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) { Write-Fail "Alembic migrations failed"; exit 1 }
Write-OK "Database schema up to date"

# ── Update frontend dependencies ──────────────────────────────────────────────
Write-Step "Step 4 of 4 - Updating frontend dependencies"
Set-Location $FrontendDir
$npmResult = & npm install --silent 2>&1; $npmResult | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed"; exit 1 }
Write-OK "Frontend dependencies up to date"

# ── Done ──────────────────────────────────────────────────────────────────────
Set-Location $ProjectRoot
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Update complete!  $before -> $after" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

if (-not $SkipRestart) {
    Write-Info "Restarting Little Gerry..."
    Start-Process (Join-Path $ProjectRoot "Start Little Gerry.bat") -WorkingDirectory $ProjectRoot
}
