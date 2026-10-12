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
  echo.
  echo Node.js installed. Close this window and double-click Setup.bat again to finish.
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
echo 3. Open index.html in Chrome. If the upscaler is offline, click "Start" next to it.
pause
