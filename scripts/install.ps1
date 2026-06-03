#Requires -Version 5.1
<#
.SYNOPSIS
    Little Gerry — Full automated setup for Windows.

.DESCRIPTION
    Installs and configures all dependencies for the Little Gerry AI Executive
    Assistant (Precisian Medical Instruments / VACTOR program).

    Prerequisites installed automatically via winget:
      - Docker Desktop
      - Ollama
      - Python 3.14+
      - Node.js 20 LTS
      - uv (Python package manager)
      - Rust toolchain (for Tauri desktop build, optional)

    Run from the project root:
        .\scripts\install.ps1

    Or to skip the Tauri desktop build:
        .\scripts\install.ps1 -SkipTauriBuild

.PARAMETER SkipTauriBuild
    Skip compiling the Tauri desktop .exe (saves ~10 minutes; you can use
    the browser at http://localhost:5173 instead).

.PARAMETER ProjectRoot
    Path to the project root. Defaults to the parent of this script's directory.
#>
param(
    [switch]$SkipTauriBuild,
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ── Resolve project root ──────────────────────────────────────────────────────
if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path $PSScriptRoot -Parent
}
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$BackendDir  = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

# ── Colour helpers ────────────────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "`n== $msg ==" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  [XX] $msg" -ForegroundColor Red }
function Write-Info  { param($msg) Write-Host "       $msg" -ForegroundColor Gray }

# ── Admin check ───────────────────────────────────────────────────────────────
function Test-Admin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Warn "Not running as Administrator. Some installations may require elevation."
    Write-Info "Right-click 'Install Little Gerry.bat' and choose 'Run as administrator' for a clean install."
    Write-Host ""
}

# ── winget helper ─────────────────────────────────────────────────────────────
function Install-WingetPackage {
    param(
        [string]$Name,
        [string]$Id,
        [string]$TestCmd = "",
        [string]$TestArgs = "--version"
    )

    if ($TestCmd) {
        $exists = Get-Command $TestCmd -ErrorAction SilentlyContinue
        if ($exists) {
            Write-OK "$Name already installed"
            return
        }
    }

    Write-Info "Installing $Name via winget..."
    winget install --id $Id --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189) {
        Write-OK "$Name installed"
    } else {
        Write-Warn "$Name installation returned code $LASTEXITCODE — it may already be installed or require a reboot"
    }
}

# ── PATH refresh helper ───────────────────────────────────────────────────────
function Update-SessionPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH    = "$machinePath;$userPath;$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\.local\bin"
}

# ── Wait for TCP port ─────────────────────────────────────────────────────────
function Wait-TcpPort {
    param(
        [string]$Host = "localhost",
        [int]$Port,
        [string]$ServiceName,
        [int]$TimeoutSeconds = 120
    )
    Write-Info "Waiting for $ServiceName on port $Port..."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $tcp = New-Object System.Net.Sockets.TcpClient
        try {
            $tcp.Connect($Host, $Port)
            $tcp.Close()
            Write-OK "$ServiceName is ready"
            return $true
        } catch {
            Start-Sleep -Seconds 3
        }
    }
    Write-Fail "$ServiceName did not become ready within ${TimeoutSeconds}s"
    return $false
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║     Little Gerry — AI Executive Assistant Installer      ║" -ForegroundColor Magenta
Write-Host "║         Precisian Medical Instruments / VACTOR            ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""
Write-Info "Project root : $ProjectRoot"
Write-Info "Skip Tauri   : $SkipTauriBuild"
Write-Host ""

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 1 of 9 — Installing prerequisites"
# ─────────────────────────────────────────────────────────────────────────────

# Check winget
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Fail "winget not found. Please install 'App Installer' from the Microsoft Store,"
    Write-Fail "then re-run this script."
    exit 1
}

Install-WingetPackage -Name "Docker Desktop"  -Id "Docker.DockerDesktop"  -TestCmd "docker"
Install-WingetPackage -Name "Ollama"           -Id "Ollama.Ollama"         -TestCmd "ollama"
Install-WingetPackage -Name "Python 3.14"      -Id "Python.Python.3.14"    -TestCmd "python"
Install-WingetPackage -Name "Node.js 20 LTS"   -Id "OpenJS.NodeJS.LTS"     -TestCmd "node"

