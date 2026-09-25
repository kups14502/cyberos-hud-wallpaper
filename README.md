# CyberOS HUD — Wallpaper Engine Wallpaper

A self-contained cyberpunk terminal HUD wallpaper: glowing cyan-on-black terminal,
live diagnostics gauges, process list, system monitor with sparklines,
audio-reactive waveform, animated wireframe terrain, and a live clock.

Resolution-scalable (any aspect ratio), spans multi-monitor setups with a proper
per-monitor layout, fully recolorable, and runs on any machine.

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

**Your own background** — point **Background image or GIF** at any picture on
your PC, or **Background video** at a `.webm`, and the HUD draws on top of it.
Leave both empty for the built-in starfield and terrain. Animated GIFs go in the
image slot and play on their own. If you set both, the video wins.

- **How it fills the screen** — fill and crop (the default), fit it all in with
  letterboxing, stretch, or actual size centered.
- **Blur the background** — 0 to 60 px. Anything past about 15 px turns busy
  footage into a soft wash the panels sit on cleanly.
- **Dim the background** — a black veil from 0 to 95%. Defaults to 35%, which is
  enough for most photos.
- **Panel opacity** — how solid the panel backgrounds are. Raise it toward 1.0
  if the HUD still competes with a bright image.
- **Keep starfield / terrain on top** — off by default, since your background is
  normally there *instead* of the scene. Turn it on to get both.

Video is always muted. A wallpaper that makes noise is a bad wallpaper, and the
audio visualizer reads your system output, so a clip with sound would end up
driving the bars.

Two limits are worth knowing before you pick a file. Both come from Wallpaper
Engine's browser, not from this wallpaper, and both are measured rather than
guessed. When either one bites, the starfield stays and a short note appears next
to the metrics tag in the bottom-left corner, so you are never left wondering.

**Video has to be WebM.** The browser Wallpaper Engine embeds is built without
h264, so an `.mp4` will not decode no matter how well formed it is. VP8 and VP9
in a `.webm` container play fine. Converting is quick:

```
ffmpeg -i clip.mp4 -c:v libvpx-vp9 -crf 32 -b:v 0 -an clip.webm
```

`-an` drops the audio track, which the wallpaper would mute anyway. Raise `-crf`
for a smaller file, lower it for better quality.

**Pick the file through the properties panel.** Wallpaper Engine lets a web
wallpaper read files inside its own folder plus the exact file you picked, and
nothing else. A path typed by hand that points elsewhere on your disk will not
load, and neither will a picked file you later move or rename: just pick it again.

On a multi-monitor span the background follows the same rule as the terrain: one
copy stretched across the whole span, or one per monitor if **Give each monitor
its own terrain** is on. Note that per-monitor plus a video means one decoder per
monitor, so leave it off unless you want each screen framed separately.

A path that will not load is ignored and the procedural scene stays, so a moved
or deleted file never leaves you with a black desktop.

**Identity / readout text** — username & host (`root@unit`), OS name, host name,
uptime base (days), 24h vs 12h clock, show/hide seconds, and the
latitude / longitude / elevation shown in the location panel.

**Real metrics** — toggle to read live system stats (see below).

**Multi-monitor**: span the HUD across every monitor and choose what goes where
(see below).

**Game mode**: while a game runs fullscreen, the scene turns still and the
visualizer pauses, but the stats stay live (see below).

---

## Multi-monitor setups

Wallpaper Engine gives a **spanned** wallpaper one viewport covering the bounding
box of every monitor at once. That rectangle is not a screen: it has seams down
the middle, dead space above any monitor mounted lower than its neighbor, and an
aspect ratio no layout was designed for. So instead of treating it as one giant
screen, the HUD works out where each physical monitor sits inside that rectangle
and lays itself out **per monitor**:

- every monitor gets its own corner anchors, corner brackets, terrain horizon and
  vignette;
- each monitor is scaled by **its own** short edge, so a 1440p panel beside a 4K
  one shows the HUD at the same apparent size instead of the same pixel size;
- portrait monitors, mismatched resolutions, and vertical offsets all work.

**Setting it up**

1. In Wallpaper Engine, select all the monitors you want covered and choose the
   span/stretch option, so one wallpaper covers them.
2. Nothing else is needed if the **companion app** is running: it reports your
   real desktop geometry and the HUD picks it up within a second.
3. Without the companion, fill in **Monitors** in the properties panel. One entry
   per monitor, `WIDTHxHEIGHT@X,Y`, separated by semicolons, with `*` on the
   primary. X,Y is that monitor's top-left corner from Windows
   **Settings → System → Display** (it can be negative):

   ```
   2560x1440@-2560,419; 3840x2160@0,0*; 1440x2560@3840,0
   ```

   Shortcuts: `3` means three equal columns, and `1920x1080, 1920x1080, 1920x1080`
   lays identical monitors out left to right.

**Choosing what appears where**

Monitors are numbered left to right, so **monitor 1 is the one on your left**.
Under **PANEL PLACEMENT** each panel gets a monitor and a position (nine anchors:
the four corners, the four edge centers, and the middle). Left on *Auto* they use
the default spread: identity and clock on the primary, the system monitor on the
monitor to its left, processes and tailnet on the monitor to its right. Panels
sharing a monitor and anchor stack neatly, so nothing ever overlaps.

**Dragging panels instead**

