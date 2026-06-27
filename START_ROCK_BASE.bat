@echo off
setlocal

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "APP_URL=http://localhost:5173"
set "BACKEND_PORT=3010"

title ROCK BASE Launcher

echo ==========================================
echo    ROCK BASE one-click launcher
echo ==========================================
echo.
echo Project:
echo %PROJECT_DIR%
echo.
echo This opens backend and frontend in separate windows.
echo No database reset, migration, login, or posting job is started by this launcher.
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm.cmd was not found on PATH.
  echo Install Node.js or open this from a terminal where npm is available.
  echo.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\backend\package.json" (
  echo ERROR: Backend package.json was not found:
  echo %PROJECT_DIR%\backend\package.json
  echo.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\frontend\package.json" (
  echo ERROR: Frontend package.json was not found:
  echo %PROJECT_DIR%\frontend\package.json
  echo.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\frontend\node_modules\vite\bin\vite.js" (
  echo ERROR: Vite was not found here:
  echo %PROJECT_DIR%\frontend\node_modules\vite\bin\vite.js
  echo.
  echo Frontend dependencies look incomplete. Run npm install in frontend first.
  echo.
  pause
  exit /b 1
)

echo Starting ROCK BASE with Windows npm...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Test-NetConnection -ComputerName 127.0.0.1 -Port %BACKEND_PORT% -InformationLevel Quiet; if ($c) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo Backend port %BACKEND_PORT% is free. Starting backend and worker...
  start "ROCK BASE Backend" cmd /k "pushd ""%PROJECT_DIR%\backend"" && set PORT=%BACKEND_PORT%&& set FRONTEND_URL=http://localhost:5173&& set BACKEND_URL=http://localhost:%BACKEND_PORT%&& set RUN_WORKERS_SEPARATELY=true&& npm.cmd run dev"
  start "ROCK BASE Worker" cmd /k "pushd ""%PROJECT_DIR%\backend"" && set RUN_WORKERS_SEPARATELY=true&& npm.cmd run worker"
) else (
  echo Backend port %BACKEND_PORT% is already active. Reusing existing backend/worker.
)

timeout /t 3 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Test-NetConnection -ComputerName 127.0.0.1 -Port 5173 -InformationLevel Quiet; if ($c) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo Frontend port 5173 is free. Starting frontend...
  start "ROCK BASE Frontend" cmd /k "cd /d ""%PROJECT_DIR%\frontend"" && node node_modules\vite\bin\vite.js --host 0.0.0.0"
) else (
  echo Frontend port 5173 is already active. Reusing existing frontend.
)

echo.
echo Waiting for servers to warm up...
for /l %%i in (1,1,20) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Test-NetConnection -ComputerName 127.0.0.1 -Port 5173 -InformationLevel Quiet; if ($c) { exit 0 } else { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto frontend_ready
  timeout /t 2 /nobreak >nul
)

echo WARNING: Frontend did not answer on port 5173 yet.
echo Check the ROCK BASE Frontend window for errors.
echo.
pause
exit /b 1

:frontend_ready

echo Opening %APP_URL%
start "" "%APP_URL%"

echo.
echo Launcher finished. Keep the Backend and Frontend windows open while using ROCK BASE.
echo If a server fails, read the message in its terminal window.
echo.
pause
