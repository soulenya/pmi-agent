<#
.SYNOPSIS
    Migration Day runbook — walks you through the full cutover from local Ollama
    to the dedicated LLM server, step by step, with verification at each stage.

.DESCRIPTION
    Run this on YOUR machine (the Little Gerry machine) on migration day.
    The dedicated server must already be set up (setup-llm-server.ps1 run and rebooted).

.PARAMETER ServerIP
    IP address of the dedicated LLM server (e.g. 192.168.1.50)

.EXAMPLE
    .\migrate-to-server.ps1 -ServerIP 192.168.1.50
#>
param(
    [Parameter(Mandatory=$false)]
    [string]$ServerIP
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"   # don't abort on non-fatal errors

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path (Split-Path -Parent $scriptDir) "backend"
$pass = 0; $fail = 0

function Step($n, $title) {
    Write-Host ""
    Write-Host "[$n] $title" -ForegroundColor Cyan
}
function Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green;  $script:pass++ }
function Warn($msg) { Write-Host "    --  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "    FAIL $msg" -ForegroundColor Red;   $script:fail++ }
function Prompt($msg) { Read-Host "    $msg" }

# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Little Gerry — Migration Day Runbook ===" -ForegroundColor Cyan
Write-Host "Transfers Ollama from this machine to the dedicated LLM server."
Write-Host ""

if (-not $ServerIP) {
    $ServerIP = Prompt "Enter the dedicated server IP address"
}
$ollamaUrl = "http://$($ServerIP):11434"
Write-Host "  Target: $ollamaUrl"

$confirm = Prompt "Ready to begin? Type YES"
if ($confirm -ne "YES") { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }

# ─────────────────────────────────────────────────────────────────────────────
Step "1/7" "Verify dedicated server is reachable"

$tcp = New-Object System.Net.Sockets.TcpClient
try {
    $connect = $tcp.BeginConnect($ServerIP, 11434, $null, $null)
    $ok = $connect.AsyncWaitHandle.WaitOne(4000, $false)
    if ($ok) { $tcp.EndConnect($connect); Ok "TCP port 11434 is open on $ServerIP" }
    else     { Fail "Cannot reach $ServerIP`:11434 — is the server on and Ollama running?" }
    $tcp.Close()
} catch { Fail "TCP check failed: $_" }

if ($fail -gt 0) {
    Write-Host ""
    Write-Host "Step 1 failed. Fix the server before continuing." -ForegroundColor Red
    Write-Host "  - Make sure the server is powered on"
    Write-Host "  - Check that setup-llm-server.ps1 was run and the server was rebooted"
    Write-Host "  - Check firewall: the OllamaServer rule should allow TCP 11434"
    exit 1
}

try {
    $tags = Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -TimeoutSec 8
    Ok "Ollama API responding — $($tags.models.Count) model(s) found"
    $tags.models | ForEach-Object { Warn "  Model: $($_.name)" }
} catch { Fail "Ollama API not responding: $_" }

# ─────────────────────────────────────────────────────────────────────────────
Step "2/7" "Quick chat probe on server"

try {
    $body = @{
        model = "gemma3:27b"
        messages = @(@{ role = "user"; content = "Reply with only the word: ready" })
        stream = $false
        options = @{ num_predict = 3 }
    } | ConvertTo-Json -Depth 5
    $resp = Invoke-RestMethod -Uri "$ollamaUrl/api/chat" -Method POST `
        -ContentType "application/json" -Body $body -TimeoutSec 120
    Ok "Chat probe succeeded: `"$($resp.message.content.Trim())`""
} catch { Fail "Chat probe failed: $_"; Warn "  Run on server: ollama pull gemma3:27b" }

# ─────────────────────────────────────────────────────────────────────────────
Step "3/7" "Stop local Ollama (free memory on this machine)"

$ollamaProc = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollamaProc) {
    Prompt "About to stop local Ollama process. Press Enter to continue"
    $ollamaProc | Stop-Process -Force
    Start-Sleep -Seconds 2
    Ok "Local Ollama process stopped"
} else {
    Warn "Local Ollama was not running"
}

# Disable local Ollama service / scheduled task so it doesn't restart
$svc = Get-Service -Name "ollama" -ErrorAction SilentlyContinue
if ($svc) {
    Set-Service -Name "ollama" -StartupType Disabled -ErrorAction SilentlyContinue
    Stop-Service -Name "ollama" -Force -ErrorAction SilentlyContinue
    Ok "Local Ollama service disabled"
}
$task = Get-ScheduledTask -TaskName "OllamaServer" -ErrorAction SilentlyContinue
if ($task) {
    Disable-ScheduledTask -TaskName "OllamaServer" -ErrorAction SilentlyContinue
    Ok "Local Ollama scheduled task disabled"
}

