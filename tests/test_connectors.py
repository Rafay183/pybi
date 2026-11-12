"""Connector tests: every engine path that can run offline, plus a mock HTTP API for all pagination/auth styles."""
import base64
import importlib.util
import io
import json
import sqlite3
import threading
import zipfile

import pandas as pd
import pytest
from flask import Flask, jsonify, request
from werkzeug.serving import make_server

from pybi.connectors import BY_ID, CATALOG, CATEGORIES, ConnectorError, discover, run
from pybi.connectors.base import Connector, Param
from pybi.connectors.files import read_bytes, read_folder

ROWS = [{"id": i, "name": f"item {i}", "amount": i * 10, "meta": {"tag": "t%d" % (i % 3)}} for i in range(1, 26)]


# ---------------------------------------------------------------- mock API
def make_api():
    app = Flask("mock")

    def authed():
        h = request.headers
        if h.get("Authorization") == "Bearer secret":
            return True
        if h.get("Authorization", "").startswith("Basic ") and base64.b64decode(h["Authorization"][6:]).decode() == "u:p":
            return True
        return h.get("X-Key") == "k1" or request.args.get("api_key") == "k1"

    @app.get("/page")
    def page():
        p, n = int(request.args.get("page", 1)), int(request.args.get("per_page", 10))
        return jsonify({"data": ROWS[(p - 1) * n: p * n], "total_pages": 3})

    @app.get("/offset")
    def offset():
        o, n = int(request.args.get("offset", 0)), int(request.args.get("limit", 10))
        return jsonify({"items": ROWS[o:o + n], "total": len(ROWS)})

    @app.get("/cursor")
    def cursor():
        c = int(request.args.get("cursor") or 0)
        nxt = c + 10 if c + 10 < len(ROWS) else None
        return jsonify({"results": ROWS[c:c + 10], "meta": {"next": nxt}})

    @app.get("/nexturl")
    def nexturl():
        c = int(request.args.get("start", 0))
        nxt = f"/nexturl?start={c + 10}" if c + 10 < len(ROWS) else None
        return jsonify({"value": ROWS[c:c + 10], "@odata.nextLink": nxt})

    @app.get("/link")
    def link():
        p = int(request.args.get("page", 1))
        resp = jsonify(ROWS[(p - 1) * 10: p * 10])
        if p < 3:
            resp.headers["Link"] = f'<{request.host_url}link?page={p + 1}>; rel="next"'
        return resp

    @app.get("/lastid")
    def lastid():
        after = int(request.args.get("starting_after", 0))
        chunk = [r for r in ROWS if r["id"] > after][:10]
        return jsonify({"data": chunk, "has_more": chunk[-1]["id"] < 25 if chunk else False})

    @app.get("/secure")
    def secure():
        if not authed():
            return jsonify({"error": "unauthorized"}), 401
        return jsonify(ROWS[:3])

    @app.get("/csv")
    def csv():
        return "a,b\n1,2\n3,4\n", 200, {"Content-Type": "text/csv"}

    @app.post("/graphql")
    def graphql():
        after = (request.json.get("variables") or {}).get("after")
        start = int(after or 0)
        nodes = ROWS[start:start + 10]
        return jsonify({"data": {"issues": {"nodes": nodes, "pageInfo": {"hasNextPage": start + 10 < len(ROWS), "endCursor": str(start + 10)}}}})

    @app.get("/table.html")
    def html():
        return "<html><body><table><tr><th>City</th><th>Pop</th></tr><tr><td>Karachi</td><td>20</td></tr><tr><td>Lahore</td><td>13</td></tr></table></body></html>"

    @app.get("/file.csv")
    def file_csv():
        return "x,y\n1,a\n2,b\n", 200, {"Content-Type": "text/csv"}

    return app


@pytest.fixture(scope="module")
def api():
    srv = make_server("127.0.0.1", 0, make_api())
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def rest(paginate, endpoint, records=None, auth=None, **extra):
    cfg = {"base": "{url}", "endpoint": endpoint, "paginate": paginate, "auth": auth}
    if records is not None:
        cfg["records"] = records
    cfg.update(extra)
    return Connector("t", "T", "Test", "rest", [Param("url", "URL")], cfg)


# ---------------------------------------------------------------- catalog
def test_catalog_size_and_shape():
    assert len(CATALOG) >= 120
    assert len(CATEGORIES) >= 10
    for c in CATALOG:
        assert c.engine in {"rest", "graphql", "sql", "file", "web", "folder", "storage", "mongo", "elastic", "influx", "redis",
                            "cassandra", "dynamodb", "firestore", "cosmos", "python", "yfinance", "kaggle"}, c.id
        json.dumps(c.to_dict())
        keys = [p.key for p in c.params]
        assert len(keys) == len(set(keys)), f"duplicate params in {c.id}"


