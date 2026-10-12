@echo off
rem Lets the 3D Playground page start the upscaler through playground3d:// links. Current user only, no admin needed.
set "SVC=%~dp0start-service.bat"
set "KEY=HKCU\Software\Classes\playground3d"

reg add "%KEY%" /ve /d "URL:3D Playground upscaler" /f >nul
reg add "%KEY%" /v "URL Protocol" /d "" /f >nul
reg add "%KEY%\shell\open\command" /ve /d "\"%ComSpec%\" /c start \"3D Playground upscaler\" /min \"%SVC%\"" /f >nul
if errorlevel 1 (
  echo Could not register the page's Start button.
  exit /b 1
)
echo The page's "Start upscaler" button is ready.
