"""PyBI launcher entry point.

Windows: frozen into PyBI.exe (installer/scripts/build.ps1). macOS: frozen into PyBI.app.
Linux AppImage/.deb: runs on the bundled Python (installer/scripts/build_unix.sh).

    PyBI.exe                  start PyBI and open it in the browser
    PyBI.exe --no-browser     start without opening a browser tab
    PyBI.exe --check-updates  print update status and exit (no window)
    PyBI.exe --version        print the installed version and exit
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import threading
import time
import webbrowser
from logging.handlers import RotatingFileHandler

from pybi_launcher import config as C
from pybi_launcher import updater
from pybi_launcher.instance import SingleInstance


def _logging() -> None:
    h = RotatingFileHandler(C.logs_dir() / "launcher.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[h])


def _dpi_aware() -> None:
    if C.IS_WINDOWS:
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # type: ignore[attr-defined]
        except Exception:
            pass


def _console_out(text: str) -> None:
    # A windowed exe has no console; attach to the parent's if there is one.
    if C.IS_WINDOWS and sys.stdout is None:
        try:
            import ctypes
            if ctypes.windll.kernel32.AttachConsole(-1):  # type: ignore[attr-defined]
                sys.stdout = open("CONOUT$", "w")
        except Exception:
            return
    if sys.stdout:
        print(text, flush=True)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="PyBI")
    p.add_argument("--no-browser", action="store_true")
    p.add_argument("--check-updates", action="store_true")
    p.add_argument("--version", action="store_true")
    args = p.parse_args(argv)

    _logging()
    cfg, state = C.Config.load(), C.State.load()
    log = logging.getLogger("pybi")
    log.info("Launcher %s starting (repo=%s, app_dir=%s)", cfg.version, cfg.github_repo, C.app_dir())

    if args.version:
        _console_out(cfg.version)
        return 0
    if args.check_updates:
        res = updater.check(cfg, state, force=True)
        _console_out(f"installed={cfg.version} status={res.status} "
                     f"latest={res.release.version if res.release else '-'} {res.error}".strip())
        return 0

    # A normal "kill" (logout, shutdown, systemd, pkill) must stop the PyBI server too:
    # turn SIGTERM/SIGHUP into SystemExit so every finally-block runs.
    import signal
    for sig in ("SIGTERM", "SIGHUP"):
        if hasattr(signal, sig):
            signal.signal(getattr(signal, sig), lambda *_: sys.exit(0))

    lock = SingleInstance(cfg.control_port)
    if not lock.acquire():
        log.info("Already running; asked the existing window to show itself")
        return 0

    updater.cleanup_downloads(C.data_dir() / "updates", keep=0)
    _dpi_aware()
    try:
        if C.IS_LINUX and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
            raise RuntimeError("no graphical display")
        from pybi_launcher.ui import LauncherApp  # tkinter imported only when a window is needed
    except Exception as e:  # noqa: BLE001
        log.warning("No launcher window (%s); running PyBI without one", e)
        try:
            return run_headless(cfg, state, open_browser=not args.no_browser)
        finally:
            lock.release()

    app = LauncherApp(cfg, state, open_browser=not args.no_browser)
    lock.serve(lambda: app.q.put(("show",)))
    try:
        app.run()
    finally:
        lock.release()
    return 0


def run_headless(cfg, state, open_browser: bool = True) -> int:
    """No window available (server, SSH session, missing Tk): run PyBI and report in the terminal."""
    from pybi_launcher.server import Server, ServerError
    srv = Server(cfg)
    try:
        srv.start()
        url = srv.wait_ready()
    except ServerError as e:
        _console_out(f"PyBI could not start: {e}\n{e.tail}")
        srv.stop()
        return 1
    _console_out(f"PyBI {cfg.version} is running at {url}  (press Ctrl+C to stop)")
    if open_browser:
        webbrowser.open(url)

    def check():
        res = updater.check(cfg, state)
        if res.status == "available":
            _console_out(f"PyBI {res.release.version} is available: {res.release.html_url}")
    threading.Thread(target=check, daemon=True).start()
    try:
        while srv.running:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        srv.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