# uv — install via pip if not present
Update-SessionPath
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Info "Installing uv (Python package manager)..."
    & python -m pip install uv --quiet
    Update-SessionPath
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        Write-OK "uv installed"
    } else {
        Write-Warn "uv not found in PATH — trying pip install with --user"
        & python -m pip install uv --user --quiet
        Update-SessionPath
    }
} else {
    Write-OK "uv already installed"
}

if (-not $SkipTauriBuild) {
    Install-WingetPackage -Name "Rust toolchain" -Id "Rustlang.Rustup" -TestCmd "cargo"
    Update-SessionPath
}

Update-SessionPath

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 2 of 9 — Starting Docker Desktop"
# ─────────────────────────────────────────────────────────────────────────────

$dockerRunning = & docker info 2>&1 | Select-String "Server Version" -Quiet
if (-not $dockerRunning) {
    Write-Info "Docker Desktop is not running — starting it..."
    $dockerExe = "${env:ProgramFiles}\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
        Write-Info "Waiting for Docker to initialise (up to 90s)..."
        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 3
            $check = & docker info 2>&1 | Select-String "Server Version" -Quiet
            if ($check) { $ready = $true; break }
        }
        if ($ready) { Write-OK "Docker Desktop is running" }
        else {
            Write-Fail "Docker Desktop did not start in time."
            Write-Fail "Please start Docker Desktop manually, then re-run this script."
            exit 1
        }
    } else {
        Write-Fail "Docker Desktop executable not found. Please install Docker Desktop and re-run."
        exit 1
    }
} else {
    Write-OK "Docker Desktop is already running"
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 3 of 9 — Starting PostgreSQL (Docker Compose)"
# ─────────────────────────────────────────────────────────────────────────────

Set-Location $ProjectRoot
& docker compose up -d 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "docker compose up failed. Check Docker Desktop is running."
    exit 1
}
Write-OK "PostgreSQL container started"

$dbReady = Wait-TcpPort -Port 5432 -ServiceName "PostgreSQL"
if (-not $dbReady) {
    Write-Fail "Cannot reach PostgreSQL on port 5432. Aborting."
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 4 of 9 — Configuring backend environment"
# ─────────────────────────────────────────────────────────────────────────────

$envFile = Join-Path $BackendDir ".env"
if (-not (Test-Path $envFile)) {
    $envExample = Join-Path $BackendDir ".env.example"
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-OK ".env created from .env.example"
    } else {
        # Write a minimal .env
        @"
DATABASE_URL=postgresql+asyncpg://pmi:pmi_dev_password@localhost:5432/pmi_dev
DATABASE_URL_SYNC=postgresql://pmi:pmi_dev_password@localhost:5432/pmi_dev
HOST=127.0.0.1
PORT=8000
DEBUG=false
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_LLM_MODEL=llama3.2
DEFAULT_EMBEDDING_MODEL=nomic-embed-text
CHUNK_SIZE_TOKENS=512
CHUNK_OVERLAP_TOKENS=64
RAG_TOP_K=5
APPROVAL_EXPIRY_HOURS=48
"@ | Set-Content $envFile
        Write-OK ".env created with defaults"
    }
} else {
    Write-OK ".env already exists — skipping"
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 5 of 9 — Installing Python backend dependencies"
# ─────────────────────────────────────────────────────────────────────────────

Set-Location $BackendDir
& uv sync 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "'uv sync' failed. Check that Python 3.12+ is installed."
    exit 1
}
Write-OK "Python dependencies installed"

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 6 of 9 — Running database migrations"
# ─────────────────────────────────────────────────────────────────────────────

& uv run alembic upgrade head 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Alembic migrations failed. Is PostgreSQL accessible?"
    exit 1
}
Write-OK "Database schema is up to date"

# Seed admin user
Write-Info "Seeding admin user (admin@precisian.local / Admin1234!)..."
& uv run python scripts/seed_admin.py 2>&1 | ForEach-Object { Write-Info $_ }
Write-OK "Admin user ready"

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 7 of 9 — Installing frontend dependencies"
# ─────────────────────────────────────────────────────────────────────────────

