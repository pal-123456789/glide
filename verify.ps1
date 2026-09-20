# verify.ps1 — the one command that proves Glide is shippable (Windows).
#
# Regenerates the browser bundles from src/, syntax-checks every module, and runs
# the full test suite. Run from the project folder:
#
#     powershell -ExecutionPolicy Bypass -File .\verify.ps1
#
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Fail($msg) { Write-Host "  $msg" -ForegroundColor Red; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js was not found on PATH. Install Node 18+ and retry."
}

Write-Host "==> 1/3  Building bundles (node build.js)" -ForegroundColor Cyan
node build.js
if ($LASTEXITCODE -ne 0) { Fail "build.js failed." }

Write-Host "==> 2/3  Syntax-checking every source module (node --check)" -ForegroundColor Cyan
$files = @(Get-ChildItem -Path "src" -Filter *.js | ForEach-Object { $_.FullName })
$files += @("sw.js", "build.js", "serve.js" | Where-Object { Test-Path $_ })
foreach ($f in $files) {
  node --check "$f"
  if ($LASTEXITCODE -ne 0) { Fail "Syntax error in $f" }
  Write-Host "    ok  $f" -ForegroundColor DarkGray
}

Write-Host "==> 3/3  Running the test suite (node --test)" -ForegroundColor Cyan
node --test
if ($LASTEXITCODE -ne 0) { Fail "Tests failed." }

Write-Host ""
Write-Host "  All green. Bundles rebuilt, sources check, tests pass." -ForegroundColor Green
Write-Host "  Serve it with:  powershell -ExecutionPolicy Bypass -File .\serve.ps1"
