#!/usr/bin/env python3
"""
CyberOS HUD — Real Metrics Companion
====================================
Serves your *actual* system stats as JSON on http://localhost:8377/metrics
so the Wallpaper Engine wallpaper can display real CPU / RAM / disk / network
data instead of the built-in simulation.

This is OPTIONAL. If you never run it, the wallpaper falls back to realistic
simulated metrics. Run it any time and the wallpaper auto-detects it within
~1 second and switches to live data; close it and it falls back again.

Requirements:
    pip install psutil

Run:
    python metrics_server.py
    (leave the window open; minimize it. Or set it to auto-start — see README.)

Stop:
    Close the window / Ctrl+C.

Security note: it binds to 127.0.0.1 only (loopback), so it is not reachable
from other machines on your network. It serves read-only stats and nothing else.

Performance: the once-per-second sample does NOT spawn any subprocess. GPU stats
come from the NVIDIA NVML library (loaded once via ctypes), disk stats from
psutil, and only the top processes get a memory lookup. The few things that do
shell out — monitor list, GPU/CPU model, the logical→physical drive map — run
once at startup; Tailscale runs on a slow 5 s thread. This keeps steady-state
CPU to a few percent of one core. (nvidia-smi / a startup PowerShell remain as
fallbacks, so nothing is lost if NVML or WMI is unavailable.)
"""

import ctypes
import json
import os
import platform
import subprocess
import sys
import time
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# When launched with pythonw.exe (no console) — which is how it auto-starts at
# login — sys.stdout/stderr are None, so any print() raises AttributeError and
# kills the process before it ever serves. Route them to the null device so the
# server runs truly headless. Harmless when a real console is attached.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

try:
    import psutil
except ImportError:
    raise SystemExit(
        "\n[!] psutil is not installed.\n"
        "    Install it with:  pip install psutil\n"
    )

PORT = 8377
HOST = "127.0.0.1"

NCORES = psutil.cpu_count(logical=True) or 1
# boot_time never changes while we run — read it once instead of every sample.
BOOT_TIME = psutil.boot_time()
# sensors_temperatures exists only on Linux/macOS/FreeBSD; checking once avoids
# raising (and swallowing) an AttributeError on Windows every single second.
_HAS_TEMP = hasattr(psutil, "sensors_temperatures")
# Windows reports the idle task as a process with huge CPU; never show it.
IDLE_NAMES = {"system idle process", "idle"}
# Hide the subprocess console window on Windows; harmless flag elsewhere.
NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


# Reads each attached display's true current mode (dmPelsWidth/Height) via
# EnumDisplaySettings — DPI/scaling-independent, so a 4K next to a 1440p
# reports "3840x2160, 2560x1440" correctly (AllScreens.Bounds does not).
_PS_MONITORS = r'''
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DM {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public ushort dmSpecVersion; public ushort dmDriverVersion; public ushort dmSize;
    public ushort dmDriverExtra; public uint dmFields;
    public int dmPositionX; public int dmPositionY;
    public uint dmDisplayOrientation; public uint dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution;
    public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public ushort dmLogPixels; public uint dmBitsPerPel;
    public uint dmPelsWidth; public uint dmPelsHeight;
    public uint dmDisplayFlags; public uint dmDisplayFrequency;
    public uint dmICMMethod; public uint dmICMIntent; public uint dmMediaType;
    public uint dmDitherType; public uint dmReserved1; public uint dmReserved2;
    public uint dmPanningWidth; public uint dmPanningHeight;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern bool EnumDisplayDevices(string dev, uint n, ref DISPLAY_DEVICE info, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
}
"@
$i = 0
while ($true) {
  $d = New-Object DM+DISPLAY_DEVICE
  $d.cb = [Runtime.InteropServices.Marshal]::SizeOf($d)
  if (-not [DM]::EnumDisplayDevices([NullString]::Value, $i, [ref]$d, 0)) { break }
  $i++
  if (($d.StateFlags -band 1) -eq 0) { continue }   # not attached to desktop
  $dm = New-Object DM+DEVMODE
  $dm.dmSize = [uint16][Runtime.InteropServices.Marshal]::SizeOf($dm)
  if ([DM]::EnumDisplaySettings($d.DeviceName, -1, [ref]$dm)) {
    # prefix 0 = primary display (StateFlags bit 0x4), 1 = secondary, so the
    # caller can sort the primary monitor to the front. Trailing = refresh Hz.
    $p = if (($d.StateFlags -band 4) -ne 0) { "0" } else { "1" }
    "$p $($dm.dmPelsWidth)x$($dm.dmPelsHeight) $($dm.dmDisplayFrequency)"
  }
}
'''


def _monitors():
    """Each attached monitor as {'res','hz'}, primary first,
    e.g. [{'res':'3840x2160','hz':120}, {'res':'2560x1440','hz':165}]."""
    if sys.platform != "win32":
        return []
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", _PS_MONITORS],
            text=True, timeout=20, creationflags=NO_WINDOW)
        rows = []
        for ln in out.splitlines():
            parts = ln.strip().split()
            if len(parts) >= 2 and "x" in parts[1] and parts[1][0].isdigit():
                pri = parts[0]
                hz = int(parts[2]) if len(parts) >= 3 and parts[2].isdigit() else None
                rows.append((pri, {"res": parts[1], "hz": hz}))
        rows.sort(key=lambda r: r[0])      # "0" (primary) sorts ahead of "1"
        return [m for _, m in rows] or []
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Drives: usage comes from psutil every second (no subprocess). Volume labels
# and the logical→physical-disk mapping (needed to attribute live read/write
# throughput to a drive letter) almost never change, so we resolve them ONCE
# at startup with a single WMI/PowerShell call and cache the result.
# ---------------------------------------------------------------------------
_PS_DRIVE_MAP = r'''
$map = @{}
Get-CimInstance Win32_LogicalDiskToPartition -ErrorAction SilentlyContinue | ForEach-Object {
  $log = $_.Dependent.DeviceID
  if ($_.Antecedent.DeviceID -match 'Disk #(\d+)') {
    if (-not $map.ContainsKey($log)) { $map[$log] = @() }
    $map[$log] += "PhysicalDrive$($matches[1])"
  }
}
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | ForEach-Object {
  $p = if ($map.ContainsKey($_.DeviceID)) { (($map[$_.DeviceID] | Select-Object -Unique) -join ',') } else { '' }
  "$($_.DeviceID)|$($_.VolumeName)|$p"
}
'''


