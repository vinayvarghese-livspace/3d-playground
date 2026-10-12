@echo off
rem Starts the AI upscaler in its own window and opens the 3D Playground page in Chrome.
cd /d "%~dp0"
start "3D Playground upscaler - keep open" cmd /k call "firefly-upscaler\start-service.bat"

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "%~dp0index.html"
) else (
  start "" "%~dp0index.html"
)
