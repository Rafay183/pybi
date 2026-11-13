"""PyBI launcher entry point (frozen into PyBI.exe by installer/scripts/build.ps1).

    PyBI.exe                  start PyBI and open it in the browser
    PyBI.exe --no-browser     start without opening a browser tab
    PyBI.exe --check-updates  print update status and exit (no window)
    PyBI.exe --version        print the installed version and exit
"""
from __future__ import annotations

import argparse
import logging
import sys
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
        print(text)


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

    lock = SingleInstance(cfg.control_port)
    if not lock.acquire():
        log.info("Already running; asked the existing window to show itself")
        return 0

    updater.cleanup_downloads(C.data_dir() / "updates", keep=0)
    _dpi_aware()
    from pybi_launcher.ui import LauncherApp  # tkinter imported only when a window is needed

    app = LauncherApp(cfg, state, open_browser=not args.no_browser)
    lock.serve(lambda: app.q.put(("show",)))
    try:
        app.run()
    finally:
        lock.release()
    return 0


if __name__ == "__main__":
    sys.exit(main())