def _drive_static():
    """One-time map: 'C:' -> {'label': 'OS', 'phys': ['PhysicalDrive0']}.
    'phys' keys match psutil.disk_io_counters(perdisk=True) on Windows."""
    if sys.platform != "win32":
        return {}
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", _PS_DRIVE_MAP],
            text=True, timeout=15, creationflags=NO_WINDOW)
    except Exception:
        return {}
    m = {}
    for ln in out.splitlines():
        parts = ln.strip().split("|")
        if len(parts) == 3 and parts[0].endswith(":"):
            m[parts[0]] = {"label": parts[1],
                           "phys": [x for x in parts[2].split(",") if x]}
    return m


DRIVE_STATIC = _drive_static()


# ---------------------------------------------------------------------------
# Tailnet: peers from the local Tailscale CLI (status --json).
# ---------------------------------------------------------------------------
def _tailscale_exe():
    for cand in ("tailscale",
                 r"C:\Program Files\Tailscale\tailscale.exe",
                 r"C:\Program Files (x86)\Tailscale\tailscale.exe"):
        try:
            subprocess.check_output([cand, "version"], timeout=4,
                                    creationflags=NO_WINDOW, text=True)
            return cand
        except Exception:
            continue
    return None


TAILSCALE = _tailscale_exe()


def _tailnet():
    """Tailnet devices: self first, then peers (online before offline)."""
    if not TAILSCALE:
        return None
    try:
        out = subprocess.check_output([TAILSCALE, "status", "--json"],
                                      timeout=6, creationflags=NO_WINDOW, text=True)
        data = json.loads(out)
    except Exception:
        return None

    def node(n, is_self=False):
        return {
            "name": n.get("HostName") or "?",
            "os": n.get("OS") or "",
            "online": bool(n.get("Online")),
            "self": is_self,
            "rx": int(n.get("RxBytes") or 0),
            "tx": int(n.get("TxBytes") or 0),
            "last_seen": n.get("LastSeen") or "",
        }

    rows = []
    if data.get("Self"):
        rows.append(node(data["Self"], True))
    for peer in (data.get("Peer") or {}).values():
        rows.append(node(peer))
    # self first, then online, then offline; alphabetical within each group
    rows.sort(key=lambda r: (not r["self"], not r["online"], r["name"].lower()))
    return rows


# ---------------------------------------------------------------------------
# CPU clock: current core frequency in MHz. On Windows psutil.cpu_freq()
# reports a near-constant value (the base clock), so we compute it the way
# Task Manager does: the documented PDH counter "% Processor Performance"
# (percent of nominal frequency; exceeds 100 when boosting) times the base
# MHz. PDH is loaded once via ctypes; each 1 Hz sample is two cheap C calls.
# Falls back to psutil.cpu_freq() (accurate on Linux/macOS).
# ---------------------------------------------------------------------------
class _PdhValue(ctypes.Structure):
    # PDH_FMT_COUNTERVALUE with the union collapsed to its double member
    # (ctypes 8-aligns the double, matching the C struct layout).
    _fields_ = [("CStatus", ctypes.c_ulong), ("doubleValue", ctypes.c_double)]


class _CpuClock:
    def __init__(self):
        self.base = None          # nominal (base) MHz
        self.hi = None            # highest MHz seen (Windows has no documented
                                  # boost-ceiling API; base * %Performance exceeds
                                  # base whenever boosting, so report a high-water
                                  # mark that converges on the true boost clock)
        self.ok = False           # PDH counter usable
        try:
            f = psutil.cpu_freq()
            if f:
                self.base = float(f.max or f.current or 0) or None
        except Exception:
            pass
        if sys.platform != "win32":
            return
        if not self.base:
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                     r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
                self.base = float(winreg.QueryValueEx(key, "~MHz")[0])
            except Exception:
                return
        try:
            pdh = ctypes.WinDLL("pdh.dll")
            self._q = ctypes.c_void_p()
            if pdh.PdhOpenQueryW(None, 0, ctypes.byref(self._q)) != 0:
                return
            self._c = ctypes.c_void_p()
            path = r"\Processor Information(_Total)\% Processor Performance"
            if pdh.PdhAddEnglishCounterW(self._q, path, 0, ctypes.byref(self._c)) != 0:
                return
            pdh.PdhCollectQueryData(self._q)  # prime: rate counters need two samples
            self._pdh = pdh
            self.ok = True
        except Exception:
            pass

    def _seen(self, mhz):
        # max = high-water mark, never below base: the wallpaper scales its
        # clock bar against this, so it must stay >= the current reading.
        if self.hi is None or mhz > self.hi:
            self.hi = mhz
        return mhz, round(max(self.hi, self.base or 0)) or None

    def query(self):
        """Return (current_mhz, max_mhz); either may be None."""
        if self.ok:
            try:
                if self._pdh.PdhCollectQueryData(self._q) == 0:
                    v = _PdhValue()
                    # 0x200 = PDH_FMT_DOUBLE
                    if self._pdh.PdhGetFormattedCounterValue(
                            self._c, 0x200, None, ctypes.byref(v)) == 0:
                        return self._seen(round(self.base * v.doubleValue / 100.0))
            except Exception:
                self.ok = False
        try:
            f = psutil.cpu_freq()
            if f and f.current:
                return self._seen(round(f.current))
        except Exception:
            pass
        return None, round(self.base) if self.base else None


CPU_CLOCK = _CpuClock()


