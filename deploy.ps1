# deploy.ps1 — build, test, commit and push Glide so GitHub Pages can serve it.
#
# All actions are safe / non-destructive: it never force-pushes, resets, or
# rewrites history, and does not change your global git config.
#
# Usage:
#     powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#     powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Message "my message"
#     powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -NoPush
#
# Author identity: uses your existing git config. If none is set, it commits as
# "Pal Ghevariya" for this one commit only.

param(
  [string]$Message = "Deploy Glide: hands-free webcam control (assistive tech)",
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Fail($m) { Write-Host "  $m" -ForegroundColor Red; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js not found on PATH." }
if (-not (Get-Command git  -ErrorAction SilentlyContinue)) { Fail "git not found on PATH." }

Write-Host "==> Verifying (build + tests) before deploy" -ForegroundColor Cyan
node build.js; if ($LASTEXITCODE -ne 0) { Fail "build.js failed." }
node --test;   if ($LASTEXITCODE -ne 0) { Fail "Tests failed — not deploying." }

if (-not (Test-Path ".git")) {
  Write-Host "==> Initializing git repo" -ForegroundColor Cyan
  git init -q
  git branch -M main
}

# Resolve a commit author without persisting config.
$authorArgs = @()
$hasName = $false
try { $null = git config user.name; if ($LASTEXITCODE -eq 0) { $hasName = $true } } catch {}
if (-not $hasName) {
  $name  = if ($env:GIT_AUTHOR_NAME)  { $env:GIT_AUTHOR_NAME }  else { "Pal Ghevariya" }
  $email = if ($env:GIT_AUTHOR_EMAIL) { $env:GIT_AUTHOR_EMAIL } else { "pal.ghevariya@users.noreply.github.com" }
  Write-Host "==> No git identity configured; committing as `"$name`" <$email>" -ForegroundColor Yellow
  $authorArgs = @("--author=$name <$email>")
  $env:GIT_COMMITTER_NAME  = $name
  $env:GIT_COMMITTER_EMAIL = $email
}

Write-Host "==> Staging + committing" -ForegroundColor Cyan
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "    Nothing to commit — working tree matches the last commit."
} else {
  git commit -q @authorArgs -m $Message
  Write-Host "    Committed: $Message"
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()

if ($NoPush) { Write-Host "==> -NoPush set; done. Current branch: $branch"; exit 0 }

git remote get-url origin *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "==> Pushing '$branch' to origin" -ForegroundColor Cyan
  git push -u origin $branch
  Write-Host ""
  Write-Host "Pushed. One-time step on GitHub:" -ForegroundColor Green
  Write-Host "  Settings -> Pages -> Build and deployment -> Source: `"GitHub Actions`""
} else {
  Write-Host ""
  Write-Host "No 'origin' remote set yet. Create an empty GitHub repo, then:" -ForegroundColor Yellow
  Write-Host "    git remote add origin https://github.com/<you>/<repo>.git"
  Write-Host "    git push -u origin main"
  Write-Host "Then: Settings -> Pages -> Source: `"GitHub Actions`""
}
