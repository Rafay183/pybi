"""PyBI web server: the studio (editor) for the local user and a read-only live view for the network."""
from __future__ import annotations

import io
import ipaddress
import json
import logging
import os
import socket
import threading
import time
import webbrowser
from pathlib import Path

import pandas as pd
from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory

from . import __version__
from .connectors import BY_ID, ConnectorError, catalog_json
from .connectors import discover as discover_tables
from .connectors import run as run_connector
from .exporters import export_html, export_pdf, export_pptx
from .project import Project, read_sqlite, read_upload, table_payload
from .sample import calendar_table, sample_report, sample_tables
from .transform import STEP_LABELS, StepError, profile

STATIC = Path(__file__).parent / "static"
HOME = Path(os.environ.get("PYBI_HOME", Path.home() / ".pybi"))


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


class Credentials:
    """Secrets (passwords, tokens) stay on this computer in ~/.pybi/credentials.json — never inside .pybi files."""

    def __init__(self, home: Path):
        self.path = home / "credentials.json"

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            return {}

    def get(self, source: str) -> dict:
        return self._load().get(source, {})

    def put(self, source: str, secrets: dict):
        data = self._load()
        data[source] = secrets
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=1), "utf-8")
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def rename(self, old: str, new: str):
        data = self._load()
        if old in data:
            data[new] = data.pop(old)
            self.path.write_text(json.dumps(data, indent=1), "utf-8")


