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
            return {"util": float(u.gpu), "temp": temp,
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
             "--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            text=True, timeout=3, creationflags=NO_WINDOW)
        util, temp, used, total = [x.strip() for x in out.strip().splitlines()[0].split(",")]
        return {"util": float(util), "temp": float(temp),
                "vram_used": float(used), "vram_total": float(total)}
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

    def _drives_native(self, dt):
        """Every fixed drive with usage + live read/write throughput, computed
        natively via psutil (no subprocess). Label and physical-disk mapping
        come from the cached startup map; an unmapped drive simply reports 0 R/W
        but still shows correct usage."""
        if sys.platform != "win32":
            return []
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
            "ram": round(vm.percent, 1),
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
            payload = json.dumps(SAMPLER.get()).encode("utf-8")
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
            self.wfile.write(b"CyberOS HUD metrics companion. GET /metrics")

    def log_message(self, *args):
        pass  # stay quiet


class Server(ThreadingHTTPServer):
    # Default SO_REUSEADDR lets a second copy silently double-bind the port
    # on Windows while the first keeps serving; make duplicates fail loudly.
    allow_reuse_address = False


def main():
    try:
        server = Server((HOST, PORT), Handler)
    except OSError:
        raise SystemExit(
            f"\n[!] Port {PORT} is already in use — the companion is probably "
            "already running.\n    Close the other window first.\n"
        )
    print("=" * 52)
    print("  CyberOS HUD — Real Metrics Companion")
    print(f"  Serving live stats at  http://{HOST}:{PORT}/metrics")
    print("  The wallpaper will pick this up automatically.")
    print("  Leave this running (you can minimize it). Ctrl+C to stop.")
    print("=" * 52)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping companion. Wallpaper will fall back to simulation.")
        server.shutdown()


if __name__ == "__main__":
    main()
