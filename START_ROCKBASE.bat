@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0start-rockbase.ps1"
exit /b %errorlevel%
