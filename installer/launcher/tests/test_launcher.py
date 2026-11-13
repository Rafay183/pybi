"""Tests for the launcher's logic. Run from installer/launcher:  python -m pytest -q"""
import hashlib
import http.server
import json
import os
import sys
import textwrap
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pybi_launcher import config as C  # noqa: E402
from pybi_launcher import server as S  # noqa: E402
from pybi_launcher import updater as U  # noqa: E402
from pybi_launcher import versions as V  # noqa: E402
from pybi_launcher.instance import SingleInstance  # noqa: E402


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("PYBI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("PYBI_WORKSPACE", str(tmp_path / "ws"))
    monkeypatch.setenv("PYBI_APP_DIR", str(tmp_path / "app"))
    (tmp_path / "app").mkdir()
    return tmp_path


# ---------------- versions ----------------
@pytest.mark.parametrize("a,b", [
    ("v1.2.3", "1.2.2"), ("1.10.0", "1.9.9"), ("2.0", "1.99.99"), ("1.2.3", "1.2.3rc1"),
    ("1.2.3rc2", "1.2.3rc1"), ("1.2.3rc1", "1.2.3b5"), ("1.2.3-beta.2", "1.2.3-alpha"),
    ("1.2.3a1", "1.2.3.dev9"), ("1.2.3.post1", "1.2.3"), ("v0.1.1", "0.1.0"),
])
def test_ordering(a, b):
    assert V.is_newer(a, b)
    assert not V.is_newer(b, a)


def test_equal_and_garbage():
    assert not V.is_newer("v1.2.0", "1.2")
    assert not V.is_newer("latest", "1.0.0")
    assert V.is_newer("1.0.0", "0.0.0-dev")
    assert V.is_newer("1.0.0", "not-a-version")
    assert V.Version("1.2.3-rc.1").is_prerelease


# ---------------- config ----------------
def test_config_files(isolated):
    app = isolated / "app"
    (app / "launcher.json").write_text(json.dumps({"version": "1.4.0", "github_repo": "o/r", "port": 9100,
                                                   "unknown_key": 1}))
    (app / "settings.ini").write_text("[updates]\nauto_check=0\ninclude_prereleases=1\n")
    cfg = C.Config.load()
    assert (cfg.version, cfg.github_repo, cfg.port) == ("1.4.0", "o/r", 9100)
    assert cfg.auto_check is False and cfg.include_prereleases is True


def test_state_roundtrip():
    s = C.State.load()
    s.skipped_version, s.last_check = "2.0.0", 123.0
    s.save()
    assert C.State.load().skipped_version == "2.0.0"


# ---------------- release selection ----------------
def _rel(tag, pre=False, draft=False, assets=("PyBI-Setup.exe", "PyBI-Setup.exe.sha256")):
    return {"tag_name": tag, "prerelease": pre, "draft": draft, "name": tag, "body": "notes",
            "html_url": f"https://x/{tag}",
            "assets": [{"name": n, "browser_download_url": f"https://dl/{tag}/{n}", "size": 10} for n in assets]}


def test_pick_release_rules():
    payload = [_rel("v2.0.0", pre=True), _rel("v1.3.0", draft=True), _rel("v1.2.0"),
               _rel("v1.2.5", assets=("source.zip",)), _rel("v1.1.0")]
    r = U.pick_release(payload, r"^PyBI-Setup.*\.exe$", include_prereleases=False)
    assert r.version == "1.2.0" and r.sha256_url.endswith(".sha256") and r.asset_name == "PyBI-Setup.exe"
    r = U.pick_release(payload, r"^PyBI-Setup.*\.exe$", include_prereleases=True)
    assert r.version == "2.0.0" and r.prerelease


# ---------------- update check + download against a fake GitHub ----------------
class _FakeGitHub(http.server.BaseHTTPRequestHandler):
    payload: bytes = b""
    files: dict = {}

    def do_GET(self):
        body = self.files.get(self.path, self.payload if self.path.startswith("/repos/") else None)
        if body is None:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


@pytest.fixture
def fake_github(monkeypatch):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _FakeGitHub)
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(U, "API", base + "/repos/{repo}/releases")
    yield base, _FakeGitHub
    srv.shutdown()


def _publish(base, handler, version, exe_bytes, sha=None):
    sha = sha or hashlib.sha256(exe_bytes).hexdigest()
    rel = _rel(f"v{version}")
    rel["assets"][0]["browser_download_url"] = f"{base}/dl/PyBI-Setup.exe"
    rel["assets"][1]["browser_download_url"] = f"{base}/dl/PyBI-Setup.exe.sha256"
    rel["assets"][0]["size"] = len(exe_bytes)
    handler.payload = json.dumps([rel]).encode()
    handler.files = {"/dl/PyBI-Setup.exe": exe_bytes, "/dl/PyBI-Setup.exe.sha256": f"{sha}  PyBI-Setup.exe\n".encode()}