# ---------------------------------------------------------------------------
# GPU: live NVIDIA stats via the driver's NVML library, loaded once through
# ctypes. query() is a few cheap C calls — no per-second subprocess. Falls back
# to nvidia-smi (then to the wallpaper's simulated GPU) if NVML is unavailable.
# ---------------------------------------------------------------------------
class _NvUtil(ctypes.Structure):
    _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]


class _NvMem(ctypes.Structure):
    _fields_ = [("total", ctypes.c_ulonglong),
                ("free", ctypes.c_ulonglong),
                ("used", ctypes.c_ulonglong)]


class _NVML:
    def __init__(self):
        self.ok = False
        self.lib = None
        self.h = None
        try:
            lib = (ctypes.WinDLL("nvml.dll") if sys.platform == "win32"
                   else ctypes.CDLL("libnvidia-ml.so.1"))
        except Exception:
            return
        init = getattr(lib, "nvmlInit_v2", None) or getattr(lib, "nvmlInit", None)
        geth = (getattr(lib, "nvmlDeviceGetHandleByIndex_v2", None)
                or getattr(lib, "nvmlDeviceGetHandleByIndex", None))
        if not init or not geth:
            return
        try:
            if init() != 0:
                return
            geth.argtypes = [ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p)]
            h = ctypes.c_void_p()
            if geth(0, ctypes.byref(h)) != 0:
                return
            lib.nvmlDeviceGetUtilizationRates.argtypes = [ctypes.c_void_p, ctypes.POINTER(_NvUtil)]
            lib.nvmlDeviceGetMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(_NvMem)]
            lib.nvmlDeviceGetTemperature.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_uint)]
        except Exception:
            return
        # Clocks (type 0 = NVML_CLOCK_GRAPHICS, 2 = NVML_CLOCK_MEM). Guarded
        # separately so a driver without these entry points still serves
        # util/temp/VRAM. The max clocks never change; read them once.
        self.clock_max = None
        self.mem_clock_max = None
        self._has_clock = False
        try:
            lib.nvmlDeviceGetClockInfo.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_uint)]
            lib.nvmlDeviceGetMaxClockInfo.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_uint)]
            self._has_clock = True
            c = ctypes.c_uint()
            if lib.nvmlDeviceGetMaxClockInfo(h, 0, ctypes.byref(c)) == 0:
                self.clock_max = float(c.value)
            if lib.nvmlDeviceGetMaxClockInfo(h, 2, ctypes.byref(c)) == 0:
                self.mem_clock_max = float(c.value)
        except Exception:
            pass
        self.lib = lib
        self.h = h
        self.ok = True

    def query(self):
        if not self.ok:
            return None
        try:
            u = _NvUtil()
            if self.lib.nvmlDeviceGetUtilizationRates(self.h, ctypes.byref(u)) != 0:
                return None
            m = _NvMem()
            if self.lib.nvmlDeviceGetMemoryInfo(self.h, ctypes.byref(m)) != 0:
                return None
            temp = None
            t = ctypes.c_uint()
            if self.lib.nvmlDeviceGetTemperature(self.h, 0, ctypes.byref(t)) == 0:
                temp = float(t.value)
            clock = mem_clock = None
            if self._has_clock:
                c = ctypes.c_uint()
                if self.lib.nvmlDeviceGetClockInfo(self.h, 0, ctypes.byref(c)) == 0:
                    clock = float(c.value)
                if self.lib.nvmlDeviceGetClockInfo(self.h, 2, ctypes.byref(c)) == 0:
                    mem_clock = float(c.value)
            return {"util": float(u.gpu), "temp": temp,
                    "clock": clock, "clock_max": self.clock_max,
                    "mem_clock": mem_clock, "mem_clock_max": self.mem_clock_max,
                    "vram_used": round(m.used / (1024 * 1024), 1),
                    "vram_total": round(m.total / (1024 * 1024), 1)}
        except Exception:
            return None


def _gpu_query():
    """Live NVIDIA GPU stats via nvidia-smi (fallback path used only when NVML
    isn't available). Returns None if no NVIDIA GPU / driver. AMD and Intel
    aren't covered; they fall back to the wallpaper's simulated GPU rows."""
    try:
        out = subprocess.check_output(
            ["nvidia-smi",
             "--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,"
             "clocks.gr,clocks.max.gr,clocks.mem,clocks.max.mem",
             "--format=csv,noheader,nounits"],
            text=True, timeout=3, creationflags=NO_WINDOW)
        vals = [x.strip() for x in out.strip().splitlines()[0].split(",")]

        def _f(i):
            try:
                return float(vals[i])
            except Exception:
                return None      # missing column, or "[N/A]" for unsupported fields

        return {"util": float(vals[0]), "temp": float(vals[1]),
                "vram_used": float(vals[2]), "vram_total": float(vals[3]),
                "clock": _f(4), "clock_max": _f(5),
                "mem_clock": _f(6), "mem_clock_max": _f(7)}
    except Exception:
        return None


class _GPU:
    """Pick the cheapest working GPU source once: NVML if possible, else a
    one-time nvidia-smi probe; otherwise report nothing (wallpaper simulates)."""
    def __init__(self):
        self._nvml = _NVML()
        if self._nvml.ok:
            self.mode = "nvml"
        elif _gpu_query() is not None:
            self.mode = "smi"
        else:
            self.mode = "none"

    def query(self):
        if self.mode == "nvml":
            r = self._nvml.query()
            if r is not None:
                return r
            self.mode = "smi"          # NVML degraded mid-run; fall back
        if self.mode == "smi":
            return _gpu_query()
        return None


GPU = _GPU()


