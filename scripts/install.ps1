#Requires -Version 5.1
<#
.SYNOPSIS
    Little Gerry - Full automated setup for Windows.

.DESCRIPTION
    Installs and configures all dependencies for the Little Gerry AI Executive
    Assistant (Precisian Medical Instruments / VACTOR program).

    Prerequisites installed automatically via winget:
      - Docker Desktop (runs PostgreSQL database)
      - Python 3.14+
      - Node.js 20 LTS
      - uv (Python package manager)
      - Microsoft Visual C++ Redistributable (x64) - required by native
        Python extensions such as greenlet; missing on fresh Windows installs

    Each prerequisite is detected first and only installed if absent.

    Note: Ollama (local LLM) is NOT installed here.
    It runs on a separate dedicated server. Configure the server URL
    in Little Gerry Settings → Ollama after first launch.

    Run from the project root:
        .\scripts\install.ps1

.PARAMETER ProjectRoot
    Path to the project root. Defaults to the parent of this script's directory.
#>
param(
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
        Write-Warn "$Name installation returned code $LASTEXITCODE - it may already be installed or require a reboot"
    }
}

# ── Visual C++ Redistributable detection ──────────────────────────────────────
# The x64 VC++ 2015-2022 runtime registers under this key (Installed = 1). It
# provides vcruntime140.dll / msvcp140.dll, which native Python extensions like
# greenlet (_greenlet.pyd) link against. A clean Windows install lacks it, which
# makes SQLAlchemy's async engine fail at migration time with
# "DLL load failed while importing _greenlet".
function Test-VCRedist {
    foreach ($key in @(
        "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
    )) {
        try {
            $entry = Get-ItemProperty -Path $key -ErrorAction Stop
            if ($entry.Installed -eq 1) { return $true }
        } catch {
            # Key absent - keep checking the other location.
        }
    }
    return $false
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
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  Little Gerry - AI Executive Assistant Installer" -ForegroundColor Magenta
Write-Host "  Precisian Medical Instruments / VACTOR" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""
Write-Info "Project root : $ProjectRoot"
Write-Host ""

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 1 of 7 - Installing prerequisites"
# ─────────────────────────────────────────────────────────────────────────────

# Check winget
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Fail "winget not found. Please install 'App Installer' from the Microsoft Store,"
    Write-Fail "then re-run this script."
    exit 1
}

# WSL 2 kernel - required by Docker Desktop. Install/update it WITHOUT a Linux
# distribution (Docker ships its own internal distros; bare `wsl --install`
# would pull in Ubuntu and prompt for a Unix account, which we don't want).
if (Get-Command wsl -ErrorAction SilentlyContinue) {
    $wslOk = $false
    try {
        wsl --status *> $null
        if ($LASTEXITCODE -eq 0) { $wslOk = $true }
    } catch { }
    if ($wslOk) {
        Write-OK "WSL 2 already set up"
        wsl --update *> $null  # keep the kernel current; harmless if already latest
    } else {
        Write-Info "Setting up WSL 2 (no Linux distribution - Docker brings its own)..."
        wsl --install --no-distribution *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-OK "WSL 2 installed - a reboot may be required before Docker Desktop can start"
        } else {
            Write-Warn "WSL 2 setup returned code $LASTEXITCODE - Docker Desktop will prompt if it needs it"
        }
    }
} else {
    Write-Warn "wsl.exe not found - Docker Desktop will guide WSL setup on first start if needed"
}

Install-WingetPackage -Name "Docker Desktop"  -Id "Docker.DockerDesktop"  -TestCmd "docker"
Install-WingetPackage -Name "Python 3.14"      -Id "Python.Python.3.14"    -TestCmd "python"
Install-WingetPackage -Name "Node.js 20 LTS"   -Id "OpenJS.NodeJS.LTS"     -TestCmd "node"

# Microsoft Visual C++ Redistributable (x64) - detected via registry, not a
# command, so it needs its own check. Required by greenlet/SQLAlchemy at runtime.
if (Test-VCRedist) {
    Write-OK "Visual C++ Redistributable (x64) already installed"
} else {
    Write-Info "Installing Microsoft Visual C++ Redistributable (x64) via winget..."
    winget install --id "Microsoft.VCRedist.2015+.x64" --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
    if (Test-VCRedist) {
        Write-OK "Visual C++ Redistributable (x64) installed"
    } else {
        Write-Warn "Visual C++ Redistributable install returned code $LASTEXITCODE - a reboot may be required to finish"
    }
}

# uv - install via pip if not present
Update-SessionPath
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Info "Installing uv (Python package manager)..."
    & python -m pip install uv --quiet
    Update-SessionPath
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        Write-OK "uv installed"
    } else {
        Write-Warn "uv not found in PATH - trying pip install with --user"
        & python -m pip install uv --user --quiet
        Update-SessionPath
    }
    # Final fallback: astral's standalone installer (installs to ~\.local\bin,
    # no working pip required). First launch also self-heals a missing uv.
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Write-Warn "pip could not provide uv - using the standalone installer"
        try {
            Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
        } catch {
            Write-Warn "Standalone uv installer failed: $_"
        }
        $env:Path = "$env:Path;$env:USERPROFILE\.local\bin"
        if (Get-Command uv -ErrorAction SilentlyContinue) {
            Write-OK "uv installed (standalone)"
        } else {
            Write-Warn "uv is still missing - the first launch will retry installing it automatically"
        }
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
Write-Step "Step 2 of 9 - Starting Docker Desktop"
# ─────────────────────────────────────────────────────────────────────────────

$dockerRunning = & docker info 2>&1 | Select-String "Server Version" -Quiet
if (-not $dockerRunning) {
    Write-Info "Docker Desktop is not running - starting it..."
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
Write-Step "Step 3 of 7 - Starting PostgreSQL (Docker Compose)"
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
Write-Step "Step 4 of 7 - Configuring backend environment"
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
OLLAMA_BASE_URL=
DEFAULT_EMBEDDING_MODEL=nomic-embed-text
CHUNK_SIZE_TOKENS=512
CHUNK_OVERLAP_TOKENS=64
RAG_TOP_K=5
APPROVAL_EXPIRY_HOURS=48
"@ | Set-Content $envFile
        Write-OK ".env created with defaults"
    }
} else {
    Write-OK ".env already exists - skipping"
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 5 of 7 - Installing Python backend dependencies"
# ─────────────────────────────────────────────────────────────────────────────

Set-Location $BackendDir
& uv sync 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "'uv sync' failed. Check that Python 3.12+ is installed."
    exit 1
}
Write-OK "Python dependencies installed"

# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 6 of 7 - Running database migrations"
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
Write-Step "Step 7 of 7 - Installing frontend dependencies"
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
    Write-OK "frontend/.env already exists - skipping"
}

# Creating desktop shortcuts is the next step — skip Ollama model pull and Tauri build
# ─────────────────────────────────────────────────────────────────────────────
Write-Step "Step 8 (Final) - Creating desktop shortcuts"
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
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "------------------------------------------------" -ForegroundColor Green
Write-Host "  Double-click 'Start Little Gerry.bat'" -ForegroundColor Green
Write-Host "  (or the desktop shortcut) to launch the app." -ForegroundColor Green
Write-Host ""
Write-Host "  IMPORTANT: Ollama runs on a separate server." -ForegroundColor Yellow
Write-Host "  After first launch, go to Settings → Ollama" -ForegroundColor Yellow
Write-Host "  and set the server URL." -ForegroundColor Yellow
Write-Host "  Until then, use Anthropic or OpenAI instead." -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
