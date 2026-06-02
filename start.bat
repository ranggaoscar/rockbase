@echo off
taskkill /F /IM node.exe 2>nul
timeout /t 3 /nobreak >nul
echo ==========================================
echo    ROCK BASE Dashboard Starter
echo ==========================================

echo Starting Backend...
start cmd /k "cd backend && npm run dev"

echo Starting Frontend...
start cmd /k "cd frontend && npm run dev"

echo Done! Both servers are launching.
echo Dashboard will be available at: http://localhost:5173
echo Login: admin@rockbase.com / Admin@123
pause
