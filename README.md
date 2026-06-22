# CyberOS HUD — Wallpaper Engine Wallpaper

A self-contained cyberpunk terminal HUD wallpaper: glowing cyan-on-black terminal,
live diagnostics gauges, process list, system monitor with sparklines, syntax-lit
code window, audio-reactive waveform, animated wireframe terrain, and a live clock.

Resolution-scalable (any aspect ratio), fully recolorable, and runs on any machine.

---

## Install

1. Open **Wallpaper Engine** → **Create Wallpaper**.
2. Choose **Files** and select the `index.html` in this folder (or just drag this
   whole folder onto the Wallpaper Engine window).
3. Give it a name, save, and apply. That's it.

The wallpaper is one HTML file with no external dependencies — nothing to download,
no internet required.

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
process list, system monitor, code window, audio visualizer, time/location.

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
stats on its own. To show **real** numbers, run the tiny companion server included in
this folder:

1. Install Python 3 and the one dependency:
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

## Publishing to the Steam Workshop

When you publish this from Wallpaper Engine, the `.html`, `project.json` and
`preview.jpg` go up as the wallpaper. **The companion (`metrics_server.py`) is not
part of the wallpaper and cannot be auto-run from the Workshop** — a Workshop
wallpaper has no permission to launch programs. The wallpaper still works fully on
its own (simulated metrics); real metrics are an opt-in extra the user sets up
locally.

So in the Workshop **description**, tell users that real metrics are optional and
where to get the companion. Paste-ready text:

> **CyberOS HUD** — a cyberpunk terminal dashboard: live clock, diagnostics
> gauges, process list, system monitor, audio-reactive waveform and an animated
> wireframe terrain. Fully recolorable from a single accent color, scales to any
> resolution, and runs on any machine with zero setup.
>
> **Optional real metrics:** by default the gauges show realistic *simulated*
> system stats. To display your *actual* CPU / RAM / GPU / disk / network,
> download the small companion add-on from [your GitHub/download link],
> double-click **Install.bat**, then enable "Real metrics" in Properties. The
> wallpaper auto-detects it within a second and falls back to simulation if it
> isn't running. The companion binds to localhost only and serves read-only stats.
>
> The installer needs no admin rights, sets the companion to auto-start at login,
> and offers to install Python for you if it's missing. Remove it any time with
> Uninstall.bat.

Because the Workshop won't host the companion files, distribute them separately
as a GitHub release / zip and link it from the description above. Two ready-made
download packages are built in this folder — ship whichever you like (or both):

- **`CyberOS-HUD-Companion.zip`** (~14 KB) — the Python-script edition. Tiny, no
  antivirus issues; the installer finds or offers to install Python + psutil.
  Source folder: `companion-dist/`.
- **`CyberOS-HUD-Companion-NoPython.zip`** (~9 MB) — a fully self-contained
  `.exe` build (PyInstaller); the user needs nothing installed. May trip an
  antivirus false-positive on some machines. Source folder:
  `companion-dist-nopython/`.

Both installers are **no-admin**: they copy the companion to
`%LOCALAPPDATA%\CyberOS-HUD` and auto-start it at login via a Startup-folder
shortcut. Each `Install.bat` is double-click-and-done; `Uninstall.bat` reverses
it. Recommended: offer the no-Python edition as the default download for most
people, and link the script edition for users who already have Python.

### Rebuilding the `.exe` (only if you change `metrics_server.py`)

```powershell
pip install --user pyinstaller
pyinstaller --noconfirm --clean --onedir --windowed --name "CyberOS-HUD-Companion" --hidden-import psutil metrics_server.py
# then copy dist\CyberOS-HUD-Companion\ into companion-dist-nopython\ and re-zip.
```

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
