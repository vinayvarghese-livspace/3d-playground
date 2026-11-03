@echo off
rem Starts the upscaler Chrome (if needed) and the local service used by 3D Playground.
rem Usage: start-service.bat [hidden]
cd /d "%~dp0"

where node >nul 2>&1 || call :refresh_path
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run Setup.bat again.
  pause
  exit /b 1
)

if not exist "answerly.js" (
  echo.
  echo [FAIL] answerly.js missing — this folder is an old upscaler install.
  echo Download the latest zip and run Setup.bat:
  echo https://vinayvarghese-livspace.github.io/3d-playground/dist/3d-playground.zip
  echo Or run "Repair Upscaler.bat" from the install folder after updating.
  echo.
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

rem Keep only a healthy Answerly bridge. Anything else on 5175 is stopped.
powershell -NoProfile -Command "try { $a=Invoke-RestMethod http://127.0.0.1:5175/answerly/health -TimeoutSec 2; if ($a.ok -and $a.service -eq 'answerly-bridge') { exit 0 } else { exit 2 } } catch { try { Invoke-RestMethod http://127.0.0.1:5175/health -TimeoutSec 2 | Out-Null; exit 2 } catch { exit 1 } }"
if not errorlevel 1 (
  echo The upscaler is already running (Answerly bridge OK).
  exit /b 0
)
if errorlevel 2 (
  echo Stopping whatever is on port 5175 so this install can start...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0free-port-5175.ps1"
)

echo Starting bridge on http://127.0.0.1:5175 ...
echo If this window closes immediately, run "Repair Upscaler.bat" from the parent folder.
node server.js
echo.
echo Bridge stopped.
pause
exit /b

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0
