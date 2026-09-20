# serve.ps1 — start a local web server for Glide (Windows PowerShell).
#
# Glide uses ES modules, which browsers block over file:// . This serves the
# folder over http:// so every button works. Run from this folder:
#
#     powershell -ExecutionPolicy Bypass -File .\serve.ps1
#
# Then open http://localhost:8080/ in Chrome or Edge.

param([int]$Port = 8080)

$ErrorActionPreference = "SilentlyContinue"
Set-Location -Path $PSScriptRoot

function Test-Cmd($name) { $null = Get-Command $name; return $?; }

Write-Host ""
Write-Host "  Starting Glide on http://localhost:$Port/ ..." -ForegroundColor Cyan
Write-Host "  Landing page: http://localhost:$Port/"
Write-Host "  The app:      http://localhost:$Port/app.html"
Write-Host "  (Ctrl+C to stop)" -ForegroundColor DarkGray
Write-Host ""

if (Test-Cmd "py")      { py -3 -m http.server $Port; return }
if (Test-Cmd "python")  { python -m http.server $Port; return }
if (Test-Cmd "python3") { python3 -m http.server $Port; return }
if (Test-Cmd "node")    { node serve.js $Port; return }

Write-Host "  Could not find Python or Node on this machine." -ForegroundColor Red
Write-Host "  Install either one, or open the folder with any static web server." -ForegroundColor Red