def _ram_mhz():
    """Installed RAM speed in MT/s (what vendors label 'MHz'). Hardware-static,
    so it is read once at startup. ConfiguredClockSpeed is the speed the module
    actually runs at (XMP/JEDEC); Speed is the rated fallback."""
    if sys.platform != "win32":
        return None
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_PhysicalMemory | ForEach-Object { "
             "if ($_.ConfiguredClockSpeed) { $_.ConfiguredClockSpeed } "
             "elseif ($_.Speed) { $_.Speed } }"],
            text=True, timeout=15, creationflags=NO_WINDOW)
        speeds = [int(x) for x in out.split() if x.strip().isdigit()]
        return max(speeds) if speeds else None
    except Exception:
        return None


RAM_MHZ = _ram_mhz()


def _collect_sysinfo():
    """Static machine identity, gathered once at startup. The wallpaper shows
    these in the neofetch block instead of the fictional defaults."""
    info = {}
    try:
        info["host"] = platform.node() or None
        info["kernel"] = platform.version() or None
        if sys.platform == "win32":
            info["os"] = "Windows " + platform.release()
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                     r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
                info["cpu"] = winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
            except Exception:
                info["cpu"] = platform.processor() or None
            try:
                # Pick the *active* GPU, not just the first enumerated one: skip
                # disabled/errored adapters (ConfigManagerErrorCode != 0, e.g. a
                # disabled iGPU) and prefer the one actually driving a display.
                gpu_ps = (
                    "$c = Get-CimInstance Win32_VideoController | "
                    "Where-Object { $_.ConfigManagerErrorCode -eq 0 -and $_.Name };"
                    "$g = $c | Where-Object { $_.CurrentHorizontalResolution -gt 0 } | "
                    "Select-Object -First 1;"
                    "if (-not $g) { $g = $c | Select-Object -First 1 };"
                    "if ($g) { $g.Name }"
                )
                out = subprocess.check_output(
                    ["powershell", "-NoProfile", "-Command", gpu_ps],
                    text=True, timeout=15, creationflags=NO_WINDOW)
                info["gpu"] = out.strip() or None
            except Exception:
                info["gpu"] = None
        else:
            info["os"] = platform.system() + " " + platform.release()
            info["cpu"] = platform.processor() or platform.machine() or None
            info["gpu"] = None
        info["monitors"] = _monitors()
    except Exception:
        pass
    return info


SYSINFO = _collect_sysinfo()

