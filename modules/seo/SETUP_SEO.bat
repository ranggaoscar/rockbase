@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 (
  echo uv is required. Install uv from https://docs.astral.sh/uv/ then rerun.
  exit /b 1
)
uv sync --python 3.12 --frozen
if errorlevel 1 exit /b 1
uv run playwright install chromium
exit /b %errorlevel%
