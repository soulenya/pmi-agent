#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Sets up this Windows 11 PC as the dedicated Little Gerry LLM server.

.DESCRIPTION
    1. Installs Ollama via winget
    2. Sets OLLAMA_HOST=0.0.0.0 as a system environment variable (binds to all interfaces)
    3. Pulls the specified model (default: gemma3:27b)
    4. Creates a Task Scheduler entry to start Ollama at system startup
    5. Opens Windows Firewall for inbound TCP 11434 (scoped to LAN)
    6. (Optional) Installs Docker Desktop + Open WebUI
    7. Displays the server's local IP at the end

    Run from an elevated PowerShell prompt on the DEDICATED SERVER machine.
    Do NOT run this on your Little Gerry machine.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Little Gerry — LLM Server Setup ===" -ForegroundColor Cyan
Write-Host "This script sets up Ollama on THIS machine as a network LLM server."
Write-Host ""

# ── Configuration prompts ─────────────────────────────────────────────────────
$defaultModel = "gemma3:27b"
$modelInput = Read-Host "Which model to pull? [Enter = $defaultModel]"
$modelName = if ($modelInput.Trim()) { $modelInput.Trim() } else { $defaultModel }

$installWebUI = Read-Host "Install Open WebUI (requires Docker Desktop)? [y/N]"
$installWebUI = $installWebUI.Trim().ToLower() -eq "y"

$confirm = Read-Host "`nType YES to begin installation"
if ($confirm -ne "YES") { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }

# ── Step 1: Install Ollama ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[1/7] Installing Ollama..." -ForegroundColor Cyan

$ollamaInstalled = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaInstalled) {
    Write-Host "  Ollama already installed: $(ollama --version 2>&1)" -ForegroundColor Green
} else {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  Installing via winget..."
        winget install --id Ollama.Ollama --silent --accept-source-agreements --accept-package-agreements
        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("PATH", "User")
        Write-Host "  Installed." -ForegroundColor Green
    } else {
        Write-Host "  winget not found. Downloading installer directly..." -ForegroundColor Yellow
        $installerUrl = "https://ollama.com/download/OllamaSetup.exe"
        $installerPath = "$env:TEMP\OllamaSetup.exe"
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath
        Start-Process -FilePath $installerPath -ArgumentList "/SILENT" -Wait
        Write-Host "  Installed." -ForegroundColor Green
    }
}

# ── Step 2: Set OLLAMA_HOST system environment variable ───────────────────────
Write-Host "[2/7] Setting OLLAMA_HOST=0.0.0.0..." -ForegroundColor Cyan
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0", "Machine")
$env:OLLAMA_HOST = "0.0.0.0"
Write-Host "  Done. Ollama will bind to all network interfaces on port 11434." -ForegroundColor Green

# ── Step 3: Pull the model ────────────────────────────────────────────────────
Write-Host "[3/7] Pulling model: $modelName (this may take a while)..." -ForegroundColor Cyan

# Start Ollama serve in background so we can pull
$ollamaPath = (Get-Command ollama -ErrorAction SilentlyContinue)?.Source
if (-not $ollamaPath) {
    # Common install locations
    foreach ($p in @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe", "$env:ProgramFiles\Ollama\ollama.exe")) {
        if (Test-Path $p) { $ollamaPath = $p; break }
    }
}
if (-not $ollamaPath) {
    Write-Host "  Cannot find ollama.exe. Please pull the model manually: ollama pull $modelName" -ForegroundColor Yellow
} else {
    # Start serve temporarily for pull
    $serveJob = Start-Process -FilePath $ollamaPath -ArgumentList "serve" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 3
    
    Write-Host "  Pulling $modelName ..."
    & $ollamaPath pull $modelName
    
    Write-Host "  Pull complete." -ForegroundColor Green
    # Don't stop the serve process — let the Task Scheduler entry own it
}

# ── Step 4: Create Task Scheduler entry (start on boot) ──────────────────────
Write-Host "[4/7] Creating Task Scheduler entry 'OllamaServer'..." -ForegroundColor Cyan

$taskName = "OllamaServer"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "  Removed existing task." -ForegroundColor Gray
}

if (-not $ollamaPath) {
    Write-Host "  Cannot find ollama.exe — skipping task creation. Create it manually." -ForegroundColor Yellow
} else {
    $action  = New-ScheduledTaskAction -Execute $ollamaPath -Argument "serve"
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description "Starts Ollama LLM server at boot"

    Write-Host "  Task 'OllamaServer' created — runs as SYSTEM at startup." -ForegroundColor Green
}

