@echo off
REM CyberOS HUD - Metrics Companion : one-click installer (no admin needed)
title CyberOS HUD Companion - Install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
pause
