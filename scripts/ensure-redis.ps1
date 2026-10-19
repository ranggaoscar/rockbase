<#
.SYNOPSIS
  Ensure a local Redis instance is installed, running and persistent for ROCK BASE Windows Local Mode.

.DESCRIPTION
  Single source of truth for Redis readiness. Solves three failure modes that used to make
  Local Mode stop at "Redis is unavailable":

    1. Stale PATH  - a process started before `winget install` cannot see the new PATH entry.
                     This script resolves redis-server.exe from disk and from the registry,
                     never from the inherited process environment alone.
    2. Dead start  - the previous launcher resolved the binary with Get-Command right after
                     installing, got $null, and silently skipped starting Redis.
    3. No boot     - nothing re-started Redis after a reboot, so every launch repeated the work.

  Safety: never deletes Redis data. It only generates a config file next to the RDB/AOF data
  in rockbase-data/redis, starts the server when the port is closed, and waits for a real PING.

.PARAMETER CheckOnly
  Inspect only. Never installs, never starts, never registers a scheduled task.
  Exit 0 = ready, 1 = not ready. Used by CHECK_ROCK_BASE.bat.

.PARAMETER NoPersist
  Do not create/refresh the logon scheduled task that keeps Redis alive across reboots.

.PARAMETER Quiet
  Minimal output. Used by the scheduled task.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ensure-redis.ps1
#>
[CmdletBinding()]
param(
  [string]$RedisBinHome = '',
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 6379,
  [string]$DataDir = '',
  [int]$ReadyTimeoutSec = 30,
  [switch]$CheckOnly,
  [switch]$NoPersist,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 1.0

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $DataDir) { $DataDir = Join-Path $ProjectRoot 'rockbase-data/redis' }
$ConfName    = 'redis.rockbase.conf'
$ConfPath    = Join-Path $DataDir $ConfName
$LogPath     = Join-Path $DataDir 'redis-6379.log'
$PidPath     = Join-Path $DataDir 'redis-6379.pid'
$TaskName    = 'RockBaseRedis'
$MarkerPath  = Join-Path $DataDir '.install-attempted'

function Say([string]$Message, [string]$Level = 'info') {
  if ($Quiet -and $Level -eq 'info') { return }
  switch ($Level) {
    'pass' { Write-Host "[PASS] $Message" -ForegroundColor Green }
    'fix'  { Write-Host "[FIX]  $Message" -ForegroundColor Cyan }
    'warn' { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
    'fail' { Write-Host "[FAIL] $Message" -ForegroundColor Red }
    default { Write-Host "-> $Message" -ForegroundColor DarkGray }
  }
}

# ── PATH resolution ────────────────────────────────────────────────────────────
# Read PATH straight from the registry so a process with a stale environment still
# finds binaries installed a moment ago by winget/choco.
function Get-RegistryPathEntries {
  $entries = @()
  foreach ($scope in @(
      'HKCU:\Environment',
      'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
    )) {
    try {
      $raw = (Get-ItemProperty -Path $scope -Name 'Path' -ErrorAction Stop).Path
      if ($raw) {
        $entries += ([Environment]::ExpandEnvironmentVariables($raw) -split ';')
      }
    } catch { }
  }
  return $entries | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } | Select-Object -Unique
}

