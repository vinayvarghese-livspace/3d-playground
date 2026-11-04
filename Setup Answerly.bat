@echo off
setlocal
title 3D Playground - Answerly bridge setup
rem Lightweight install for Product Replacement only (no Adobe / Firefly).
set "HOME_DIR=%USERPROFILE%\3d-playground"
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$d='D:\3d-playground'; $u=Join-Path $env:USERPROFILE '3d-playground'; if (Test-Path ($d+'\firefly-upscaler\answerly-server.js')) { $d } elseif (Test-Path ($u+'\firefly-upscaler\answerly-server.js')) { $u } elseif (Test-Path ($d+'\firefly-upscaler\server.js')) { $d } elseif (Test-Path ($u+'\firefly-upscaler\server.js')) { $u } else { try { $i=[IO.DriveInfo]::new('D'); if (-not ($i.IsReady -and $i.DriveType -eq 'Fixed')) { throw 'no D' }; $null=New-Item -ItemType Directory $d -Force -ErrorAction Stop; $t=$d+'\.write-test'; Set-Content $t 'x' -ErrorAction Stop; Remove-Item $t; $d } catch { $u } }"`) do set "HOME_DIR=%%p"
set "PAGE=https://vinayvarghese-livspace.github.io/3d-playground/preview.html"

if not "%~1"=="copied" (
  echo.
  echo  ==============================================
  echo    Answerly bridge setup ^(no Firefly needed^)
  echo  ==============================================
  echo.
)

if /I not "%~dp0"=="%HOME_DIR%\" (
  echo  [1/3] Copying files to %HOME_DIR% ...
  robocopy "%~dp0." "%HOME_DIR%" /E /XD node_modules chrome-profile jobs logs jobs-answerly /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 (
    echo  Could not copy files. Close open files in that folder and retry.
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%HOME_DIR%' -Recurse -File | Unblock-File" >nul 2>&1
  call "%HOME_DIR%\Setup Answerly.bat" copied
  exit /b
)

cd /d "%HOME_DIR%\firefly-upscaler"
echo  [1/3] Files are in %HOME_DIR%
if not exist "answerly-server.js" (
  echo  [FAIL] answerly-server.js missing. Download the latest zip.
  pause
  exit /b 1
)

echo  [2/3] Checking Node.js ...
where node >nul 2>&1 || call :refresh_path
where node >nul 2>&1
if errorlevel 1 (
  echo        Installing Node.js for this user...
  winget install OpenJS.NodeJS.LTS --scope user --silent --accept-package-agreements --accept-source-agreements
  call :refresh_path
)
where node >nul 2>&1
if errorlevel 1 (
  echo  Install Node.js LTS from https://nodejs.org then run this again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
echo        OK
call register-launcher.bat >nul

echo  [3/3] Starting Answerly bridge ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HOME_DIR%\firefly-upscaler\free-port-5175.ps1" >nul 2>&1
start "Answerly bridge" cmd /k "cd /d ""%HOME_DIR%\firefly-upscaler"" && title Answerly bridge && node answerly-server.js"
echo        Waiting for http://127.0.0.1:5175/answerly/health ...
powershell -NoProfile -Command "$end=(Get-Date).AddSeconds(45); while((Get-Date) -lt $end){ try { $a=Invoke-RestMethod http://127.0.0.1:5175/answerly/health -TimeoutSec 2; if($a.ok -and $a.service -eq 'answerly-bridge'){ Write-Host '        Connected.'; exit 0 } } catch {}; Start-Sleep 2 }; exit 1"
if errorlevel 1 (
  echo  Bridge did not start. Look at the Answerly bridge window for errors.
  pause
  exit /b 1
)

echo.
echo  Opening Preview. In Answerly token: Connect bridge ^(Allow if Chrome asks^), then paste session JSON.
echo  AI upscale / Firefly is optional — use Settings - AI upscale setup only if you need it.
echo.
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (start "" "%CHROME%" "%PAGE%") else (start "" "%PAGE%")
timeout /t 20 >nul
exit /b 0

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0
