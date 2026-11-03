@echo off
setlocal
title 3D Playground - AI upscale setup
rem Install folder: an existing install first, else D:\3d-playground on a local writable D drive, else the user folder.
set "HOME_DIR=%USERPROFILE%\3d-playground"
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$d='D:\3d-playground'; $u=Join-Path $env:USERPROFILE '3d-playground'; if (Test-Path ($d+'\firefly-upscaler\server.js')) { $d } elseif (Test-Path ($u+'\firefly-upscaler\server.js')) { $u } else { try { $i=[IO.DriveInfo]::new('D'); if (-not ($i.IsReady -and $i.DriveType -eq 'Fixed')) { throw 'no D' }; $null=New-Item -ItemType Directory $d -Force -ErrorAction Stop; $t=$d+'\.write-test'; Set-Content $t 'x' -ErrorAction Stop; Remove-Item $t; $d } catch { $u } }"`) do set "HOME_DIR=%%p"
set "PAGE=https://vinayvarghese-livspace.github.io/3d-playground/preview.html?setup=1"

if not "%~1"=="copied" (
  echo.
  echo  ==============================================
  echo    3D Playground - AI upscale / Answerly setup
  echo  ==============================================
  echo.
)

rem Always run from the install folder, so Start / Repair / Adobe sign-in share one fixed place.
if /I not "%~dp0"=="%HOME_DIR%\" (
  echo  [1/5] Copying files to %HOME_DIR% ...
  robocopy "%~dp0." "%HOME_DIR%" /E /XD node_modules chrome-profile jobs logs /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 (
    echo.
    echo  Could not copy the files. Close any open file from that folder and run Setup.bat again.
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%HOME_DIR%' -Recurse -File | Unblock-File" >nul 2>&1
  call "%HOME_DIR%\Setup.bat" copied
  exit /b
)

cd /d "%HOME_DIR%\firefly-upscaler"
echo  [1/5] Files are in %HOME_DIR%
if not exist "answerly.js" (
  echo.
  echo  [FAIL] answerly.js missing after copy. The zip is too old or incomplete.
  echo  Download again:
  echo  https://vinayvarghese-livspace.github.io/3d-playground/dist/3d-playground.zip
  pause
  exit /b 1
)
echo        Answerly bridge files OK
echo.

echo  [2/5] Checking Node.js ...
where node >nul 2>&1 || call :refresh_path
where node >nul 2>&1
if errorlevel 1 (
  echo        Installing Node.js for this user. This can take a few minutes ...
  winget install OpenJS.NodeJS.LTS --scope user --silent --accept-package-agreements --accept-source-agreements
  call :refresh_path
)
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js could not be installed automatically.
  echo  Install the LTS version from https://nodejs.org, then run Setup.bat again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
echo        OK
echo.

echo  [3/5] Installing the upscaler ...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo  The install failed. Check the internet connection and run Setup.bat again.
  pause
  exit /b 1
)
call register-launcher.bat >nul
echo        OK
echo.

echo  [4/5] Adobe sign-in ^(needed for AI upscale; Answerly token is separate in the web page^)
call start-chrome.bat login >nul
echo        A Chrome window opened on Adobe Firefly.
echo        - Sign in with your Adobe account ^(already signed in? nothing to do^).
echo        - Using your company Google account? Approve Google's 2-Step
echo          Verification on your phone or enter the code in that window.
echo        - Then CLOSE that Chrome window.
echo.
echo        Press any key here once that Chrome window is closed ...
pause >nul
echo.

echo  [5/5] Starting the upscaler / Answerly bridge ...
echo        Freeing port 5175 so an old install cannot block this one ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HOME_DIR%\firefly-upscaler\free-port-5175.ps1" >nul 2>&1
echo        Starting bridge ^(visible window — leave it open^)...
start "3D Playground upscaler" cmd /k "cd /d ""%HOME_DIR%\firefly-upscaler"" && title 3D Playground upscaler && node server.js"
echo        Waiting for the bridge on 5175 ^(up to 90 seconds^)...
powershell -NoProfile -Command "$end=(Get-Date).AddSeconds(90); $chrome=$false; while((Get-Date) -lt $end){ try { $h=Invoke-RestMethod http://127.0.0.1:5175/health -TimeoutSec 2; try { $a=Invoke-RestMethod http://127.0.0.1:5175/answerly/health -TimeoutSec 2 } catch { $a=$null }; if($h.ok -and $a -and $a.ok -and $a.service -eq 'answerly-bridge'){ $chrome=[bool]$h.chrome; if($chrome){ Write-Host '        Connected: bridge + Firefly Chrome'; exit 0 }; Write-Host '        Bridge online (Answerly OK). Firefly Chrome not ready yet — AI upscale may need Start later.'; exit 0 } } catch {}; Start-Sleep 2 }; exit 1"
if errorlevel 1 goto :not_connected

echo.
echo        Opening Preview ...
call :open_page
echo.
echo  ==============================================
echo    Setup complete.
echo    Install folder: %HOME_DIR%
echo    Bridge: http://127.0.0.1:5175/answerly/health
echo.
echo    Next: in Preview, paste your Answerly token
echo    ^(Settings or Product Replacement bar^).
echo    If Chrome asks to access your local network, Allow.
echo.
echo    Later problems? Double-click "Repair Upscaler.bat"
echo    in %HOME_DIR%
echo  ==============================================
echo.
echo  This window closes by itself in 30 seconds.
timeout /t 30 >nul
exit /b 0

:not_connected
echo.
echo  The bridge did not come online on port 5175.
echo  Look at the "3D Playground upscaler" window for the error text.
echo.
echo  Quick fix: double-click "Repair Upscaler.bat" in:
echo    %HOME_DIR%
echo.
call :open_page
pause
exit /b 1

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0

:open_page
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (start "" "%CHROME%" "%PAGE%") else (start "" "%PAGE%")
exit /b 0
