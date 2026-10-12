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

if /I "%~1"=="hidden" (
  start "" "%CHROME%" %COMMON% --window-position=-32000,-32000 --window-size=1600,1000 "%URL%"
) else if /I "%~1"=="headless" (
  start "" "%CHROME%" %COMMON% --headless=new --window-size=1600,1000 "%URL%"
) else (
  start "" "%CHROME%" %COMMON% --start-maximized "%URL%"
)

echo Chrome started on port 9222 with profile "%PROFILE%".
