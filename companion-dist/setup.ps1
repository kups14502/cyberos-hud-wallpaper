<#
  CyberOS HUD - Metrics Companion installer / uninstaller
  --------------------------------------------------------
  Installs the companion to %LOCALAPPDATA%\CyberOS-HUD, makes it auto-start at
  login via a Startup-folder shortcut (NO admin required), and launches it now.
  Re-running is safe (idempotent). Run with -Uninstall to remove everything.

  Invoked by Install.bat / Uninstall.bat so the user never has to touch
  PowerShell or its execution policy directly.
#>
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$AppName  = 'CyberOS-HUD'
$Dest     = Join-Path $env:LOCALAPPDATA $AppName
$Script   = Join-Path $Dest 'metrics_server.py'
$Startup  = [Environment]::GetFolderPath('Startup')
$Shortcut = Join-Path $Startup 'CyberOS HUD Companion.lnk'
$Port     = 8377

function Stop-Companion {
    # Stop the script copy AND the standalone-exe edition, so switching editions
    # or re-installing never leaves two copies fighting over the port.
    Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*metrics_server.py*' } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
    Get-CimInstance Win32_Process -Filter "Name='CyberOS-HUD-Companion.exe'" -ErrorAction SilentlyContinue |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
}

# ---------------------------------------------------------------- uninstall ---
if ($Uninstall) {
    Write-Host '== Removing CyberOS HUD companion =='
    Stop-Companion
    if (Test-Path $Shortcut) { Remove-Item $Shortcut -Force; Write-Host 'Removed auto-start shortcut.' }
    if (Test-Path $Dest)     { Remove-Item $Dest -Recurse -Force; Write-Host 'Removed installed files.' }
    Write-Host 'Done. The wallpaper will simply fall back to SIMULATED metrics.'
    Write-Host '(Python and psutil were left installed.)'
    return
}

# ----------------------------------------------------------------- install ---
Write-Host '== CyberOS HUD - Metrics Companion installer =='
Write-Host ''

# Sanity: metrics_server.py must sit next to this script.
$srcScript = Join-Path $PSScriptRoot 'metrics_server.py'
if (-not (Test-Path $srcScript)) {
    Write-Host 'ERROR: metrics_server.py was not found next to this installer.' -ForegroundColor Red
    Write-Host 'Keep all the files from the zip together in one folder and try again.'
    return
}

# 1) Find Python 3 (prefer the "py" launcher); offer winget if it is missing.
function Resolve-Python {
    foreach ($cmd in 'py', 'python') {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { continue }
        try {
            $exe = if ($cmd -eq 'py') { & $cmd -3 -c 'import sys;print(sys.executable)' 2>$null }
                   else               { & $cmd    -c 'import sys;print(sys.executable)' 2>$null }
            if ($LASTEXITCODE -eq 0 -and $exe) {
                $exe = $exe.Trim()
                if ($exe -and (Test-Path $exe)) { return $exe }
            }
        } catch {}
    }
    return $null
}

$py = Resolve-Python
if (-not $py) {
    Write-Host 'Python 3 was not found on this PC.' -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $ans = Read-Host 'Install Python 3.12 now via winget (no admin)? [Y/N]'
        if ($ans -match '^(y|yes)$') {
            try {
                winget install -e --id Python.Python.3.12 --scope user `
                    --accept-source-agreements --accept-package-agreements
            } catch {}
            Write-Host ''
            Write-Host 'Python was installed. CLOSE this window, then run Install.bat again' -ForegroundColor Cyan
            Write-Host '(so Windows picks up the new PATH). Sorry for the extra step!'
            return
        }
    }
    Write-Host 'Please install Python 3 from https://www.python.org/downloads/'
    Write-Host '(tick "Add python.exe to PATH" in the installer), then run Install.bat again.'
    return
}
Write-Host "Found Python: $py"

# Prefer the windowless launcher pyw.exe (version-independent path); else
# pythonw.exe next to the interpreter; else the console interpreter.
$pyw = Get-Command pyw -ErrorAction SilentlyContinue
if ($pyw) {
    $launchExe  = $pyw.Source
    $launchArgs = @('-3', ('"' + $Script + '"'))
} else {
    $pythonw = Join-Path (Split-Path $py) 'pythonw.exe'
    if (-not (Test-Path $pythonw)) { $pythonw = $py }
    $launchExe  = $pythonw
    $launchArgs = @(('"' + $Script + '"'))
}

# 2) Ensure psutil (per-user; a Startup shortcut runs in a normal interactive
#    environment, so user site-packages are importable).
Write-Host 'Installing/updating psutil (the only dependency)...'
& $py -m pip install --user --upgrade --quiet psutil
if ($LASTEXITCODE -ne 0) {
    Write-Host 'WARNING: psutil did not install cleanly. Trying once more without --user...' -ForegroundColor Yellow
    & $py -m pip install --upgrade --quiet psutil
}

# 3) Copy the companion into place.
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item $srcScript $Script -Force
Write-Host "Installed to: $Script"

# 4) Auto-start at login: a Startup-folder shortcut (no admin, no scheduled task).
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($Shortcut)
$lnk.TargetPath       = $launchExe
$lnk.Arguments        = ($launchArgs -join ' ')
$lnk.WorkingDirectory = $Dest
$lnk.WindowStyle      = 7
$lnk.Description       = 'CyberOS HUD metrics companion'
$lnk.Save()
Write-Host "Auto-start shortcut created: $Shortcut"

# 5) (Re)launch it now.
Stop-Companion
Start-Process -FilePath $launchExe -ArgumentList $launchArgs -WorkingDirectory $Dest

# 6) Confirm it is serving (it probes hardware once at startup, ~a few seconds).
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
    Write-Host 'It may still be starting - give it a few more seconds, then check the wallpaper.'
}
Write-Host ''
Write-Host 'To remove it later: run Uninstall.bat.'