# ─────────────────────────────────────────────────────────────────────────────
Step "4/7" "Update Little Gerry settings to use the server"

Write-Host "    Calling the Little Gerry API to update llm.ollama_url..."
Write-Host "    (Backend must be running on http://127.0.0.1:8000)"

# Try to update via the API if the backend is running
try {
    # We need a JWT token — check if there's a saved one, otherwise skip and advise manually
    $apiBase = "http://127.0.0.1:8000"
    $health = Invoke-RestMethod -Uri "$apiBase/health" -TimeoutSec 3
    if ($health.status -eq "ok" -or $health.status -eq "degraded") {
        Ok "Backend is running"
        Write-Host ""
        Write-Host "    ACTION REQUIRED:" -ForegroundColor Yellow
        Write-Host "    Open Little Gerry → Settings → Ollama tab"
        Write-Host "    Set 'Ollama Server URL' to: $ollamaUrl" -ForegroundColor Cyan
        Write-Host "    Click Save."
        Write-Host ""
        Prompt "Press Enter once you've saved the URL in Settings"
    }
} catch {
    Warn "Backend not reachable — update manually in Settings after starting the app"
    Warn "Set Ollama Server URL to: $ollamaUrl"
}

# Also update the .env file as a fallback
$envFile = Join-Path $backendDir ".env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
    if ($envContent -match "OLLAMA_BASE_URL=") {
        $envContent = $envContent -replace "OLLAMA_BASE_URL=.*", "OLLAMA_BASE_URL=$ollamaUrl"
        Set-Content -Path $envFile -Value $envContent -NoNewline
        Ok ".env updated: OLLAMA_BASE_URL=$ollamaUrl"
    } else {
        Add-Content -Path $envFile -Value "`nOLLAMA_BASE_URL=$ollamaUrl"
        Ok ".env updated: added OLLAMA_BASE_URL=$ollamaUrl"
    }
} else {
    Warn ".env file not found — OLLAMA_BASE_URL not updated in file"
}

# ─────────────────────────────────────────────────────────────────────────────
Step "5/7" "Verify app is using the remote server"

Write-Host "    Checking connectivity from backend to $ollamaUrl..."
try {
    $apiBase = "http://127.0.0.1:8000"
    $testResp = Invoke-RestMethod -Uri "$apiBase/settings/test-connection" -Method POST `
        -ContentType "application/json" `
        -Body '{"provider":"ollama"}' -TimeoutSec 15
    if ($testResp.ok) { Ok "Backend confirmed: Ollama reachable at $ollamaUrl" }
    else              { Warn "Backend says: $($testResp.message)" }
} catch {
    Warn "Could not test via API (backend may not be running yet): $_"
    Warn "Restart the backend and check Settings → Ollama → Test Connection"
}

# ─────────────────────────────────────────────────────────────────────────────
Step "6/7" "Memory check"

$mem = Get-CimInstance Win32_OperatingSystem
$freeGB  = [math]::Round($mem.FreePhysicalMemory / 1MB, 1)
$totalGB = [math]::Round($mem.TotalVisibleMemorySize / 1MB, 1)
Ok "RAM: $freeGB GB free of $totalGB GB total"

# ─────────────────────────────────────────────────────────────────────────────
Step "7/7" "Optional: clean up local Ollama files"

Write-Host ""
Write-Host "    You can now run cleanup-ollama.ps1 to remove Ollama from this machine." -ForegroundColor Yellow
Write-Host "    This will free ~17+ GB of disk space."
Write-Host ""
$doCleanup = Prompt "Run cleanup now? [y/N]"
if ($doCleanup.ToLower() -eq "y") {
    $cleanupScript = Join-Path $scriptDir "cleanup-ollama.ps1"
    if (Test-Path $cleanupScript) {
        & $cleanupScript
    } else {
        Warn "cleanup-ollama.ps1 not found at $cleanupScript — run it manually"
    }
} else {
    Warn "Skipped. Run scripts\cleanup-ollama.ps1 when you're ready."
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Migration complete! ===" -ForegroundColor Green
Write-Host "  Passed: $pass   Failed: $fail"
Write-Host ""
if ($fail -eq 0) {
    Write-Host "Everything looks good. Little Gerry is now using the remote LLM server." -ForegroundColor Green
} else {
    Write-Host "Some steps failed. Review the output above and fix before relying on the remote server." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Cloud LLMs (Anthropic, OpenAI) are unaffected and continue to work independently."
Write-Host ""