# ---------------------------------------------------------------- REST pagination & auth
@pytest.mark.parametrize("pg,endpoint,records", [
    ({"type": "page", "param": "page", "size_param": "per_page", "size": 10, "total_pages": "total_pages"}, "/page", "data"),
    ({"type": "offset", "param": "offset", "size_param": "limit", "size": 10, "total": "total"}, "/offset", "items"),
    ({"type": "cursor", "param": "cursor", "path": "meta.next"}, "/cursor", None),
    ({"type": "next_url", "path": "@odata.nextLink"}, "/nexturl", "value"),
    ({"type": "link"}, "/link", None),
    ({"type": "last_id", "param": "starting_after", "more": "has_more"}, "/lastid", "data"),
])
def test_rest_pagination(api, pg, endpoint, records):
    df = next(iter(run(rest(pg, endpoint, records), {"url": api}).values()))
    assert len(df) == 25 and df["id"].tolist() == list(range(1, 26))
    assert "meta.tag" in df.columns  # nested JSON flattened


def test_rest_preview_is_one_page(api):
    df = next(iter(run(rest({"type": "link"}, "/link"), {"url": api}, preview=True).values()))
    assert len(df) == 10


@pytest.mark.parametrize("auth", [
    {"type": "bearer", "token": "secret"}, {"type": "basic", "user": "u", "password": "p"},
    {"type": "header", "name": "X-Key", "value": "k1"}, {"type": "query", "name": "api_key", "value": "k1"}])
def test_rest_auth(api, auth):
    assert len(next(iter(run(rest(None, "/secure", auth=auth), {"url": api}).values()))) == 3


def test_rest_auth_failure_message(api):
    with pytest.raises(ConnectorError, match="401"):
        run(rest(None, "/secure", auth={"type": "bearer", "token": "wrong"}), {"url": api})


def test_rest_csv_and_generic(api):
    assert next(iter(run(rest(None, "/csv"), {"url": api}).values())).shape == (2, 2)
    df = next(iter(run(BY_ID["rest_api"], {"url": api + "/offset", "pagination": "offset", "page_param": "offset", "size_param": "limit"}).values()))
    assert len(df) == 25


def test_graphql_pagination(api):
    c = Connector("g", "G", "T", "graphql", [Param("url", "URL")], {"base": "{url}/graphql", "records": "data.issues.nodes",
                  "paginate": {"type": "graphql", "has_next": "data.issues.pageInfo.hasNextPage", "cursor": "data.issues.pageInfo.endCursor", "var": "after"}})
    df = next(iter(run(c, {"url": api, "query": "query($after: String){ issues { nodes { id } } }"}).values()))
    assert len(df) == 25


def test_web_and_url_file(api):
    tables = discover(BY_ID["web"], {"url": api + "/table.html"})
    assert len(tables) == 1
    df = next(iter(run(BY_ID["web"], {"url": api + "/table.html"}).values()))
    assert df["City"].tolist() == ["Karachi", "Lahore"]
    assert len(next(iter(run(BY_ID["http_file"], {"url": api + "/file.csv"}).values()))) == 2


def test_missing_required_param():
    with pytest.raises(ConnectorError, match="Please fill in"):
        run(BY_ID["github"], {"resource": "Issues"})


def test_missing_driver_message():
    with pytest.raises(ConnectorError) as e:
        run(BY_ID["mongodb"], {"uri": "mongodb://x", "database": "d", "collection": "c"})
    assert "pip install" in str(e.value) or "MongoDB" in str(e.value)


# ---------------------------------------------------------------- post-processors
def test_post_processors():
    from pybi.connectors.engines import POST
    assert POST["values_table"]([["a", "b"], [1, 2]]) == [{"a": 1, "b": 2}]
    assert POST["columns"]([{"time": ["d1", "d2"], "t": [1, 2]}]) == [{"time": "d1", "t": 1}, {"time": "d2", "t": 2}]
    assert POST["date_dict"]([{"2024-01-01": {"EUR": 0.9}}]) == [{"date": "2024-01-01", "EUR": 0.9}]
    assert POST["fields"]([{"id": "r1", "fields": {"Name": "x"}}])[0]["Name"] == "x"
    notion = POST["notion"]([{"id": "1", "properties": {"Name": {"type": "title", "title": [{"plain_text": "Hi"}]}, "Tags": {"type": "multi_select", "multi_select": [{"name": "a"}, {"name": "b"}]}}}])
    assert notion[0]["Name"] == "Hi" and notion[0]["Tags"] == "a, b"
    assert POST["imf"]([{"PAK": {"2020": 1.5}}]) == [{"country": "PAK", "year": 2020, "value": 1.5}]


