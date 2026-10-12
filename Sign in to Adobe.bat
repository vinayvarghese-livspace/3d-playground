@echo off
title 3D Playground - Adobe sign-in
cd /d "%~dp0firefly-upscaler"
call start-chrome.bat login >nul
echo.
echo  A Chrome window opened on Adobe Firefly.
echo  Sign in with your Adobe account, then close that Chrome window.
echo.
pause
