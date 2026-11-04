@echo off
rem Starts the local bridge on 5175 first (Answerly needs this).
rem Firefly Chrome is optional and starts after the bridge is up.
cd /d "%~dp0"
title 3D Playground upscaler

where node >nul 2>&1 || call :refresh_path
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install LTS from https://nodejs.org then run Setup.bat.
  pause
  exit /b 1
)

if not exist "answerly.js" (
  echo [FAIL] answerly.js missing — download the latest zip and run Setup.bat.
  echo https://vinayvarghese-livspace.github.io/3d-playground/dist/3d-playground.zip
  pause
  exit /b 1
)

if not exist "node_modules\playwright-core" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed. Check internet and retry.
    pause
    exit /b 1
  )
)

rem If a healthy Answerly bridge is already up, keep it.
powershell -NoProfile -Command "try { $a=Invoke-RestMethod http://127.0.0.1:5175/answerly/health -TimeoutSec 2; if ($a.ok -and $a.service -eq 'answerly-bridge') { exit 0 }; exit 2 } catch { exit 1 }"
if %ERRORLEVEL%==0 (
  echo Bridge already running on http://127.0.0.1:5175
  call :ensure_chrome
  exit /b 0
)

rem Free a stale / old process on 5175.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0free-port-5175.ps1" >nul 2>&1

rem Firefly Chrome helps AI upscale; Answerly works without it. Start Chrome in background, don't block bridge.
start "" cmd /c "cd /d ""%~dp0"" && call start-chrome.bat"

echo.
echo Starting bridge on http://127.0.0.1:5175
echo Leave this window open while using Preview / Answerly.
echo Check: http://127.0.0.1:5175/answerly/health
echo.
node server.js
echo.
echo Bridge stopped.
pause
exit /b

:ensure_chrome
powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:9222/json/version -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 start "" cmd /c "cd /d ""%~dp0"" && call start-chrome.bat"
exit /b 0

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0
