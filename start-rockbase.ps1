# ROCK BASE Local Mode launcher. Localhost-only, no RockBase login.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $root 'backend/.env'
function Step($m) { Write-Host "-> $m" -ForegroundColor Cyan }
function Pass($m) { Write-Host "[PASS] $m" -ForegroundColor Green }
function Hex([int]$bytes) { $b=New-Object byte[] $bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b|%{$_.ToString('x2')}) -join '' }
# Fast loopback probe: Test-NetConnection takes seconds per call and made the
# readiness loop feel hung.
function PortOpen([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch { return $false } finally { $client.Close() }
}

Write-Host "ROCK BASE`nDigital Growth OS" -ForegroundColor White
if (-not (Get-Command node -EA SilentlyContinue)) {
  if (Get-Command winget -EA SilentlyContinue) { Step 'Installing Node LTS'; winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements } else { throw 'Node LTS is required. Install Node LTS, then rerun this launcher.' }
}
if (-not (Get-Command npm -EA SilentlyContinue)) { throw 'Node/npm is not available yet. Restart the terminal after Node installation, then rerun.' }
Pass 'Node runtime'
if (-not (Test-Path $envPath)) {
  Step 'Creating local configuration'
  @"
ROCKBASE_MODE=local
PORT=3010
FRONTEND_URL="http://127.0.0.1:5173"
BACKEND_URL="http://127.0.0.1:3010"
AUTOMATION_ENABLED=false
DATABASE_URL="file:./dev.db"
REDIS_HOST="127.0.0.1"
REDIS_PORT=6379
RUN_WORKERS_SEPARATELY=false
JWT_SECRET="$(Hex 64)"
JWT_EXPIRES_IN="24h"
ENCRYPTION_KEY="$(Hex 32)"
MAX_BULK_SESSION_CHECK=3
SESSION_HEALTH_CHECK_CONCURRENCY=2
"@ | ForEach-Object { [System.IO.File]::WriteAllText($envPath, $_, (New-Object System.Text.UTF8Encoding($false))) }
}
Pass 'Configuration preserved'
# Redis is guaranteed by scripts/ensure-redis.ps1: PATH-independent binary resolver,
# idempotent start, AOF bootstrap from dump.rdb, and a logon task for reboots.
# Resolving the binary with Get-Command right after winget install returned $null
# (stale PATH), so Redis was never started at all.
$redisScript = Join-Path $root 'scripts/ensure-redis.ps1'
if (-not (Test-Path $redisScript)) { throw "Missing Redis supervisor: $redisScript" }
Step 'Ensuring local Redis'
& powershell -NoProfile -ExecutionPolicy Bypass -File $redisScript
if ($LASTEXITCODE -ne 0) { throw 'Redis is unavailable. Local Mode stops safely rather than bypassing queue protections.' }
Pass 'Redis'
if (-not (Test-Path (Join-Path $root 'frontend/node_modules'))) { Step 'Installing frontend dependencies'; Push-Location "$root/frontend"; npm ci; Pop-Location }
# Windows keeps the Prisma engine DLL locked while the backend runs, so regenerating
# the client in that state dies with EPERM (rename ...query_engine-windows.dll.node).
# A second launch must reuse the running instance instead of rebuilding under it.
if (PortOpen 3010) {
  Step 'Backend already running - reusing it (Prisma client left untouched)'
} else {
  if (-not (Test-Path (Join-Path $root 'backend/node_modules'))) { Step 'Installing backend dependencies'; Push-Location "$root/backend"; npm ci; Pop-Location }
  Push-Location "$root/backend"
  if (-not (Test-Path 'node_modules/.prisma/client/query_engine-windows.dll.node')) { npx prisma generate }
  npx prisma migrate deploy
  npx playwright install chromium
  Pop-Location
  Pass 'Browser runtime'
}
if (-not (PortOpen 3010)) { Start-Process powershell -ArgumentList '-NoExit','-Command',"cd '$root/backend'; `$env:ROCKBASE_MODE='local'; `$env:PORT='3010'; `$env:FRONTEND_URL='http://127.0.0.1:5173'; `$env:BACKEND_URL='http://127.0.0.1:3010'; `$env:RUN_WORKERS_SEPARATELY='false'; npm run dev" }
if (-not (PortOpen 5173)) { Start-Process powershell -ArgumentList '-NoExit','-Command',"cd '$root/frontend'; `$env:VITE_ROCKBASE_MODE='local'; npm run dev -- --host 127.0.0.1" }
for ($i=0; $i -lt 30; $i++) { try { if ((Invoke-WebRequest http://127.0.0.1:3010/readyz -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { break } } catch {}; Start-Sleep 2 }
if (-not (PortOpen 3010) -or -not (PortOpen 5173)) { throw 'RockBase did not become ready. Review the local backend/frontend windows.' }
Pass 'Backend'; Pass 'Frontend'; Write-Host "`nRockBase ready. Opening: http://127.0.0.1:5173" -ForegroundColor Green; Start-Process 'http://127.0.0.1:5173'
Write-Host 'Use STOP_ROCKBASE.bat for a graceful backend stop.'
