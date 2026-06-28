# CyberOS HUD — Wallpaper Engine Wallpaper

A self-contained cyberpunk terminal HUD wallpaper: glowing cyan-on-black terminal,
live diagnostics gauges, process list, system monitor with sparklines,
audio-reactive waveform, animated wireframe terrain, and a live clock.

Resolution-scalable (any aspect ratio), fully recolorable, and runs on any machine.

---

## Install (Steam Workshop)

The recommended way is to subscribe on the Steam Workshop:

1. Open the wallpaper page and click **Subscribe**:
   **https://steamcommunity.com/sharedfiles/filedetails/?id=3742359990**
2. In **Wallpaper Engine**, open your **Installed** wallpapers and select **CyberOS HUD**.
3. Tune anything you like from the **Properties** panel (see Customize below).

That is all the wallpaper needs. It runs on any machine with zero setup and shows
realistic simulated metrics out of the box. There is nothing to import by hand.

> This repository holds the source and the **optional companion app** (for real
> system stats, see below). You do not need to load `index.html` yourself: just
> subscribe on the Workshop.

---

## Customize

Open the wallpaper's **Properties** panel in Wallpaper Engine. Everything below is
adjustable live, no editing required:

**Size**
- **Interface scale** — multiplies the size of every panel and font. The HUD
  auto-scales with resolution, but if text feels small on a 4K/high-DPI
  monitor, push this up.

**Color**
- **Accent color** — the master swatch. The entire palette (gauges, text, glow,
  grid, sparklines) is derived from this one color. Pick cyan, amber, magenta,
  green — anything.
- **Background color** and **Alert color** (gauges turn this color past ~85%).
- **Glow strength** and **Scanline overlay**.

**Panels** — toggle any panel on/off independently: terminal, diagnostics,
process list, system monitor, audio visualizer, time/location.

**Scene** — starfield on/off, wireframe terrain on/off, audio reactivity on/off,
metric animation speed.

**Identity / readout text** — username & host (`root@unit`), OS name, host name,
uptime base (days), 24h vs 12h clock, show/hide seconds, and the
latitude / longitude / elevation shown in the location panel.

**Real metrics** — toggle to read live system stats (see below).

---

## Metrics: simulated vs. real

By default the gauges and monitor show **physically realistic simulated** values
(smooth random-walk; every panel is driven from one shared state so CPU, RAM, swap,
temp, network, and the process list always agree). This looks alive and works on any
computer with zero setup.

A few values are **always real**, even in simulated mode: the clock, the date, your
screen resolution, your CPU core count, and (where the browser exposes it) your RAM
size and the live audio spectrum from whatever is playing.

### Want real CPU / RAM / disk / network?

Wallpaper Engine runs wallpapers in a sandboxed browser that can't read true system
stats on its own. To show **real** numbers, install the small companion app.

