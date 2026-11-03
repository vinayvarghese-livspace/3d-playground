@echo off
rem Starts the bridge (healing port 5175 if needed) and opens Preview.
cd /d "%~dp0"
if not exist "%~dp0firefly-upscaler\answerly.js" (
  echo answerly.js missing — run Setup.bat from the latest zip, or Repair Upscaler.bat after updating.
  pause
  exit /b 1
)
start "3D Playground upscaler" "%~dp0firefly-upscaler\start-service.bat"

set "PAGE=https://vinayvarghese-livspace.github.io/3d-playground/preview.html"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (start "" "%CHROME%" "%PAGE%") else (start "" "%PAGE%")