def create_app(project: Project | None = None, host: str = "127.0.0.1", port: int = 8050) -> Flask:
    app = Flask("pybi", static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024
    proj = project or Project()
    app.config["PROJECT"] = proj
    rev = {"n": 0}

    def bump():
        rev["n"] += 1
        try:
            HOME.mkdir(parents=True, exist_ok=True)
            (HOME / "autosave.pybi").write_bytes(proj.to_bytes())
        except Exception:  # noqa: BLE001 - autosave must never break the app
            pass

    def is_local() -> bool:
        try:
            return ipaddress.ip_address(request.remote_addr or "127.0.0.1").is_loopback
        except ValueError:
            return False

    creds = Credentials(HOME)

    def connector_request(cid):
        c = BY_ID.get(cid)
        if not c:
            abort(404)
        if request.files or request.form:
            params = json.loads(request.form.get("params") or "{}")
            tables = json.loads(request.form.get("tables") or "null")
            name = request.form.get("name") or ""
            remember = request.form.get("remember", "true") != "false"
            f = request.files.get("file")
            file = (f.filename, f.read()) if f and f.filename else None
        else:
            body = request.get_json(force=True) or {}
            params, tables, name, file = body.get("params") or {}, body.get("tables"), body.get("name") or "", None
            remember = body.get("remember", True)
        return c, params, tables, name, file, remember

    def conn_err(exc):
        return jsonify({"error": str(exc), "install": getattr(exc, "install", None)}), 400

    VIEW_OK = ("/view", "/static/", "/api/view-state", "/api/revision", "/favicon")

    @app.before_request
    def guard():
        # Anyone on the network may *view*; only the machine running PyBI may *edit*.
        if not is_local() and not request.path.startswith(VIEW_OK):
            if request.path == "/":
                return Response("", 302, {"Location": "/view"})
            abort(403)

    def ok(**extra):
        st = proj.state()
        st.update(extra)
        return jsonify(st)

    def err(msg, code=400):
        return jsonify({"error": str(msg)}), code

    # ---------------------------------------------------------------- pages
    @app.get("/")
    def index():
        return send_from_directory(STATIC, "index.html")

    @app.get("/view")
    def view():
        return send_from_directory(STATIC, "viewer.html")

    @app.get("/static/<path:name>")
    def static_files(name):
        resp = send_from_directory(STATIC, name)
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.get("/favicon.ico")
    def favicon():
        return send_from_directory(STATIC, "favicon.svg", mimetype="image/svg+xml")

    # ---------------------------------------------------------------- state
    @app.get("/api/state")
    def state():
        return ok()

    @app.get("/api/view-state")
    def view_state():
        st = proj.state()
        return jsonify({"report": st["report"], "tables": st["tables"], "app": st["app"], "revision": rev["n"]})

    @app.get("/api/revision")
    def revision():
        return jsonify({"revision": rev["n"]})

    @app.get("/api/info")
    def info():
        lan = lan_ip()
        shared = host in ("0.0.0.0", "::")
        return jsonify({"version": __version__, "localUrl": f"http://127.0.0.1:{port}/",
                        "shareUrl": f"http://{lan}:{port}/view" if shared else None, "shared": shared,
                        "lanIp": lan, "port": port, "path": str(proj.path) if proj.path else None,
                        "home": str(HOME), "stepLabels": STEP_LABELS})

    @app.post("/api/report")
    def save_report():
        data = request.get_json(force=True)
        with proj.lock:
            proj.report = data
            proj.dirty = True
        bump()
        return jsonify({"ok": True, "revision": rev["n"]})

    # ---------------------------------------------------------------- data in
    @app.post("/api/upload")
    def upload():
        files = request.files.getlist("file")
        if not files:
            return err("No file received")
        added = []
        try:
            for f in files:
                for name, df in read_upload(f.filename, f.read(), request.form.get("sheet") or None).items():
                    added.append(proj.add_source(name, df, Path(f.filename).suffix.lstrip(".").lower(), f.filename))
        except Exception as exc:  # noqa: BLE001
            return err(f"Could not read file: {exc}")
        bump()
        return ok(added=added)

    @app.post("/api/paste")
    def paste():
        body = request.get_json(force=True)
        text = body.get("text", "")
        try:
            sep = "\t" if "\t" in text.splitlines()[0] else None
            df = pd.read_csv(io.StringIO(text), sep=sep, engine="python")
        except Exception as exc:  # noqa: BLE001
            return err(f"Could not parse pasted data: {exc}")
        name = proj.add_source(body.get("name") or "Pasted data", df, "paste", "Entered data")
        bump()
        return ok(added=[name])

    @app.post("/api/url")
    def from_url():
        body = request.get_json(force=True)
        url = body.get("url", "").strip()
        if not url.lower().startswith(("http://", "https://")):
            return err("Enter an http(s) URL to a CSV, Excel or JSON file")
        try:
            import urllib.request
            with urllib.request.urlopen(url, timeout=30) as r:  # noqa: S310 - user supplied, local tool
                data = r.read()
            fname = url.split("?")[0].rstrip("/").split("/")[-1] or "web.csv"
            if "." not in fname:
                fname += ".csv"
            added = [proj.add_source(n, df, "web", url) for n, df in read_upload(fname, data).items()]
        except Exception as exc:  # noqa: BLE001
            return err(f"Could not load URL: {exc}")
        bump()
        return ok(added=added)

    @app.post("/api/sqlite")
    def sqlite():
        body = request.get_json(force=True)
        try:
            dfs = read_sqlite(body["path"], body.get("query") or None)
            added = [proj.add_source(body.get("name") or n, df, "sqlite", body["path"]) for n, df in dfs.items()]
        except Exception as exc:  # noqa: BLE001
            return err(f"SQLite error: {exc}")
        bump()
        return ok(added=added)

    @app.post("/api/sample")
    def sample():
        for n, df in sample_tables().items():
            if n in proj.sources:
                proj.remove_source(n)
            proj.add_source(n, df, "sample", "PyBI demo data", detect=False)
        with proj.lock:
            proj.report = sample_report()
        bump()
        return ok()

    @app.post("/api/datetable")
    def date_table():
        body = request.get_json(force=True)
        start, end = body.get("start"), body.get("end")
        if body.get("table") and body.get("column"):
            col = pd.to_datetime(proj.table(body["table"])[body["column"]], errors="coerce").dropna()
            if col.empty:
                return err("That column has no dates")
            start, end = f"{col.min().year}-01-01", f"{col.max().year}-12-31"
        if not start or not end:
            return err("Choose a date column or a start and end date")
        name = proj.add_source(body.get("name") or "Calendar", calendar_table(start, end), "calendar", "Generated date table", detect=False)
        with proj.lock:
            props = proj.report.setdefault("columnProps", {})
            props[f"{name}[Month Name]"] = {"sortBy": "Month Number"}
            props[f"{name}[Weekday]"] = {"sortBy": "Weekday Number"}
            if body.get("table") and body.get("column"):
                proj.report.setdefault("relationships", []).append({
                    "id": f"r{int(time.time() * 1000)}", "fromTable": body["table"], "fromColumn": body["column"],
                    "toTable": name, "toColumn": "Date", "crossFilter": "single", "active": True})
        bump()
        return ok(added=[name])

    # ---------------------------------------------------------------- connectors
    @app.get("/api/connectors")
    def connectors():
        return jsonify(catalog_json())

    @app.post("/api/connectors/<cid>/discover")
    def conn_discover(cid):
        c, params, _, _, file, _ = connector_request(cid)
        try:
            names = discover_tables(c, params, file)
        except ConnectorError as exc:
            return conn_err(exc)
        except Exception as exc:  # noqa: BLE001
            return conn_err(ConnectorError(f"{type(exc).__name__}: {exc}"))
        return jsonify({"tables": names})

    @app.post("/api/connectors/<cid>/preview")
    def conn_preview(cid):
        c, params, tables, _, file, _ = connector_request(cid)
        try:
            dfs = run_connector(c, params, file, preview=True, tables=tables[:1] if tables else None)
        except ConnectorError as exc:
            return conn_err(exc)
        except Exception as exc:  # noqa: BLE001
            return conn_err(ConnectorError(f"{type(exc).__name__}: {exc}"))
        out = {}
        for k, df in list(dfs.items())[:6]:
            out[k] = table_payload(df.head(200).pipe(lambda d: d.astype({col: str for col in d.columns if d[col].dtype == object})))
        return jsonify({"tables": out})

    @app.post("/api/connectors/<cid>/load")
    def conn_load(cid):
        c, params, tables, name, file, remember = connector_request(cid)
        try:
            dfs = run_connector(c, params, file, preview=False, tables=tables)
        except ConnectorError as exc:
            return conn_err(exc)
        except Exception as exc:  # noqa: BLE001
            return conn_err(ConnectorError(f"{type(exc).__name__}: {exc}"))
        if not dfs:
            return err("Nothing to load")
        secret_keys = {p.key for p in c.params if p.secret}
        public = {k: v for k, v in params.items() if k not in secret_keys}
        secrets = {k: v for k, v in params.items() if k in secret_keys and v}
        added = []
        for tname, df in dfs.items():
            label = name if (name and len(dfs) == 1) else tname
            meta = {"id": c.id, "params": public, "table": tname, "upload": bool(file)}
            n = proj.add_source(label, df, c.id, c.name if not file else f"{c.name}: {file[0]}", connector=meta)
            if secrets and remember:
                creds.put(n, secrets)
            added.append(n)
        bump()
        return ok(added=added)

    @app.post("/api/source/<name>/refresh")
    def refresh_source(name):
        src = proj.sources.get(name)
        if not src:
            return err("Unknown query", 404)
        try:
            refresh_one(src)
        except ConnectorError as exc:
            return conn_err(exc)
        bump()
        return ok(refreshed=[name])

    def refresh_one(src):
        meta = src.connector
        if not meta or meta.get("upload"):
            raise ConnectorError(f"'{src.name}' was uploaded from a file — upload it again or use a path/URL to make it refreshable")
        c = BY_ID.get(meta["id"])
        if not c:
            raise ConnectorError(f"Connector '{meta['id']}' is not available in this PyBI version")
        params = dict(meta.get("params") or {}, **creds.get(src.name))
        dfs = run_connector(c, params, None, preview=False, tables=[meta["table"]] if c.multi and meta.get("table") else None)
        df = dfs.get(meta.get("table")) if meta.get("table") in dfs else next(iter(dfs.values()))
        proj.replace_raw(src.name, df)

    @app.post("/api/refresh-all")
    def refresh_all():
        done, failed = [], {}
        for src in list(proj.sources.values()):
            if not src.connector or src.connector.get("upload"):
                continue
            try:
                refresh_one(src)
                done.append(src.name)
            except Exception as exc:  # noqa: BLE001
                failed[src.name] = str(exc)
        bump()
        return ok(refreshed=done, failed=failed)

    # ---------------------------------------------------------------- query editor
    @app.post("/api/source/<name>/preview")
    def preview(name):
        if name not in proj.sources:
            return err("Unknown query", 404)
        steps = request.get_json(force=True).get("steps", [])
        try:
            df = proj.preview(name, steps)
        except (StepError, Exception) as exc:  # noqa: BLE001
            return err(exc)
        head = df.head(int(request.args.get("limit", 150)))
        return jsonify({"table": table_payload(head), "rowCount": int(len(df)), "profile": profile(df)})

    @app.post("/api/source/<name>/steps")
    def set_steps(name):
        if name not in proj.sources:
            return err("Unknown query", 404)
        try:
            proj.set_steps(name, request.get_json(force=True).get("steps", []))
        except Exception as exc:  # noqa: BLE001
            return err(exc)
        bump()
        return ok()

    @app.post("/api/source/<name>/rename")
    def rename(name):
        try:
            new = request.get_json(force=True).get("name", "").strip()
            proj.rename_source(name, new)
            creds.rename(name, new)
        except Exception as exc:  # noqa: BLE001
            return err(exc)
        bump()
        return ok()

    @app.post("/api/source/<name>/duplicate")
    def duplicate(name):
        src = proj.sources.get(name)
        if not src:
            return err("Unknown query", 404)
        new = proj.add_source(name + " copy", src.raw, src.kind, src.origin, detect=False)
        proj.sources[new].steps = list(src.steps)
        bump()
        return ok(added=[new])

    @app.delete("/api/source/<name>")
    def delete(name):
        proj.remove_source(name)
        bump()
        return ok()

    @app.get("/api/table/<name>.csv")
    def table_csv(name):
        try:
            df = proj.table(name)
        except KeyError:
            abort(404)
        return Response(df.to_csv(index=False), mimetype="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})

    @app.post("/api/table-export")
    def table_export():
        body = request.get_json(force=True)
        df = pd.DataFrame(body.get("rows", []), columns=body.get("columns"))
        fmt = body.get("format", "csv")
        name = body.get("name", "data")
        if fmt == "xlsx":
            out = io.BytesIO()
            df.to_excel(out, index=False)
            return send_file(io.BytesIO(out.getvalue()), as_attachment=True, download_name=f"{name}.xlsx")
        return Response(df.to_csv(index=False), mimetype="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})

    # ---------------------------------------------------------------- project files
    @app.post("/api/new")
    def new_project():
        fresh = Project()
        with proj.lock:
            proj.sources, proj.report, proj.path = fresh.sources, fresh.report, None
            proj._cache.clear()
        bump()
        return ok()

    @app.post("/api/save")
    def save():
        body = request.get_json(silent=True) or {}
        if body.get("report"):
            proj.report = body["report"]
        target = body.get("path") or (str(proj.path) if proj.path else None)
        if not target:
            safe = "".join(ch for ch in proj.report.get("title", "report") if ch.isalnum() or ch in " -_").strip() or "report"
            target = str(Path.cwd() / f"{safe}.pybi")
        try:
            p = proj.save(target)
        except Exception as exc:  # noqa: BLE001
            return err(f"Could not save: {exc}")
        return jsonify({"ok": True, "path": str(p)})

    @app.get("/api/download-project")
    def download_project():
        name = (proj.path.stem if proj.path else proj.report.get("title", "report")) + ".pybi"
        return send_file(io.BytesIO(proj.to_bytes()), as_attachment=True, download_name=name,
                         mimetype="application/zip")

    @app.post("/api/open")
    def open_project():
        f = request.files.get("file")
        try:
            other = Project.from_bytes(f.read()) if f else Project.load(request.get_json(force=True)["path"])
        except Exception as exc:  # noqa: BLE001
            return err(f"Not a valid .pybi file: {exc}")
        with proj.lock:
            proj.sources, proj.report = other.sources, other.report
            proj.path = other.path
            proj._cache.clear()
        bump()
        return ok()

    @app.get("/api/recent")
    def recent():
        files = sorted(Path.cwd().glob("*.pybi"), key=lambda p: p.stat().st_mtime, reverse=True)[:12]
        auto = HOME / "autosave.pybi"
        return jsonify({"files": [str(p) for p in files], "autosave": str(auto) if auto.exists() else None})

    # ---------------------------------------------------------------- exports
    @app.post("/api/export/html")
    def exp_html():
        body = request.get_json(silent=True) or {}
        if body.get("report"):
            proj.report = body["report"]
        html = export_html(proj.state())
        name = (proj.report.get("title") or "report").replace("/", "-")
        return Response(html, mimetype="text/html",
                        headers={"Content-Disposition": f'attachment; filename="{name}.html"'})

    @app.post("/api/export/pptx")
    def exp_pptx():
        body = request.get_json(force=True)
        title = body.get("title") or proj.report.get("title") or "PyBI report"
        try:
            data = export_pptx(body.get("pages", []), title)
        except Exception as exc:  # noqa: BLE001
            return err(f"PowerPoint export failed: {exc}")
        return send_file(io.BytesIO(data), as_attachment=True, download_name=f"{title}.pptx",
                         mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation")

    @app.post("/api/export/pdf")
    def exp_pdf():
        body = request.get_json(force=True)
        title = body.get("title") or proj.report.get("title") or "PyBI report"
        try:
            data = export_pdf(body.get("pages", []))
        except Exception as exc:  # noqa: BLE001
            return err(f"PDF export failed: {exc}")
        return send_file(io.BytesIO(data), as_attachment=True, download_name=f"{title}.pdf", mimetype="application/pdf")

    @app.errorhandler(413)
    def too_big(_):
        return err("File is too large", 413)

    return app


BANNER = r"""
  ____        ____ ___
 |  _ \ _   _| __ )_ _|   PyBI {version} - business intelligence in Python
 | |_) | | | |  _ \| |    by Muhammad Rafay Shaikh, from Pakistan
 |  __/| |_| | |_) | |
 |_|    \__, |____/___|
        |___/
"""


def serve(project: str | None = None, host: str = "0.0.0.0", port: int = 8050, open_browser: bool = True,
          dataframes: dict | None = None, sample: bool = False) -> None:
    proj = Project.load(project) if project and Path(project).exists() else Project()
    if project and not Path(project).exists():
        proj.path = Path(project).with_suffix(".pybi")
    if dataframes:
        for name, df in dataframes.items():
            proj.add_source(name, df, "dataframe", "Python")
    if sample:
        for n, df in sample_tables().items():
            proj.add_source(n, df, "sample", "PyBI demo data", detect=False)
        proj.report = sample_report()

    # find a free port
    for p in range(port, port + 30):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host if host not in ("0.0.0.0", "::") else "", p))
                port = p
                break
            except OSError:
                continue

    app = create_app(proj, host, port)
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    local = f"http://127.0.0.1:{port}/"
    print(BANNER.format(version=__version__))
    print(f"  Studio (edit):   {local}")
    if host in ("0.0.0.0", "::"):
        print(f"  Network (view):  http://{lan_ip()}:{port}/view   <- share this link on your Wi-Fi/LAN")
    else:
        print("  Network sharing is off (started with --private).")
    if proj.path:
        print(f"  Project file:    {proj.path}")
    print("\n  Press Ctrl+C to stop.\n")
    if open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(local)).start()
    app.run(host=host, port=port, threaded=True, debug=False, use_reloader=False)
