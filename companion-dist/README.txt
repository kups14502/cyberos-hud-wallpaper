============================================================
 CyberOS // HUD  -  Real Metrics Companion  (optional add-on)
============================================================

The CyberOS HUD wallpaper works on its own with realistic SIMULATED system
stats. This little companion lets it show your REAL CPU / RAM / GPU / disk /
network instead. It is completely optional.

Wallpaper Engine runs wallpapers in a sandbox that is not allowed to launch
programs, so this companion has to be installed once, separately. After that it
starts automatically every time you log in - you never touch it again.

------------------------------------------------------------
 INSTALL  (about 30 seconds)
------------------------------------------------------------
1. Double-click  Install.bat
2. If Windows shows a blue "Windows protected your PC" box, click
   "More info"  ->  "Run anyway". (It's a plain text script - you can open
   Install.bat and setup.ps1 in Notepad to read exactly what they do.)
3. If you don't have Python, the installer offers to install it for you
   (or get it from https://www.python.org/downloads and run Install.bat again).
4. When it says SUCCESS, open the wallpaper's properties in Wallpaper Engine
   and make sure "Real metrics" is ON. The tag at the bottom-left flips from
   SIMULATED to REAL within a second.

That's it. It will auto-start at every login from now on.

------------------------------------------------------------
 REMOVE
------------------------------------------------------------
Double-click  Uninstall.bat  (stops it, removes the auto-start entry and the
installed files; leaves Python alone).

------------------------------------------------------------
 WHERE THINGS GO
------------------------------------------------------------
- Companion script:  %LOCALAPPDATA%\CyberOS-HUD\metrics_server.py
- Auto-start:        a shortcut in your Startup folder (shell:startup)
- No admin rights, no scheduled task, nothing in Program Files.

------------------------------------------------------------
 PRIVACY & SECURITY
------------------------------------------------------------
The companion serves read-only stats on http://127.0.0.1:8377 - localhost
ONLY. It is not reachable from your network or the internet, opens no firewall
ports, and sends nothing anywhere. The wallpaper (running on your own PC) reads
that local address. That's the whole story.

------------------------------------------------------------
 NOTES
------------------------------------------------------------
- Needs Windows + Python 3 (the installer handles Python and the one
  dependency, psutil).
- Live GPU stats need an NVIDIA card; AMD/Intel GPUs fall back to a simulated
  GPU readout. Everything else (CPU/RAM/disk/network/drives) is real on any PC.
- CPU temperature isn't exposed by Windows to this kind of tool, so it's
  estimated from load. Everything else is measured directly.
- Footprint is tiny: well under 1% of CPU and about 40 MB RAM, with no
  background processes spawned while it runs.