Switch on **Layout edit mode** and the wallpaper starts accepting the mouse. Each
monitor gets a dashed frame and a big number, every panel gets a label, and you
can drag panels anywhere, including from one monitor to another. Drop a panel on
an existing stack to join it: a line across the stack shows whether it lands
above or below each panel, which is also how you reorder a stack. With **SNAP ON**
a panel dropped on empty space docks to the nearest of the nine anchors; switch
snapping off to place panels freely. A click without a drag picks a panel up and
the next click puts it down. **RESET** returns everything to the defaults.
Positions are saved on that PC, so switch edit mode back off when you are done
and they stay put. (Only edit mode makes the wallpaper accept clicks; the rest of
the time every click goes straight to your desktop as usual.)

**Not spanning?** If you assign the wallpaper per monitor instead, each copy
detects which monitor it is on and shows only the panels assigned to that
monitor, so you can still spread the HUD across screens without spanning. Set
**"When not spanning, this wallpaper is on monitor"** if it cannot tell your
monitors apart (identical models).

A single-monitor desktop is unaffected by all of this and renders exactly as
before.

---

## Game mode

Wallpaper Engine normally pauses the wallpaper when a game goes fullscreen, and
that freezes the stats along with everything else. Game mode keeps the stats and
stops the rest. The flowing terrain turns into a still wireframe mountain range
and the audio visualizer parks on a flat line marked paused. Any video or GIF
background stops too. The stat panels keep updating once a second, so a second
monitor can still show your CPU and GPU load mid-game.

1. Run the **companion app**. It tells the wallpaper when the window in front
   fills its monitor.
2. In Wallpaper Engine, open **Settings → Performance** and set **Other
   application fullscreen** to **Keep running**.
3. Leave **Game mode** on its default, **When a fullscreen game runs**.

The HUD switches about two seconds after a game takes over the screen, and back
a few seconds after you leave it, so Alt+Tab and loading screens don't make it
flicker. The mode readout says `GAME MODE` while it is on. A browser or video
player in fullscreen counts too; a maximized window does not. **Always** keeps
the HUD in game mode permanently, and that setting works without the companion.

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
(bottom-left) switches from `SIMULATED` to `REAL · localhost`. If the server isn't
running it silently falls back to simulated — nothing breaks.

The server binds to `127.0.0.1:8377` (localhost only — it is not reachable from the
network) and serves CPU %, RAM %, swap %, CPU temperature, disk MB/s, network
up/down, uptime, process count, the top processes, per-drive usage and
read/write throughput, NVIDIA GPU load/temp/VRAM, your Tailscale devices, and
your machine identity (OS, hostname, kernel build, CPU model, GPU). When
connected, the terminal's neofetch block shows your real system instead of the
fictional CyberOS one.

### Show another machine's stats (like a server)

The wallpaper can display metrics from a **different machine** running the
companion — a home server, NAS, or lab box. Linux works: drives, processes,
temperatures, and clocks are all real (GPU rows need an NVIDIA card; the RAM
speed hides if the OS won't expose it).

1. On the other machine, run the companion bound to a reachable address:
   ```
   python3 metrics_server.py --host 0.0.0.0
   ```
   (or bind a specific LAN / VPN / Tailscale IP instead of `0.0.0.0`; only
   `psutil` is required: `pip install psutil`.)
2. In the wallpaper's Properties, set **Remote metrics host** to that machine's
   hostname or IP — `myserver`, `192.168.1.50:8377`, or a Tailscale name all
   work. Leave it **blank** to go back to this PC's companion.

The mode tag switches to `REAL · <host>` and the whole HUD (identity block,
gauges, monitor, process list, drives, uptime) mirrors the remote machine.

> Exposure note: the companion serves **read-only** stats, but once it binds a
> non-loopback address, anything that can reach that port can read them (OS,
> hostname, process names, and so on). Prefer a Tailscale/VPN address or
> firewall the port to your own machines.

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
- **Resolution** scales automatically, from 720p up through 4K, ultrawide and
  portrait. On a single monitor the whole interface tracks the short edge; across a
  span, each monitor is scaled by its own short edge instead.
- **Ultrawide** monitors keep the HUD in a centered band capped at 2:1 rather than
  flinging the corner stacks to the far physical corners of a 32:9 panel.
- **Monitor geometry** can only be measured exactly by the companion app. Without
  it the wallpaper falls back to a guess for identical side-by-side monitors, and
  otherwise treats the span as one wide screen until you fill in the **Monitors**
  property by hand.
- **Dragged panel positions** are stored in the browser storage of that PC's
  Wallpaper Engine, not in the wallpaper, so they do not travel with the Workshop
  item and are not shared between machines.
- **Mouse input** is only accepted while **Layout edit mode** is on. At all other
  times the wallpaper is transparent to the mouse and cannot swallow a click meant
  for your desktop.
- **Background blur** runs on a downscaled copy that CSS then scales back up, so
  the render surface it costs stays small no matter how wide your span is. For a
  still image the blur is rasterized once, so the radius you pick has no effect
  on frame rate. Video repaints, so its blur is redone per frame; the downscale
  is floored higher for video to keep that cost bounded.

---

## Files

```
index.html          the wallpaper (everything is in here)
project.json        Wallpaper Engine manifest + property definitions
metrics_server.py   optional real-metrics server (psutil)
preview.jpg         Wallpaper Engine thumbnail
README.md           this file
```
