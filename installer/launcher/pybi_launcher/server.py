"""Runs PyBI on localhost with the private runtime and tells the UI when it is ready."""
from __future__ import annotations

import collections
import logging
import os
import re
import socket
import subprocess
import threading
import time
from pathlib import Path

from . import config as C

log = logging.getLogger("pybi.server")

URL_RE = re.compile(r"https?://(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|[\d.]+):(\d{2,5})", re.I)

CREATE_NO_WINDOW = 0x08000000


class ServerError(Exception):
    def __init__(self, message: str, tail: str = ""):
        super().__init__(message)
        self.tail = tail


def port_open(host: str, port: int, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def find_free_port(host: str, preferred: int, span: int = 50) -> int:
    for p in range(preferred, preferred + span):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, p))
                return p
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


class _KillOnCloseJob:
    """Windows job object: if the launcher dies, the server and its children die too."""

    def __init__(self):
        self.handle = None
        if not C.IS_WINDOWS:
            return
        try:
            import ctypes
            from ctypes import wintypes

            k32 = ctypes.WinDLL("kernel32", use_last_error=True)

            class IO_COUNTERS(ctypes.Structure):
                _fields_ = [(n, ctypes.c_ulonglong) for n in (
                    "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                    "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

            class BASIC(ctypes.Structure):
                _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                            ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                            ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                            ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                            ("SchedulingClass", wintypes.DWORD)]

            class EXTENDED(ctypes.Structure):
                _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO_COUNTERS),
                            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

            k32.CreateJobObjectW.restype = wintypes.HANDLE
            k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
            k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
            k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            k32.CloseHandle.argtypes = [wintypes.HANDLE]
            job = k32.CreateJobObjectW(None, None)
            if not job:
                return
            info = EXTENDED()
            info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
                k32.CloseHandle(job)
                return
            self._k32, self.handle = k32, job
        except Exception:  # never let this block startup
            log.exception("Job object unavailable; falling back to taskkill")

    def assign(self, proc: subprocess.Popen) -> None:
        if self.handle:
            try:
                self._k32.AssignProcessToJobObject(self.handle, int(proc._handle))  # type: ignore[attr-defined]
            except Exception:
                log.exception("Could not assign server to job object")

    def close(self) -> None:
        if self.handle:
            self._k32.CloseHandle(self.handle)
            self.handle = None


class Server:
    def __init__(self, cfg: C.Config):
        self.cfg = cfg
        self.proc: subprocess.Popen | None = None
        self.port: int | None = None
        self.url: str | None = None
        self.tail: collections.deque[str] = collections.deque(maxlen=60)
        self._detected_port: int | None = None
        self._job: _KillOnCloseJob | None = None
        self.log_path = C.logs_dir() / "server.log"

    # ---------- command ----------
    def _probe(self, py: Path) -> str:
        code = ("import importlib.util as u\n"
                "try:\n print('main' if u.find_spec('pybi.__main__') else ('pkg' if u.find_spec('pybi') else 'none'))\n"
                "except Exception:\n print('pkg')\n")
        try:
            env = {k: v for k, v in os.environ.items() if k not in ("PYTHONHOME", "PYTHONPATH")}
            out = subprocess.run([str(py), "-c", code], capture_output=True, text=True, timeout=60,
                                 cwd=str(C.workspace_dir()), env=env,
                                 creationflags=CREATE_NO_WINDOW if C.IS_WINDOWS else 0)
            return (out.stdout or "").strip().splitlines()[-1] if out.stdout.strip() else "none"
        except (OSError, subprocess.SubprocessError):
            return "none"

    def build_command(self, port: int) -> list[str]:
        py = C.runtime_python()
        if not py.exists():
            raise ServerError("PyBI's Python runtime is missing. Please reinstall PyBI.")
        ws = C.workspace_dir()
        subs = {"python": str(py), "port": str(port), "host": self.cfg.host, "workspace": str(ws)}
        if self.cfg.command:
            return [str(part).format(**subs) for part in self.cfg.command]
        kind = self._probe(py)
        log.info("pybi probe: %s", kind)
        if kind == "main":
            return [str(py), "-m", "pybi"]
        if kind == "none":
            raise ServerError("The pybi package is not installed in PyBI's runtime. Please reinstall PyBI.")
        app = ws / "app.py"
        if not app.exists():
            raise ServerError("This pybi version has no 'python -m pybi' entry point. Please reinstall PyBI.")
        return [str(py), str(app)]

    # ---------- lifecycle ----------
    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self) -> None:
        if self.running:
            return
        self.port = find_free_port(self.cfg.host, int(self.cfg.port))
        self._detected_port = None
        self.url = None
        self.tail.clear()
        cmd = self.build_command(self.port)
        env = dict(os.environ)
        env.update({
            "PYBI_HOST": self.cfg.host, "PYBI_PORT": str(self.port), "PYBI_OPEN_BROWSER": "0",
            "PYBI_LAUNCHER": "1", "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8",
        })
        for k in ("PYTHONHOME", "PYTHONPATH"):  # never let a system Python leak in
            env.pop(k, None)
        log.info("Starting server on port %s: %s", self.port, cmd)
        self._job = _KillOnCloseJob()
        logf = open(self.log_path, "a", encoding="utf-8", errors="replace")
        logf.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')}  {' '.join(cmd)}\n")
        logf.flush()
        self.proc = subprocess.Popen(
            cmd, cwd=str(C.workspace_dir()), env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
            bufsize=1, creationflags=CREATE_NO_WINDOW if C.IS_WINDOWS else 0,
        )
        self._job.assign(self.proc)
        threading.Thread(target=self._pump, args=(self.proc, logf), name="server-output", daemon=True).start()

    def _pump(self, proc: subprocess.Popen, logf) -> None:
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                logf.write(line)
                logf.flush()
                self.tail.append(line.rstrip())
                if self._detected_port is None:
                    m = URL_RE.search(line)
                    if m:
                        self._detected_port = int(m.group(1))
        finally:
            logf.close()

    def wait_ready(self, cancel: threading.Event | None = None) -> str:
        deadline = time.time() + self.cfg.start_timeout
        host = "127.0.0.1" if self.cfg.host in ("0.0.0.0", "") else self.cfg.host
        while time.time() < deadline:
            if cancel is not None and cancel.is_set():
                raise ServerError("Start cancelled.")
            if not self.running:
                raise ServerError("PyBI stopped while starting.", "\n".join(self.tail))
            for p in filter(None, (self._detected_port, self.port)):
                if port_open(host, p):
                    self.url = f"http://{host}:{p}/"
                    return self.url
            time.sleep(0.25)
        raise ServerError(f"PyBI did not respond within {self.cfg.start_timeout} seconds.", "\n".join(self.tail))

    def stop(self, timeout: float = 8.0) -> None:
        proc, self.proc = self.proc, None
        if proc is None:
            return
        if proc.poll() is None:
            log.info("Stopping server pid %s", proc.pid)
            try:
                proc.terminate()
                proc.wait(timeout=timeout)
            except (OSError, subprocess.TimeoutExpired):
                if C.IS_WINDOWS:
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                                   capture_output=True, creationflags=CREATE_NO_WINDOW)
                else:
                    proc.kill()
        if self._job:
            self._job.close()  # kills any leftover child processes
            self._job = None
        self.url = None
