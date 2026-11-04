@echo off
rem Full Firefly upscaler (+ Answerly) on 5175.
rem If Answerly-only is already on 5175, replace it with this process.
cd /d "%~dp0"
title 3D Playground upscaler

where node >nul 2>&1 || call :refresh_path
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install LTS from https://nodejs.org then run Setup.bat.
  pause
  exit /b 1
)

if not exist "server.js" (
  echo [FAIL] server.js missing — download the latest zip and run Setup.bat.
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

rem exit 0 = full Firefly already up; 2 = Answerly-only or wrong service; 1 = nothing listening
powershell -NoProfile -Command "try { $h=Invoke-RestMethod http://127.0.0.1:5175/health -TimeoutSec 2; if ($h.ok -and $h.service -eq 'firefly-upscaler' -and -not $h.answerlyOnly) { exit 0 }; exit 2 } catch { exit 1 }"
if %ERRORLEVEL%==0 (
  echo Firefly upscaler already running on http://127.0.0.1:5175
  call :ensure_chrome
  powershell -NoProfile -Command "try { $h=Invoke-RestMethod http://127.0.0.1:5175/health -TimeoutSec 2; if ($h.chrome) { Write-Host 'Firefly Chrome: connected'; exit 0 }; Write-Host 'Firefly Chrome: not connected yet — started Chrome if needed.'; exit 0 } catch { exit 0 }"
  exit /b 0
)
if %ERRORLEVEL%==2 (
  echo Replacing Answerly-only bridge with full Firefly upscaler...
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0free-port-5175.ps1" >nul 2>&1

echo Starting Firefly Chrome ^(needed for AI upscale^)...
call start-chrome.bat
timeout /t 4 /nobreak >nul

echo.
echo Starting Firefly upscaler on http://127.0.0.1:5175
echo Leave this window open. Answerly routes stay available on the same port.
echo Check: http://127.0.0.1:5175/health
echo.
node server.js
echo.
echo Upscaler stopped.
pause
exit /b

:ensure_chrome
powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:9222/json/version -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 call start-chrome.bat
exit /b 0

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0
