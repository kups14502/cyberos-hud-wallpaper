@echo off
REM CyberOS HUD - Metrics Companion (no-Python edition) : one-click installer
title CyberOS HUD Companion - Install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-exe.ps1"
echo.
pause
