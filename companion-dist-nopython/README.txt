==================================================================
 CyberOS // HUD  -  Real Metrics Companion  (no-Python edition)
==================================================================

The CyberOS HUD wallpaper works on its own with realistic SIMULATED system
stats. This companion lets it show your REAL CPU / RAM / GPU / disk / network
instead. It is completely optional.

This edition is fully self-contained - you do NOT need Python installed.
(If you already have Python and prefer the tiny script version, grab the other
download instead. Both do exactly the same thing.)

Wallpaper Engine runs wallpapers in a sandbox that is not allowed to launch
programs, so this companion has to be installed once, separately. After that it
starts automatically every time you log in - you never touch it again.

------------------------------------------------------------------
 INSTALL  (about 15 seconds)
------------------------------------------------------------------
1. Keep this whole folder together (the "CyberOS-HUD-Companion" subfolder must
   stay next to Install.bat).
2. Double-click  Install.bat
3. If Windows shows a blue "Windows protected your PC" box, click
   "More info"  ->  "Run anyway".
4. If your antivirus flags CyberOS-HUD-Companion.exe, that's a common false
   positive for small bundled Python apps - allow it, then run Install.bat
   again. (Don't want to deal with that? Use the Python-script edition, which
   AV never flags.)
5. When it says SUCCESS, open the wallpaper's properties in Wallpaper Engine
   and make sure "Real metrics" is ON. The tag at the bottom-left flips from
   SIMULATED to REAL within a second.

That's it. It auto-starts at every login from now on.

------------------------------------------------------------------
 REMOVE
------------------------------------------------------------------
Double-click  Uninstall.bat.

------------------------------------------------------------------
 WHERE THINGS GO
------------------------------------------------------------------
- Companion:   %LOCALAPPDATA%\CyberOS-HUD\CyberOS-HUD-Companion.exe
- Auto-start:  a shortcut in your Startup folder (shell:startup)
- No admin rights, no scheduled task, nothing in Program Files.

------------------------------------------------------------------
 PRIVACY & SECURITY
------------------------------------------------------------------
The companion serves read-only stats on http://127.0.0.1:8377 - localhost
ONLY. It is not reachable from your network or the internet, opens no firewall
ports, and sends nothing anywhere. The wallpaper (running on your own PC) reads
that local address. That's the whole story.

------------------------------------------------------------------
 NOTES
------------------------------------------------------------------
- Windows only.
- Live GPU stats need an NVIDIA card; AMD/Intel GPUs fall back to a simulated
  GPU readout. Everything else (CPU/RAM/disk/network/drives) is real on any PC.
- CPU temperature isn't exposed by Windows to this kind of tool, so it's
  estimated from load. Everything else is measured directly.
- Footprint is tiny: well under 1% of CPU and about 40 MB RAM.