# ── Step 5: Windows Firewall rule ─────────────────────────────────────────────
Write-Host "[5/7] Configuring Windows Firewall..." -ForegroundColor Cyan

# Detect the LAN subnet from the primary adapter
$lanSubnet = $null
try {
    $adapter = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notmatch "^127\." -and $_.IPAddress -notmatch "^169\." } |
        Select-Object -First 1
    if ($adapter) {
        # Build /24 subnet from the IP
        $parts = $adapter.IPAddress -split "\."
        $lanSubnet = "$($parts[0]).$($parts[1]).$($parts[2]).0/24"
        Write-Host "  Detected LAN subnet: $lanSubnet"
    }
} catch {}

# Remove existing rule if present
Remove-NetFirewallRule -DisplayName "Ollama LLM Server" -ErrorAction SilentlyContinue

if ($lanSubnet) {
    New-NetFirewallRule -DisplayName "Ollama LLM Server" `
        -Direction Inbound -Protocol TCP -LocalPort 11434 `
        -RemoteAddress $lanSubnet -Action Allow -Profile Any | Out-Null
    Write-Host "  Firewall rule created: allow TCP 11434 from $lanSubnet" -ForegroundColor Green
} else {
    # Fall back to any — user can tighten this manually
    New-NetFirewallRule -DisplayName "Ollama LLM Server" `
        -Direction Inbound -Protocol TCP -LocalPort 11434 `
        -Action Allow -Profile Private | Out-Null
    Write-Host "  Firewall rule created: allow TCP 11434 on Private network." -ForegroundColor Green
    Write-Host "  (Could not auto-detect LAN subnet — rule allows all Private network traffic)" -ForegroundColor Yellow
}

# ── Step 6: Optional Docker + Open WebUI ──────────────────────────────────────
if ($installWebUI) {
    Write-Host "[6/7] Installing Docker Desktop..." -ForegroundColor Cyan
    $dockerInstalled = Get-Command docker -ErrorAction SilentlyContinue
    if ($dockerInstalled) {
        Write-Host "  Docker already installed." -ForegroundColor Green
    } else {
        winget install --id Docker.DockerDesktop --silent --accept-source-agreements --accept-package-agreements
        Write-Host "  Docker Desktop installed. You may need to reboot and re-run Open WebUI setup." -ForegroundColor Yellow
    }

    Write-Host "  Setting up Open WebUI via docker-compose..."
    $webUIDir = "$env:USERPROFILE\open-webui"
    New-Item -ItemType Directory -Path $webUIDir -Force | Out-Null
    
    $composeContent = @"
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    restart: unless-stopped
    ports:
      - "3000:8080"
    environment:
      - OLLAMA_BASE_URL=http://host-gateway:11434
    extra_hosts:
      - "host-gateway:host-gateway"
    volumes:
      - open-webui:/app/backend/data
volumes:
  open-webui:
"@
    Set-Content -Path "$webUIDir\docker-compose.yml" -Value $composeContent
    Write-Host "  Open WebUI compose file written to: $webUIDir\docker-compose.yml" -ForegroundColor Green
    Write-Host "  After Docker Desktop starts, run: docker compose -f $webUIDir\docker-compose.yml up -d"
} else {
    Write-Host "[6/7] Skipping Open WebUI (not requested)." -ForegroundColor Gray
}

# ── Step 7: Show server IP ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[7/7] Server network information:" -ForegroundColor Cyan
$ipAddresses = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch "^127\." -and $_.IPAddress -notmatch "^169\." }

Write-Host ""
Write-Host "  LAN IP address(es) for this server:" -ForegroundColor Yellow
foreach ($ip in $ipAddresses) {
    Write-Host "    $($ip.IPAddress)  (adapter: $($ip.InterfaceAlias))" -ForegroundColor White
}

$primaryIP = ($ipAddresses | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "=== Setup complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT — next steps:" -ForegroundColor Yellow
Write-Host "  1. Reboot this server (so the Task Scheduler entry takes effect)"
Write-Host "  2. On your Little Gerry machine, run: scripts\test-llm-server.ps1 $primaryIP"
Write-Host "  3. In Little Gerry Settings → Ollama → Server URL, set:"
Write-Host "     http://$($primaryIP):11434" -ForegroundColor Cyan
Write-Host ""
Write-Host "  TIP: Assign a static IP or DHCP reservation for this server in your router"
Write-Host "  so the address never changes."
Write-Host ""
