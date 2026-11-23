"""Sign in with GitHub, and keep reports on GitHub.

PyBI uses GitHub's **device flow** (OAuth 2.0 Device Authorization Grant, RFC 8628), the secure sign-in made for apps
that run on your own computer:

1. PyBI asks GitHub for a one-time code. The secret ``device_code`` that goes with it stays inside PyBI's Python
   process and is never sent to the browser.
2. You open https://github.com/login/device, type the short code and approve. Your GitHub password is only ever typed
   on github.com - PyBI never sees it, and no client secret is shipped inside PyBI.
3. PyBI exchanges the approved code for an access token over HTTPS and stores it **only on this computer**: in the
   operating system's keychain when the ``keyring`` package is installed, otherwise in ``~/.pybi/credentials.json``
   with owner-only permissions. The token never goes into .pybi files, exports, or the network view.

The signed-in account is then used by the GitHub connectors (no personal access token to paste), to save and open
reports in a ``pybi-reports`` repository, and to publish dashboards as web pages with GitHub Pages.
"""
from __future__ import annotations

import base64
import os
import re
import secrets
import threading
import time
from typing import Any, Dict, List, Optional

import requests

# Public identifier of the "PyBI" OAuth app (not a secret - device flow apps have no client secret).
# Override with the PYBI_GITHUB_CLIENT_ID environment variable to use your own OAuth app.
DEFAULT_CLIENT_ID = "PYBI_CLIENT_ID_NOT_SET"
GITHUB = "https://github.com"
API = "https://api.github.com"
DEVICE_URL = f"{GITHUB}/login/device"
SIGNUP_URL = f"{GITHUB}/signup?source=pybi"
REVOKE_URL = f"{GITHUB}/settings/applications"
REPORTS_REPO = "pybi-reports"
PAGES_REPO = "pybi-dashboards"
KEYRING_SERVICE = "PyBI GitHub"
STORE_KEY = "__github__"
TIMEOUT = 20
UA = "PyBI (+https://github.com/rafay183/pybi)"


class GitHubError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def client_id() -> str:
    return os.environ.get("PYBI_GITHUB_CLIENT_ID") or DEFAULT_CLIENT_ID


def configured() -> bool:
    return bool(re.fullmatch(r"(Iv[0-9.]*|Ov)[A-Za-z0-9._-]{8,}|[0-9a-f]{20}", client_id()))


def scopes(private: bool) -> str:
    # read:user = name & avatar; repo (private + public) or public_repo = read repo data, save reports, publish pages
    return "read:user repo" if private else "read:user public_repo"


def safe_name(name: str, default: str = "report") -> str:
    s = re.sub(r"[^A-Za-z0-9 ._-]+", "", name or "").strip().strip(".")
    s = re.sub(r"\s+", " ", s)
    return (s or default)[:80]


class _TokenStore:
    """Keychain when available, else ~/.pybi/credentials.json (chmod 600) through PyBI's Credentials store."""

    def __init__(self, creds):
        self.creds = creds

    def _keyring(self):
        if os.environ.get("PYBI_NO_KEYRING"):
            return None
        try:
            import keyring  # optional
            keyring.get_keyring()
            return keyring
        except Exception:  # noqa: BLE001
            return None

    def load(self) -> Dict[str, Any]:
        meta = dict(self.creds.get(STORE_KEY) or {})
        if meta.get("in_keyring"):
            kr = self._keyring()
            tok = None
            if kr:
                try:
                    tok = kr.get_password(KEYRING_SERVICE, meta.get("login") or "default")
                except Exception:  # noqa: BLE001
                    tok = None
            meta["token"] = tok
        return meta

    def save(self, token: str, user: dict, scope: str):
        meta = {"login": user.get("login"), "name": user.get("name"), "avatar_url": user.get("avatar_url"),
                "html_url": user.get("html_url"), "scope": scope, "signed_in_at": int(time.time())}
        kr = self._keyring()
        stored = False
        if kr:
            try:
                kr.set_password(KEYRING_SERVICE, user.get("login") or "default", token)
                stored = True
            except Exception:  # noqa: BLE001
                stored = False
        if stored:
            meta["in_keyring"] = True
        else:
            meta["token"] = token
        self.creds.put(STORE_KEY, meta)

    def clear(self):
        meta = self.creds.get(STORE_KEY) or {}
        if meta.get("in_keyring"):
            kr = self._keyring()
            if kr:
                try:
                    kr.delete_password(KEYRING_SERVICE, meta.get("login") or "default")
                except Exception:  # noqa: BLE001
                    pass
        self.creds.delete(STORE_KEY)


