@echo off
setlocal
title 3D Playground - AI upscale setup
set "HOME_DIR=%USERPROFILE%\3d-playground"
set "PAGE=https://vinayvarghese-livspace.github.io/3d-playground/?setup=1"

if not "%~1"=="copied" (
  echo.
  echo  ==============================================
  echo    3D Playground - AI upscale setup
  echo  ==============================================
  echo.
)

rem Always run from the user folder, so the Adobe sign-in and the page's Start button keep one fixed place.
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

echo  [4/5] Adobe sign-in
call start-chrome.bat login >nul
echo        A Chrome window opened on Adobe Firefly.
echo        - Sign in with your Adobe account (already signed in? nothing to do).
echo        - Then CLOSE that Chrome window.
echo.
echo        Press any key here once that Chrome window is closed ...
pause >nul
echo.

echo  [5/5] Starting the upscaler and opening 3D Playground ...
start "3D Playground upscaler" /min "%HOME_DIR%\firefly-upscaler\start-service.bat"
timeout /t 3 /nobreak >nul
call :open_page
echo.
echo  ==============================================
echo    Setup complete.
echo    If Chrome asks to open the upscaler or to
echo    access your local network, click Allow.
echo  ==============================================
echo.
pause
exit /b 0

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
exit /b 0

:open_page
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (start "" "%CHROME%" "%PAGE%") else (start "" "%PAGE%")
exit /b 0