# ---------------------------------------------------------------------------
# Sampler: keeps lightweight state so we can compute rates (deltas over time).
# ---------------------------------------------------------------------------
class Sampler:
    def __init__(self):
        self._lock = threading.Lock()
        self._last_t = time.time()
        self._last_cpu = psutil.cpu_times()
        self._last_disk = psutil.disk_io_counters()
        self._last_net = psutil.net_io_counters()
        self._last_perdisk = {}        # drive letter -> cumulative (read, write) bytes
        self._tick = 0
        self._users = self._count_users()
        # prime per-process CPU counters (first reading is meaningless)
        for p in psutil.process_iter():
            try:
                p.cpu_percent(None)
            except Exception:
                pass
        # Tailnet is a separate CLI call on a slower cadence; cache it.
        self._tailnet = _tailnet()
        # The all-process scan that ranks the top 5 is by far the heaviest part
        # of a sample, so it runs on its own slower thread — the process table
        # doesn't need 1 Hz. The live gauges built below stay at 1 Hz and never
        # wait on it. Prime it once so the very first response already has rows.
        self._procs = self._top_procs(psutil.virtual_memory().total)
        self._cache = self._build()
        # Sample on our own cadence in the background; HTTP requests always serve
        # the cached snapshot instantly instead of paying for a scan.
        threading.Thread(target=self._sample_loop, daemon=True).start()
        threading.Thread(target=self._procs_loop, daemon=True).start()
        threading.Thread(target=self._tailnet_loop, daemon=True).start()

    def _sample_loop(self):
        while True:
            time.sleep(1.0)
            snap = self._build()
            with self._lock:
                self._cache = snap

    def _procs_loop(self):
        # Top-5 process table: refresh every 2 s. This is the one expensive scan
        # (one OS handle per process); keeping it off the 1 Hz path is what holds
        # steady-state CPU down without touching live-gauge freshness.
        while True:
            time.sleep(2.0)
            rows = self._top_procs(psutil.virtual_memory().total)
            with self._lock:
                self._procs = rows

    def _tailnet_loop(self):
        while True:
            time.sleep(5.0)
            tn = _tailnet()
            with self._lock:
                self._tailnet = tn

    def _cpu_percent(self):
        # psutil.cpu_percent() keys its baseline per-thread; under a
        # thread-per-request server every call is a "first call" and
        # returns 0.0 forever. Compute the busy/total delta ourselves.
        cur = psutil.cpu_times()
        busy = (sum(cur) - cur.idle) - (sum(self._last_cpu) - self._last_cpu.idle)
        total = sum(cur) - sum(self._last_cpu)
        self._last_cpu = cur
        if total <= 0:
            return 0.0
        return min(max(100.0 * busy / total, 0.0), 100.0)

    def _cpu_temp(self):
        # Not available on most Windows / some macOS setups.
        if not _HAS_TEMP:
            return None
        try:
            temps = psutil.sensors_temperatures()
        except Exception:
            return None
        if not temps:
            return None
        # Prefer common CPU sensors, else first available reading.
        for key in ("coretemp", "k10temp", "cpu_thermal", "acpitz", "zenpower"):
            if key in temps and temps[key]:
                return round(temps[key][0].current, 1)
        for arr in temps.values():
            if arr:
                return round(arr[0].current, 1)
        return None

    def _count_users(self):
        # Distinct logged-in users (like the count in `uptime`).
        try:
            return len({u.name for u in psutil.users()}) or 1
        except Exception:
            return None

    def _drives_posix(self, dt):
        """Linux/macOS drives: real mounts via psutil (fixed filesystems only),
        with live per-device throughput where the kernel exposes it. Matters for
        the remote-server use: a Linux companion should show its real disks."""
        SKIP_FS = {"tmpfs", "devtmpfs", "squashfs", "overlay", "ramfs", "zram",
                   "proc", "sysfs", "efivarfs", "autofs", "fuse.gvfsd-fuse"}
        try:
            perdisk = psutil.disk_io_counters(perdisk=True) or {}
        except Exception:
            perdisk = {}
        out, seen_dev = [], set()
        try:
            parts = psutil.disk_partitions(all=False)
        except Exception:
            return []
        for part in parts:
            if part.fstype.lower() in SKIP_FS or not part.device.startswith("/dev/"):
                continue
            if part.device in seen_dev:        # bind mounts / btrfs subvolumes
                continue
            seen_dev.add(part.device)
            try:
                u = psutil.disk_usage(part.mountpoint)
            except Exception:
                continue
            dev = os.path.basename(part.device)
            c = perdisk.get(dev)
            rb = c.read_bytes if c else 0
            wb = c.write_bytes if c else 0
            prev = self._last_perdisk.get(dev)
            self._last_perdisk[dev] = (rb, wb)
            read_mbs = write_mbs = 0.0
            if prev and dt > 0 and (rb or wb):
                read_mbs = max(rb - prev[0], 0) / dt / (1024 * 1024)
                write_mbs = max(wb - prev[1], 0) / dt / (1024 * 1024)
            mp = part.mountpoint
            out.append({
                "id": "/" if mp == "/" else (os.path.basename(mp)[:6] or mp[:6]),
                "label": dev,
                "total_gb": round(u.total / (1024 ** 3), 1),
                "used_pct": round(u.used / u.total * 100) if u.total else 0,
                "read_mbs": round(read_mbs, 1),
                "write_mbs": round(write_mbs, 1),
            })
        out.sort(key=lambda d: (d["id"] != "/", d["id"]))
        return out[:6]                          # HUD panel space is finite

    def _drives_native(self, dt):
        """Every fixed drive with usage + live read/write throughput, computed
        natively via psutil (no subprocess). Label and physical-disk mapping
        come from the cached startup map; an unmapped drive simply reports 0 R/W
        but still shows correct usage."""
        if sys.platform != "win32":
            return self._drives_posix(dt)
        try:
            perdisk = psutil.disk_io_counters(perdisk=True) or {}
        except Exception:
            perdisk = {}
        # psutil sees hot-plugged fixed drives live; the startup map supplies
        # label + physical mapping. Union the two so neither misses a drive.
        seen, parts = set(), []
        try:
            for part in psutil.disk_partitions(all=False):
                letter = part.device.rstrip("\\/")
                if "fixed" in part.opts or letter in DRIVE_STATIC:
                    parts.append((letter, part.mountpoint))
                    seen.add(letter)
        except Exception:
            pass
        for letter in DRIVE_STATIC:
            if letter not in seen:
                parts.append((letter, letter + "\\"))

        out = []
        for letter, mount in parts:
            try:
                u = psutil.disk_usage(mount)
            except Exception:
                continue
            st = DRIVE_STATIC.get(letter, {})
            rb = wb = 0
            for phys in st.get("phys", []):
                c = perdisk.get(phys)
                if c:
                    rb += c.read_bytes
                    wb += c.write_bytes
            prev = self._last_perdisk.get(letter)
            self._last_perdisk[letter] = (rb, wb)
            read_mbs = write_mbs = 0.0
            if prev and dt > 0 and (rb or wb):
                read_mbs = max(rb - prev[0], 0) / dt / (1024 * 1024)
                write_mbs = max(wb - prev[1], 0) / dt / (1024 * 1024)
            out.append({
                "id": letter,
                "label": st.get("label", ""),
                "total_gb": round(u.total / (1024 ** 3), 1),
                "used_pct": round((u.total - u.free) / u.total * 100) if u.total else 0,
                "read_mbs": round(read_mbs, 1),
                "write_mbs": round(write_mbs, 1),
            })
        out.sort(key=lambda d: d["id"])
        return out

    def _top_procs(self, total_bytes, n=5):
        # First pass: cpu_percent for *every* process (cheap, and required to keep
        # each process's CPU baseline current). Only the top N then pay for a
        # memory lookup — Task-Manager-style, but ~60x fewer memory syscalls.
        cand = []
        for p in psutil.process_iter(["pid", "name"]):
            try:
                pid = p.info["pid"]
                name = p.info.get("name") or "?"
                if pid == 0 or name.lower() in IDLE_NAMES:
                    continue
                # per-process cpu_percent is per-core (can exceed 100);
                # normalize to share of total CPU, like Task Manager.
                cand.append((p.cpu_percent(None) / NCORES, pid, name, p))
            except Exception:
                continue
        cand.sort(key=lambda r: r[0], reverse=True)
        rows = []
        for cpu, pid, name, p in cand[:n]:
            mem = 0.0
            try:
                if total_bytes:
                    mem = p.memory_info().rss / total_bytes * 100
            except Exception:
                pass
            rows.append({
                "pid": pid,
                "name": name[:12],
                "cpu": round(cpu, 1),
                "mem": round(mem, 1),
            })
        return rows

    def _build(self):
        now = time.time()
        dt = max(now - self._last_t, 1e-3)

        cpu = self._cpu_percent()
        cpu_mhz, cpu_mhz_max = CPU_CLOCK.query()
        vm = psutil.virtual_memory()
        sm = psutil.swap_memory()

        disk = psutil.disk_io_counters()
        d_bytes = (disk.read_bytes + disk.write_bytes) - \
                  (self._last_disk.read_bytes + self._last_disk.write_bytes)
        disk_mbs = max(d_bytes, 0) / dt / (1024 * 1024)

        net = psutil.net_io_counters()
        down_kbs = max(net.bytes_recv - self._last_net.bytes_recv, 0) / dt / 1024
        up_kbs = max(net.bytes_sent - self._last_net.bytes_sent, 0) / dt / 1024

        drives = self._drives_native(dt)

        self._last_t = now
        self._last_disk = disk
        self._last_net = net

        # Logged-in user count changes rarely; refresh every ~30 s, not every tick.
        self._tick += 1
        if self._tick % 30 == 0:
            self._users = self._count_users()

        return {
            "cpu": round(cpu, 1),
            "cpu_mhz": cpu_mhz,
            "cpu_mhz_max": cpu_mhz_max,
            "ram": round(vm.percent, 1),
            "ram_mhz": RAM_MHZ,
            "ram_total_mb": round(vm.total / (1024 * 1024)),
            "cpu_count": NCORES,
            "swap": round(sm.percent, 1),
            "cpu_temp": self._cpu_temp(),
            "disk_mbs": round(disk_mbs, 1),
            "net_down_kbs": round(down_kbs, 1),
            "net_up_kbs": round(up_kbs, 1),
            "uptime_sec": int(now - BOOT_TIME),
            "nproc": len(psutil.pids()),
            "nusers": self._users,
            "sys": SYSINFO,
            "gpu": GPU.query(),
            "drives": drives,
            "tailnet": self._tailnet,
            "procs": self._procs,
            "ts": now,
        }

    def get(self):
        with self._lock:
            return self._cache


