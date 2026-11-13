"""Update checks against GitHub Releases, verified download, silent upgrade.

Release contract (produced by .github/workflows/build-installer.yml):
  * tag ``vX.Y.Z`` (pre-releases marked as such on GitHub)
  * asset ``PyBI-Setup.exe``            the Inno Setup installer
  * asset ``PyBI-Setup.exe.sha256``     its SHA-256, "<hex>  PyBI-Setup.exe"
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import versions
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


def _get(url: str, timeout: float, accept: str = "application/vnd.github+json") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    token = os.environ.get("PYBI_GITHUB_TOKEN")  # optional, raises the API rate limit
    if token and "api.github.com" in url:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
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
    target = dest / f"PyBI-Setup-{rel.version}.exe"
    part = target.with_suffix(".part")
    expected = _expected_sha(rel, timeout)
    req = urllib.request.Request(rel.asset_url, headers={"User-Agent": UA, "Accept": "application/octet-stream"})
    h = hashlib.sha256()
    done = 0
    with urllib.request.urlopen(req, timeout=timeout) as r, open(part, "wb") as f:
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
        files = sorted(dest.glob("PyBI-Setup-*.exe"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in files[keep:]:
            p.unlink(missing_ok=True)
    except OSError:
        pass