**Easiest (recommended):** download the latest companion from the
[Releases page](https://github.com/kups14502/cyberos-hud-wallpaper/releases), unzip
it, and double-click **Install.bat**. It needs no admin rights, sets itself to
auto-start at login, and can install Python for you if it is missing. Then turn
**Real metrics** on in the wallpaper's Properties.

**Manual (if you already have Python):**

1. Install the one dependency:
   ```
   pip install psutil
   ```
2. Run the server (keep it running in the background):
   ```
   python metrics_server.py
   ```
3. In the wallpaper's Properties, turn **Real metrics** on.

The wallpaper auto-detects the server within about a second and the mode tag
(bottom-left) switches from `SIMULATED` to `LIVE`. If the server isn't running it
silently falls back to simulated — nothing breaks.

The server binds to `127.0.0.1:8377` (localhost only — it is not reachable from the
network) and serves CPU %, RAM %, swap %, CPU temperature, disk MB/s, network
up/down, uptime, process count, the top processes, per-drive usage and
read/write throughput, NVIDIA GPU load/temp/VRAM, your Tailscale devices, and
your machine identity (OS, hostname, kernel build, CPU model, GPU). When
connected, the terminal's neofetch block shows your real system instead of the
fictional CyberOS one.

### Audio visualizer shows only a gentle idle wave?

The waveform reacts to whatever is playing **only when Wallpaper Engine feeds it
audio**. Check Wallpaper Engine → **Settings → General → Audio input** and make
sure it is set to your active playback device (e.g. "Default playback device"),
and that the wallpaper's **Audio-reactive visualizer** property is on. With no
audio feed (or during silence) it falls back to the idle wave by design.

### Auto-start the companion on login (Windows)

The recommended installer above already sets this up via a Startup-folder
shortcut, so most people can skip this section. It is here for anyone who wants a
self-healing Scheduled Task instead.

> **Why this can't live inside the wallpaper:** Wallpaper Engine runs web
> wallpapers in a sandboxed Chromium browser that is not allowed to launch
> external programs — and the same applies to anything published to the Steam
> Workshop (Valve won't let a wallpaper auto-run an executable). So the companion
> can't be started *by* the wallpaper or bundled into a Workshop item. It has to
> be started by Windows itself at login. Setup is a one-time, per-machine step.

The robust way is a **Scheduled Task** that runs the script with `pythonw` (no
console window) and relaunches it if it ever dies.

> **Copy the script to a LOCAL drive first.** Do not point the task at a network,
> removable, or cloud-synced drive (mapped network shares, OneDrive, external
> USB). Those mount *after* logon, so the at-logon launch fails with "file not
> found" and only the 5-minute retry recovers it. A folder under `%LOCALAPPDATA%`
> is ideal — always present the instant you log in.

Create it once from an admin PowerShell (adjust the paths to match your install):

```powershell
# Adjust the Python path/version to match your install (this is the default
# per-user location; it contains no username). Or run: (Get-Command pythonw).Source
$pythonw = "$env:LOCALAPPDATA\Programs\Python\Python312\pythonw.exe"
$src     = "C:\path\to\metrics_server.py"                     # where you downloaded it
$script  = "$env:LOCALAPPDATA\CyberOS-HUD\metrics_server.py"  # local runtime copy
New-Item -ItemType Directory -Force -Path (Split-Path $script) | Out-Null
Copy-Item $src $script -Force
$action  = New-ScheduledTaskAction -Execute $pythonw -Argument ('"'+$script+'"') -WorkingDirectory (Split-Path $script)
$logon   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$daily   = New-ScheduledTaskTrigger -Daily -At 12:00am
$daily.Repetition = (New-ScheduledTaskTrigger -Once -At 12:00am -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
$set     = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "CyberOS HUD Metrics" -Action $action -Trigger $daily,$logon -Settings $set
Start-ScheduledTask -TaskName "CyberOS HUD Metrics"   # start it now too
```

The repeat-every-5-minutes trigger plus `IgnoreNew` means: if it's already
running, nothing happens; if it died (reboot, sleep, crash), it's relaunched
within 5 minutes. To verify, open `http://127.0.0.1:8377/metrics` — you should see
a JSON blob. (Simpler alternative: a shortcut to the same `pythonw` + script in
`shell:startup`, but that only fires at login and won't self-heal.)

> **⚠ psutil must be importable headlessly.** A Scheduled Task / `pythonw` runs
> with a *stripped environment* that does **not** include Python's per-user
> site-packages. If `pip install psutil` put psutil in your user-site
> (`%APPDATA%\Python\...\site-packages`), the task will silently fail with
> "psutil is not installed" even though it works in a normal terminal. Test the
> task's view of things with:
> ```
> python -s -E -c "import psutil; print(psutil.__file__)"
> ```
> If that errors, install psutil into the interpreter's own site-packages:
> ```
> python -m pip install --target "<your Python>\Lib\site-packages" psutil
> ```

> **Heads-up on startup time:** the companion probes your monitors, GPU model and
> drive layout once at launch (via PowerShell), so it can take a few seconds —
> occasionally up to ~30 s on a cold boot — before it begins serving. That's
> normal: the wallpaper shows `SIMULATED` until the companion is up, then
> switches to `LIVE` on its own. Once running, the steady-state poll is fully
> native (psutil + the NVIDIA NVML library), so it spawns no per-second
> processes. Nothing to do.

---

## Notes & limits

- **RAM size** read in-browser is capped at 8 GB by the browser for privacy, so in
  simulated mode the total may read low. The companion server reports your true RAM.
- **CPU temperature** isn't available on all platforms (notably most Windows setups
  via psutil); it's simulated when the OS doesn't expose a sensor.
- **Performance** is governed by Wallpaper Engine's own **FPS** slider — drop it to
  24–30 FPS on a laptop to save battery. The terrain renderer is batched to stay
  light even at 4K.
- **Companion footprint** is minimal. The once-per-second sample uses native APIs
  only — psutil for CPU / RAM / disk / network / drives, and the NVIDIA NVML
  library for GPU — while the heavier top-process scan runs on a slower 2 s
  thread. It sits around half a percent of total CPU and ~40 MB RAM and spawns
  no subprocesses while running. (`nvidia-smi` and a one-time PowerShell query
  remain as automatic fallbacks if NVML / WMI aren't available.)
- **Resolution** scales automatically. The root font-size tracks the viewport so the
  HUD stays proportional from 720p up through 4K and ultrawide.

---

## Files

```
index.html          the wallpaper (everything is in here)
project.json        Wallpaper Engine manifest + property definitions
metrics_server.py   optional real-metrics server (psutil)
preview.jpg         Wallpaper Engine thumbnail
README.md           this file
```
