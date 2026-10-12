@echo off
rem Starts the AI upscaler (minimised) and opens 3D Playground in Chrome.
cd /d "%~dp0"
start "3D Playground upscaler" /min "%~dp0firefly-upscaler\start-service.bat"

set "PAGE=https://vinayvarghese-livspace.github.io/3d-playground/"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (start "" "%CHROME%" "%PAGE%") else (start "" "%PAGE%")
