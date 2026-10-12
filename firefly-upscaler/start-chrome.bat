@echo off
rem Usage:
rem   start-chrome.bat login    plain Chrome, no debugging port (use this to sign in)
rem   start-chrome.bat          visible window
rem   start-chrome.bat hidden   window placed off-screen
rem   start-chrome.bat headless no window at all (Adobe may reject this)

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Chrome not found. Edit CHROME in start-chrome.bat.
  exit /b 1
)

set "PROFILE=%~dp0chrome-profile"
set "URL=https://firefly.adobe.com/generate/image?view=edit&workflow=upscaleImage"
set "COMMON=--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check"

if /I "%~1"=="login" (
  start "" "%CHROME%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --start-maximized "%URL%"
  echo Sign in, then CLOSE this Chrome window and run start-chrome.bat without "login".
  exit /b 0
)

powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:9222/json/version -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo Chrome is already running on port 9222.
  exit /b 0
)

rem A Chrome left running on this profile without the debugging port (for example the sign-in window, still
rem running in the background) would take over this launch, so close it first.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name=''chrome.exe''' | Where-Object { $_.CommandLine -like ('*' + $env:PROFILE + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul

if /I "%~1"=="hidden" (
  start "" "%CHROME%" %COMMON% --window-position=-32000,-32000 --window-size=1600,1000 "%URL%"
) else if /I "%~1"=="headless" (
  start "" "%CHROME%" %COMMON% --headless=new --window-size=1600,1000 "%URL%"
) else (
  start "" "%CHROME%" %COMMON% --start-maximized "%URL%"
)

echo Chrome started on port 9222 with profile "%PROFILE%".
