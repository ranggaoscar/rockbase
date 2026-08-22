@echo off
setlocal
echo ROCK BASE graceful stop
echo.
echo In the ROCK BASE Backend window, press Ctrl+C once and wait for shutdown.
echo The backend then saves and releases active session state before closing browser contexts.
echo Close the Frontend window after the backend reports shutdown.
echo.
echo This helper intentionally does not hard-kill Node processes.
pause
exit /b 0
