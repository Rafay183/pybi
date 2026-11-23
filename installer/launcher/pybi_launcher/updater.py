"""Update checks against GitHub Releases, verified download, silent upgrade.

Release contract (produced by .github/workflows/build-installer.yml):
  * tag ``vX.Y.Z`` (pre-releases marked as such on GitHub)
  * one asset per platform, each with ``<name>.sha256`` ("<hex>  <name>"):
      PyBI-Setup.exe                 Windows (Inno Setup)
      PyBI-macOS-arm64.dmg           macOS Apple Silicon      PyBI-macOS-x86_64.dmg   macOS Intel
      PyBI-Linux-x86_64.AppImage     Linux (any distro)       PyBI-Linux-aarch64.AppImage
      PyBI-Linux-amd64.deb           Debian/Ubuntu/ChromeOS   PyBI-Linux-arm64.deb
  Each build's launcher.json carries the asset_pattern for its own platform.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import versions
from . import config as C
from .config import IS_WINDOWS, Config, State

log = logging.getLogger("pybi.updater")

API = "https://api.github.com/repos/{repo}/releases?per_page=15"
UA = "PyBI-Launcher (+https://github.com)"


class UpdateError(Exception):
    pass


@dataclass
class Release:
    version: str
    tag: str
    name: str
    notes: str
    html_url: str
    asset_name: str
    asset_url: str
    asset_size: int
    sha256_url: str | None
    prerelease: bool


@dataclass
class CheckResult:
    status: str                      # available | current | skipped | throttled | disabled | error
    release: Release | None = None
    error: str = ""


_SYSTEM_CTX: ssl.SSLContext | None = None


def _system_context() -> ssl.SSLContext:
    """Verify HTTPS with the operating system (like the web browser does).

    Python's own check only sees certificates already present in the Windows store; Windows adds many root
    certificates on demand, and antivirus / company networks add their own. truststore asks Windows / macOS
    to verify, so update checks work wherever the browser works.
    """
    global _SYSTEM_CTX
    if _SYSTEM_CTX is None:
        try:
            import truststore
            _SYSTEM_CTX = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        except Exception:  # noqa: BLE001 - optional dependency
            _SYSTEM_CTX = ssl.create_default_context()
    return _SYSTEM_CTX


def _bundled_context() -> ssl.SSLContext | None:
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001 - optional dependency
        return None


def _urlopen(req: urllib.request.Request, timeout: float):
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=_system_context())
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, ssl.SSLCertVerificationError):
            ctx = _bundled_context()
            if ctx is not None:
                log.info("System certificate check failed (%s); retrying with the bundled certificates", exc.reason)
                return urllib.request.urlopen(req, timeout=timeout, context=ctx)
        raise


def _get(url: str, timeout: float, accept: str = "application/vnd.github+json") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    token = os.environ.get("PYBI_GITHUB_TOKEN")  # optional, raises the API rate limit
    if token and "api.github.com" in url:
        req.add_header("Authorization", f"Bearer {token}")
    with _urlopen(req, timeout) as r:
        return r.read()


def pick_release(payload: list, pattern: str, include_prereleases: bool) -> Release | None:
    """Choose the highest-versioned published release that carries an installer asset."""
    rx = re.compile(pattern, re.IGNORECASE)
    best: tuple[versions.Version, Release] | None = None
    for rel in payload:
        if rel.get("draft"):
            continue
        if rel.get("prerelease") and not include_prereleases:
            continue
        v = versions.parse(rel.get("tag_name", ""))
        if v is None:
            continue
        assets = rel.get("assets") or []
        exe = next((a for a in assets if rx.search(a.get("name", ""))
                    and not a["name"].lower().endswith(".sha256")), None)
        if not exe:
            continue
        sha = next((a for a in assets if a.get("name", "").lower() == exe["name"].lower() + ".sha256"), None)
        r = Release(
            version=str(v), tag=rel.get("tag_name", ""), name=rel.get("name") or rel.get("tag_name", ""),
            notes=rel.get("body") or "", html_url=rel.get("html_url", ""),
            asset_name=exe["name"], asset_url=exe["browser_download_url"],
            asset_size=int(exe.get("size") or 0),
            sha256_url=sha["browser_download_url"] if sha else None,
            prerelease=bool(rel.get("prerelease")),
        )
        if best is None or v > best[0]:
            best = (v, r)
    return best[1] if best else None


def check(cfg: Config, state: State, force: bool = False, timeout: float = 10.0) -> CheckResult:
    if not cfg.github_repo:
        return CheckResult("disabled", error="No GitHub repository configured for updates.")
    auto = cfg.auto_check if state.auto_check is None else state.auto_check
    if not force:
        if not auto:
            return CheckResult("disabled")
        if time.time() - state.last_check < cfg.check_interval_hours * 3600:
            return CheckResult("throttled")
    try:
        payload = json.loads(_get(API.format(repo=cfg.github_repo), timeout))
    except urllib.error.HTTPError as e:
        limited = e.code == 429 or (e.code == 403 and (e.headers or {}).get("X-RateLimit-Remaining") == "0")
        if limited:
            msg = "GitHub's hourly limit for update checks was reached. PyBI will try again later."
        elif e.code == 404:
            msg = "The PyBI release page was not found on GitHub."
        else:
            msg = f"GitHub refused the update check (HTTP {e.code})."
        return CheckResult("error", error=msg)
    except (urllib.error.URLError, OSError, ValueError) as e:
        if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
            return CheckResult("error", error="Could not check for updates: this computer could not verify GitHub's security "
                                              "certificate. If you use antivirus web protection or a company network, allow "
                                              "github.com, or download the newest PyBI from https://rafay183.github.io/pybi/")
        return CheckResult("error", error=f"Could not reach GitHub ({e}).")
    state.last_check = time.time()
    try:
        state.save()
    except OSError:
        pass
    rel = pick_release(payload, cfg.asset_pattern, cfg.include_prereleases)
    if rel is None or not versions.is_newer(rel.version, cfg.version):
        return CheckResult("current", rel)
    if not force and state.skipped_version and state.skipped_version == rel.version:
        return CheckResult("skipped", rel)
    return CheckResult("available", rel)


def _expected_sha(rel: Release, timeout: float) -> str | None:
    if not rel.sha256_url:
        return None
    text = _get(rel.sha256_url, timeout, accept="application/octet-stream").decode("utf-8", "replace")
    m = re.search(r"\b([0-9a-fA-F]{64})\b", text)
    if not m:
        raise UpdateError("The release's checksum file is unreadable.")
    return m.group(1).lower()


def download(rel: Release, dest: Path, progress: Callable[[int, int], None] | None = None,
             cancel: threading.Event | None = None, timeout: float = 30.0) -> Path:
    """Download the installer, verify its SHA-256, return its path."""
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / f"{rel.version}-{rel.asset_name}"
    part = target.with_suffix(".part")
    expected = _expected_sha(rel, timeout)
    req = urllib.request.Request(rel.asset_url, headers={"User-Agent": UA, "Accept": "application/octet-stream"})
    h = hashlib.sha256()
    done = 0
    with _urlopen(req, timeout) as r, open(part, "wb") as f:
        total = int(r.headers.get("Content-Length") or rel.asset_size or 0)
        while True:
            if cancel is not None and cancel.is_set():
                raise UpdateError("Download cancelled.")
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            f.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if progress:
                progress(done, total)
    if total and done != total:
        part.unlink(missing_ok=True)
        raise UpdateError("The download was incomplete. Please try again.")
    if expected and h.hexdigest() != expected:
        part.unlink(missing_ok=True)
        raise UpdateError("The downloaded file failed its integrity check, so it was not installed.")
    if not expected:
        log.warning("Release %s has no .sha256 asset; installed without checksum verification", rel.tag)
    os.replace(part, target)
    return target


def launch_installer(installer: Path, log_dir: Path) -> None:
    """Start the silent upgrade, detached, so this launcher can exit and be replaced.

    The installer closes PyBI if still running, upgrades in place (same AppId,
    same folder, previous choices kept) and starts PyBI again when done.
    """
    args = [str(installer), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART",
            "/CLOSEAPPLICATIONS", "/FORCECLOSEAPPLICATIONS",
            f"/LOG={log_dir / 'update-install.log'}"]
    flags = 0
    if IS_WINDOWS:
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    log.info("Launching installer: %s", args)
    subprocess.Popen(args, creationflags=flags, close_fds=True)


def cleanup_downloads(dest: Path, keep: int = 1) -> None:
    try:
        files = sorted((p for p in dest.iterdir() if p.is_file()), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in files[keep:]:
            p.unlink(missing_ok=True)
    except OSError:
        pass


def _relaunch_later(argv: list[str]) -> None:
    """Start the new version two seconds after this process exits (frees the single-instance port)."""
    script = 'sleep 2; exec "$@"'
    subprocess.Popen(["/bin/sh", "-c", script, "pybi-relaunch", *argv],
                     start_new_session=True, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def replace_appimage(new_file: Path, target: Path) -> None:
    tmp = target.with_name(target.name + ".new")
    shutil.copyfile(new_file, tmp)
    os.chmod(tmp, 0o755)
    os.replace(tmp, target)  # the running AppImage keeps its old inode until it exits


def install_mac_app(dmg: Path, bundle: Path) -> None:
    mnt = tempfile.mkdtemp(prefix="pybi-dmg-")
    subprocess.run(["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt, str(dmg)],
                   check=True, capture_output=True)
    try:
        src = Path(mnt) / "PyBI.app"
        if not src.exists():
            raise UpdateError("The downloaded disk image does not contain PyBI.app.")
        staging = bundle.with_name(".PyBI-update.app")
        old = bundle.with_name(".PyBI-old.app")
        for d in (staging, old):
            shutil.rmtree(d, ignore_errors=True)
        subprocess.run(["ditto", str(src), str(staging)], check=True, capture_output=True)
        os.rename(bundle, old)
        os.rename(staging, bundle)
        shutil.rmtree(old, ignore_errors=True)
    finally:
        subprocess.run(["hdiutil", "detach", mnt, "-quiet", "-force"], capture_output=True)


def _manual(downloaded: Path) -> tuple[str, Path]:
    """Put the file where people look (Downloads) for them to open."""
    downloads = Path.home() / "Downloads"
    try:
        downloads.mkdir(parents=True, exist_ok=True)
        final = downloads / downloaded.name.split("-", 1)[-1]
        shutil.copyfile(downloaded, final)
        return "manual", final
    except OSError:
        return "manual", downloaded


def _can_sudo() -> bool:
    """True when sudo works without a password prompt (default in ChromeOS's Linux)."""
    try:
        return subprocess.run(["sudo", "-n", "true"], capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def install_deb(deb: Path, log_dir: Path) -> bool:
    os.chmod(deb, 0o644)  # apt's sandbox user must be able to read it
    env = dict(os.environ, DEBIAN_FRONTEND="noninteractive")
    with open(log_dir / "update-install.log", "a", encoding="utf-8") as logf:
        r = subprocess.run(["sudo", "-n", "apt-get", "install", "-y", str(deb)],
                           stdout=logf, stderr=subprocess.STDOUT, env=env, timeout=900)
    return r.returncode == 0


def apply_update(downloaded: Path, cfg: Config, log_dir: Path) -> tuple[str, Path]:
    """Install a downloaded update. Returns ("restart", path) when this launcher must now exit,
    or ("manual", path) when the user has to open the file (deb packages, read-only installs)."""
    kind = cfg.install_kind
    log.info("Applying update %s as %s", downloaded, kind)
    if kind == "inno":
        launch_installer(downloaded, log_dir)
        return "restart", downloaded
    if kind == "appimage" and os.environ.get("APPIMAGE"):
        target = Path(os.environ["APPIMAGE"])
        try:
            replace_appimage(downloaded, target)
        except OSError:
            log.exception("Cannot replace %s", target)
            return _manual(downloaded)
        _relaunch_later([str(target)])
        return "restart", target
    if kind == "macapp" and C.mac_bundle() is not None:
        bundle = C.mac_bundle()
        try:
            install_mac_app(downloaded, bundle)
        except (OSError, subprocess.CalledProcessError, UpdateError):
            log.exception("In-place macOS update failed; opening the disk image instead")
            subprocess.Popen(["open", str(downloaded)])
            return "manual", downloaded
        _relaunch_later(["/usr/bin/open", "-n", str(bundle)])
        return "restart", bundle
    if kind == "deb" and _can_sudo():
        try:
            if install_deb(downloaded, log_dir):
                _relaunch_later(["/usr/bin/pybi-desktop"])
                return "restart", downloaded
        except (OSError, subprocess.SubprocessError):
            log.exception("apt install of the update failed")
    return _manual(downloaded)
