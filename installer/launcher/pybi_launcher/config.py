"""Where things live, and the launcher's settings.

Layouts (res_dir() is where runtime/, launcher.json and assets/ live):

  Windows   %LOCALAPPDATA%\\Programs\\PyBI\\        (PyBI.exe, frozen launcher)
  macOS     /Applications/PyBI.app/Contents/Resources  (frozen launcher in Contents/MacOS)
  AppImage  $APPDIR/usr                                (launcher runs on the bundled Python)
  .deb      /opt/pybi                                  (ChromeOS, Debian, Ubuntu)

Windows layout of an installed copy:

    PyBI.exe            this launcher (frozen with PyInstaller)
    _internal\\          launcher's own files
    runtime\\python.exe  private Python with pybi-ray and all dependencies
    launcher.json       build-time settings: version, GitHub repo, start command
    settings.ini        installer choices (automatic update checks)

Per-user data (logs, update state) goes to %LOCALAPPDATA%\\PyBI.
The user's dashboards live in Documents\\PyBI.
"""
from __future__ import annotations

import configparser
import json
import os
import sys
from dataclasses import dataclass, field, fields
from pathlib import Path

IS_WINDOWS = os.name == "nt"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")


def app_dir() -> Path:
    env = os.environ.get("PYBI_APP_DIR")
    if env:
        return Path(env)
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]  # installer/launcher during development


def res_dir() -> Path:
    """Folder holding runtime/, launcher.json and assets/ (differs inside a macOS .app)."""
    if IS_MAC and getattr(sys, "frozen", False):
        res = Path(sys.executable).resolve().parent.parent / "Resources"
        if (res / "runtime").exists() or (res / "launcher.json").exists():
            return res
    return app_dir()


def mac_bundle() -> Path | None:
    """The running PyBI.app, if any."""
    if IS_MAC and getattr(sys, "frozen", False):
        b = Path(sys.executable).resolve().parents[2]
        if b.suffix == ".app":
            return b
    return None


def data_dir() -> Path:
    env = os.environ.get("PYBI_DATA_DIR")
    if env:
        base = Path(env)
    elif IS_WINDOWS:
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "PyBI"
    elif IS_MAC:
        base = Path.home() / "Library" / "Application Support" / "PyBI"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "pybi"
    base.mkdir(parents=True, exist_ok=True)
    return base


def logs_dir() -> Path:
    d = data_dir() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def workspace_dir() -> Path:
    env = os.environ.get("PYBI_WORKSPACE")
    if env:
        d = Path(env)
    else:
        docs = Path.home() / "Documents"
        d = (docs if docs.exists() else Path.home()) / "PyBI"
    d.mkdir(parents=True, exist_ok=True)
    return d


def runtime_python() -> Path:
    """The private Python the installer ships. Falls back for development runs."""
    env = os.environ.get("PYBI_PYTHON")
    if env:
        return Path(env)
    exe = res_dir() / "runtime" / ("python.exe" if IS_WINDOWS else "bin/python3")
    if exe.exists():
        return exe
    if not getattr(sys, "frozen", False):
        return Path(sys.executable)
    return exe  # missing: the UI reports a broken install


def asset(name: str) -> Path | None:
    """Find a bundled asset (icon) whether frozen or running from source."""
    roots = []
    if getattr(sys, "_MEIPASS", None):
        roots.append(Path(sys._MEIPASS) / "assets")
    roots += [res_dir() / "assets", app_dir() / "assets", Path(__file__).resolve().parents[2] / "assets"]
    for r in roots:
        p = r / name
        if p.exists():
            return p
    return None


def detect_install_kind() -> str:
    if IS_WINDOWS and getattr(sys, "frozen", False):
        return "inno"
    if mac_bundle() is not None:
        return "macapp"
    if IS_LINUX and os.environ.get("APPIMAGE"):
        return "appimage"
    if IS_LINUX and str(app_dir()).startswith("/opt/pybi"):
        return "deb"
    return "source"


@dataclass
class Config:
    app_name: str = "PyBI"
    version: str = "0.0.0-dev"
    github_repo: str = ""                      # "owner/repo"; filled in by the release build
    asset_pattern: str = r"^PyBI-Setup.*\.exe$"
    host: str = "127.0.0.1"
    port: int = 8050                           # preferred; the next free port is used if busy
    command: list | None = None                # e.g. ["{python}", "-m", "pybi", "--port", "{port}"]
    start_timeout: int = 120                   # seconds; first start compiles bytecode
    open_browser_on_start: bool = True
    check_interval_hours: float = 6.0
    include_prereleases: bool = False
    control_port: int = 47821                  # single-instance channel (localhost only)
    auto_check: bool = True                    # from settings.ini, set by the installer task
    install_kind: str = ""                     # inno | macapp | appimage | deb | source (auto when empty)

    @classmethod
    def load(cls) -> "Config":
        cfg = cls()
        known = {f.name for f in fields(cls)}
        path = res_dir() / "launcher.json"
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8-sig"))
                for k, v in data.items():
                    if k in known:
                        setattr(cfg, k, v)
            except (OSError, ValueError):
                pass
        ini = res_dir() / "settings.ini"
        if ini.exists():
            cp = configparser.ConfigParser()
            try:
                cp.read(ini, encoding="utf-8")
                cfg.auto_check = cp.getboolean("updates", "auto_check", fallback=cfg.auto_check)
                cfg.include_prereleases = cp.getboolean(
                    "updates", "include_prereleases", fallback=cfg.include_prereleases)
            except (configparser.Error, ValueError):
                pass
        if not cfg.install_kind:
            cfg.install_kind = detect_install_kind()
        return cfg


@dataclass
class State:
    """Per-user state that survives updates."""
    last_check: float = 0.0
    skipped_version: str = ""
    auto_check: bool | None = None             # user override from the launcher checkbox
    extra: dict = field(default_factory=dict)

    @staticmethod
    def path() -> Path:
        return data_dir() / "state.json"

    @classmethod
    def load(cls) -> "State":
        try:
            data = json.loads(cls.path().read_text(encoding="utf-8"))
            known = {f.name for f in fields(cls)}
            return cls(**{k: v for k, v in data.items() if k in known})
        except (OSError, ValueError, TypeError):
            return cls()

    def save(self) -> None:
        tmp = self.path().with_suffix(".tmp")
        tmp.write_text(json.dumps(self.__dict__, indent=2), encoding="utf-8")
        os.replace(tmp, self.path())