SAMPLER = Sampler()

# ---------------------------------------------------------------------------
# Wallpaper Engine audio-capture watchdog  (opt-in, Windows only)
#
# WE captures desktop audio by loopback from whatever endpoint is the Windows
# default. When that default changes under it (headset connects, BT dongle
# sleeps, you flip output in the volume flyout) its capture can keep reading the
# old endpoint and hand the wallpaper all-zero frames indefinitely. Nothing logs
# an error; the visualizer just goes dead. Restarting WE reattaches capture.
#
# Acting on every device switch would blink the wallpaper constantly, so we
# remediate only on evidence of the real fault: audio IS playing (we read the
# endpoint's own peak meter) AND the wallpaper reports it is receiving silence
# (aud=0 on the metrics request it already makes every second).
#
# Off unless --we-audio-watchdog is passed. A stats app that restarts another
# program is intrusive, and a misfire costs a visible wallpaper reload.
# ---------------------------------------------------------------------------
WE_DIR_DEFAULT = r"C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine"

# what the wallpaper last told us about its audio feed
_AUDIO_LOCK = threading.Lock()
_AUDIO_REPORT = {"state": None, "sum": 0.0, "ts": 0.0}


def _note_audio_report(path):
    """Record ?aud=/&audsum= from a /metrics request. Absent on old wallpapers
    and on remote setups, in which case the watchdog simply stays idle."""
    if "?" not in path:
        return
    try:
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
    except Exception:
        return
    state = (q.get("aud") or [None])[0]
    if state not in ("0", "1", "x"):
        return
    try:
        total = float((q.get("audsum") or ["0"])[0])
    except ValueError:
        total = 0.0
    with _AUDIO_LOCK:
        _AUDIO_REPORT["state"] = state
        _AUDIO_REPORT["sum"] = total
        _AUDIO_REPORT["ts"] = time.time()


_CLSCTX_ALL = 23
_CLSID_MMDEVICE_ENUM = "{BCDE0395-E52F-467C-8E3D-C4579291692E}"
_IID_IMMDEVICE_ENUM = "{A95664D2-9614-4F35-A746-DE8DB63617E6}"
_IID_IAUDIO_METER = "{C02216F6-8C67-4B5B-9D00-D008E73E0064}"


class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_uint32), ("Data2", ctypes.c_uint16),
                ("Data3", ctypes.c_uint16), ("Data4", ctypes.c_ubyte * 8)]


_GUID_CACHE = {}


def _guid(text):
    """Parsed once and cached: CLSIDFromString on every poll would be wasteful,
    and holding the objects keeps them alive for byref() calls."""
    g = _GUID_CACHE.get(text)
    if g is None:
        g = _GUID()
        if ctypes.windll.ole32.CLSIDFromString(ctypes.c_wchar_p(text), ctypes.byref(g)) != 0:
            raise OSError("bad GUID: " + text)
        _GUID_CACHE[text] = g
    return g


def _vcall(ptr, index, *argtypes):
    """Call COM method #index through the vtable, no comtypes/pycaw needed.
    That matters: the no-Python edition is a PyInstaller bundle, and this keeps
    its dependency list (psutil only) unchanged."""
    vtbl = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    proto = ctypes.WINFUNCTYPE(ctypes.c_int32, ctypes.c_void_p, *argtypes)
    return proto(vtbl[index])


def _com_release(ptr):
    if ptr:
        _vcall(ptr, 2)(ptr)


_COM_TLS = threading.local()


def _ensure_com():
    """CoCreateInstance fails with CO_E_NOTINITIALIZED unless the *calling*
    thread has initialized COM, so do it lazily per thread (once: repeat calls
    would just inflate the init count)."""
    if getattr(_COM_TLS, "ready", False):
        return
    ctypes.windll.ole32.CoInitialize(None)
    _COM_TLS.ready = True


