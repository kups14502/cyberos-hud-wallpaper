<#
  CyberOS HUD - Metrics Companion (standalone .exe edition) installer
  -------------------------------------------------------------------
  No Python required - this build is fully self-contained. Installs to
  %LOCALAPPDATA%\CyberOS-HUD, auto-starts at login via a Startup-folder
  shortcut (NO admin), and launches it now. Re-running is safe.
  Run with -Uninstall to remove everything.
#>
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$AppName   = 'CyberOS-HUD'
$Dest      = Join-Path $env:LOCALAPPDATA $AppName
$ExeName   = 'CyberOS-HUD-Companion.exe'
$Exe       = Join-Path $Dest $ExeName
$Startup   = [Environment]::GetFolderPath('Startup')
$Shortcut  = Join-Path $Startup 'CyberOS HUD Companion.lnk'
$Port      = 8377

function Stop-Companion {
    # Stop both editions: the frozen exe AND any script-based copy, so switching
    # editions or re-installing never leaves two copies fighting over the port.
    Get-CimInstance Win32_Process -Filter "Name='$ExeName'" -ErrorAction SilentlyContinue |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
    Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*metrics_server.py*' } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
}

# ---------------------------------------------------------------- uninstall ---
if ($Uninstall) {
    Write-Host '== Removing CyberOS HUD companion =='
    Stop-Companion
    Start-Sleep -Milliseconds 600
    if (Test-Path $Shortcut) { Remove-Item $Shortcut -Force; Write-Host 'Removed auto-start shortcut.' }
    if (Test-Path $Dest)     { Remove-Item $Dest -Recurse -Force; Write-Host 'Removed installed files.' }
    Write-Host 'Done. The wallpaper will simply fall back to SIMULATED metrics.'
    return
}

# ----------------------------------------------------------------- install ---
Write-Host '== CyberOS HUD - Metrics Companion (no-Python edition) =='
Write-Host ''

# The build folder must sit next to this script.
$srcFolder = Join-Path $PSScriptRoot $AppName
$srcExe    = Join-Path $srcFolder $ExeName
if (-not (Test-Path $srcExe)) {
    Write-Host "ERROR: $ExeName was not found in the '$AppName' folder next to this installer." -ForegroundColor Red
    Write-Host 'Keep all the files/folders from the zip together and try again.'
    return
}

# Stop any running copy, then replace the install folder cleanly.
Stop-Companion
Start-Sleep -Milliseconds 600
if (Test-Path $Dest) {
    try { Remove-Item $Dest -Recurse -Force } catch {
        Write-Host 'NOTE: could not fully clear the old install (a file may be in use).' -ForegroundColor Yellow
    }
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
# Copy the contents of the build folder INTO $Dest (exe + _internal alongside).
Copy-Item (Join-Path $srcFolder '*') $Dest -Recurse -Force
Write-Host "Installed to: $Dest"

# Auto-start at login: a Startup-folder shortcut (no admin, no scheduled task).
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($Shortcut)
$lnk.TargetPath       = $Exe
$lnk.WorkingDirectory = $Dest
$lnk.WindowStyle      = 7
$lnk.Description       = 'CyberOS HUD metrics companion'
$lnk.Save()
Write-Host "Auto-start shortcut created: $Shortcut"

# Launch it now.
Start-Process -FilePath $Exe -WorkingDirectory $Dest

Write-Host ''
Write-Host 'Starting the companion (first launch probes your hardware)...'
$ok = $false
foreach ($i in 1..20) {
    Start-Sleep -Seconds 2
    try {
        if ((Invoke-WebRequest "http://127.0.0.1:$Port/metrics" -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200) {
            $ok = $true; break
        }
    } catch {}
}

Write-Host ''
if ($ok) {
    Write-Host 'SUCCESS - the companion is running and will start automatically at every login.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'In Wallpaper Engine, open the wallpaper''s properties and make sure'
    Write-Host '"Real metrics" is ON. The tag at the bottom-left will switch from'
    Write-Host 'SIMULATED to REAL within a second.'
} else {
    Write-Host 'Installed and auto-start is set, but it has not responded yet.' -ForegroundColor Yellow
    Write-Host 'Give it a few more seconds, then check the wallpaper. If your antivirus'
    Write-Host 'flagged it, allow "CyberOS-HUD-Companion.exe" and run Install.bat again.'
}
Write-Host ''
Write-Host 'To remove it later: run Uninstall.bat.'
