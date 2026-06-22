@echo off
REM CyberOS HUD - Metrics Companion (no-Python edition) : uninstaller
title CyberOS HUD Companion - Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-exe.ps1" -Uninstall
echo.
pause