function Find-RedisBinary {
  param([string]$Hint)

  $candidates = New-Object System.Collections.Generic.List[string]

  if ($Hint) { $candidates.Add((Join-Path $Hint 'redis-server.exe')) }
  if ($env:REDIS_HOME) { $candidates.Add((Join-Path $env:REDIS_HOME 'redis-server.exe')) }

  # 1. Fresh process PATH (works in newly opened shells)
  $onPath = Get-Command 'redis-server.exe' -ErrorAction SilentlyContinue
  if ($onPath) { $candidates.Add($onPath.Source) }

  # 2. WinGet shim directory (empty on this machine - kept for other installs)
  $candidates.Add((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\redis-server.exe'))

  # 3. WinGet package tree - this is where the fork actually lands
  $pkgRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path -LiteralPath $pkgRoot) {
    Get-ChildItem -LiteralPath $pkgRoot -Directory -Filter '*redis*' -ErrorAction SilentlyContinue |
      ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Recurse -Depth 3 -Filter 'redis-server.exe' -File -ErrorAction SilentlyContinue
      } |
      ForEach-Object { $candidates.Add($_.FullName) }
  }

  # 4. Registry PATH entries mentioning redis (authoritative after install)
  foreach ($entry in Get-RegistryPathEntries) {
    if ($entry -match 'redis') { $candidates.Add((Join-Path $entry 'redis-server.exe')) }
  }

  # 5. Conventional locations (choco / manual / service installs)
  foreach ($dir in @(
      'C:\Program Files\Redis',
      'C:\Program Files\redis',
      'C:\Redis',
      (Join-Path $env:ProgramData 'chocolatey\lib\redis\tools'),
      (Join-Path $env:ProgramData 'chocolatey\bin')
    )) {
    $candidates.Add((Join-Path $dir 'redis-server.exe'))
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

# ── Health probes ─────────────────────────────────────────────────────────────
# TCP connect with a hard timeout. Test-NetConnection is seconds-slow and unreliable
# for a fast readiness loop.
function Test-PortOpen {
  param([string]$TargetHost, [int]$TargetPort, [int]$TimeoutMs = 400)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($TargetHost, $TargetPort, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch { return $false } finally { $client.Close() }
}

# Real Redis protocol PING - proves the process is Redis, not merely a bound port.
function Test-RedisPong {
  param([string]$TargetHost, [int]$TargetPort, [int]$TimeoutMs = 1200)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($TargetHost, $TargetPort, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
    $client.EndConnect($iar)
    $stream = $client.GetStream()
    $stream.ReadTimeout = $TimeoutMs
    $stream.WriteTimeout = $TimeoutMs
    $payload = [Text.Encoding]::ASCII.GetBytes("*1`r`n`$4`r`nPING`r`n")
    $stream.Write($payload, 0, $payload.Length)
    $buffer = New-Object byte[] 128
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { return $false }
    return ([Text.Encoding]::ASCII.GetString($buffer, 0, $read)).StartsWith('+PONG')
  } catch { return $false } finally { $client.Close() }
}

# ── Config ────────────────────────────────────────────────────────────────────
# Generated every run so paths always match this clone. Data files are never touched.
function Write-RedisConfig {
  param([string]$Dir, [ValidateSet('yes', 'no')][string]$AppendOnly = 'yes')

  $dataDirForward = ($Dir -replace '\\', '/')
  $logForward     = ($LogPath -replace '\\', '/')
  $pidForward     = ($PidPath -replace '\\', '/')

  $lines = @(
    '# Generated by scripts/ensure-redis.ps1 - do not edit by hand.',
    '# Local Mode: loopback only, no network exposure.',
    "bind $BindHost",
    "port $Port",
    'protected-mode yes',
    'daemonize no',
    "dir `"$dataDirForward`"",
    'dbfilename dump.rdb',
    "logfile `"$logForward`"",
    "pidfile `"$pidForward`"",
    'databases 16',
    'maxmemory-policy noeviction',
    '',
    '# Durability for BullMQ queues: delayed/scheduled jobs must survive a restart.',
    "appendonly $AppendOnly",
    'appenddirname "appendonlydir"',
    'appendfsync everysec',
    'no-appendfsync-on-rewrite no',
    'auto-aof-rewrite-percentage 100',
    'auto-aof-rewrite-min-size 64mb',
    'save 900 1',
    'save 300 10',
    'save 60 10000',
    '',
    '# Restart payload safety.',
    'stop-writes-on-bgsave-error yes',
    'rdbcompression yes',
    'rdbchecksum yes'
  )
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  [System.IO.File]::WriteAllText($ConfPath, ($lines -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
}

function Start-RedisProcess {
  param([string]$ServerPath)
  # The WinGet (MSYS2) build cannot accept an absolute Windows path as an argument:
  # it prepends the working directory to "C:\..." and dies with
  # "Fatal error, can't open config file". A bare relative filename resolved from
  # -WorkingDirectory is the only form this binary accepts.
  # The process must also outlive this PowerShell session, hence Start-Process.
  $proc = Start-Process -FilePath $ServerPath `
    -ArgumentList @($ConfName) `
    -WorkingDirectory $DataDir `
    -WindowStyle Hidden -PassThru
  return $proc
}

function Wait-RedisReady {
  param([int]$TimeoutSec)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-RedisPong -TargetHost $BindHost -TargetPort $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# ── Persistence ───────────────────────────────────────────────────────────────
# Logon task that owns the Redis process and restarts it if it crashes.
# Self-healing: refreshes the definition when the binary path or data dir moved.
function Ensure-RedisAutostart {
  param([string]$ServerPath)

  if ($CheckOnly -or $NoPersist) { return }

  # Must mirror Start-RedisProcess: relative filename, never an absolute path.
  $desiredArg = $ConfName
  try {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $action = @($existing.Actions)[0]
    $same = ($action.Execute -eq $ServerPath) -and ($action.Arguments -eq $desiredArg)
    if ($same) { return }
  } catch { }

  try {
    $action = New-ScheduledTaskAction -Execute $ServerPath -Argument $desiredArg -WorkingDirectory $DataDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -RestartCount 999 `
      -RestartInterval (New-TimeSpan -Minutes 1) `
      -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $TaskName `
      -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
      -Description 'ROCK BASE Local Mode Redis (loopback, queue durability)' -Force | Out-Null
    Say "Registered logon task '$TaskName' so Redis survives reboot" 'fix'
  } catch {
    Say "Could not register logon task: $($_.Exception.Message). Redis still runs for this session." 'warn'
  }
}

# ── Main ──────────────────────────────────────────────────────────────────────
$binary = Find-RedisBinary -Hint $RedisBinHome

if (-not $binary) {
  if ($CheckOnly) {
    Say 'Redis binary not found (checked PATH, WinGet packages, registry PATH, Program Files)' 'fail'
    exit 1
  }

  # One install attempt per invocation. Never loop: if the binary still cannot be
  # resolved from disk afterwards, fail loudly instead of reinstalling again.
  $recentAttempt = $false
  if (Test-Path -LiteralPath $MarkerPath) {
    $age = (Get-Date) - (Get-Item -LiteralPath $MarkerPath).LastWriteTime
    if ($age.TotalMinutes -lt 10) { $recentAttempt = $true }
  }

  if ($recentAttempt) {
    Say 'An install was attempted in the last 10 minutes and no binary was found. Not retrying.' 'fail'
    Say 'Reinstall manually: winget install --id taizod1024.redis-windows-fork --exact' 'warn'
    exit 1
  }

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    Say 'Redis is not installed and winget is unavailable.' 'fail'
    exit 1
  }

  Say 'Installing local Redis runtime (one attempt)' 'fix'
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  [System.IO.File]::WriteAllText($MarkerPath, (Get-Date).ToString('o'))
  & winget install --id taizod1024.redis-windows-fork --exact --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null

  # Re-resolve from disk. Do NOT rely on the process PATH, which winget cannot update.
  $binary = Find-RedisBinary -Hint $RedisBinHome
  if (-not $binary) {
    Say 'Redis installed but redis-server.exe still not found on disk.' 'fail'
    Say 'Check: $env:LOCALAPPDATA\Microsoft\WinGet\Packages\*redis*\*\redis-server.exe' 'warn'
    exit 1
  }
}

if ($CheckOnly) {
  if (Test-RedisPong -TargetHost $BindHost -TargetPort $Port) {
    Say "Redis responding on ${BindHost}:${Port}" 'pass'
    exit 0
  }
  if (Test-PortOpen -TargetHost $BindHost -TargetPort $Port) {
    Say "Port ${Port} is bound but not answering PING" 'fail'
    exit 1
  }
  Say "Redis binary found but not running on ${BindHost}:${Port}" 'fail'
  exit 1
}

# Persistence mode. An AOF-enabled FIRST start creates an empty AOF base and never
# reads dump.rdb - that silently publishes empty BullMQ queues over real ones.
# When only an RDB exists we must boot with appendonly=no (so the RDB loads), then
# promote the live dataset to AOF. Verified behaviour on Redis 8.10.2 / Windows.
$AofDirPath = Join-Path $DataDir 'appendonlydir'
$hasAof = (Test-Path -LiteralPath $AofDirPath) -and
          (@(Get-ChildItem -LiteralPath $AofDirPath -File -ErrorAction SilentlyContinue).Count -gt 0)
$RdbPath = Join-Path $DataDir 'dump.rdb'
$hasRdb = (Test-Path -LiteralPath $RdbPath -PathType Leaf) -and ((Get-Item -LiteralPath $RdbPath).Length -gt 0)
$bootstrapFromRdb = (-not $hasAof) -and $hasRdb

if (Test-RedisPong -TargetHost $BindHost -TargetPort $Port) {
  if (-not (Test-Path -LiteralPath $ConfPath)) { Write-RedisConfig -Dir $DataDir -AppendOnly 'yes' }
  Say "Redis already running on ${BindHost}:${Port}" 'pass'
  Ensure-RedisAutostart -ServerPath $binary
  exit 0
}

if (Test-PortOpen -TargetHost $BindHost -TargetPort $Port) {
  Say "Port ${Port} is taken by another process that does not answer PING" 'fail'
  Say 'Stop that process (netstat -ano | findstr :6379) and rerun.' 'warn'
  exit 1
}

# Losing race with the logon task? Give it a moment before spawning a second server.
if ((Test-Path -LiteralPath $PidPath) -and -not (Test-RedisPong -TargetHost $BindHost -TargetPort $Port)) {
  $null = Wait-RedisReady -TimeoutSec 4
  if (Test-RedisPong -TargetHost $BindHost -TargetPort $Port) {
    Say "Redis came up from the logon task on ${BindHost}:${Port}" 'pass'
    Ensure-RedisAutostart -ServerPath $binary
    exit 0
  }
}

$appendMode = if ($bootstrapFromRdb) { 'no' } else { 'yes' }
Write-RedisConfig -Dir $DataDir -AppendOnly $appendMode
if ($bootstrapFromRdb) { Say 'Bootstrapping from dump.rdb before enabling AOF persistence' }

Say "Starting Redis ($binary)" 'fix'
try {
  $proc = Start-RedisProcess -ServerPath $binary
} catch {
  Say "Failed to start redis-server: $($_.Exception.Message)" 'fail'
  exit 1
}

if (-not (Wait-RedisReady -TimeoutSec $ReadyTimeoutSec)) {
  Say "Redis did not answer PING within ${ReadyTimeoutSec}s" 'fail'
  if (Test-Path -LiteralPath $LogPath) {
    Say 'Last log lines:' 'warn'
    Get-Content -LiteralPath $LogPath -Tail 12 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
  }
  exit 1
}

# Promote the RDB-loaded dataset to AOF so queues survive an unclean restart,
# then persist the new mode for every future boot. CONFIG SET rewrites nothing on
# disk, so the config file is regenerated to match.
if ($bootstrapFromRdb) {
  $cli = Join-Path (Split-Path -Parent $binary) 'redis-cli.exe'
  if (Test-Path -LiteralPath $cli) {
    $loadedKeys = ((& $cli -p $Port dbsize) -join '').Trim()
    Say "Loaded $loadedKeys key(s) from dump.rdb" 'pass'
    & $cli -p $Port config set appendonly yes 2>&1 | Out-Null
    Start-Sleep -Milliseconds 900
    Write-RedisConfig -Dir $DataDir -AppendOnly 'yes'
    Say 'Promoted dataset to AOF persistence (queue durability on restart)' 'fix'
  } else {
    Say 'redis-cli.exe missing next to redis-server; staying RDB-only' 'warn'
  }
}

Ensure-RedisAutostart -ServerPath $binary
Say "Redis listening on ${BindHost}:${Port} (pid $($proc.Id))" 'pass'
exit 0
