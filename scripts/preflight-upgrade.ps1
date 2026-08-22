# ROCK BASE existing-installation upgrade preflight.
# Inspection only: never starts/stops containers, edits .env, migrates, or deletes data.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvPath = Join-Path $ProjectRoot 'backend/.env'
$failed = $false

function Report([bool]$Pass, [string]$Label, [string]$Detail = '') {
  $prefix = if ($Pass) { '[PASS]' } else { '[FAIL]' }
  $color = if ($Pass) { 'Green' } else { 'Red' }
  Write-Host "$prefix $Label" -ForegroundColor $color
  if ($Detail) { Write-Host "       $Detail" -ForegroundColor DarkGray }
  if (-not $Pass) { $script:failed = $true }
}
function Read-EnvValue([string]$Name) {
  if (-not (Test-Path $EnvPath)) { return $null }
  $match = Select-String -Path $EnvPath -Pattern "^$([regex]::Escape($Name))\s*=\s*(.*)$" | Select-Object -First 1
  if (-not $match) { return $null }
  return $match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}

Write-Host 'ROCK BASE UPGRADE PREFLIGHT' -ForegroundColor Cyan
Write-Host ''

$dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
Report $dockerAvailable 'Docker command'
if ($dockerAvailable) {
  try { & docker version --format '{{.Server.Version}}' | Out-Null; Report $true 'Docker daemon' } catch { Report $false 'Docker daemon' 'Start Docker Desktop before upgrading.' }
  try { & docker compose version | Out-Null; Report $true 'Docker Compose' } catch { Report $false 'Docker Compose' }
}

$envExists = Test-Path $EnvPath
Report $envExists 'backend/.env'
$key = Read-EnvValue 'ENCRYPTION_KEY'
Report ($null -ne $key) 'ENCRYPTION_KEY present' 'This key is required with the database to recover encrypted sessions.'
Report ($null -ne $key -and $key -match '^[a-fA-F0-9]{64}$') 'ENCRYPTION_KEY format' 'Expected exactly 64 hexadecimal characters.'

$composePath = Join-Path $ProjectRoot 'docker-compose.yml'
$composeText = if (Test-Path $composePath) { Get-Content $composePath -Raw } else { '' }
foreach ($volume in @('backend-db', 'backend-uploads', 'backend-backups', 'backend-logs', 'redis-data')) {
  Report ($composeText -match "(?m)^\s*$([regex]::Escape($volume)):\s*$") "Compose volume: $volume"
}

if ($dockerAvailable) {
  foreach ($service in @('redis', 'backend', 'frontend')) {
    try {
      $state = & docker compose -f $composePath ps --status running --services 2>$null
      Report ($state -contains $service) "Container running: $service" 'Informational only; preflight does not start or stop containers.'
    } catch { Report $false "Container status: $service" 'Could not inspect Docker Compose status.' }
  }
}

Write-Host ''
if ($failed) {
  Write-Host 'Upgrade safety: NOT READY — fix failed checks before creating a backup or rebuilding.' -ForegroundColor Red
  exit 1
}
Write-Host 'Upgrade safety: READY FOR BACKUP / UPGRADE' -ForegroundColor Green
Write-Host 'Next: create a verified database backup, preserve backend/.env and uploads backup, then follow docs/UPGRADE.md.'
exit 0
