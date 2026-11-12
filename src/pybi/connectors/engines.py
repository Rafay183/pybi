"""Connector engines. Each catalog entry is a small spec; these engines do the real work."""
from __future__ import annotations

import decimal
import io
import json
import os
import re
from pathlib import Path
from typing import Callable, Dict, List, Optional
from urllib.parse import quote, quote_plus, urljoin, urlparse

import numpy as np
import pandas as pd

from .base import Connector, ConnectorError, dig, need, render
from .files import SUPPORTED, read_bytes, read_folder, read_html, read_sqlite

TIMEOUT = 60
PREVIEW_ROWS = 200
USER_AGENT = "PyBI (+https://github.com/rafay183/pybi)"

FileArg = Optional[tuple]  # (filename, bytes)


# ============================================================ helpers
def _int(v, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _json_param(v, default=None):
    if v in (None, ""):
        return default
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except json.JSONDecodeError as exc:
        raise ConnectorError(f"Invalid JSON: {exc}") from exc


def _clean_cell(v):
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (dict, list, tuple, set)):
        try:
            return json.dumps(v if not isinstance(v, set) else list(v), default=str, ensure_ascii=False)
        except TypeError:
            return str(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return v


def frame(records, max_level: int = 3) -> pd.DataFrame:
    """Turn API records (list of dicts) into a tidy DataFrame: nested objects become a.b columns, lists become JSON text."""
    if isinstance(records, pd.DataFrame):
        df = records
    elif not records:
        return pd.DataFrame()
    elif isinstance(records, list) and records and not isinstance(records[0], dict):
        df = pd.DataFrame({"value": records})
    else:
        df = pd.json_normalize(records, max_level=max_level)
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].map(_clean_cell)
    return df


