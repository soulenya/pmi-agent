# Build the PMI Agent Windows desktop app (Tauri + Vite)
# Run from the project root: .\scripts\build-desktop.ps1
#
# Requirements:
#   - Rust/Cargo: https://rustup.rs
#   - Node.js 18+: https://nodejs.org
#   - Run `npm install` in ./frontend first

$ErrorActionPreference = "Stop"

# Ensure cargo and node are in PATH for this session
$env:PATH = "$env:USERPROFILE\.cargo\bin;C:\Program Files\nodejs\;" + $env:PATH

$frontendDir = Join-Path $PSScriptRoot "..\frontend"
Set-Location $frontendDir

Write-Host "=== Building Vite frontend ===" -ForegroundColor Cyan
& node node_modules\vite\bin\vite.js build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

Write-Host "=== Compiling Tauri desktop app ===" -ForegroundColor Cyan
& node node_modules\@tauri-apps\cli\tauri.js build
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }

Write-Host ""
Write-Host "=== Build complete! ===" -ForegroundColor Green
Write-Host "Installer: frontend\src-tauri\target\release\bundle\" -ForegroundColor Green
