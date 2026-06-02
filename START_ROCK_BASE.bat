@echo off
setlocal

set "PROJECT_DIR=C:\AI PROJECTS\Dashboard_Sentral\RockBase-Codex-Dev"
set "APP_URL=http://localhost:5173"

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

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 -InformationLevel Quiet; if ($c) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo Backend port 3000 is free. Starting backend...
  start "ROCK BASE Backend" cmd /k "pushd ""%PROJECT_DIR%\backend"" && npm.cmd run dev"
) else (
  echo Backend port 3000 is already active. Reusing existing backend.
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
