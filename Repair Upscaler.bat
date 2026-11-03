@echo off
setlocal
title 3D Playground - Repair upscaler
rem One-click fix when Setup says offline / token Not found / Answerly missing.
rem Always frees port 5175, checks files, starts a VISIBLE upscaler window, then verifies.

set "HOME_DIR=%~dp0"
if /I not "%HOME_DIR:~-1%"=="\" set "HOME_DIR=%HOME_DIR%\"
if not exist "%HOME_DIR%firefly-upscaler\server.js" (
  echo.
  echo  Run this from the install folder ^(usually D:\3d-playground^), not from the zip Downloads folder.
  echo  Or run Setup.bat from the extracted zip first.
  echo.
  pause
  exit /b 1
)

echo.
echo  ==============================================
echo    Repair upscaler / Answerly bridge
echo  ==============================================
echo  Install: %HOME_DIR%
echo.

cd /d "%HOME_DIR%firefly-upscaler"

where node >nul 2>&1 || call :refresh_path
where node >nul 2>&1
if errorlevel 1 (
  echo  Node.js not found. Run Setup.bat first ^(it installs Node for this user^).
  pause
  exit /b 1
)

if not exist "answerly.js" (
  echo  [FAIL] answerly.js is missing — this install is too old for Product Replacement.
  echo         Download the latest 3d-playground.zip and run Setup.bat again.
  echo         https://vinayvarghese-livspace.github.io/3d-playground/dist/3d-playground.zip
  pause
  exit /b 1
)
echo  [OK] answerly.js present

if not exist "node_modules\playwright-core" (
  echo  Installing npm packages...
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 (
    echo  npm install failed. Check internet and retry.
    pause
    exit /b 1
  )
)

call register-launcher.bat >nul 2>&1

echo  Freeing port 5175 ^(stops any old / conflicting upscaler^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0firefly-upscaler\free-port-5175.ps1"

echo  Starting upscaler in a visible window...
echo  Leave that window open. Close it only to stop the bridge.
start "3D Playground upscaler" cmd /k "cd /d ""%HOME_DIR%firefly-upscaler"" && title 3D Playground upscaler && node server.js"

echo  Waiting for bridge ^(up to 45 seconds^)...
powershell -NoProfile -Command "$end=(Get-Date).AddSeconds(45); while((Get-Date) -lt $end){ try { $h=Invoke-RestMethod http://127.0.0.1:5175/health -TimeoutSec 2; $a=$null; try { $a=Invoke-RestMethod http://127.0.0.1:5175/answerly/health -TimeoutSec 2 } catch {}; if($h.ok -and $a -and $a.ok -and $a.service -eq 'answerly-bridge'){ Write-Host ('  [OK] Bridge online · Chrome Firefly=' + ($(if($h.chrome){'yes'}else{'not yet'}))); exit 0 } } catch {}; Start-Sleep 2 }; Write-Host '  [FAIL] Bridge did not respond on http://127.0.0.1:5175'; exit 1"
if errorlevel 1 (
  echo.
  echo  Look at the "3D Playground upscaler" window for the red error.
  echo  Common fixes: allow Node through firewall; close other Node apps; re-run Setup.bat.
  pause
  exit /b 1
)

echo.
echo  Optional check in browser:
echo    http://127.0.0.1:5175/answerly/health
echo  Then open Preview and paste your Answerly token.
echo    https://vinayvarghese-livspace.github.io/3d-playground/preview.html
echo.
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "http://127.0.0.1:5175/answerly/health"
  start "" "%CHROME%" "https://vinayvarghese-livspace.github.io/3d-playground/preview.html"
) else (
  start "" "https://vinayvarghese-livspace.github.io/3d-playground/preview.html"
)
echo  Done. This window can close.
timeout /t 20 >nul
exit /b 0

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0
