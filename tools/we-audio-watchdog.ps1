<#
.SYNOPSIS
  Keeps Wallpaper Engine's audio-reactive capture alive when the Windows default
  output device changes.

.DESCRIPTION
  Wallpaper Engine captures desktop audio by loopback from whatever endpoint is
  the Windows default (its "Audio recording device" setting is "default"). When
  that endpoint changes (headset connects, dongle sleeps, you flip output in the
  volume flyout), WE's capture can keep reading the old endpoint and hand the
  wallpaper all-zero frames forever. The wallpaper then has no signal to draw:
  in CyberOS HUD v0.2.4+ the visualizer falls back to its idle waveform, which
  looks exactly like "audio reactivity is broken".

  This script polls the default render endpoint and, when it changes, re-inits
  WE so capture reattaches to the new device.

  Remediation modes:
    Hard (default) restart wallpaper64.exe, then close+reopen the wallpaper on
          monitor 0. This is the sequence verified to restore live samples. It
          also clears WE's duplicate-CEF-view bug, where two views stack in the
          desktop wallpaper window and the top one gets no properties and no
          audio callbacks. Costs a ~10s wallpaper blink.
    Soft  pause then play via the WE control CLI. No blink, but whether it
          actually reattaches capture is UNVERIFIED. Try it; if the visualizer
          stays dead after a switch, use Hard.

.EXAMPLE
  # see what it detects, change nothing
  .\we-audio-watchdog.ps1 -Once -DryRun

.EXAMPLE
  # repair right now, without starting the watchdog
  .\we-audio-watchdog.ps1 -Fix

.EXAMPLE
  # run in the foreground, remediate on device change
  .\we-audio-watchdog.ps1

.EXAMPLE
  # install as a logon task, then start it now
  .\we-audio-watchdog.ps1 -Install
  Start-ScheduledTask -TaskName "CyberOS HUD - WE audio watchdog"

.NOTES
  PowerShell 5.1. No admin rights needed for -Install (task runs as the
  logged-on user, not elevated).
