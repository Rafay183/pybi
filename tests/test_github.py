"""Sign in with GitHub (device flow) and reports on GitHub, with GitHub's HTTP API faked."""
import base64
import json

import pytest

import pybi.github as ghmod
from pybi.github import GitHub, GitHubError
from pybi.server import Credentials, create_app

CID = "Ov23liTESTCLIENTID01"


class Resp:
    def __init__(self, status=200, body=None, content=None):
        self.status_code = status
        self._body = body
        self.content = content if content is not None else (json.dumps(body).encode() if body is not None else b"")
        self.text = self.content.decode("utf-8", "replace")

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeGitHub:
    """Just enough of github.com + api.github.com for PyBI's flows."""

    def __init__(self):
        self.approved = False
        self.denied = False
        self.files = {}
        self.repos = {}
        self.pages = False
        self.calls = []

    # requests.Session API
    def post(self, url, data=None, headers=None, timeout=None):
        self.calls.append(("POST", url, data))
        assert data["client_id"] == CID
        if url.endswith("/login/device/code"):
            return Resp(200, {"device_code": "SECRET-DEVICE-CODE", "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device",
                              "expires_in": 900, "interval": 0})
        if url.endswith("/login/oauth/access_token"):
            assert data["device_code"] == "SECRET-DEVICE-CODE"
            if self.denied:
                return Resp(200, {"error": "access_denied"})
            if not self.approved:
                return Resp(200, {"error": "authorization_pending"})
            return Resp(200, {"access_token": "gho_TESTTOKEN", "token_type": "bearer", "scope": "read:user,repo"})
        raise AssertionError(url)

    def request(self, method, url, headers=None, json=None, timeout=None):
        assert headers["Authorization"] == "Bearer gho_TESTTOKEN"
        path = url.replace("https://api.github.com", "")
        self.calls.append((method, path, json))
        if path == "/user":
            return Resp(200, {"login": "rafay", "name": "Rafay", "avatar_url": "https://avatars.example/u/1?v=4", "html_url": "https://github.com/rafay"})
        if path.startswith("/repos/rafay/") and path.count("/") == 3 and method == "GET":
            name = path.split("/")[3]
            return Resp(200, self.repos[name]) if name in self.repos else Resp(404, {"message": "Not Found"})
        if path == "/user/repos" and method == "POST":
            self.repos[json["name"]] = {"full_name": "rafay/" + json["name"], "private": json["private"],
                                        "html_url": "https://github.com/rafay/" + json["name"], "default_branch": "main"}
            return Resp(201, self.repos[json["name"]])
        if "/contents/" in path:
            repo, fpath = path.split("/")[3], path.split("/contents/")[1]
            key = (repo, fpath)
            if method == "PUT":
                if key in self.files:
                    assert json.get("sha") == "sha1", "updates must send the current sha"
                self.files[key] = base64.b64decode(json["content"])
                return Resp(201, {"content": {"html_url": f"https://github.com/rafay/{repo}/blob/main/{fpath}"}})
            if key in self.files:
                if headers["Accept"].endswith("raw+json"):
                    return Resp(200, content=self.files[key])
                return Resp(200, {"sha": "sha1"})
            listing = [{"type": "file", "name": k[1].split("/")[-1], "path": k[1], "size": len(v), "html_url": "u"}
                       for k, v in self.files.items() if k[0] == repo and k[1].startswith(fpath + "/")]
            return Resp(200, listing) if listing else Resp(404, {"message": "Not Found"})
        if path.endswith("/pages"):
            if method == "GET":
                return Resp(200, {"html_url": "https://rafay.github.io/pybi-dashboards/"}) if self.pages else Resp(404, {"message": "Not Found"})
            self.pages = True
            return Resp(201, {"html_url": "https://rafay.github.io/pybi-dashboards/"})
        raise AssertionError((method, path))


@pytest.fixture()
def fake(monkeypatch, tmp_path):
    monkeypatch.setenv("PYBI_GITHUB_CLIENT_ID", CID)
    monkeypatch.setenv("PYBI_NO_KEYRING", "1")
    monkeypatch.setattr("pybi.server.HOME", tmp_path)
    f = FakeGitHub()
    return f


def make_app(fake):
    app = create_app()
    app.config["GITHUB"].http = fake
    return app


