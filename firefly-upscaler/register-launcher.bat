@echo off
rem Registers playground3d:// for the page Start / Connect buttons.
rem   playground3d://answerly → Answerly-only bridge (no Firefly)
rem   playground3d://start    → full Firefly upscaler (+ Answerly)
set "DIR=%~dp0"
set "LAUNCH=%DIR%launch-playground3d.bat"
set "KEY=HKCU\Software\Classes\playground3d"

reg add "%KEY%" /ve /d "URL:3D Playground" /f >nul
reg add "%KEY%" /v "URL Protocol" /d "" /f >nul
reg add "%KEY%\shell\open\command" /ve /d "\"%ComSpec%\" /c \"\"%LAUNCH%\" \"%%1\"\"" /f >nul
if errorlevel 1 (
  echo Could not register playground3d://
  exit /b 1
)
echo playground3d:// registered (answerly + upscale).
