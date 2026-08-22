@echo off
setlocal

echo ROCK BASE graceful stop
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:3010/internal/local/shutdown' -TimeoutSec 5; if ($response.StatusCode -ne 202) { exit 1 } } catch { exit 1 }; for ($i = 0; $i -lt 12; $i++) { if (-not (Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Seconds 1 }; if (Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue) { Write-Error 'Backend did not stop gracefully in time.'; exit 1 }; $frontend = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($frontend) { Stop-Process -Id $frontend.OwningProcess -ErrorAction Stop }; Write-Output 'RockBase stopped. Redis remains running locally for the next start.'"
if errorlevel 1 (
  echo RockBase stop failed. If the backend is not running, close the frontend window manually.
  exit /b 1
)
echo RockBase stopped gracefully.
exit /b 0