def http(method: str, url: str, *, params=None, headers=None, json_body=None, data=None, auth=None, raw=False):
    requests = need("requests", "requests")
    h = {"User-Agent": USER_AGENT, "Accept": "application/json, text/csv, */*"}
    h.update(headers or {})
    try:
        r = requests.request(method, url, params=params, headers=h, json=json_body, data=data, auth=auth, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ConnectorError(f"Could not reach {urlparse(url).netloc or url}: {exc}") from exc
    if r.status_code >= 400:
        snippet = r.text[:400].strip().replace("\n", " ")
        hint = " (check your credentials / token)" if r.status_code in (401, 403) else ""
        raise ConnectorError(f"HTTP {r.status_code} from {urlparse(url).netloc}{hint}: {snippet}")
    return r


def _parse_body(r, fmt: Optional[str]):
    ctype = r.headers.get("content-type", "")
    if fmt == "csv" or (fmt is None and ("text/csv" in ctype or "application/csv" in ctype)):
        return "csv", r.text
    if fmt == "html":
        return "html", r.text
    try:
        return "json", r.json()
    except ValueError:
        text = r.text.strip()
        if text and "," in text.splitlines()[0]:
            return "csv", text
        raise ConnectorError("The response was not JSON. First characters: " + text[:200])


AUTO_KEYS = ["data", "results", "items", "records", "value", "values", "rows", "entries", "hits", "list", "objects",
             "elements", "collection", "response", "result", "content"]


def extract_records(data, path):
    if path not in (None, ""):
        rec = dig(data, path)
        if rec is None:
            return []
        return rec if isinstance(rec, list) else [rec]
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in AUTO_KEYS:
            v = data.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                for k2 in AUTO_KEYS:
                    if isinstance(v.get(k2), list):
                        return v[k2]
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
        return [data]
    return [data]


# ============================================================ post-processors (operate on raw records)
def _pp_fields(recs):  # Airtable
    return [{"id": r.get("id"), "createdTime": r.get("createdTime"), **(r.get("fields") or {})} for r in recs]


def _pp_properties(recs):  # HubSpot
    return [{"id": r.get("id"), **(r.get("properties") or {})} for r in recs]


def _pp_attributes(recs):  # JSON:API style (Klaviyo, Strapi v4)
    return [{"id": r.get("id"), "type": r.get("type"), **(r.get("attributes") or {})} for r in recs]


def _notion_value(p):
    t = p.get("type")
    v = p.get(t)
    if t in ("title", "rich_text"):
        return "".join(x.get("plain_text", "") for x in v or [])
    if t in ("select", "status"):
        return (v or {}).get("name")
    if t == "multi_select":
        return ", ".join(x.get("name", "") for x in v or [])
    if t == "date":
        return (v or {}).get("start")
    if t == "people":
        return ", ".join(x.get("name", "") or x.get("id", "") for x in v or [])
    if t == "formula":
        return (v or {}).get((v or {}).get("type"))
    if t == "relation":
        return ", ".join(x.get("id", "") for x in v or [])
    if t == "rollup":
        return (v or {}).get((v or {}).get("type"))
    if t == "files":
        return ", ".join(x.get("name", "") for x in v or [])
    if t == "unique_id":
        return f"{(v or {}).get('prefix') or ''}{(v or {}).get('number')}"
    return v


def _pp_notion(recs):
    out = []
    for r in recs:
        row = {"id": r.get("id"), "created_time": r.get("created_time"), "last_edited_time": r.get("last_edited_time"), "url": r.get("url")}
        for k, p in (r.get("properties") or {}).items():
            row[k] = _notion_value(p)
        out.append(row)
    return out


def _pp_values_table(recs):  # [[header...], [row...]] (Google Sheets, US Census)
    rows = [r for r in recs if isinstance(r, list)]
    if not rows:
        return []
    header = [str(h) for h in rows[0]]
    return [dict(zip(header, r + [None] * (len(header) - len(r)))) for r in rows[1:]]


def _pp_columns(recs):  # {"time": [...], "temp": [...]} (Open-Meteo)
    if len(recs) == 1 and isinstance(recs[0], dict):
        d = recs[0]
        n = max((len(v) for v in d.values() if isinstance(v, list)), default=0)
        return [{k: (v[i] if isinstance(v, list) and i < len(v) else None) for k, v in d.items()} for i in range(n)]
    return recs


def _pp_date_dict(recs):  # {"2024-01-01": {"EUR": 0.9}} (exchange rates)
    out = []
    for d in recs:
        if isinstance(d, dict):
            for k, v in d.items():
                out.append({"date": k, **(v if isinstance(v, dict) else {"value": v})})
    return out


def _pp_ga4(recs, data=None):
    data = data or {}
    dims = [h["name"] for h in data.get("dimensionHeaders", [])]
    mets = [h["name"] for h in data.get("metricHeaders", [])]
    out = []
    for r in recs:
        row = {d: x.get("value") for d, x in zip(dims, r.get("dimensionValues", []))}
        for m, x in zip(mets, r.get("metricValues", [])):
            try:
                row[m] = float(x.get("value"))
            except (TypeError, ValueError):
                row[m] = x.get("value")
        out.append(row)
    return out


def _pp_smartsheet(recs, data=None):
    cols = {c["id"]: c.get("title") for c in (data or {}).get("columns", [])}
    return [{"rowNumber": r.get("rowNumber"), **{cols.get(c.get("columnId"), str(c.get("columnId"))): c.get("value") for c in r.get("cells", [])}} for r in recs]


def _pp_prometheus(recs):
    out = []
    for s in recs:
        metric = s.get("metric", {})
        label = metric.get("__name__", "") + ("{" + ",".join(f'{k}="{v}"' for k, v in metric.items() if k != "__name__") + "}" if len(metric) > 1 else "")
        pts = s.get("values") or ([s["value"]] if "value" in s else [])
        for ts, val in pts:
            out.append({"series": label, "time": pd.to_datetime(float(ts), unit="s").isoformat(), "value": float(val), **{f"label.{k}": v for k, v in metric.items()}})
    return out


def _pp_pairs(recs):  # [[epoch_ms, value], ...]
    return [{"time": pd.to_datetime(r[0], unit="ms").isoformat(), "value": r[1]} for r in recs if isinstance(r, list) and len(r) >= 2]


def _pp_unwrap(recs):  # [{"subscription": {...}}] -> [{...}]
    out = []
    for r in recs:
        if isinstance(r, dict) and len(r) >= 1:
            merged = {}
            for k, v in r.items():
                if isinstance(v, dict):
                    merged.update({(f"{k}.{kk}" if len(r) > 1 else kk): vv for kk, vv in v.items()})
                else:
                    merged[k] = v
            out.append(merged)
    return out


def _pp_dict_values(recs):  # {"id1": {...}, "id2": {...}} (Firebase)
    out = []
    for d in recs:
        if isinstance(d, dict):
            for k, v in d.items():
                out.append({"key": k, **(v if isinstance(v, dict) else {"value": v})})
    return out


def _pp_es_hits(recs):
    return [{"_id": h.get("_id"), "_index": h.get("_index"), **(h.get("_source") or {})} for h in recs]


def _pp_couch(recs):
    return [r.get("doc") or r for r in recs if not str(r.get("id", "")).startswith("_design")]


def _pp_sf(recs):
    def clean(d):
        return {k: (clean(v) if isinstance(v, dict) else v) for k, v in d.items() if k != "attributes"}
    return [clean(r) for r in recs]


def _pp_coda(recs):
    return [{"id": r.get("id"), "name": r.get("name"), **(r.get("values") or {})} for r in recs]


def _pp_datadog(recs):
    out = []
    for s in recs:
        for ts, val in s.get("pointlist") or []:
            out.append({"metric": s.get("metric"), "scope": s.get("scope"), "time": pd.to_datetime(ts, unit="ms").isoformat(), "value": val})
    return out


def _pp_neo4j(recs, data=None):
    res = ((data or {}).get("results") or [{}])[0]
    cols = res.get("columns", [])
    return [dict(zip(cols, d.get("row", []))) for d in res.get("data", [])]


def _pp_worldbank(recs):
    return [{"country": (r.get("country") or {}).get("value"), "countryiso3code": r.get("countryiso3code"),
             "indicator": (r.get("indicator") or {}).get("value"), "date": r.get("date"), "value": r.get("value")} for r in recs]


def _pp_fred(recs):
    return [{"date": r.get("date"), "value": None if r.get("value") in (".", None) else float(r["value"])} for r in recs]


def _pp_imf(recs):  # {"PAK": {"2020": 1.2}} -> country, year, value
    out = []
    for d in recs:
        for country, years in (d or {}).items():
            for y, v in (years or {}).items():
                out.append({"country": country, "year": int(y), "value": v})
    return out


POST: Dict[str, Callable] = {"imf": _pp_imf,
    "fields": _pp_fields, "properties": _pp_properties, "attributes": _pp_attributes, "notion": _pp_notion,
    "values_table": _pp_values_table, "columns": _pp_columns, "date_dict": _pp_date_dict, "ga4": _pp_ga4,
    "smartsheet": _pp_smartsheet, "prometheus": _pp_prometheus, "pairs": _pp_pairs, "unwrap": _pp_unwrap,
    "dict_values": _pp_dict_values, "es_hits": _pp_es_hits, "couch": _pp_couch, "salesforce": _pp_sf,
    "coda": _pp_coda, "datadog": _pp_datadog, "neo4j": _pp_neo4j, "worldbank": _pp_worldbank, "fred": _pp_fred,
}
POST_NEEDS_DATA = {"ga4", "smartsheet", "neo4j"}


def apply_post(name, recs, data):
    if not name:
        return recs
    for n in name if isinstance(name, list) else [name]:
        fn = POST[n]
        recs = fn(recs, data) if n in POST_NEEDS_DATA else fn(recs)
    return recs


# ============================================================ REST / OData / GraphQL engine
def _auth(cfg_auth, headers: dict, query: dict):
    if not cfg_auth:
        return None
    t = cfg_auth.get("type")
    if t == "bearer":
        if cfg_auth.get("token"):
            headers["Authorization"] = f"{cfg_auth.get('prefix', 'Bearer')} {cfg_auth['token']}".strip()
    elif t == "basic":
        if cfg_auth.get("user") or cfg_auth.get("password"):
            return (cfg_auth.get("user", ""), cfg_auth.get("password", ""))
    elif t == "header":
        if cfg_auth.get("value"):
            headers[cfg_auth["name"]] = cfg_auth["value"]
    elif t == "query":
        if cfg_auth.get("value"):
            query[cfg_auth["name"]] = cfg_auth["value"]
    return None


def _resource_cfg(c: Connector, params: dict) -> dict:
    cfg = dict(c.config)
    res = cfg.pop("resources", None)
    if res:
        key = params.get("resource") or next(iter(res))
        if key not in res:
            raise ConnectorError(f"Unknown resource '{key}'")
        for k, v in res[key].items():
            if k in ("query", "headers") and isinstance(v, dict):
                cfg[k] = dict(cfg.get(k) or {}, **v)
            else:
                cfg[k] = v
    # advanced overrides typed by the user
    for k in ("endpoint", "records"):
        if params.get("_" + k) not in (None, ""):
            cfg[k] = params["_" + k]
    return cfg


def _csv_list(v):
    return [x.strip() for x in str(v or "").split(",") if x.strip()]


BODY_FNS = {
    "ga4": lambda p: {"dateRanges": [{"startDate": p.get("start") or "30daysAgo", "endDate": p.get("end") or "today"}],
                      "dimensions": [{"name": d} for d in _csv_list(p.get("dimensions"))], "metrics": [{"name": m} for m in _csv_list(p.get("metrics"))], "limit": 100000},
    "gsc": lambda p: {"startDate": p.get("start"), "endDate": p.get("end"), "dimensions": _csv_list(p.get("dims")) or ["date"], "rowLimit": 25000},
}


def _generic_cfg(p: dict) -> dict:
    at = p.get("auth_type") or "none"
    auth = {"bearer": {"type": "bearer", "token": "{token}"}, "basic": {"type": "basic", "user": "{user}", "password": "{token}"},
            "header": {"type": "header", "name": p.get("user") or "X-API-Key", "value": "{token}"},
            "query": {"type": "query", "name": p.get("user") or "api_key", "value": "{token}"}}.get(at)
    pg = p.get("pagination") or "none"
    paginate = {"link": {"type": "link"}, "page": {"type": "page", "param": p.get("page_param") or "page", "size_param": p.get("size_param") or None, "size": 100},
                "offset": {"type": "offset", "param": p.get("page_param") or "offset", "size_param": p.get("size_param") or "limit", "size": 100},
                "next_url": {"type": "next_url", "path": p.get("next_path") or "next"},
                "cursor": {"type": "cursor", "param": p.get("page_param") or "cursor", "path": p.get("next_path") or "next_cursor"}}.get(pg)
    return {"base": "{url}", "method": p.get("method") or "GET", "auth": auth, "paginate": paginate}


def rest_engine(c: Connector, params: dict, preview=False, **_):
    cfg = _generic_cfg(params) if c.config.get("generic") else _resource_cfg(c, params)
    if cfg.get("body_fn"):
        cfg["body"] = BODY_FNS[cfg["body_fn"]](params)
    p = dict(params)
    base = render(cfg.get("base", ""), p).rstrip("/")
    endpoint = render(cfg.get("endpoint", ""), {k: (quote(str(v), safe="/:@") if isinstance(v, str) and k not in ("url", "base_url") else v) for k, v in p.items()})
    url = endpoint if endpoint.startswith("http") else base + ("" if not endpoint or endpoint.startswith("/") else "/") + endpoint
    if not url.startswith("http"):
        raise ConnectorError("Please enter a full URL starting with http:// or https://")
    method = cfg.get("method", "GET").upper()
    query = {k: v for k, v in render(cfg.get("query", {}), p).items() if v not in ("", None)}
    query.update({k: v for k, v in (_json_param(p.get("_query"), {}) or {}).items()})
    headers = {k: v for k, v in render(cfg.get("headers", {}), p).items() if v not in ("", None)}
    headers.update(_json_param(p.get("_headers"), {}) or {})
    body = render(cfg.get("body"), p) if cfg.get("body") is not None else None
    if isinstance(body, str) and body.strip().startswith(("{", "[")):
        body = _json_param(body)
    if p.get("_body"):
        body = _json_param(p["_body"])
    auth = _auth(render(cfg.get("auth"), p), headers, query)
    pg = cfg.get("paginate") or {}
    ptype = pg.get("type")
    max_pages = 1 if preview else _int(p.get("_max_pages"), cfg.get("max_pages", 200))
    records, data = [], None
    page = pg.get("start", 1)
    offset = pg.get("start_offset", 0)
    cursor, next_url, last_id = None, None, None
    rec_path = render(cfg.get("records"), p) if cfg.get("records") is not None else None

    for _ in range(max(1, max_pages)):
        q, b = dict(query), (json.loads(json.dumps(body)) if body is not None else None)
        if ptype == "page":
            q[pg.get("param", "page")] = page
            if pg.get("size_param"):
                q[pg["size_param"]] = pg.get("size", 100)
        elif ptype == "offset":
            target = b if pg.get("in") == "body" and isinstance(b, dict) else q
            target[pg.get("param", "offset")] = offset
            if pg.get("size_param"):
                target[pg["size_param"]] = pg.get("size", 100)
        elif ptype == "cursor" and cursor is not None:
            if pg.get("in") == "body" and isinstance(b, dict):
                b[pg.get("param", "cursor")] = cursor
            else:
                q[pg.get("param", "cursor")] = cursor
        elif ptype == "last_id" and last_id is not None:
            q[pg.get("param", "starting_after")] = last_id
        req_url = next_url or url
        if next_url:
            keep = {k: v for k, v in q.items() if (cfg.get("auth") or {}).get("type") == "query" and k == (cfg.get("auth") or {}).get("name")}
            q = keep
        if method == "GET":
            r = http("GET", req_url, params=q, headers=headers, auth=auth)
        else:
            if cfg.get("form"):
                r = http(method, req_url, params=q, headers=headers, data=b, auth=auth)
            else:
                r = http(method, req_url, params=q, headers=headers, json_body=b, auth=auth)
        kind, data = _parse_body(r, cfg.get("format"))
        if kind == "csv":
            lines = [ln for ln in data.splitlines() if not ln.startswith("#")]
            df = pd.read_csv(io.StringIO("\n".join(lines)))
            return {c.name: df.drop(columns=[x for x in df.columns if str(x).startswith("Unnamed") and df[x].isna().all()] or [])}
        if kind == "html":
            return read_html(data, c.name)
        recs = extract_records(data, rec_path)
        recs = apply_post(cfg.get("post"), recs, data)
        records.extend(recs)
        if not recs:
            break
        if ptype == "page":
            page += 1
            if pg.get("total_pages") and page > _int(dig(data, pg["total_pages"]), 0) + (pg.get("start", 1) - 1):
                break
            if pg.get("more") and not dig(data, pg["more"]):
                break
            if pg.get("size") and pg.get("stop_short", True) and len(recs) < pg["size"]:
                break
        elif ptype == "offset":
            offset += len(recs) if not pg.get("step_pages") else 1
            if pg.get("next") is not None:
                nxt = dig(data, pg["next"])
                if nxt in (None, "", False):
                    break
                offset = nxt
            if pg.get("total") and offset >= _int(dig(data, pg["total"]), 0):
                break
            if pg.get("more") and not dig(data, pg["more"]):
                break
            if pg.get("size") and len(recs) < pg["size"]:
                break
        elif ptype == "cursor":
            cursor = dig(data, pg.get("path"))
            if cursor in (None, "", False) or (pg.get("more") and not dig(data, pg["more"])):
                break
        elif ptype in ("next_url", "link"):
            nxt = r.links.get("next", {}).get("url") if ptype == "link" else dig(data, pg.get("path"))
            if not nxt or (pg.get("results_flag") and r.links.get("next", {}).get("results") == "false"):
                break
            origin = render(pg.get("origin", ""), p) or req_url
            next_url = urljoin(origin, nxt)
        elif ptype == "last_id":
            if pg.get("more") and not dig(data, pg["more"]):
                break
            last_id = recs[-1].get(pg.get("id", "id")) if isinstance(recs[-1], dict) else None
            if last_id is None:
                break
        elif ptype == "graphql":
            if not dig(data, pg["has_next"]):
                break
            cursor = dig(data, pg["cursor"])
            body = dict(body or {})
            body["variables"] = dict(body.get("variables") or {}, **{pg.get("var", "after"): cursor})
        else:
            break
        if preview and len(records) >= PREVIEW_ROWS:
            break
    if isinstance(data, dict) and data.get("errors") and not records:
        raise ConnectorError("API returned errors: " + json.dumps(data["errors"])[:400])
    return {c.name if not params.get("resource") else f"{c.name} {params['resource']}": frame(records)}


def graphql_engine(c: Connector, params: dict, preview=False, **kw):
    cfg = dict(c.config)
    q = params.get("query") or cfg.get("query", "")
    variables = _json_param(params.get("variables"), cfg.get("variables") or {})
    variables = render(variables, params)
    spec = Connector(c.id, c.name, c.category, "rest", c.params,
                     dict(cfg, method="POST", body={"query": render(q, params) if cfg.get("render_query") else q, "variables": variables}))
    return rest_engine(spec, params, preview=preview)


# ============================================================ SQL engine
def _quoted(params: dict) -> dict:
    out = {}
    for k, v in params.items():
        if k in ("user", "username", "password", "token", "key", "secret") and isinstance(v, str):
            out[k] = quote_plus(v)
        else:
            out[k] = v
    return out


def sql_engine(c: Connector, params: dict, preview=False, tables=None, discover=False, **_):
    cfg = c.config
    kind = cfg.get("kind", "sqlalchemy")
    query = (params.get("query") or "").strip()
    schema = params.get("schema") or None
    limit = PREVIEW_ROWS if preview else None

    def first_chunk(it):
        if limit is None:
            return it
        for chunk in it:
            return chunk
        return pd.DataFrame()

    if kind == "sqlite":
        path = os.path.expanduser(params.get("path", ""))
        if not Path(path).exists():
            raise ConnectorError(f"Database file not found: {path}")
        if discover and not query:
            import sqlite3
            con = sqlite3.connect(path)
            names = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type in ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            con.close()
            return names
        dfs = read_sqlite(path, query or None)
        if tables:
            dfs = {k: v for k, v in dfs.items() if k in tables}
        return {k: (v.head(limit) if limit else v) for k, v in dfs.items()}

    if kind == "duckdb":
        duckdb = need("duckdb", "duckdb")
        target = render(cfg.get("database", "{path}"), params) or ":memory:"
        con = duckdb.connect(target, read_only=target.endswith(".duckdb") and Path(target).exists())
        try:
            if query:
                return {"Query": con.execute(query + (f" LIMIT {limit}" if limit and "limit" not in query.lower() else "")).df()}
            names = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
            if discover:
                return names
            return {t: con.execute(f'SELECT * FROM "{t}"' + (f" LIMIT {limit}" if limit else "")).df() for t in (tables or names)}
        finally:
            con.close()

    if kind == "odbc":
        pyodbc = need("pyodbc", "pyodbc")
        conn_str = render(cfg.get("conn", "{connection_string}"), params)
        try:
            con = pyodbc.connect(conn_str, timeout=30)
        except pyodbc.Error as exc:
            raise ConnectorError(f"ODBC connection failed: {exc}") from exc
        try:
            if not query:
                names = [f"{r.table_schem}.{r.table_name}" if r.table_schem else r.table_name
                         for r in con.cursor().tables() if r.table_type in ("TABLE", "VIEW") and (not schema or r.table_schem == schema)]
                if discover:
                    return names
                return {t: first_chunk(pd.read_sql(f"SELECT * FROM {t}", con, chunksize=limit) if limit else pd.read_sql(f"SELECT * FROM {t}", con)) for t in (tables or names)}
            df = pd.read_sql(query, con, chunksize=limit) if limit else pd.read_sql(query, con)
            return {"Query": first_chunk(df)}
        finally:
            con.close()

    # SQLAlchemy
    sa = need("sqlalchemy", "sqlalchemy")
    for mod, pkg in cfg.get("drivers", []):
        need(mod, pkg)
    url = (params.get("url") or "").strip() or render(cfg.get("url", ""), _quoted(params))
    if not url:
        raise ConnectorError("Connection URL is empty")
    kwargs = render(cfg.get("engine_kwargs", {}), params)
    kwargs = {k: v for k, v in kwargs.items() if v not in ("", None)}
    try:
        engine = sa.create_engine(url, **kwargs)
        with engine.connect() as con:
            if query:
                it = pd.read_sql_query(sa.text(query), con, chunksize=limit) if limit else pd.read_sql_query(sa.text(query), con)
                return {"Query": first_chunk(it)}
            insp = sa.inspect(con)
            names = sorted(insp.get_table_names(schema=schema)) + sorted(v for v in insp.get_view_names(schema=schema))
            if discover:
                return names
            out = {}
            for t in tables or names[:1]:
                tbl = sa.Table(t, sa.MetaData(), schema=schema, autoload_with=con)
                stmt = sa.select(tbl)
                if limit:
                    stmt = stmt.limit(limit)
                out[t] = pd.read_sql(stmt, con)
            return out
    except ConnectorError:
        raise
    except Exception as exc:  # noqa: BLE001 - driver exceptions vary by vendor
        msg = str(exc).split("\n")[0][:400]
        raise ConnectorError(f"Database error: {msg}") from exc


# ============================================================ files, web, storage
SHARE_LINKS = {
    "gsheet": lambda u: re.sub(r"/edit.*$|/view.*$", "", u) + ("/export?format=csv" + ("&gid=" + re.search(r"gid=(\d+)", u).group(1) if re.search(r"gid=(\d+)", u) else "") if "/spreadsheets/d/" in u and "export" not in u else ""),
    "gdrive": lambda u: f"https://drive.google.com/uc?export=download&id={re.search(r'/d/([^/]+)|id=([^&]+)', u).group(1) or re.search(r'/d/([^/]+)|id=([^&]+)', u).group(2)}" if re.search(r"/d/([^/]+)|id=([^&]+)", u) else u,
    "dropbox": lambda u: re.sub(r"([?&])dl=0", r"\1dl=1", u) if "dl=0" in u else u + ("&" if "?" in u else "?") + "dl=1",
    "onedrive": lambda u: u + ("&" if "?" in u else "?") + "download=1" if "download=1" not in u else u,
    "github": lambda u: u.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/") if "github.com" in u and "/blob/" in u else u,
}


def _filename_from(url: str, fallback_ext: str = ".csv", ctype: str = "") -> str:
    name = urlparse(url).path.rstrip("/").split("/")[-1] or "data"
    if "." not in name:
        if "csv" in ctype:
            name += ".csv"
        elif "json" in ctype:
            name += ".json"
        elif "spreadsheetml" in ctype or "excel" in ctype:
            name += ".xlsx"
        elif "html" in ctype:
            name += ".html"
        else:
            name += fallback_ext
    return name


def file_engine(c: Connector, params: dict, file: FileArg = None, preview=False, tables=None, discover=False, **_):
    opts = {k: params.get(k) for k in ("sheet", "delimiter", "skiprows", "xpath", "query", "header") if params.get(k) not in (None, "")}
    if c.config.get("format"):
        opts.setdefault("format", c.config["format"])
    if params.get("format"):
        opts["format"] = params["format"]
    if file:
        fname, data = file
    elif params.get("path"):
        p = Path(os.path.expanduser(params["path"]))
        if not p.exists():
            raise ConnectorError(f"File not found: {p}")
        fname, data = p.name, p.read_bytes()
    elif params.get("url") or c.config.get("url_template"):
        url = (params.get("url") or render(c.config["url_template"], params)).strip()
        link = c.config.get("link")
        if link:
            url = SHARE_LINKS[link](url)
        r = http("GET", url, headers={"Accept": "*/*"})
        fname = _filename_from(url, c.config.get("ext", ".csv"), r.headers.get("content-type", ""))
        if c.config.get("ext") and Path(fname).suffix.lower() not in SUPPORTED:
            fname = Path(fname).stem + c.config["ext"]
        data = r.content
    else:
        raise ConnectorError("Choose a file, enter a path on this computer, or a URL")
    dfs = read_bytes(fname, data, opts)
    if discover:
        return list(dfs)
    if tables:
        dfs = {k: v for k, v in dfs.items() if k in tables}
    return {k: (v.head(PREVIEW_ROWS) if preview else v) for k, v in dfs.items()}


def web_engine(c: Connector, params: dict, preview=False, tables=None, discover=False, **_):
    url = params.get("url", "").strip()
    if not url.startswith("http"):
        raise ConnectorError("Enter a full web address (https://…)")
    r = http("GET", url, headers={"Accept": "text/html,*/*"})
    ctype = r.headers.get("content-type", "")
    if "html" in ctype or c.config.get("html"):
        dfs = read_html(r.text, (urlparse(url).path.rstrip("/").split("/")[-1] or urlparse(url).netloc).replace("_", " ")[:40])
    else:
        dfs = read_bytes(_filename_from(url, ".csv", ctype), r.content)
    if discover:
        return list(dfs)
    if tables:
        dfs = {k: v for k, v in dfs.items() if k in tables}
    return {k: (v.head(PREVIEW_ROWS) if preview else v) for k, v in dfs.items()}


def folder_engine(c: Connector, params: dict, preview=False, **_):
    dfs = read_folder(params.get("path", ""), params.get("pattern") or "*", params.get("combine", True) not in (False, "false"))
    return {k: (v.head(PREVIEW_ROWS) if preview else v) for k, v in dfs.items()}


def storage_engine(c: Connector, params: dict, preview=False, tables=None, discover=False, **_):
    cfg = c.config
    proto = cfg["protocol"]
    path = render(cfg.get("path", "{path}"), params).lstrip("/") if proto not in ("ftp",) else params.get("path", "")
    if proto == "ftp":
        import ftplib
        host = params.get("host", "")
        try:
            ftp = ftplib.FTP_TLS(host, timeout=TIMEOUT) if params.get("tls") else ftplib.FTP(host, timeout=TIMEOUT)
            ftp.login(params.get("user") or "anonymous", params.get("password") or "")
            if params.get("tls"):
                ftp.prot_p()
            buf = io.BytesIO()
            ftp.retrbinary("RETR " + path, buf.write)
            ftp.quit()
        except ftplib.all_errors as exc:
            raise ConnectorError(f"FTP error: {exc}") from exc
        files = [(Path(path).name, buf.getvalue())]
    else:
        fsspec = need("fsspec", "fsspec")
        for mod, pkg in cfg.get("drivers", []):
            need(mod, pkg)
        opts = {k: v for k, v in render(cfg.get("options", {}), params).items() if v not in ("", None)}
        if "client_kwargs" in cfg:
            ck = {k: v for k, v in render(cfg["client_kwargs"], params).items() if v not in ("", None)}
            if ck:
                opts["client_kwargs"] = ck
        try:
            fs = fsspec.filesystem(proto, **opts)
            matches = fs.glob(path) if any(ch in path for ch in "*?[") else ([path] if not fs.isdir(path) else [p for p in fs.ls(path) if Path(p).suffix.lower() in SUPPORTED])
            if not matches:
                raise ConnectorError(f"No files match {path}")
            files = []
            for m in matches[:200]:
                with fs.open(m, "rb") as fh:
                    files.append((Path(m).name, fh.read()))
        except ConnectorError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ConnectorError(f"{c.name} error: {str(exc)[:300]}") from exc
    dfs: Dict[str, pd.DataFrame] = {}
    if len(files) > 1 and params.get("combine", True) not in (False, "false"):
        frames = []
        for fname, data in files:
            for _, df in read_bytes(fname, data).items():
                df = df.copy()
                df.insert(0, "Source.Name", fname)
                frames.append(df)
        dfs = {Path(path.rstrip("/*")).name or c.name: pd.concat(frames, ignore_index=True, sort=False)}
    else:
        for fname, data in files:
            dfs.update(read_bytes(fname, data))
    if discover:
        return list(dfs)
    if tables:
        dfs = {k: v for k, v in dfs.items() if k in tables}
    return {k: (v.head(PREVIEW_ROWS) if preview else v) for k, v in dfs.items()}


# ============================================================ NoSQL & search
def mongo_engine(c: Connector, params: dict, preview=False, tables=None, discover=False, **_):
    pymongo = need("pymongo", "pymongo")
    try:
        client = pymongo.MongoClient(params.get("uri"), serverSelectionTimeoutMS=15000)
        db = client[params.get("database") or client.get_default_database().name]
        if discover and not params.get("collection"):
            return sorted(db.list_collection_names())
        names = [params["collection"]] if params.get("collection") else (tables or [])
        flt = _json_param(params.get("filter"), {}) or {}
        proj = _json_param(params.get("projection"), None)
        limit = PREVIEW_ROWS if preview else _int(params.get("limit"), 0)
        out = {}
        for n in names:
            cur = db[n].find(flt, proj)
            if limit:
                cur = cur.limit(limit)
            docs = []
            for d in cur:
                d["_id"] = str(d.get("_id"))
                docs.append(d)
            out[n] = frame(docs)
        return out
    except pymongo.errors.PyMongoError as exc:
        raise ConnectorError(f"MongoDB error: {exc}") from exc


def elastic_engine(c: Connector, params: dict, preview=False, tables=None, discover=False, **_):
    base = params.get("url", "").rstrip("/")
    headers, auth = {}, None
    if params.get("api_key"):
        headers["Authorization"] = "ApiKey " + params["api_key"]
    elif params.get("user"):
        auth = (params["user"], params.get("password", ""))
    if discover and not params.get("index"):
        r = http("GET", base + "/_cat/indices?format=json", headers=headers, auth=auth)
        return sorted(i["index"] for i in r.json() if not i["index"].startswith("."))
    out = {}
    for idx in [params["index"]] if params.get("index") else (tables or []):
        size = PREVIEW_ROWS if preview else min(_int(params.get("size"), 10000), 10000)
        q = _json_param(params.get("query"), {"match_all": {}})
        body = {"query": q, "size": size}
        r = http("POST", f"{base}/{quote(idx)}/_search", headers=headers, auth=auth, json_body=body)
        out[idx] = frame(_pp_es_hits(r.json().get("hits", {}).get("hits", [])))
    return out


def influx_engine(c: Connector, params: dict, preview=False, **_):
    base = params.get("url", "").rstrip("/")
    flux = params.get("query") or f'from(bucket: "{params.get("bucket")}") |> range(start: -{params.get("range") or "30d"})'
    r = http("POST", f"{base}/api/v2/query", params={"org": params.get("org")},
             headers={"Authorization": f"Token {params.get('token', '')}", "Accept": "application/csv", "Content-Type": "application/vnd.flux"},
             data=flux.encode())
    text = "\n".join(ln for ln in r.text.splitlines() if ln and not ln.startswith("#"))
    if not text.strip():
        return {c.name: pd.DataFrame()}
    df = pd.read_csv(io.StringIO(text))
    df = df.drop(columns=[x for x in df.columns if str(x).startswith("Unnamed")] + [x for x in ("result", "table") if x in df.columns])
    df = df[df.get("_time", pd.Series(dtype=str)) != "_time"] if "_time" in df.columns else df
    return {"Influx": df.head(PREVIEW_ROWS) if preview else df}


def redis_engine(c: Connector, params: dict, preview=False, **_):
    redis = need("redis", "redis")
    try:
        r = redis.from_url(params.get("url") or "redis://localhost:6379/0", decode_responses=True, socket_timeout=15)
        rows = []
        for i, key in enumerate(r.scan_iter(match=params.get("pattern") or "*", count=1000)):
            if preview and i >= PREVIEW_ROWS or i >= 200000:
                break
            t = r.type(key)
            if t == "hash":
                rows.append({"key": key, **r.hgetall(key)})
            elif t == "string":
                rows.append({"key": key, "value": r.get(key)})
            elif t == "list":
                rows.append({"key": key, "value": json.dumps(r.lrange(key, 0, -1))})
            elif t == "set":
                rows.append({"key": key, "value": json.dumps(sorted(r.smembers(key)))})
            elif t == "zset":
                rows.append({"key": key, "value": json.dumps(r.zrange(key, 0, -1, withscores=True))})
            else:
                rows.append({"key": key, "type": t})
        return {"Redis": frame(rows)}
    except redis.RedisError as exc:
        raise ConnectorError(f"Redis error: {exc}") from exc


def cassandra_engine(c: Connector, params: dict, preview=False, **_):
    cluster_mod = need("cassandra.cluster", "cassandra-driver")
    from cassandra.auth import PlainTextAuthProvider  # type: ignore
    auth = PlainTextAuthProvider(params["user"], params.get("password", "")) if params.get("user") else None
    cluster = cluster_mod.Cluster([h.strip() for h in params.get("hosts", "127.0.0.1").split(",")], port=_int(params.get("port"), 9042), auth_provider=auth)
    try:
        session = cluster.connect(params.get("keyspace") or None)
        q = params.get("query") or f"SELECT * FROM {params.get('table')}"
        if preview and "limit" not in q.lower():
            q += f" LIMIT {PREVIEW_ROWS}"
        rows = [r._asdict() if hasattr(r, "_asdict") else dict(r) for r in session.execute(q)]
        return {"Cassandra": frame(rows)}
    except Exception as exc:  # noqa: BLE001
        raise ConnectorError(f"Cassandra error: {exc}") from exc
    finally:
        cluster.shutdown()


def dynamodb_engine(c: Connector, params: dict, preview=False, tables=None, discover=False, **_):
    boto3 = need("boto3", "boto3")
    kw = {k: v for k, v in {"region_name": params.get("region"), "aws_access_key_id": params.get("access_key"),
                            "aws_secret_access_key": params.get("secret_key"), "endpoint_url": params.get("endpoint")}.items() if v}
    try:
        db = boto3.resource("dynamodb", **kw)
        if discover and not params.get("table"):
            return sorted(t.name for t in db.tables.all())
        out = {}
        for name in [params["table"]] if params.get("table") else (tables or []):
            table, items, start = db.Table(name), [], None
            while True:
                resp = table.scan(**({"ExclusiveStartKey": start} if start else {}))
                items.extend(resp.get("Items", []))
                start = resp.get("LastEvaluatedKey")
                if not start or (preview and len(items) >= PREVIEW_ROWS):
                    break
            out[name] = frame(items)
        return out
    except Exception as exc:  # noqa: BLE001
        raise ConnectorError(f"DynamoDB error: {exc}") from exc


def firestore_engine(c: Connector, params: dict, preview=False, **_):
    fs = need("google.cloud.firestore", "google-cloud-firestore")
    try:
        client = fs.Client.from_service_account_json(os.path.expanduser(params["credentials"])) if params.get("credentials") else fs.Client(project=params.get("project") or None)
        q = client.collection(params["collection"])
        if preview:
            q = q.limit(PREVIEW_ROWS)
        return {params["collection"]: frame([{"id": d.id, **d.to_dict()} for d in q.stream()])}
    except Exception as exc:  # noqa: BLE001
        raise ConnectorError(f"Firestore error: {exc}") from exc


def cosmos_engine(c: Connector, params: dict, preview=False, **_):
    cosmos = need("azure.cosmos", "azure-cosmos")
    try:
        client = cosmos.CosmosClient(params["url"], credential=params["key"])
        cont = client.get_database_client(params["database"]).get_container_client(params["container"])
        q = params.get("query") or "SELECT * FROM c"
        items = []
        for i, it in enumerate(cont.query_items(q, enable_cross_partition_query=True)):
            if preview and i >= PREVIEW_ROWS:
                break
            items.append({k: v for k, v in it.items() if not k.startswith("_")})
        return {params["container"]: frame(items)}
    except Exception as exc:  # noqa: BLE001
        raise ConnectorError(f"Cosmos DB error: {exc}") from exc


# ============================================================ Python & finance
def python_engine(c: Connector, params: dict, preview=False, **_):
    code = params.get("script") or ""
    ns = {"pd": pd, "np": np, "__name__": "__pybi__"}
    try:
        exec(compile(code, "<pybi script>", "exec"), ns)  # noqa: S102 - user's own script, local studio only
    except Exception as exc:  # noqa: BLE001
        raise ConnectorError(f"Python error: {type(exc).__name__}: {exc}") from exc
    dfs = {k: v for k, v in ns.items() if isinstance(v, pd.DataFrame) and not k.startswith("_")}
    if not dfs:
        raise ConnectorError("The script did not create any pandas DataFrame variables")
    return {k: (v.head(PREVIEW_ROWS) if preview else v) for k, v in dfs.items()}


def yfinance_engine(c: Connector, params: dict, preview=False, **_):
    yf = need("yfinance", "yfinance")
    tickers = [t.strip().upper() for t in re.split(r"[,\s]+", params.get("tickers", "")) if t.strip()]
    if not tickers:
        raise ConnectorError("Enter at least one ticker symbol")
    df = yf.download(tickers, start=params.get("start") or None, end=params.get("end") or None,
                     interval=params.get("interval") or "1d", group_by="ticker", auto_adjust=True, progress=False)
    if df is None or df.empty:
        raise ConnectorError("No prices returned (check the symbols and dates)")
    if isinstance(df.columns, pd.MultiIndex):
        df = df.stack(level=0, future_stack=True).rename_axis(["Date", "Ticker"]).reset_index()
    else:
        df = df.reset_index()
        df.insert(1, "Ticker", tickers[0])
    return {"Stock prices": df}


def kaggle_engine(c: Connector, params: dict, preview=False, **_):
    need("kaggle", "kaggle")
    import tempfile

    from kaggle.api.kaggle_api_extended import KaggleApi  # type: ignore
    api = KaggleApi()
    api.authenticate()
    tmp = tempfile.mkdtemp()
    api.dataset_download_files(params["dataset"], path=tmp, unzip=True, quiet=True)
    dfs = read_folder(tmp, params.get("pattern") or "*", combine=False)
    return {k: (v.head(PREVIEW_ROWS) if preview else v) for k, v in dfs.items()}


ENGINES = {
    "rest": rest_engine, "graphql": graphql_engine, "sql": sql_engine, "file": file_engine, "web": web_engine,
    "folder": folder_engine, "storage": storage_engine, "mongo": mongo_engine, "elastic": elastic_engine,
    "influx": influx_engine, "redis": redis_engine, "cassandra": cassandra_engine, "dynamodb": dynamodb_engine,
    "firestore": firestore_engine, "cosmos": cosmos_engine, "python": python_engine, "yfinance": yfinance_engine,
    "kaggle": kaggle_engine,
}

DISCOVERABLE = {"sql", "file", "web", "storage", "mongo", "elastic", "dynamodb"}


def run(c: Connector, params: dict, file: FileArg = None, preview: bool = False, tables: Optional[List[str]] = None) -> Dict[str, pd.DataFrame]:
    fn = ENGINES[c.engine]
    params = {k: (v.strip() if isinstance(v, str) else v) for k, v in (params or {}).items()}
    missing = [p.label for p in c.params if p.required and p.type != "file" and params.get(p.key) in (None, "") and not (p.key in ("path", "url") and (file or params.get("path") or params.get("url")))]
    if missing:
        raise ConnectorError("Please fill in: " + ", ".join(missing))
    out = fn(c, params, file=file, preview=preview, tables=tables)
    return {(k or c.name): v for k, v in out.items()}


def discover(c: Connector, params: dict, file: FileArg = None) -> Optional[List[str]]:
    """List the tables a multi-table source offers (Power BI 'Navigator'). None for single-table connectors."""
    if c.engine not in DISCOVERABLE or not c.multi:
        return None
    params = {k: (v.strip() if isinstance(v, str) else v) for k, v in (params or {}).items()}
    if params.get("query"):
        return None
    if c.engine in ("mongo",) and params.get("collection"):
        return None
    if c.engine == "elastic" and params.get("index"):
        return None
    if c.engine == "dynamodb" and params.get("table"):
        return None
    res = ENGINES[c.engine](c, params, file=file, preview=True, discover=True)
    return res if isinstance(res, list) else list(res)