def _default_output_level():
    """(device_id, peak 0..1) for the default multimedia output endpoint.
    Returns (None, 0.0) if anything goes wrong, which keeps the watchdog idle
    rather than guessing."""
    _ensure_com()
    ole32 = ctypes.windll.ole32
    enum = ctypes.c_void_p()
    hr = ole32.CoCreateInstance(ctypes.byref(_guid(_CLSID_MMDEVICE_ENUM)), None,
                                _CLSCTX_ALL,
                                ctypes.byref(_guid(_IID_IMMDEVICE_ENUM)),
                                ctypes.byref(enum))
    if hr != 0 or not enum:
        return (None, 0.0)
    dev = ctypes.c_void_p()
    meter = ctypes.c_void_p()
    try:
        # IMMDeviceEnumerator::GetDefaultAudioEndpoint(eRender=0, eMultimedia=1)
        hr = _vcall(enum, 4, ctypes.c_int32, ctypes.c_int32,
                    ctypes.POINTER(ctypes.c_void_p))(enum, 0, 1, ctypes.byref(dev))
        if hr != 0 or not dev:
            return (None, 0.0)
        dev_id = None
        pid = ctypes.c_wchar_p()
        if _vcall(dev, 5, ctypes.POINTER(ctypes.c_wchar_p))(dev, ctypes.byref(pid)) == 0:
            dev_id = pid.value
            ole32.CoTaskMemFree(pid)
        # IMMDevice::Activate(IAudioMeterInformation)
        hr = _vcall(dev, 3, ctypes.POINTER(_GUID), ctypes.c_uint32, ctypes.c_void_p,
                    ctypes.POINTER(ctypes.c_void_p))(
                        dev, ctypes.byref(_guid(_IID_IAUDIO_METER)),
                        _CLSCTX_ALL, None, ctypes.byref(meter))
        if hr != 0 or not meter:
            return (dev_id, 0.0)
        peak = ctypes.c_float()
        if _vcall(meter, 3, ctypes.POINTER(ctypes.c_float))(meter, ctypes.byref(peak)) != 0:
            return (dev_id, 0.0)
        return (dev_id, float(peak.value))
    finally:
        _com_release(meter)
        _com_release(dev)
        _com_release(enum)


_ENUM_PROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)


def _stacked_view_count():
    """Largest number of CEF views inside one of WE's desktop wallpaper windows.

    2 or more is WE's duplicate-view bug: two Chrome_WidgetWin_1 views stack in
    the same WPEDesktopCEFWindow and the one on top receives no user properties
    and no audio callbacks, so the wallpaper renders defaults and ignores audio
    even when capture is perfectly healthy. Restarting WE can land in this state,
    so we check for it after remediating."""
    user32 = ctypes.windll.user32
    buf = ctypes.create_unicode_buffer(256)

    def class_of(hwnd):
        user32.GetClassNameW(hwnd, buf, 256)
        return buf.value

    desktop_windows = []

    def find_desktop(hwnd, _lparam):
        if class_of(hwnd) == "WPEDesktopCEFWindow":
            desktop_windows.append(hwnd)
        return True

    find_cb = _ENUM_PROC(find_desktop)

    def descend(parent, depth=0):
        # WE's wallpaper window hangs off Progman/WorkerW, so a plain EnumWindows
        # never sees it; walk down a few levels instead.
        if depth > 4:
            return
        kids = []

        def collect(hwnd, _lparam):
            kids.append(hwnd)
            return True

        cb = _ENUM_PROC(collect)
        user32.EnumChildWindows(parent, cb, None)
        for k in kids:
            find_desktop(k, None)
            descend(k, depth + 1)

    tops = []

    def collect_top(hwnd, _lparam):
        if class_of(hwnd) in ("Progman", "WorkerW"):
            tops.append(hwnd)
        return True

    top_cb = _ENUM_PROC(collect_top)
    user32.EnumWindows(top_cb, None)
    for t in tops:
        find_desktop(t, None)
        descend(t)

    best = 0
    for dw in set(desktop_windows):
        views = []

        def count_views(hwnd, _lparam):
            if class_of(hwnd) == "Chrome_WidgetWin_1":
                views.append(hwnd)
            return True

        cb = _ENUM_PROC(count_views)
        user32.EnumChildWindows(dw, cb, None)
        best = max(best, len(set(views)))
    del find_cb, top_cb
    return best


def _default_watchdog_log():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "CyberOS-HUD", "we-watchdog.log")