def sign_in(c, fake):
    r = c.post("/api/github/start", json={"private": True}).get_json()
    assert r["user_code"] == "ABCD-1234" and "SECRET" not in json.dumps(r)  # the device code never reaches the browser
    assert c.post("/api/github/poll", json={"flow": r["flow"]}).get_json()["status"] == "pending"
    fake.approved = True
    return c.post("/api/github/poll", json={"flow": r["flow"]}).get_json()


def test_device_flow_sign_in_and_out(fake, tmp_path):
    app = make_app(fake)
    c = app.test_client()
    st = c.get("/api/github/status").get_json()
    assert st["configured"] and not st["signedIn"] and st["signupUrl"].startswith("https://github.com/signup")
    r = sign_in(c, fake)
    assert r["status"] == "ok" and r["user"]["login"] == "rafay" and r["user"]["private"] is True
    st = c.get("/api/github/status").get_json()
    assert st["signedIn"] and "token" not in json.dumps(st) and "gho_" not in json.dumps(st)
    stored = json.loads((tmp_path / "credentials.json").read_text())
    assert stored["__github__"]["token"] == "gho_TESTTOKEN"  # only on this computer
    assert ("read:user repo") in [call[2].get("scope") for call in fake.calls if call[0] == "POST" and call[1].endswith("device/code")]
    assert c.post("/api/github/signout").get_json()["signedIn"] is False
    assert "__github__" not in json.loads((tmp_path / "credentials.json").read_text())


def test_denied_and_unknown_flow(fake):
    c = make_app(fake).test_client()
    r = c.post("/api/github/start", json={"private": False}).get_json()
    fake.denied = True
    assert c.post("/api/github/poll", json={"flow": r["flow"]}).get_json()["status"] == "denied"
    assert c.post("/api/github/poll", json={"flow": "nope"}).get_json()["status"] == "expired"


def test_not_configured(monkeypatch, tmp_path):
    monkeypatch.delenv("PYBI_GITHUB_CLIENT_ID", raising=False)
    monkeypatch.setattr(ghmod, "DEFAULT_CLIENT_ID", "PYBI_CLIENT_ID_NOT_SET")
    gh = GitHub(Credentials(tmp_path))
    assert gh.status()["configured"] is False
    with pytest.raises(GitHubError):
        gh.start()


def test_save_open_publish_reports(fake):
    app = make_app(fake)
    c = app.test_client()
    sign_in(c, fake)
    c.post("/api/sample", json={})
    r = c.post("/api/github/save", json={"name": "Sales / Q4", "html": True}).get_json()
    assert r["repo"] == "rafay/pybi-reports" and r["private"] is True and r["path"] == "reports/Sales Q4.pybi"
    assert ("pybi-reports", r["path"]) in fake.files and any(k[1].startswith("dashboards/") for k in fake.files)
    c.post("/api/github/save", json={"name": "Sales / Q4"})  # second save updates (sends sha)
    reports = c.get("/api/github/reports").get_json()["reports"]
    assert [x["path"] for x in reports] == [r["path"]]
    c.post("/api/new", json={})
    st = c.post("/api/github/open", json={"path": r["path"]}).get_json()
    assert "Sales" in st["tables"] and st["report"]["pages"]
    assert c.post("/api/github/open", json={"path": "../../etc/passwd"}).status_code == 400
    pub = c.post("/api/github/publish", json={"name": "Sales Q4"}).get_json()
    assert pub["url"] == "https://rafay.github.io/pybi-dashboards/sales-q4.html"
    assert fake.repos["pybi-dashboards"]["private"] is False


def test_github_connector_uses_sign_in(fake, monkeypatch):
    app = make_app(fake)
    c = app.test_client()
    sign_in(c, fake)
    seen = {}

    def fake_run(conn, params, file=None, preview=False, tables=None):
        seen["token"] = params.get("token")
        import pandas as pd
        return {"Issues": pd.DataFrame({"n": [1]})}

    monkeypatch.setattr("pybi.server.run_connector", fake_run)
    r = c.post("/api/connectors/github/load", json={"params": {"resource": "Issues", "owner": "rafay", "repo": "pybi"}})
    assert r.status_code == 200 and seen["token"] == "gho_TESTTOKEN"
    src = r.get_json()["sources"][0]
    assert "token" not in json.dumps(src)  # the sign-in token is never stored with the source


def test_cross_site_requests_are_blocked(fake):
    c = make_app(fake).test_client()
    assert c.post("/api/github/start", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert c.post("/api/github/signout", headers={"Origin": "http://localhost"}).status_code == 200
