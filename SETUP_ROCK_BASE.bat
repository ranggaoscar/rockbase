@echo off
setlocal EnableExtensions

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

title ROCK BASE Setup

echo ==========================================
echo    ROCK BASE first-time setup
echo ==========================================
echo.
echo Project:
echo %PROJECT_DIR%
echo.
echo This installs dependencies, creates backend\.env if missing,
echo prepares Prisma, and seeds the default admin user.
echo It does not delete or reset any existing database.
echo.

where node.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on PATH.
  echo Install Node.js 18+ from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm.cmd was not found on PATH.
  echo Install Node.js 18+ from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\backend\package.json" (
  echo ERROR: backend\package.json was not found.
  echo Make sure this file is inside the ROCK BASE project folder.
  echo.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\frontend\package.json" (
  echo ERROR: frontend\package.json was not found.
  echo Make sure this file is inside the ROCK BASE project folder.
  echo.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\backend\.env" (
  echo Creating backend\.env from backend\.env.example...
  copy "%PROJECT_DIR%\backend\.env.example" "%PROJECT_DIR%\backend\.env" >nul
  if errorlevel 1 (
    echo ERROR: Could not create backend\.env.
    echo.
    pause
    exit /b 1
  )
  echo Created backend\.env. Edit API keys later if you use AI features.
) else (
  echo backend\.env already exists. Leaving it unchanged.
)

echo.
echo Installing backend dependencies...
pushd "%PROJECT_DIR%\backend" >nul
call npm.cmd install
if errorlevel 1 (
  popd >nul
  echo ERROR: Backend npm install failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Generating Prisma client...
call npx.cmd prisma generate
if errorlevel 1 (
  popd >nul
  echo ERROR: Prisma generate failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Applying database migrations...
call npx.cmd prisma migrate deploy
if errorlevel 1 (
  popd >nul
  echo ERROR: Prisma migrate deploy failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Seeding default workspace and admin user...
call npm.cmd run seed
if errorlevel 1 (
  popd >nul
  echo ERROR: Database seed failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Installing Playwright Chromium browser...
call npx.cmd playwright install chromium
if errorlevel 1 (
  echo WARNING: Playwright browser install failed.
  echo Farm View and Instagram automation may fail until Playwright is installed.
) else (
  echo Playwright Chromium installed.
)
popd >nul

echo.
echo Installing frontend dependencies...
pushd "%PROJECT_DIR%\frontend" >nul
call npm.cmd install
if errorlevel 1 (
  popd >nul
  echo ERROR: Frontend npm install failed.
  echo.
  pause
  exit /b 1
)
popd >nul

echo.
echo Checking Redis on 127.0.0.1:6379...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -InformationLevel Quiet; if ($ok) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo WARNING: Redis is not reachable.
  echo Install/start Redis before running mass posting queues.
) else (
  echo Redis is reachable.
)

echo.
echo Setup complete.
echo Next:
echo   1. Edit backend\.env if you need real AI API keys.
echo   2. Start Redis.
echo   3. Double-click START_ROCK_BASE.bat.
echo   4. Open http://localhost:5173
echo.
if "%ROCKBASE_NO_PAUSE%"=="" pause
