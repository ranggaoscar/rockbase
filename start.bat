@echo off
setlocal

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "BACKEND_PORT=3010"

taskkill /F /IM node.exe 2>nul
timeout /t 3 /nobreak >nul
echo ==========================================
echo    ROCK BASE Dashboard Starter
echo ==========================================

echo Starting Backend...
start "ROCK BASE Backend" cmd /k "pushd ""%PROJECT_DIR%\backend"" && set PORT=%BACKEND_PORT%&& set FRONTEND_URL=http://localhost:5173&& set BACKEND_URL=http://localhost:%BACKEND_PORT%&& npm.cmd run dev"

echo Starting Frontend...
start "ROCK BASE Frontend" cmd /k "pushd ""%PROJECT_DIR%\frontend"" && npm.cmd run dev"

echo Done! Both servers are launching.
echo Dashboard will be available at: http://localhost:5173
echo Login: admin@rockbase.com / Admin@123
pause
