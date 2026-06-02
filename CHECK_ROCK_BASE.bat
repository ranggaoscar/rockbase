@echo off
setlocal EnableExtensions

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "BACKEND_PORT=3010"
set "FRONTEND_PORT=5173"
set "BLOCKING_ERRORS=0"

title ROCK BASE Preflight Check

echo ==========================================
echo    ROCK BASE preflight check
echo ==========================================
echo.
echo Project:
echo %PROJECT_DIR%
echo.

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  set /a BLOCKING_ERRORS+=1
) else (
  for /f "tokens=*" %%v in ('node --version') do echo [OK] Node %%v
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found on PATH.
  set /a BLOCKING_ERRORS+=1
) else (
  for /f "tokens=*" %%v in ('npm.cmd --version') do echo [OK] npm %%v
)

if not exist "%PROJECT_DIR%\backend\package.json" (
  echo [ERROR] backend\package.json was not found.
  set /a BLOCKING_ERRORS+=1
) else (
  echo [OK] Backend folder found.
)

if not exist "%PROJECT_DIR%\frontend\package.json" (
  echo [ERROR] frontend\package.json was not found.
  set /a BLOCKING_ERRORS+=1
) else (
  echo [OK] Frontend folder found.
)

if not exist "%PROJECT_DIR%\backend\.env" (
  echo [ERROR] backend\.env is missing. Run SETUP_ROCK_BASE.bat first.
  set /a BLOCKING_ERRORS+=1
) else (
  echo [OK] backend\.env exists.
)

if not exist "%PROJECT_DIR%\backend\node_modules" (
  echo [WARN] Backend dependencies are missing. Run SETUP_ROCK_BASE.bat.
) else (
  echo [OK] Backend dependencies found.
)

if not exist "%PROJECT_DIR%\frontend\node_modules" (
  echo [WARN] Frontend dependencies are missing. Run SETUP_ROCK_BASE.bat.
) else (
  echo [OK] Frontend dependencies found.
)

echo.
echo Checking Redis on 127.0.0.1:6379...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -InformationLevel Quiet; if ($ok) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [WARN] Redis is not reachable. Queue jobs will not run until Redis is started.
) else (
  echo [OK] Redis is reachable.
)

echo.
if exist "%PROJECT_DIR%\backend\node_modules" (
  echo Validating Prisma schema...
  pushd "%PROJECT_DIR%\backend" >nul
  call npx.cmd prisma validate
  if errorlevel 1 (
    echo [ERROR] Prisma schema validation failed.
    set /a BLOCKING_ERRORS+=1
  ) else (
    echo [OK] Prisma schema is valid.
  )
  popd >nul
)

echo.
echo Checking backend health on port %BACKEND_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://localhost:%BACKEND_PORT%/api/health -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [WARN] Backend is not answering yet. Start it with START_ROCK_BASE.bat.
) else (
  echo [OK] Backend health endpoint is OK.
)

echo Checking frontend port %FRONTEND_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port %FRONTEND_PORT% -InformationLevel Quiet; if ($ok) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [WARN] Frontend is not answering yet. Start it with START_ROCK_BASE.bat.
) else (
  echo [OK] Frontend port is open.
)

echo.
if "%BLOCKING_ERRORS%"=="0" (
  echo Preflight complete. No blocking setup errors found.
) else (
  echo Preflight found %BLOCKING_ERRORS% blocking errors. Fix them before sharing/running.
)
echo.
if "%ROCKBASE_NO_PAUSE%"=="" pause
exit /b %BLOCKING_ERRORS%
