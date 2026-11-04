@echo off
rem Answerly-only bridge — no Firefly Chrome, no Playwright, no Adobe sign-in.
cd /d "%~dp0"
title Answerly bridge

where node >nul 2>&1 || call :refresh_path
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install LTS from https://nodejs.org then run Setup Answerly.bat.
  pause
  exit /b 1
)

if not exist "answerly.js" (
  echo [FAIL] answerly.js missing — install the latest 3d-playground zip.
  pause
  exit /b 1
)
if not exist "answerly-server.js" (
  echo [FAIL] answerly-server.js missing — install the latest 3d-playground zip.
  pause
  exit /b 1
)

rem Keep a healthy Answerly bridge if already running (full upscaler or answerly-only).
powershell -NoProfile -Command "try { $a=Invoke-RestMethod http://127.0.0.1:5175/answerly/health -TimeoutSec 2; if ($a.ok -and $a.service -eq 'answerly-bridge') { exit 0 }; exit 2 } catch { exit 1 }"
if %ERRORLEVEL%==0 (
  echo Answerly bridge already running on http://127.0.0.1:5175
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0free-port-5175.ps1" >nul 2>&1

echo.
echo Starting Answerly bridge on http://127.0.0.1:5175
echo Leave this window open while using Product Replacement.
echo Firefly / AI upscale is NOT started ^(optional, separate^).
echo Check: http://127.0.0.1:5175/answerly/health
echo.
node answerly-server.js
echo.
echo Answerly bridge stopped.
pause
exit /b

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0
