@echo off
setlocal
rem Dispatches playground3d:// links from the hosted page.
set "URL=%~1"
cd /d "%~dp0"
echo %URL% | find /I "answerly" >nul
if not errorlevel 1 (
  start "Answerly bridge" "%~dp0start-answerly.bat"
  exit /b 0
)
start "3D Playground upscaler" "%~dp0start-service.bat"
exit /b 0
