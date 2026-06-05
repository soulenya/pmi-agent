<#
.SYNOPSIS
    Tests connectivity from THIS machine to the dedicated Ollama LLM server.

.PARAMETER ServerIP
    IP address of the LLM server (e.g. 192.168.1.50)

.PARAMETER Port
    Ollama port (default: 11434)

.EXAMPLE
    .\test-llm-server.ps1 192.168.1.50
    .\test-llm-server.ps1 192.168.1.50 -Port 11434
#>
param(
    [Parameter(Mandatory=$false)]
    [string]$ServerIP,
    [int]$Port = 11434
)

if (-not $ServerIP) {
    $ServerIP = Read-Host "Enter the LLM server IP address"
}

$baseUrl = "http://$($ServerIP):$Port"
Write-Host ""
Write-Host "=== Ollama LLM Server Connectivity Test ===" -ForegroundColor Cyan
Write-Host "Target: $baseUrl"
Write-Host ""

$allPassed = $true

# ── Test 1: TCP port reachable ────────────────────────────────────────────────
Write-Host "[Test 1] TCP port $Port..." -NoNewline
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $connect = $tcp.BeginConnect($ServerIP, $Port, $null, $null)
    $wait = $connect.AsyncWaitHandle.WaitOne(3000, $false)
    if ($wait -and -not $tcp.Client.Connected -eq $false) {
        $tcp.EndConnect($connect)
        Write-Host " OPEN" -ForegroundColor Green
    } else {
        Write-Host " TIMEOUT / REFUSED" -ForegroundColor Red
        Write-Host "  ⇒ Check that Ollama is running on the server and the firewall rule allows port $Port" -ForegroundColor Yellow
        $allPassed = $false
    }
    $tcp.Close()
} catch {
    Write-Host " FAILED: $_" -ForegroundColor Red
    $allPassed = $false
}

# ── Test 2: Ollama /api/tags ──────────────────────────────────────────────────
Write-Host "[Test 2] Ollama API (/api/tags)..." -NoNewline
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/tags" -Method GET -TimeoutSec 10
    $modelCount = $response.models.Count
    Write-Host " OK — $modelCount model(s) found" -ForegroundColor Green
    if ($modelCount -gt 0) {
        Write-Host "  Installed models:" -ForegroundColor Gray
        foreach ($m in $response.models) {
            Write-Host "    - $($m.name)  ($([math]::Round($m.size/1GB, 1)) GB)" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host " FAILED: $_" -ForegroundColor Red
    Write-Host "  ⇒ Ollama may not be running. SSH into server and run: ollama serve" -ForegroundColor Yellow
    $allPassed = $false
}

# ── Test 3: Quick chat completion ─────────────────────────────────────────────
Write-Host "[Test 3] Chat completion (1-token probe)..." -NoNewline
try {
    $body = @{
        model = "gemma3:27b"
        messages = @(@{ role = "user"; content = "Say only the word: ready" })
        stream = $false
        options = @{ num_predict = 3 }
    } | ConvertTo-Json -Depth 5

    $resp = Invoke-RestMethod -Uri "$baseUrl/api/chat" -Method POST `
        -ContentType "application/json" -Body $body -TimeoutSec 120
    $reply = $resp.message.content.Trim()
    Write-Host " OK — model replied: `"$reply`"" -ForegroundColor Green
} catch {
    Write-Host " FAILED: $_" -ForegroundColor Red
    Write-Host "  ⇒ Model may not be pulled yet. Run on server: ollama pull gemma3:27b" -ForegroundColor Yellow
    $allPassed = $false
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
if ($allPassed) {
    Write-Host "All tests passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Set this URL in Little Gerry Settings → Ollama → Server URL:" -ForegroundColor Yellow
    Write-Host "  $baseUrl" -ForegroundColor Cyan
} else {
    Write-Host "Some tests failed. See notes above." -ForegroundColor Red
}
Write-Host ""