class GitHub:
    """One signed-in GitHub account per PyBI installation."""

    def __init__(self, creds, session: Optional[requests.Session] = None):
        self.store = _TokenStore(creds)
        self.http = session or requests.Session()
        self.lock = threading.Lock()
        self.pending: Dict[str, dict] = {}  # flow id -> {device_code, interval, expires, next_poll, scope}

    # ------------------------------------------------------------ device flow
    def start(self, private: bool = True) -> dict:
        if not configured():
            raise GitHubError("GitHub sign-in is not set up in this PyBI build (no OAuth Client ID). "
                              "Set PYBI_GITHUB_CLIENT_ID or update PyBI.", 503)
        scope = scopes(private)
        r = self._post(f"{GITHUB}/login/device/code", {"client_id": client_id(), "scope": scope})
        if "device_code" not in r:
            raise GitHubError(r.get("error_description") or r.get("error") or "GitHub did not return a sign-in code")
        fid = secrets.token_urlsafe(16)
        now = time.time()
        with self.lock:
            self.pending = {k: v for k, v in self.pending.items() if v["expires"] > now}
            self.pending[fid] = {"device_code": r["device_code"], "interval": int(r.get("interval", 5)),
                                 "expires": now + int(r.get("expires_in", 900)), "next_poll": now, "scope": scope}
        return {"flow": fid, "user_code": r["user_code"], "verification_uri": r.get("verification_uri", DEVICE_URL),
                "expires_in": int(r.get("expires_in", 900)), "interval": int(r.get("interval", 5))}

    def poll(self, fid: str) -> dict:
        with self.lock:
            f = self.pending.get(fid)
        if not f:
            return {"status": "expired"}
        now = time.time()
        if now > f["expires"]:
            self.pending.pop(fid, None)
            return {"status": "expired"}
        if now < f["next_poll"]:
            return {"status": "pending", "interval": f["interval"]}
        f["next_poll"] = now + f["interval"]
        r = self._post(f"{GITHUB}/login/oauth/access_token",
                       {"client_id": client_id(), "device_code": f["device_code"],
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"})
        if r.get("access_token"):
            self.pending.pop(fid, None)
            token = r["access_token"]
            user = self._get_user(token)
            self.store.save(token, user, r.get("scope") or f["scope"])
            return {"status": "ok", "user": self.public_user()}
        err = r.get("error")
        if err == "authorization_pending":
            return {"status": "pending", "interval": f["interval"]}
        if err == "slow_down":
            f["interval"] = int(r.get("interval", f["interval"] + 5))
            f["next_poll"] = now + f["interval"]
            return {"status": "pending", "interval": f["interval"]}
        self.pending.pop(fid, None)
        if err == "access_denied":
            return {"status": "denied"}
        if err == "expired_token":
            return {"status": "expired"}
        return {"status": "error", "error": r.get("error_description") or err or "Sign-in failed"}

    def cancel(self, fid: str):
        with self.lock:
            self.pending.pop(fid, None)

    def sign_out(self):
        self.store.clear()

    # ------------------------------------------------------------ account
    def token(self) -> Optional[str]:
        return self.store.load().get("token")

    def public_user(self) -> Optional[dict]:
        m = self.store.load()
        if not m.get("token"):
            return None
        scope = m.get("scope") or ""
        return {"login": m.get("login"), "name": m.get("name") or m.get("login"), "avatar_url": m.get("avatar_url"),
                "html_url": m.get("html_url"), "private": "repo" in re.split(r"[\s,]+", scope), "scope": scope}

    def status(self) -> dict:
        u = self.public_user()
        return {"configured": configured(), "signedIn": bool(u), "user": u, "deviceUrl": DEVICE_URL,
                "signupUrl": SIGNUP_URL, "revokeUrl": REVOKE_URL, "reportsRepo": REPORTS_REPO}

    def refresh_profile(self) -> Optional[dict]:
        tok = self.token()
        if not tok:
            return None
        try:
            user = self._get_user(tok)
        except GitHubError as exc:
            if exc.status == 401:  # token revoked on github.com
                self.sign_out()
                return None
            raise
        m = self.store.load()
        self.store.save(tok, user, m.get("scope") or "")
        return self.public_user()

    # ------------------------------------------------------------ reports on GitHub
    def _login(self) -> str:
        u = self.public_user()
        if not u:
            raise GitHubError("Sign in with GitHub first.", 401)
        return u["login"]

    def ensure_repo(self, name: str, private: bool, description: str) -> dict:
        login = self._login()
        r = self.api("GET", f"/repos/{login}/{name}", allow=(404,))
        if r is not None:
            return r
        return self.api("POST", "/user/repos", {"name": name, "private": private, "description": description,
                                                 "auto_init": True, "has_issues": False, "has_wiki": False})

    def _put_file(self, repo: str, path: str, data: bytes, message: str) -> dict:
        login = self._login()
        existing = self.api("GET", f"/repos/{login}/{repo}/contents/{path}", allow=(404,))
        body = {"message": message, "content": base64.b64encode(data).decode("ascii")}
        if isinstance(existing, dict) and existing.get("sha"):
            body["sha"] = existing["sha"]
        return self.api("PUT", f"/repos/{login}/{repo}/contents/{path}", body)

    def save_report(self, name: str, data: bytes, html: Optional[bytes] = None) -> dict:
        user = self.public_user() or {}
        repo = self.ensure_repo(REPORTS_REPO, private=bool(user.get("private")),
                                description="My PyBI reports (saved from PyBI Studio)")
        fname = safe_name(name)
        res = self._put_file(REPORTS_REPO, f"reports/{fname}.pybi", data, f"Save {fname}.pybi from PyBI")
        out = {"repo": repo.get("full_name"), "private": repo.get("private"), "path": f"reports/{fname}.pybi",
               "url": (res.get("content") or {}).get("html_url") or f"{repo.get('html_url')}/tree/main/reports"}
        if html:
            h = self._put_file(REPORTS_REPO, f"dashboards/{fname}.html", html, f"Save {fname}.html dashboard from PyBI")
            out["htmlUrl"] = (h.get("content") or {}).get("html_url")
        return out

    def list_reports(self) -> List[dict]:
        login = self._login()
        items = self.api("GET", f"/repos/{login}/{REPORTS_REPO}/contents/reports", allow=(404,))
        if not isinstance(items, list):
            return []
        return [{"name": i["name"][:-5], "path": i["path"], "size": i.get("size", 0), "url": i.get("html_url")}
                for i in items if i.get("type") == "file" and i["name"].endswith(".pybi")]

    def download_report(self, path: str) -> bytes:
        if not re.fullmatch(r"reports/[^/]+\.pybi", path or ""):
            raise GitHubError("Not a PyBI report path")
        login = self._login()
        return self.api("GET", f"/repos/{login}/{REPORTS_REPO}/contents/{path}", raw=True)

    def publish_dashboard(self, name: str, html: bytes) -> dict:
        """Public web page: a public pybi-dashboards repo served by GitHub Pages."""
        login = self._login()
        repo = self.ensure_repo(PAGES_REPO, private=False, description="Dashboards published from PyBI")
        slug = re.sub(r"[^a-z0-9-]+", "-", safe_name(name).lower()).strip("-") or "dashboard"
        self._put_file(PAGES_REPO, f"{slug}.html", html, f"Publish {slug} from PyBI")
        pages = self.api("GET", f"/repos/{login}/{PAGES_REPO}/pages", allow=(404,))
        if pages is None:
            pages = self.api("POST", f"/repos/{login}/{PAGES_REPO}/pages", {"source": {"branch": repo.get("default_branch") or "main",
                                                                                      "path": "/"}}, allow=(409,)) or {}
        base = (pages.get("html_url") if isinstance(pages, dict) else None) or f"https://{login.lower()}.github.io/{PAGES_REPO}/"
        return {"url": base.rstrip("/") + f"/{slug}.html", "repo": repo.get("html_url"),
                "note": "GitHub Pages can take a minute to publish the first time."}

    # ------------------------------------------------------------ HTTP
    def api(self, method: str, path: str, body: Any = None, allow=(), raw: bool = False, token: Optional[str] = None):
        tok = token or self.token()
        if not tok:
            raise GitHubError("Sign in with GitHub first.", 401)
        headers = {"Authorization": f"Bearer {tok}", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA,
                   "Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json"}
        try:
            r = self.http.request(method, API + path, headers=headers, json=body, timeout=TIMEOUT)
        except requests.RequestException as exc:
            raise GitHubError(f"Could not reach GitHub: {exc}", 502) from exc
        if r.status_code in allow:
            return None
        if r.status_code == 401:
            raise GitHubError("Your GitHub sign-in has expired or was revoked. Please sign in again.", 401)
        if r.status_code >= 400:
            try:
                msg = r.json().get("message")
            except ValueError:
                msg = r.text[:200]
            if r.status_code in (403, 404) and "repo" in path:
                msg = f"{msg} - your sign-in may not allow this. Sign out and sign in again with the access you need."
            raise GitHubError(f"GitHub: {msg}", r.status_code)
        if raw:
            return r.content
        return r.json() if r.content else {}

    def _get_user(self, token: str) -> dict:
        return self.api("GET", "/user", token=token)

    def _post(self, url: str, data: dict) -> dict:
        try:
            r = self.http.post(url, data=data, headers={"Accept": "application/json", "User-Agent": UA}, timeout=TIMEOUT)
        except requests.RequestException as exc:
            raise GitHubError(f"Could not reach GitHub: {exc}", 502) from exc
        try:
            return r.json()
        except ValueError as exc:
            raise GitHubError(f"Unexpected answer from GitHub ({r.status_code})", 502) from exc