# ---------------------------------------------------------------- files, folder, sqlite
def test_file_formats(tmp_path):
    df = pd.DataFrame({"a": [1, 2], "b": ["x", "y"]})
    assert read_bytes("t.csv", df.to_csv(index=False).encode())["t"].shape == (2, 2)
    assert read_bytes("t.tsv", df.to_csv(index=False, sep="\t").encode())["t"].shape == (2, 2)
    assert read_bytes("t.jsonl", b'{"a":1}\n{"a":2}\n')["t"].shape == (2, 1)
    assert read_bytes("t.json", json.dumps({"orders": [{"x": 1}], "users": [{"y": 2}]}).encode()).keys() == {"orders", "users"}
    assert read_bytes("t.xml", b"<r><row><a>1</a></row><row><a>2</a></row></r>")["t"]["a"].tolist() == [1, 2]
    if importlib.util.find_spec("yaml"):
        assert read_bytes("t.yaml", b"- a: 1\n- a: 2\n")["t"].shape == (2, 1)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf) as w:
        df.to_excel(w, sheet_name="One", index=False)
        df.to_excel(w, sheet_name="Two", index=False)
    assert set(read_bytes("book.xlsx", buf.getvalue())) == {"One", "Two"}
    if importlib.util.find_spec("odf"):
        ods = io.BytesIO()
        df.to_excel(ods, engine="odf", index=False)
        assert read_bytes("t.ods", ods.getvalue())["t"].shape == (2, 2)
    st = io.BytesIO()
    df.to_stata(st, write_index=False)
    assert read_bytes("t.dta", st.getvalue())["t"].shape == (2, 2)
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("a.csv", "q\n1\n")
        zf.writestr("b.json", '[{"w": 1}]')
    assert set(read_bytes("x.zip", z.getvalue())) == {"a", "b"}
    assert read_bytes("p.html", b"<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>")


def test_pdf_tables():
    pytest.importorskip("pdfplumber")
    rl = pytest.importorskip("reportlab.platypus")
    from reportlab.lib.pagesizes import A4
    buf = io.BytesIO()
    doc = rl.SimpleDocTemplate(buf, pagesize=A4)
    t = rl.Table([["Region", "Sales"], ["South", "100"], ["North", "80"]], style=[("GRID", (0, 0), (-1, -1), 1, (0, 0, 0))])
    doc.build([t])
    out = read_bytes("report.pdf", buf.getvalue())
    df = next(iter(out.values()))
    assert list(df.columns) == ["Region", "Sales"] and len(df) == 2


def test_folder_combine(tmp_path):
    (tmp_path / "jan.csv").write_text("s\n1\n2\n")
    (tmp_path / "feb.csv").write_text("s\n3\n")
    df = next(iter(read_folder(str(tmp_path), "*.csv").values()))
    assert len(df) == 3 and set(df["Source.Name"]) == {"jan.csv", "feb.csv"}
    df2 = next(iter(run(BY_ID["folder"], {"path": str(tmp_path), "pattern": "*.csv", "combine": True}).values()))
    assert len(df2) == 3


def test_sqlite_navigator(tmp_path):
    db = tmp_path / "shop.db"
    con = sqlite3.connect(db)
    pd.DataFrame({"id": [1, 2]}).to_sql("customers", con, index=False)
    pd.DataFrame({"id": [1], "total": [9.5]}).to_sql("orders", con, index=False)
    con.close()
    assert discover(BY_ID["sqlite"], {"path": str(db)}) == ["customers", "orders"]
    out = run(BY_ID["sqlite"], {"path": str(db)}, tables=["orders"])
    assert list(out) == ["orders"]
    q = run(BY_ID["sqlite"], {"path": str(db), "query": "select sum(total) t from orders"})
    assert q["Query"]["t"][0] == 9.5


def test_python_script():
    out = run(BY_ID["python"], {"script": "import pandas as pd\nsales = pd.DataFrame({'a':[1,2,3]})\nx = 5"})
    assert list(out) == ["sales"]


# ---------------------------------------------------------------- server integration: load + refresh + secrets
def test_server_load_refresh(tmp_path, monkeypatch):
    import pybi.server as server
    monkeypatch.setattr(server, "HOME", tmp_path / "home")
    from pybi.project import Project
    db = tmp_path / "live.db"
    con = sqlite3.connect(db)
    pd.DataFrame({"v": [1, 2]}).to_sql("t", con, index=False)
    con.close()
    proj = Project()
    c = server.create_app(proj).test_client()
    assert c.get("/api/connectors").json["count"] >= 120
    r = c.post("/api/connectors/sqlite/discover", json={"params": {"path": str(db)}})
    assert r.json["tables"] == ["t"]
    r = c.post("/api/connectors/sqlite/load", json={"params": {"path": str(db)}, "tables": ["t"]})
    assert r.status_code == 200 and r.json["added"] == ["t"]
    con = sqlite3.connect(db)
    pd.DataFrame({"v": [1, 2, 3]}).to_sql("t", con, index=False, if_exists="replace")
    con.close()
    r = c.post("/api/source/t/refresh")
    assert r.json["tables"]["t"]["rows"] == 3
    # secrets go to the credential store, never into the project file
    r = c.post("/api/connectors/rest_api/preview", json={"params": {"url": "http://127.0.0.1:9/none"}})
    assert r.status_code == 400 and "error" in r.json
    assert b"password" not in proj.to_bytes()
