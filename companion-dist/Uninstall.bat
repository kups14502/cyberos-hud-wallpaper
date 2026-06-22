@echo off
REM CyberOS HUD - Metrics Companion : uninstaller
title CyberOS HUD Companion - Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Uninstall
echo.
pause
