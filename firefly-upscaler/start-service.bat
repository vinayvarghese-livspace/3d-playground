@echo off
rem Starts the upscaler Chrome (if it isn't running) and the local service used by the 3D Playground page.
rem Usage: start-service.bat [hidden]
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\playwright-core" (
  echo Installing dependencies, first run only...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed. Check the internet connection and run this again.
    pause
    exit /b 1
  )
)

powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:9222/json/version -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  call start-chrome.bat %1
  timeout /t 5 /nobreak >nul
)

powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:5175/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo The upscaler is already running.
  exit /b 0
)

node server.js
