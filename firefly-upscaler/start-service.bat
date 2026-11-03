@echo off
rem Starts the upscaler Chrome (if it isn't running) and the local service used by the 3D Playground page.
rem Usage: start-service.bat [hidden]
cd /d "%~dp0"

rem Chrome (which launches this through the page's Start button) may predate the Node.js install, so reload PATH.
where node >nul 2>&1 || call :refresh_path

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

rem If something is already on 5175, keep it only when Answerly routes exist.
rem An old upscaler (pre-V1.4) answers /health but returns "Not found" for /answerly/token.
powershell -NoProfile -Command "try { $h=Invoke-RestMethod http://127.0.0.1:5175/health -TimeoutSec 2; try { $a=Invoke-RestMethod http://127.0.0.1:5175/answerly/health -TimeoutSec 2; if ($a.ok -and $a.service -eq 'answerly-bridge') { exit 0 } else { exit 2 } } catch { exit 2 } } catch { exit 1 }"
if not errorlevel 1 (
  echo The upscaler is already running (Answerly bridge OK).
  exit /b 0
)
if errorlevel 2 (
  echo An older upscaler is on port 5175 without Answerly — stopping it so this install can start...
  powershell -NoProfile -Command "$conns=Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue; foreach($c in $conns){ if($c.OwningProcess){ Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }; Start-Sleep 1"
)

node server.js
exit /b

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0
