@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo Installing dependencies…
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Starting Shoot Tracker Sync UI…
node server.js
pause
