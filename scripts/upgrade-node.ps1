<#
.SYNOPSIS
    Little Gerry - bring Node.js up to the supported floor (Windows).

    Run elevated. Called by launcher.py when the installed Node is older than
    the floor (NODE_MIN there), and by scripts/install.ps1. Installs the newest
    Node 24.x winget offers - the same line the hub image builds on - leaving a
    newer major alone.

.PARAMETER MinVersion
    Lowest acceptable version. Below it an upgrade is attempted.
#>
param([string]$MinVersion = "24.22.1")

$ErrorActionPreference = "Continue"

function Get-NodeVersion {
    try { $v = (& node --version 2>$null | Select-Object -First 1) } catch { $v = "" }
    if ($v -match '(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
    return $null
}

$have = Get-NodeVersion
$min = [version]$MinVersion
if ($have -and $have -ge $min) { Write-Host "Node $have is current (floor $min)."; exit 0 }
if ($have -and $have.Major -gt $min.Major) { Write-Host "Node $have is a newer line than $min; leaving it."; exit 0 }

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget is not available; install Node $MinVersion or newer from https://nodejs.org/"; exit 2
}

# Newest 24.x winget knows about. The LTS id has moved past 24, so pin the line.
$line = "$($min.Major)."
$versions = @(& winget show --id OpenJS.NodeJS.LTS --exact --versions --accept-source-agreements 2>$null |
    Where-Object { $_ -match "^\s*$([regex]::Escape($line))\d+\.\d+\s*$" } | ForEach-Object { [version]$_.Trim() } | Sort-Object -Descending)
$target = if ($versions) { $versions[0].ToString() } else { $MinVersion }
if ([version]$target -lt $min) { $target = $MinVersion }

$installed = @(& winget list --id OpenJS.NodeJS.LTS --exact --accept-source-agreements 2>$null | Select-String 'OpenJS.NodeJS')
$installedCurrent = @(& winget list --id OpenJS.NodeJS --exact --accept-source-agreements 2>$null | Select-String 'OpenJS.NodeJS')
$common = @("--exact", "--version", $target, "--silent", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity")
if ($installed) {
    Write-Host "Upgrading Node.js $have -> $target (winget OpenJS.NodeJS.LTS)..."
    & winget upgrade --id OpenJS.NodeJS.LTS @common 2>&1 | Out-Null
} elseif ($installedCurrent) {
    # Installed from the "Current" channel; winget can't cross ids, so replace it.
    Write-Host "Replacing Node.js (Current channel) $have with $target LTS..."
    & winget uninstall --id OpenJS.NodeJS --exact --silent --disable-interactivity 2>&1 | Out-Null
    & winget install --id OpenJS.NodeJS.LTS @common 2>&1 | Out-Null
} else {
    Write-Host "Installing Node.js $target..."
    & winget install --id OpenJS.NodeJS.LTS @common 2>&1 | Out-Null
}
$code = $LASTEXITCODE

# node.exe on PATH may still be the old binary in this process; read the MSI's version.
$exe = Join-Path $env:ProgramFiles "nodejs\node.exe"
$now = if (Test-Path $exe) { (Get-Item $exe).VersionInfo.ProductVersion } else { "" }
if ($now -and [version]($now -replace '[^\d.]', '') -ge $min) { Write-Host "Node $now installed."; exit 0 }
Write-Host "Node upgrade did not complete (winget exit $code; node is '$now'). Install $MinVersion or newer from https://nodejs.org/"
exit 1