#>
[CmdletBinding()]
param(
  [ValidateSet('Hard', 'Soft')]
  [string]$Mode = 'Hard',

  [int]$IntervalSeconds = 5,

  # ignore further device changes for this long after remediating, so a burst of
  # endpoint churn (BT connect often fires several) causes one fix, not five
  [int]$DebounceSeconds = 25,

  [string]$WallpaperPath = "C:\Program Files (x86)\Steam\steamapps\workshop\content\431960\3742359990\index.html",
  [string]$WeDir = "C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine",
  [string]$LogPath = "$env:LOCALAPPDATA\CyberOS-HUD\we-audio-watchdog.log",

  [switch]$Once,
  [switch]$Fix,
  [switch]$DryRun,
  [switch]$Install,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'CyberOS HUD - WE audio watchdog'

# ---------------------------------------------------------------- CoreAudio ---
$interop = @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr act, [MarshalAs(UnmanagedType.IUnknown)] out object i);
  int OpenPropertyStore(int access, out IPropertyStore store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetState(out int state);
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  int GetCount(out int c);
  int GetAt(int i, out PROPERTYKEY k);
  int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation { int GetPeakValue(out float peak); }

[StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] struct PROPVARIANT {
  [FieldOffset(0)] public short vt;
  [FieldOffset(8)] public IntPtr p;
}

public class WeAudio {
  // role: 0 eConsole, 1 eMultimedia, 2 eCommunications. WE follows the
  // multimedia/console default, which are normally the same endpoint.
  const int RENDER = 0;

  static IMMDevice DefaultDevice(int role) {
    var e = (IMMDeviceEnumerator)(new MMDeviceEnumerator() as object);
    IMMDevice d;
    if (e.GetDefaultAudioEndpoint(RENDER, role, out d) != 0) return null;
    return d;
  }

  static string Name(IMMDevice d) {
    IPropertyStore ps;
    d.OpenPropertyStore(0, out ps);
    var k = new PROPERTYKEY();
    k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");   // PKEY_Device_FriendlyName
    k.pid = 14;
    PROPVARIANT v;
    ps.GetValue(ref k, out v);
    return Marshal.PtrToStringUni(v.p);
  }

  // "id|friendly name|current peak", or null when there is no default endpoint
  public static string DefaultInfo(int role) {
    IMMDevice d = DefaultDevice(role);
    if (d == null) return null;
    string id;
    d.GetId(out id);
    float peak = 0;
    object o;
    var iid = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
    if (d.Activate(ref iid, 23, IntPtr.Zero, out o) == 0) {
      ((IAudioMeterInformation)o).GetPeakValue(out peak);
    }
    return id + "|" + Name(d) + "|" + peak.ToString("F5");
  }
}
'@

if (-not ('WeAudio' -as [type])) {
  Add-Type -TypeDefinition $interop -Language CSharp
}

# ------------------------------------------------------------------ helpers ---
function Write-Log {
  param([string]$Message)
  $dir = Split-Path -Parent $LogPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $LogPath -Value $line
  Write-Output $line
}

function Get-DefaultEndpoint {
  $raw = [WeAudio]::DefaultInfo(1)
  if (-not $raw) { return $null }
  $p = $raw -split '\|'
  return [PSCustomObject]@{ Id = $p[0]; Name = $p[1]; Peak = [double]$p[2] }
}

function Test-WeRunning {
  return [bool](Get-Process -Name wallpaper64 -ErrorAction SilentlyContinue)
}

function Invoke-SoftFix {
  $cli = Join-Path $WeDir 'wallpaper32.exe'
  & $cli -control pause
  Start-Sleep -Seconds 1
  & $cli -control play
  Write-Log "soft fix: pause/play issued"
}

function Invoke-HardFix {
  $cli = Join-Path $WeDir 'wallpaper32.exe'
  $exe = Join-Path $WeDir 'wallpaper64.exe'

  Stop-Process -Name wallpaper64 -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Start-Process -FilePath $exe
  Start-Sleep -Seconds 14

  # WE does not always restore the wallpaper itself after being killed, and a
  # plain auto-restore is what produces the duplicate stacked view. Closing then
  # opening on monitor 0 yields exactly one view, with saved properties applied
  # and the other monitors picked up as clone mirrors.
  & $cli -control closeWallpaper -monitor 0
  Start-Sleep -Seconds 3
  & $cli -control openWallpaper -file $WallpaperPath -monitor 0
  Start-Sleep -Seconds 8
  Write-Log "hard fix: WE restarted and wallpaper reapplied on monitor 0"
}

function Invoke-Fix {
  if ($DryRun) { Write-Log "DRYRUN: would apply $Mode fix"; return }
  if (-not (Test-WeRunning)) { Write-Log "WE not running, skipping fix"; return }
  if ($Mode -eq 'Soft') { Invoke-SoftFix } else { Invoke-HardFix }
}

function Install-Task {
  $script = $PSCommandPath
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Mode {1}' -f $script, $Mode)
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $trigger.Delay = 'PT1M'   # let WE and Steam settle first
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description 'Reattaches WE audio capture when the default output device changes.' -Force | Out-Null
  Write-Log "installed scheduled task '$TaskName' (mode $Mode, 1 minute logon delay)"
}

function Uninstall-Task {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Log "removed scheduled task '$TaskName'"
}

# --------------------------------------------------------------------- main ---
if ($Install) { Install-Task; return }
if ($Uninstall) { Uninstall-Task; return }
if ($Fix) { Invoke-Fix; return }   # one-shot repair, no polling

$current = Get-DefaultEndpoint
if ($current) {
  Write-Log ("watchdog start: mode={0} interval={1}s default='{2}'" -f $Mode, $IntervalSeconds, $current.Name)
} else {
  Write-Log "watchdog start: no default render endpoint present"
}

$lastId = $null
if ($current) { $lastId = $current.Id }
$lastFix = (Get-Date).AddSeconds(-$DebounceSeconds)

if ($Once) {
  if ($current) { Write-Log ("current default: '{0}' peak={1:F5}" -f $current.Name, $current.Peak) }
  return
}

while ($true) {
  Start-Sleep -Seconds $IntervalSeconds
  try {
    $now = Get-DefaultEndpoint
    if (-not $now) { continue }

    if ($now.Id -ne $lastId) {
      Write-Log ("default output changed to '{0}'" -f $now.Name)
      $lastId = $now.Id
      $sinceFix = ((Get-Date) - $lastFix).TotalSeconds
      if ($sinceFix -lt $DebounceSeconds) {
        Write-Log ("debounced, {0:F0}s since last fix" -f $sinceFix)
      } else {
        Invoke-Fix
        $lastFix = Get-Date
      }
    }
  } catch {
    Write-Log ("error: {0}" -f $_.Exception.Message)
  }
}