Set-Location $FrontendDir
& node --version 2>&1 | ForEach-Object { Write-Info "Node $_" }
& npm install 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "npm install failed."
    exit 1
}
Write-OK "Frontend dependencies installed"

# Create frontend .env if missing
$feEnv = Join-Path $FrontendDir ".env"
if (-not (Test-Path $feEnv)) {
    @"
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_BASE=ws://127.0.0.1:8000
"@ | Set-Content $feEnv
    Write-OK "frontend/.env created"
} else {
    Write-OK "frontend/.env already exists — skipping"
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 8 of 9 — Pulling Ollama AI models"
# ─────────────────────────────────────────────────────────────────────────────

# Ensure Ollama service is running
$ollamaRunning = Get-Process "ollama" -ErrorAction SilentlyContinue
if (-not $ollamaRunning) {
    Write-Info "Starting Ollama service..."
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 4
}

$ollamaReady = Wait-TcpPort -Port 11434 -ServiceName "Ollama" -TimeoutSeconds 30
if ($ollamaReady) {
    Write-Info "Pulling llama3.2 (chat model — ~2 GB, this may take a while)..."
    & ollama pull llama3.2
    Write-OK "llama3.2 ready"

    Write-Info "Pulling nomic-embed-text (embedding model — ~274 MB)..."
    & ollama pull nomic-embed-text
    Write-OK "nomic-embed-text ready"
} else {
    Write-Warn "Ollama is not reachable. Models were not pulled."
    Write-Warn "After starting Ollama, run:  ollama pull llama3.2"
    Write-Warn "                             ollama pull nomic-embed-text"
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 9 of 9 — Creating desktop shortcuts"
# ─────────────────────────────────────────────────────────────────────────────

$WshShell = New-Object -ComObject WScript.Shell
$desktop  = [System.Environment]::GetFolderPath("Desktop")

# Start shortcut
$startBat = Join-Path $ProjectRoot "Start Little Gerry.bat"
$shortcut = $WshShell.CreateShortcut("$desktop\Little Gerry.lnk")
$shortcut.TargetPath       = $startBat
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.Description      = "Start Little Gerry AI Assistant"
$shortcut.Save()
Write-OK "Desktop shortcut created: Little Gerry.lnk"

# Start Menu entry
$startMenu = Join-Path ([System.Environment]::GetFolderPath("StartMenu")) "Programs\Little Gerry"
if (-not (Test-Path $startMenu)) { New-Item -ItemType Directory -Path $startMenu | Out-Null }

$sm = $WshShell.CreateShortcut("$startMenu\Little Gerry.lnk")
$sm.TargetPath       = $startBat
$sm.WorkingDirectory = $ProjectRoot
$sm.Description      = "Start Little Gerry AI Assistant"
$sm.Save()
Write-OK "Start Menu entry created"

# ─────────────────────────────────────────────────────────────────────────────
# Optional: Tauri desktop build
# ─────────────────────────────────────────────────────────────────────────────

if (-not $SkipTauriBuild) {
    Write-Step "Optional — Building Tauri desktop app"
    Set-Location $FrontendDir
    Write-Info "This compiles the native Windows .exe — may take 5-15 minutes..."
    & node node_modules\@tauri-apps\cli\tauri.js build 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Tauri desktop app built"
        Write-Info "Installer: frontend\src-tauri\target\release\bundle\"
    } else {
        Write-Warn "Tauri build failed — you can still use the browser at http://localhost:5173"
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║           Installation complete!                         ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  Double-click 'Start Little Gerry.bat' (or the desktop   ║" -ForegroundColor Green
Write-Host "║  shortcut) to launch the application.                    ║" -ForegroundColor Green
Write-Host "║                                                          ║" -ForegroundColor Green
Write-Host "║  Default login:                                          ║" -ForegroundColor Green
Write-Host "║    Email   : admin@precisian.local                       ║" -ForegroundColor Green
Write-Host "║    Password: Admin1234!                                  ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