def test_check_and_download(fake_github, isolated):
    base, h = fake_github
    exe = os.urandom(300_000)
    _publish(base, h, "1.3.0", exe)
    cfg = C.Config(version="1.2.0", github_repo="o/r")
    st = C.State()
    res = U.check(cfg, st, force=True)
    assert res.status == "available" and res.release.version == "1.3.0"
    # throttling and skipping
    assert U.check(cfg, st).status == "throttled"
    st.last_check, st.skipped_version = 0, "1.3.0"
    assert U.check(cfg, st).status == "skipped"
    # same version installed -> current
    assert U.check(C.Config(version="1.3.0", github_repo="o/r"), C.State(), force=True).status == "current"
    # download + checksum
    seen = []
    path = U.download(res.release, isolated / "dl", progress=lambda d, t: seen.append((d, t)))
    assert path.read_bytes() == exe and seen[-1] == (len(exe), len(exe))


def test_checksum_mismatch_rejected(fake_github, isolated):
    base, h = fake_github
    _publish(base, h, "1.3.0", b"real installer", sha="0" * 64)
    res = U.check(C.Config(version="1.0.0", github_repo="o/r"), C.State(), force=True)
    with pytest.raises(U.UpdateError, match="integrity"):
        U.download(res.release, isolated / "dl")
    assert not list((isolated / "dl").glob("*.exe"))


def test_check_offline_is_graceful(monkeypatch):
    monkeypatch.setattr(U, "API", "http://127.0.0.1:9/repos/{repo}/releases")
    res = U.check(C.Config(version="1.0.0", github_repo="o/r"), C.State(), force=True)
    assert res.status == "error" and "GitHub" in res.error


def test_disabled_without_repo():
    assert U.check(C.Config(), C.State(), force=True).status == "disabled"


# ---------------- server ----------------
FAKE_PYBI = textwrap.dedent('''
    import http.server, os, sys
    host, port = os.environ["PYBI_HOST"], int(os.environ["PYBI_PORT"])
    print(f"PyBI running at http://{host}:{port}", flush=True)
    http.server.ThreadingHTTPServer((host, port), http.server.SimpleHTTPRequestHandler).serve_forever()
''')


def test_server_module_entry(isolated, monkeypatch):
    monkeypatch.setenv("PYBI_PYTHON", sys.executable)
    # the child runs with cwd = workspace, so a package there is importable like an installed one
    ws = C.workspace_dir()
    (ws / "pybi").mkdir()
    (ws / "pybi" / "__init__.py").write_text("")
    (ws / "pybi" / "__main__.py").write_text(FAKE_PYBI)
    cfg = C.Config(port=18050, start_timeout=20)
    srv = S.Server(cfg)
    assert srv.build_command(18050)[1:] == ["-m", "pybi"]
    srv.start()
    try:
        url = srv.wait_ready()
        assert url.startswith("http://127.0.0.1:")
        assert S.port_open("127.0.0.1", srv.port)
    finally:
        srv.stop()
    time.sleep(0.3)
    assert not srv.running


def test_server_starter_fallback_and_busy_port(isolated, monkeypatch):
    import socket
    monkeypatch.setenv("PYBI_PYTHON", sys.executable)
    ws = C.workspace_dir()
    (ws / "pybi").mkdir()
    (ws / "pybi" / "__init__.py").write_text("")          # package without __main__
    (ws / "app.py").write_text(FAKE_PYBI)                  # user's dashboard script
    blocker = socket.socket()
    blocker.bind(("127.0.0.1", 18060))
    blocker.listen(1)
    try:
        srv = S.Server(C.Config(port=18060, start_timeout=20))
        srv.start()
        try:
            assert srv.port != 18060                       # moved to a free port
            assert srv.wait_ready().endswith(f":{srv.port}/")
        finally:
            srv.stop()
    finally:
        blocker.close()


def test_server_crash_reports_tail(isolated, monkeypatch):
    monkeypatch.setenv("PYBI_PYTHON", sys.executable)
    ws = C.workspace_dir()
    (ws / "pybi").mkdir()
    (ws / "pybi" / "__init__.py").write_text("")
    (ws / "pybi" / "__main__.py").write_text("raise SystemExit('boom: missing data file')")
    srv = S.Server(C.Config(port=18070, start_timeout=10))
    srv.start()
    with pytest.raises(S.ServerError) as e:
        srv.wait_ready()
    time.sleep(0.2)
    assert "boom" in e.value.tail
    srv.stop()


def test_custom_command_placeholders(isolated, monkeypatch):
    monkeypatch.setenv("PYBI_PYTHON", sys.executable)
    srv = S.Server(C.Config(command=["{python}", "-m", "pybi", "serve", "--port", "{port}", "--dir", "{workspace}"]))
    cmd = srv.build_command(8123)
    assert cmd[0] == sys.executable and cmd[5] == "8123" and cmd[-1] == str(C.workspace_dir())


# ---------------- single instance ----------------
def test_single_instance():
    port = S.find_free_port("127.0.0.1", 47900)
    a, b = SingleInstance(port), SingleInstance(port)
    assert a.acquire()
    hits = []
    a.serve(lambda: hits.append(1))
    assert not b.acquire()
    for _ in range(40):
        if hits:
            break
        time.sleep(0.05)
    assert hits == [1]
    a.release()