class WeAudioWatchdog(threading.Thread):
    PEAK_MIN = 0.01          # output level that counts as "audio is playing"
    STARVE_SECONDS = 8.0     # mismatch must hold this long before we act
    COOLDOWN = 180.0         # never remediate more often than this
    REPORT_MAX_AGE = 6.0     # older wallpaper reports are stale, ignore them
    POLL = 2.0

    def __init__(self, we_dir=WE_DIR_DEFAULT, wallpaper_path="", verbose=False,
                 log_path=None):
        super().__init__(daemon=True)
        self.we_dir = we_dir
        self.wallpaper_path = wallpaper_path
        self.verbose = verbose
        self.log_path = log_path or _default_watchdog_log()
        self._starved_since = None
        self._last_fix = 0.0
        self._last_device = None

    def _log(self, msg):
        print("[we-watchdog] " + msg)
        # This auto-starts at login under pythonw.exe, where stdout is the null
        # device, so the file is the only place these lines survive. Without it
        # there is no way to tell whether the watchdog ever fired.
        try:
            os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
            with open(self.log_path, "a", encoding="utf-8") as fh:
                fh.write("%s  %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
        except Exception:
            pass

    def _restart_we(self):
        exe = os.path.join(self.we_dir, "wallpaper64.exe")
        if not os.path.isfile(exe):
            self._log("wallpaper64.exe not found under " + self.we_dir)
            return False
        subprocess.run(["taskkill", "/F", "/IM", "wallpaper64.exe"],
                       capture_output=True, creationflags=NO_WINDOW)
        time.sleep(3)
        subprocess.Popen([exe], creationflags=NO_WINDOW)
        time.sleep(14)
        return True

    def _repair_stacked_view(self):
        """Last resort. Letting WE auto-restore preserves the user's monitor
        layout (clone mirrors and all), which the control CLI cannot express, so
        we only force a single-view reload when the duplicate view really is
        there. This does collapse the wallpaper to monitor 0."""
        if not self.wallpaper_path:
            self._log("stacked view present but --we-wallpaper not set, leaving it")
            return
        cli = os.path.join(self.we_dir, "wallpaper32.exe")
        if not os.path.isfile(cli):
            return
        subprocess.run([cli, "-control", "closeWallpaper", "-monitor", "0"],
                       capture_output=True, creationflags=NO_WINDOW)
        time.sleep(3)
        subprocess.run([cli, "-control", "openWallpaper", "-file", self.wallpaper_path,
                        "-monitor", "0"], capture_output=True, creationflags=NO_WINDOW)
        time.sleep(6)
        self._log("reapplied wallpaper on monitor 0 to clear the stacked view")

    def _remediate(self):
        self._log("remediating: audio is playing but the wallpaper reports silence")
        # Stamp the cooldown up front: if the restart fails (WE not installed
        # where we think, permissions, whatever) we must not retry every poll.
        self._last_fix = time.time()
        self._starved_since = None
        if not self._restart_we():
            return
        try:
            views = _stacked_view_count()
        except Exception as exc:
            views = 0
            self._log("view check failed: %s" % exc)
        if views > 1:
            self._log("WE came back with %d stacked views" % views)
            self._repair_stacked_view()
        self._last_fix = time.time()
        self._starved_since = None

    def run(self):
        self._log("started (peak>%.2f + wallpaper reporting silence for %.0fs)"
                  % (self.PEAK_MIN, self.STARVE_SECONDS))
        while True:
            time.sleep(self.POLL)
            try:
                device, peak = _default_output_level()
                if device and device != self._last_device:
                    if self._last_device is not None and self.verbose:
                        self._log("default output changed")
                    self._last_device = device

                with _AUDIO_LOCK:
                    state = _AUDIO_REPORT["state"]
                    age = time.time() - _AUDIO_REPORT["ts"]

                # No fresh report means no wallpaper is talking to us (or it is a
                # remote setup, or an older build): nothing to diagnose.
                fresh = state is not None and age < self.REPORT_MAX_AGE
                starved = fresh and state == "0" and peak > self.PEAK_MIN

                now = time.time()
                if not starved:
                    self._starved_since = None
                    continue
                if self._starved_since is None:
                    self._starved_since = now
                    if self.verbose:
                        self._log("starvation suspected (peak %.3f)" % peak)
                if (now - self._starved_since >= self.STARVE_SECONDS
                        and now - self._last_fix >= self.COOLDOWN):
                    self._remediate()
            except Exception as exc:
                self._log("error: %s" % exc)


# ---------------------------------------------------------------------------
# HTTP handler with permissive CORS so the wallpaper's browser can fetch it.
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/metrics"):
            # the wallpaper piggybacks its audio-feed state on this request
            _note_audio_report(self.path)
            payload = json.dumps(SAMPLER.get()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        elif self.path.startswith("/audio"):
            # Diagnostic: what the wallpaper last reported about its audio feed,
            # next to the real output level. Lets you tell "WE is feeding the
            # wallpaper silence" from "nothing is playing" with one curl.
            with _AUDIO_LOCK:
                state = _AUDIO_REPORT["state"]
                total = _AUDIO_REPORT["sum"]
                ts = _AUDIO_REPORT["ts"]
            device, peak = (None, 0.0)
            if sys.platform == "win32":
                try:
                    device, peak = _default_output_level()
                except Exception:
                    pass
            body = {
                "wallpaper_audio": state,            # "1" live, "0" starved, "x" off, null none
                "wallpaper_frame_sum": round(total, 6),
                "report_age_s": round(time.time() - ts, 2) if ts else None,
                "output_peak": round(peak, 5),
                "output_device": device,
            }
            payload = json.dumps(body).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self._cors()
            self.end_headers()
            self.wfile.write(b"CyberOS HUD metrics companion. GET /metrics or /audio")

    def log_message(self, *args):
        pass  # stay quiet


class Server(ThreadingHTTPServer):
    # Default SO_REUSEADDR lets a second copy silently double-bind the port
    # on Windows while the first keeps serving; make duplicates fail loudly.
    allow_reuse_address = False


def main():
    import argparse
    ap = argparse.ArgumentParser(
        description="CyberOS HUD metrics companion (read-only stats server)")
    ap.add_argument("--host", default=HOST,
                    help="interface to bind (default 127.0.0.1 = this PC only). "
                         "To feed the wallpaper on ANOTHER machine, bind a LAN/"
                         "tailnet IP or 0.0.0.0 and set that host in the "
                         "wallpaper's 'Remote metrics host' property.")
    ap.add_argument("--port", type=int, default=PORT,
                    help=f"TCP port to serve on (default {PORT})")
    ap.add_argument("--we-audio-watchdog", action="store_true",
                    help="Windows only. Watch for Wallpaper Engine's audio capture "
                         "going deaf after the default output device changes, and "
                         "restart WE when the wallpaper reports it is receiving "
                         "silence while audio is actually playing. Off by default.")
    ap.add_argument("--we-dir", default=WE_DIR_DEFAULT,
                    help="Wallpaper Engine install folder (for --we-audio-watchdog)")
    ap.add_argument("--we-wallpaper", default="",
                    help="path to your wallpaper's index.html/project.json. Only used "
                         "as a fallback when WE restarts into its duplicate-view bug; "
                         "reapplying collapses the wallpaper to monitor 0.")
    args = ap.parse_args()
    try:
        server = Server((args.host, args.port), Handler)
    except OSError:
        raise SystemExit(
            f"\n[!] Can't bind {args.host}:{args.port} — the companion is probably "
            "already running (or the address isn't local).\n"
            "    Close the other window first.\n"
        )
    print("=" * 52)
    print("  CyberOS HUD — Real Metrics Companion")
    print(f"  Serving live stats at  http://{args.host}:{args.port}/metrics")
    if args.host != "127.0.0.1":
        print("  NOTE: bound to a non-loopback address, so these read-only")
        print("  stats are visible to other machines that can reach this one.")
    print("  The wallpaper will pick this up automatically.")
    if args.we_audio_watchdog:
        if sys.platform == "win32":
            WeAudioWatchdog(we_dir=args.we_dir,
                            wallpaper_path=args.we_wallpaper,
                            verbose=True).start()
            print("  WE audio-capture watchdog: ON")
        else:
            print("  WE audio-capture watchdog: ignored (Windows only)")
    print("  Leave this running (you can minimize it). Ctrl+C to stop.")
    print("=" * 52)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping companion. Wallpaper will fall back to simulation.")
        server.shutdown()


if __name__ == "__main__":
    main()
