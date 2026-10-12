@echo off
title 3D Playground - first-time setup
cd /d "%~dp0firefly-upscaler"

echo === 3D Playground setup (AI upscale) ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Installing it for this user, no admin needed...
  winget install OpenJS.NodeJS.LTS --scope user --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo.
    echo Could not install Node.js automatically. Install the LTS version from https://nodejs.org
    pause
    exit /b 1
  )
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p"
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js was installed. Close this window and double-click Setup.bat again to finish.
  pause
  exit /b 0
)

echo Installing the upscaler's dependency...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo npm install failed. Check the internet connection and run Setup.bat again.
  pause
  exit /b 1
)

call register-launcher.bat

echo.
echo Opening Chrome for the one-time Adobe sign-in...
call start-chrome.bat login
echo.
echo 1. Sign in to Adobe Firefly in the Chrome window that opened.
echo 2. Close that Chrome window.
echo 3. Open https://vinayvarghese-livspace.github.io/3d-playground/ (or index.html) in Chrome.
echo 4. If the upscaler shows offline, click "Start" next to it and allow Chrome's prompts.
pause
