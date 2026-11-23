"""Open Power BI files (.pbix / .pbit) in PyBI.

A .pbix file is a zip archive with two parts that matter:

* the **report** - pages, visuals, positions, fields, filters, slicers, theme and images. It is stored as JSON,
  either in the classic ``Report/Layout`` file or in the newer folder format (PBIR, ``Report/definition/...``).
  PyBI reads this part itself, with no extra packages.
* the **data model** - tables, relationships, DAX measures and calculated columns, stored in Microsoft's
  compressed VertiPaq format (``DataModel``). PyBI reads it with the optional ``pbixray`` package
  (``pip install pybi-ray[pbix]``). A .pbit template has no data but keeps the model as plain JSON
  (``DataModelSchema``), which PyBI reads directly.

Everything that cannot be carried over exactly (custom visuals, maps, buttons, DAX functions the PyBI engine does
not know yet, ...) is listed in ``PbixImport.warnings`` so the user knows what to check.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import tempfile
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Dict, List, Optional, Tuple, Union

import pandas as pd

AUTO_DATE_PREFIXES = ("LocalDateTable_", "DateTableTemplate_")
MAX_IMAGE_BYTES = 6 * 1024 * 1024


@dataclass
class PbixImport:
    tables: Dict[str, pd.DataFrame]
    report: dict
    warnings: List[str] = field(default_factory=list)
    info: Dict[str, Any] = field(default_factory=dict)


class PbixError(ValueError):
    """The file is not a Power BI file PyBI can open."""


# ====================================================================== public API

def read_pbix(source: Union[str, os.PathLike, bytes], name: Optional[str] = None, load_data: bool = True) -> PbixImport:
    """Read a .pbix or .pbit file (path or bytes) into PyBI tables + a PyBI report definition."""
    if isinstance(source, (bytes, bytearray)):
        data = bytes(source)
    else:
        p = Path(source)
        data = p.read_bytes()
        name = name or p.name
    name = name or "Power BI report"
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PbixError("This is not a Power BI file (.pbix/.pbit is a zip archive).") from exc

    with z:
        names = set(z.namelist())
        warn: List[str] = []
        info: Dict[str, Any] = {"file": name}

        # ---------------- data model
        tables: Dict[str, pd.DataFrame] = {}
        model = _empty_model()
        if "DataModelSchema" in names:
            info["model"] = "schema"
            model = _model_from_schema(_read_json(z, "DataModelSchema"), warn)
            tables = {t: pd.DataFrame(columns=cols) for t, cols in model.pop("columns").items()}
            if Path(name).suffix.lower() == ".pbit":
                warn.append("This is a Power BI template (.pbit): it has the report and the model but no data. "
                            "Load or connect the data, then refresh.")
        elif "DataModel" in names:
            info["model"] = "vertipaq"
            if load_data:
                tables, model = _model_from_vertipaq(data, warn)
        else:
            info["model"] = "live"
            conn = _connection_info(z, names)
            warn.append("This report uses a live connection" + (f" ({conn})" if conn else "") +
                        " - the data stays in Power BI / Analysis Services, so only the report layout was imported. "
                        "Load matching tables in PyBI to see the visuals.")
        model.pop("columns", None)

        # ---------------- report
        pkg = _Package(z, names)
        if pkg.layout is None and not pkg.pbir:
            if not tables:
                raise PbixError("No report or data model was found in this file.")
            warn.append("The file has no report pages - only the data model was imported.")
        conv = _Converter(pkg, tables, model, warn)
        report = conv.report(Path(name).stem)

    info.update({"pages": len(report["pages"]), "visuals": sum(len(p["visuals"]) for p in report["pages"]),
                 "tables": len(tables), "rows": int(sum(len(df) for df in tables.values())),
                 "measures": len(report["measures"]), "relationships": len(report["relationships"])})
    big = [f"{t} ({len(df):,} rows)" for t, df in tables.items() if len(df) > 1_000_000]
    if big:
        warn.append("Large tables can make the browser slow: " + ", ".join(big) + ".")
    _dax_warnings(report, warn)
    return PbixImport(tables=tables, report=report, warnings=_dedupe(warn), info=info)


def project_from_pbix(source: Union[str, os.PathLike, bytes], name: Optional[str] = None):
    """Build a PyBI :class:`~pybi.project.Project` from a Power BI file. Returns ``(project, PbixImport)``."""
    from .project import Project

    imp = read_pbix(source, name)
    proj = Project()
    origin = imp.info.get("file", "Power BI")
    for t, df in imp.tables.items():
        proj.add_source(t, df, "pbix", origin, detect=False)
    proj.report = imp.report
    return proj, imp


def is_power_bi_file(filename: str) -> bool:
    return Path(filename or "").suffix.lower() in (".pbix", ".pbit")


# ====================================================================== zip helpers

def _decode(raw: bytes) -> str:
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    if raw[:3] == b"\xef\xbb\xbf":
        return raw[3:].decode("utf-8")
    if len(raw) > 1 and raw[1:2] == b"\x00":
        return raw.decode("utf-16-le")
    return raw.decode("utf-8")


def _read_json(z: zipfile.ZipFile, name: str):
    return json.loads(_decode(z.read(name)))


def _jload(v, default=None):
    if v is None or v == "":
        return default
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def _connection_info(z: zipfile.ZipFile, names) -> str:
    if "Connections" not in names:
        return ""
    try:
        c = _read_json(z, "Connections")
        rc = (c.get("RemoteArtifacts") or c.get("Connections") or [{}])[0]
        return rc.get("DatasetId") and "Power BI dataset" or rc.get("ConnectionString", "")[:80]
    except Exception:  # noqa: BLE001
        return ""


def _dedupe(items):
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


# ====================================================================== data model

def _empty_model() -> dict:
    return {"measures": [], "calcColumns": [], "relationships": [], "hidden": [], "columnProps": {}, "columns": {}}


def _skip_table(name: str) -> bool:
    return str(name).startswith(AUTO_DATE_PREFIXES)


def _expr_text(e) -> str:
    if isinstance(e, list):
        return "\n".join(str(x) for x in e)
    return "" if e is None else str(e)


def _cross(v) -> str:
    return "both" if str(v).lower() in ("2", "both", "bothdirections") else "single"


def _model_from_schema(schema: dict, warn: list) -> dict:
    """.pbit / DataModelSchema: the model as JSON (tables, columns, measures, relationships), no rows."""
    m = _empty_model()
    model = schema.get("model", schema)
    for t in model.get("tables", []):
        tn = t.get("name")
        if not tn or _skip_table(tn):
            continue
        cols = []
        for c in t.get("columns", []):
            cn = c.get("name")
            if not cn or cn.startswith("RowNumber-"):
                continue
            if c.get("type") == "calculated" or (c.get("expression") and c.get("type") != "data"):
                m["calcColumns"].append({"table": tn, "name": cn, "expression": _expr_text(c.get("expression"))})
            else:
                cols.append(cn)
            if c.get("isHidden") or t.get("isHidden"):
                m["hidden"].append(f"{tn}[{cn}]")
            props = {}
            fmt = _format_from_string(c.get("formatString"))
            if fmt:
                props["format"] = fmt
            if c.get("sortByColumn"):
                props["sortBy"] = c["sortByColumn"]
            if props:
                m["columnProps"][f"{tn}[{cn}]"] = props
        if t.get("partitions") and any((p.get("source") or {}).get("type") == "calculated" for p in t["partitions"]):
            warn.append(f"'{tn}' is a calculated table; its rows are not in the file.")
        m["columns"][tn] = cols
        for ms in t.get("measures", []):
            m["measures"].append({"name": ms.get("name"), "expression": _expr_text(ms.get("expression")), "table": tn,
                                  "format": _format_from_string(ms.get("formatString")) or {}})
    for r in model.get("relationships", []):
        if _skip_table(r.get("fromTable", "")) or _skip_table(r.get("toTable", "")):
            continue
        m["relationships"].append({"fromTable": r.get("fromTable"), "fromColumn": r.get("fromColumn"),
                                   "toTable": r.get("toTable"), "toColumn": r.get("toColumn"),
                                   "crossFilter": _cross(r.get("crossFilteringBehavior")), "active": r.get("isActive", True) is not False})
    return m


def _model_from_vertipaq(data: bytes, warn: list) -> Tuple[Dict[str, pd.DataFrame], dict]:
    m = _empty_model()
    try:
        from pbixray import PBIXRay
    except ImportError:
        warn.append("The data inside this .pbix needs the 'pbixray' package. Install it with:  pip install \"pybi-ray[pbix]\"  "
                    "then open the file again. The report pages were imported without data.")
        return {}, m

    tmp = tempfile.NamedTemporaryFile(suffix=".pbix", delete=False)
    try:
        tmp.write(data)
        tmp.close()
        model = PBIXRay(tmp.name)
        try:
            return _read_pbixray(model, m, warn)
        finally:
            close = getattr(model, "close", None)
            if callable(close):
                close()
    except Exception as exc:  # noqa: BLE001
        warn.append(f"Could not read the data model ({type(exc).__name__}: {exc}). The report pages were imported without data.")
        return {}, m
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def _df(obj) -> pd.DataFrame:
    return obj if isinstance(obj, pd.DataFrame) else pd.DataFrame()


def _attr(model, name):
    try:
        return getattr(model, name)
    except Exception:  # noqa: BLE001 - pbixray raises for parts a file does not have
        return None


def _truthy(v) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes")
    try:
        return bool(v) and not pd.isna(v)
    except (TypeError, ValueError):
        return bool(v)


def _read_pbixray(model, m: dict, warn: list) -> Tuple[Dict[str, pd.DataFrame], dict]:
    tables: Dict[str, pd.DataFrame] = {}
    names = [str(t) for t in (_attr(model, "tables") or [])]
    for t in names:
        if _skip_table(t):
            continue
        try:
            df = model.get_table(t)
            df = df.loc[:, [c for c in df.columns if not str(c).startswith("RowNumber-")]]
            tables[t] = _clean_types(df)
        except Exception as exc:  # noqa: BLE001
            warn.append(f"Table '{t}' could not be read ({exc}); it was skipped.")

    cols = _df(_attr(model, "tmschema_columns"))
    if not cols.empty and {"TableName", "Name"} <= set(cols.columns):
        by_id = {}
        if "ID" in cols.columns:
            by_id = {r["ID"]: r["Name"] for _, r in cols.iterrows()}
        hidden_tables = set()
        tdf = _df(_attr(model, "tmschema_tables"))
        if not tdf.empty and "IsHidden" in tdf.columns:
            hidden_tables = {r["Name"] for _, r in tdf.iterrows() if _truthy(r["IsHidden"])}
        for _, r in cols.iterrows():
            tn, cn = r["TableName"], r["Name"]
            if tn not in tables or not cn:
                continue
            key = f"{tn}[{cn}]"
            if _truthy(r.get("IsHidden")) or tn in hidden_tables:
                m["hidden"].append(key)
            props = {}
            fmt = _format_from_string(r.get("FormatString"))
            if fmt:
                props["format"] = fmt
            sid = r.get("SortByColumnID")
            if sid is not None and not pd.isna(sid) and sid in by_id:
                props["sortBy"] = by_id[sid]
            if props:
                m["columnProps"][key] = props

    measures = _df(_attr(model, "dax_measures"))
    fmt_by_name = {}
    for extra in ("tmschema_measures",):
        mdf = _df(_attr(model, extra))
        if not mdf.empty and {"Name", "FormatString"} <= set(mdf.columns):
            fmt_by_name = {r["Name"]: r["FormatString"] for _, r in mdf.iterrows()}
    for _, r in measures.iterrows():
        n = r.get("Name")
        if not n:
            continue
        fs = r.get("FormatString") if "FormatString" in measures.columns else fmt_by_name.get(n)
        m["measures"].append({"name": str(n), "expression": _expr_text(r.get("Expression")), "table": str(r.get("TableName") or ""),
                              "format": _format_from_string(fs) or {}})

    # calculated columns are stored with their values; keep the DAX only for columns that are not in the data
    calc = _df(_attr(model, "dax_columns"))
    for _, r in calc.iterrows():
        tn, cn = r.get("TableName"), r.get("ColumnName")
        if tn in tables and cn and cn not in tables[tn].columns:
            m["calcColumns"].append({"table": tn, "name": cn, "expression": _expr_text(r.get("Expression"))})

    rels = _df(_attr(model, "relationships"))
    for _, r in rels.iterrows():
        ft, fc, tt, tc = r.get("FromTableName"), r.get("FromColumnName"), r.get("ToTableName"), r.get("ToColumnName")
        if not (ft and tt and fc and tc) or _skip_table(ft) or _skip_table(tt):
            continue
        if str(r.get("Cardinality", "")).upper().startswith("1:M"):
            ft, fc, tt, tc = tt, tc, ft, fc
        m["relationships"].append({"fromTable": ft, "fromColumn": fc, "toTable": tt, "toColumn": tc,
                                   "crossFilter": _cross(r.get("CrossFilteringBehavior")), "active": _truthy(r.get("IsActive", True))})
    if _df(_attr(model, "rls")).shape[0]:
        warn.append("Row-level security roles are not applied in PyBI - everyone who opens the report sees all rows.")
    return tables, m


def _clean_types(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in df.columns:
        s = df[c]
        if isinstance(s.dtype, pd.CategoricalDtype):
            df[c] = s.astype(object)
        elif isinstance(s.dtype, pd.DatetimeTZDtype):
            df[c] = s.dt.tz_convert("UTC").dt.tz_localize(None)
        elif s.dtype == object and s.notna().any() and type(s.dropna().iloc[0]).__name__ == "Decimal":
            df[c] = pd.to_numeric(s, errors="coerce")
    return df


def _format_from_string(fs) -> Optional[dict]:
    """Power BI / Excel format string -> PyBI format ({type, symbol, decimals})."""
    if fs is None or (isinstance(fs, float) and pd.isna(fs)):
        return None
    s = str(fs).split(";")[0].strip()
    if not s or s.lower() in ("general", "g"):
        return None
    if s.lower().startswith(("dd", "mm", "yyyy", "d/", "m/", "long date", "short date", "general date", "hh")):
        return None
    dec_m = re.search(r"\.([0#]+)", s)
    dec = len(dec_m.group(1)) if dec_m else 0
    if "%" in s:
        return {"type": "percent", "decimals": dec}
    sym = re.search(r"\\?([$€£¥₹₨])|\[\$([^\]-]+)", s)
    if sym:
        return {"type": "currency", "symbol": sym.group(1) or sym.group(2), "decimals": dec}
    if re.fullmatch(r"[#,0.\s]+", s):
        return {"type": "whole"} if not dec else {"type": "decimal", "decimals": dec}
    return None


# ====================================================================== report package

class _Package:
    """Normalises the two report formats (Report/Layout and PBIR) into one simple structure."""

    def __init__(self, z: zipfile.ZipFile, names):
        self.z, self.names = z, names
        self.layout = None
        self.pbir = any(n.startswith("Report/definition/") for n in names)
        lay = next((n for n in names if n.lower() == "report/layout"), None)
        if lay:
            self.layout = _read_json(z, lay)

    # ------------------------------------------------ resources
    def resource(self, item: str, package: str = "RegisteredResources") -> Optional[bytes]:
        for base in ("Report/StaticResources/", "StaticResources/"):
            p = f"{base}{package}/{item}"
            if p in self.names:
                return self.z.read(p)
        hit = next((n for n in self.names if n.endswith("/" + item)), None)
        return self.z.read(hit) if hit else None

    def theme(self) -> Optional[dict]:
        cands = []
        for n in self.names:
            if not n.lower().endswith(".json"):
                continue
            if "/RegisteredResources/" in n:
                cands.insert(0, n)
            elif "/BaseThemes/" in n:
                cands.append(n)
        for n in cands:
            try:
                t = _read_json(self.z, n)
            except Exception:  # noqa: BLE001
                continue
            if isinstance(t, dict) and t.get("dataColors"):
                t["_custom"] = "/RegisteredResources/" in n
                return t
        return None

    # ------------------------------------------------ pages
    def pages(self) -> List[dict]:
        if self.layout is not None:
            return self._layout_pages()
        if self.pbir:
            return self._pbir_pages()
        return []

    def report_filters(self) -> list:
        if self.layout is not None:
            return _jload(self.layout.get("filters"), []) or []
        rp = "Report/definition/report.json"
        if rp in self.names:
            return ((_read_json(self.z, rp).get("filterConfig") or {}).get("filters")) or []
        return []

    def _layout_pages(self) -> List[dict]:
        out = []
        for s in sorted(self.layout.get("sections", []), key=lambda s: s.get("ordinal", 0)):
            cfg = _jload(s.get("config"), {}) or {}
            page = {"name": s.get("displayName") or s.get("name") or "Page", "width": s.get("width") or 1280,
                    "height": s.get("height") or 720, "objects": cfg.get("objects") or {},
                    "hidden": cfg.get("visibility") == 1, "tooltip": cfg.get("type") == 2,
                    "filters": _jload(s.get("filters"), []) or [], "visuals": []}
            for vc in s.get("visualContainers", []):
                c = _jload(vc.get("config"), {}) or {}
                pos = ((c.get("layouts") or [{}])[0] or {}).get("position") or {}
                v = {"name": c.get("name") or vc.get("id"), "x": vc.get("x", pos.get("x", 0)), "y": vc.get("y", pos.get("y", 0)),
                     "w": vc.get("width", pos.get("width", 200)), "h": vc.get("height", pos.get("height", 150)),
                     "z": vc.get("z", pos.get("z", 0)), "filters": _jload(vc.get("filters"), []) or [],
                     "parent": c.get("parentGroupName")}
                if "singleVisualGroup" in c:
                    g = c["singleVisualGroup"] or {}
                    v.update(type="__group", hidden=bool(g.get("isHidden")))
                    page["visuals"].append(v)
                    continue
                sv = c.get("singleVisual") or {}
                proto = sv.get("prototypeQuery") or {}
                aliases = {f.get("Name"): f.get("Entity") for f in proto.get("From", [])}
                select = {sel.get("Name"): _resolve(sel, aliases) for sel in proto.get("Select", [])}
                cprops = sv.get("columnProperties") or {}
                roles = {}
                for role, items in (sv.get("projections") or {}).items():
                    roles[role] = []
                    for it in items or []:
                        qr = it.get("queryRef")
                        if qr in select:
                            roles[role].append({"expr": select[qr], "label": (cprops.get(qr) or {}).get("displayName"),
                                                "active": bool(it.get("active"))})
                v.update(type=sv.get("visualType") or "", roles=roles, objects=sv.get("objects") or {},
                         vcObjects=sv.get("vcObjects") or {}, hidden=(sv.get("display") or {}).get("mode") == "hidden",
                         orderBy=proto.get("OrderBy") or [], aliases=aliases)
                page["visuals"].append(v)
            out.append(page)
        return out

    def _pbir_pages(self) -> List[dict]:
        root = "Report/definition/pages/"
        order = []
        if root + "pages.json" in self.names:
            order = _read_json(self.z, root + "pages.json").get("pageOrder") or []
        found = sorted({PurePosixPath(n).parts[3] for n in self.names if n.startswith(root) and n.endswith("/page.json")})
        order = [p for p in order if p in found] + [p for p in found if p not in order]
        out = []
        for pid in order:
            pj = _read_json(self.z, f"{root}{pid}/page.json")
            page = {"name": pj.get("displayName") or pid, "width": pj.get("width") or 1280, "height": pj.get("height") or 720,
                    "objects": pj.get("objects") or {}, "hidden": pj.get("visibility") in ("HiddenInViewMode", 1),
                    "tooltip": (pj.get("type") or "") == "Tooltip",
                    "filters": (pj.get("filterConfig") or {}).get("filters") or [], "visuals": []}
            vroot = f"{root}{pid}/visuals/"
            for n in sorted(x for x in self.names if x.startswith(vroot) and x.endswith("/visual.json")):
                vj = _read_json(self.z, n)
                pos = vj.get("position") or {}
                v = {"name": vj.get("name"), "x": pos.get("x", 0), "y": pos.get("y", 0), "w": pos.get("width", 200),
                     "h": pos.get("height", 150), "z": pos.get("z", 0), "parent": vj.get("parentGroupName"),
                     "filters": (vj.get("filterConfig") or {}).get("filters") or [], "hidden": bool(vj.get("isHidden"))}
                if "visualGroup" in vj:
                    v["type"] = "__group"
                    page["visuals"].append(v)
                    continue
                vis = vj.get("visual") or {}
                roles = {}
                for role, st in ((vis.get("query") or {}).get("queryState") or {}).items():
                    roles[role] = [{"expr": p.get("field"), "label": p.get("displayName"), "active": bool(p.get("active"))}
                                   for p in (st or {}).get("projections", []) if p.get("field")]
                v.update(type=vis.get("visualType") or "", roles=roles, objects=vis.get("objects") or {},
                         vcObjects=vis.get("visualContainerObjects") or {},
                         orderBy=((vis.get("query") or {}).get("sortDefinition") or {}).get("sort") or [], aliases={})
                page["visuals"].append(v)
            out.append(page)
        return out


def _resolve(obj, aliases: dict):
    """Replace query aliases ({"SourceRef": {"Source": "s"}}) with table names ({"SourceRef": {"Entity": "Sales"}})."""
    if isinstance(obj, dict):
        if set(obj) == {"Source"} and obj["Source"] in aliases:
            return {"Entity": aliases[obj["Source"]]}
        return {k: _resolve(v, aliases) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_resolve(x, aliases) for x in obj]
    return obj


# ====================================================================== expressions

LEVELS = {"year": "year", "quarter": "quarter", "month": "month", "day": "day", "date": "day", "week": None}
AGG = {0: "sum", 1: "avg", 2: "distinct", 3: "min", 4: "max", 5: "count", 6: "median"}


def _entity(expr: dict) -> Optional[str]:
    if not isinstance(expr, dict):
        return None
    sr = expr.get("SourceRef")
    if sr:
        return sr.get("Entity")
    for k in ("PropertyVariationSource", "Hierarchy", "Column"):
        if k in expr:
            return _entity(expr[k].get("Expression"))
    return None


def field_from_expr(e: dict) -> Optional[dict]:
    """Power BI semantic-query field -> PyBI field ({table, column, level?, agg?} or {measure})."""
    if not isinstance(e, dict):
        return None
    if "Column" in e:
        c = e["Column"]
        t = _entity(c.get("Expression"))
        return {"table": t, "column": c.get("Property")} if t else None
    if "Measure" in e:
        return {"measure": e["Measure"].get("Property")}
    if "Aggregation" in e:
        f = field_from_expr(e["Aggregation"].get("Expression"))
        if f and "column" in f:
            f["agg"] = AGG.get(e["Aggregation"].get("Function"), "sum")
        return f
    if "HierarchyLevel" in e:
        hl = e["HierarchyLevel"]
        level = str(hl.get("Level") or "")
        h = ((hl.get("Expression") or {}).get("Hierarchy")) or {}
        src = h.get("Expression") or {}
        if "PropertyVariationSource" in src:  # automatic date hierarchy: Date Hierarchy / Year
            pvs = src["PropertyVariationSource"]
            t = _entity(pvs.get("Expression"))
            lv = LEVELS.get(level.lower())
            f = {"table": t, "column": pvs.get("Property")}
            if lv:
                f["level"] = lv
            return f if t else None
        t = _entity(src)
        return {"table": t, "column": level} if t and level else None
    if "PropertyVariationSource" in e:
        pvs = e["PropertyVariationSource"]
        t = _entity(pvs.get("Expression"))
        return {"table": t, "column": pvs.get("Property")} if t else None
    return None


_LIT_NUM = re.compile(r"^(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)([LDM]?)$")


def literal(e) -> Any:
    """Power BI literal ("'text'", "12L", "1.5D", "datetime'2020-01-01T00:00:00'", "true", "null") -> Python value."""
    if isinstance(e, dict):
        if "Literal" in e:
            e = e["Literal"].get("Value")
        elif "expr" in e:
            return literal(e["expr"])
        else:
            return None
    if not isinstance(e, str):
        return e
    s = e.strip()
    if s == "null":
        return None
    if s in ("true", "false"):
        return s == "true"
    if s.startswith("datetime'") and s.endswith("'"):
        d = s[9:-1]
        return d[:19] if "T" in d else d + "T00:00:00"
    if len(s) >= 2 and s[0] == "'" and s[-1] == "'":
        return s[1:-1].replace("''", "'")
    m = _LIT_NUM.match(s)
    if m:
        n = m.group(1)
        return int(n) if m.group(2) == "L" or ("." not in n and "e" not in n.lower() and m.group(2) == "") else float(n)
    return s


def prop(objects: dict, obj: str, name: str, default=None):
    """Read objects[obj][0].properties[name] as a plain value."""
    try:
        for entry in objects.get(obj) or []:
            if entry.get("selector"):
                continue
            p = (entry.get("properties") or {}).get(name)
            if p is not None:
                return p
    except AttributeError:
        pass
    return default


def prop_value(objects: dict, obj: str, name: str, default=None):
    p = prop(objects, obj, name)
    if p is None:
        return default
    v = literal(p.get("expr") if isinstance(p, dict) and "expr" in p else p)
    return default if v is None else v


# ====================================================================== filters

COMPARE = {0: "=", 1: ">", 2: ">=", 3: "<", 4: "<="}


def condition_to_spec(cond: dict) -> Optional[dict]:
    if not isinstance(cond, dict):
        return None
    if "In" in cond:
        i = cond["In"]
        exprs = i.get("Expressions") or []
        if len(exprs) != 1:
            return None
        f = field_from_expr(exprs[0])
        if not f or "table" not in f:
            return None
        f.pop("agg", None)
        vals = [literal(row[0]) for row in i.get("Values") or [] if row]
        return {"field": f, "mode": "basic", "values": vals}
    if "Not" in cond:
        inner = condition_to_spec(cond["Not"].get("Expression"))
        if not inner:
            return None
        if inner["mode"] == "basic":
            inner["invert"] = True
            return inner
        neg = {"=": "!=", "contains": "not contains", "is blank": "is not blank", ">": "<=", ">=": "<", "<": ">=", "<=": ">"}
        if inner.get("op") in neg and not inner.get("op2"):
            inner["op"] = neg[inner["op"]]
            return inner
        return None
    if "Comparison" in cond:
        c = cond["Comparison"]
        f = field_from_expr(c.get("Left"))
        if not f or "table" not in f:
            return None
        f.pop("agg", None)
        val = literal(c.get("Right"))
        op = COMPARE.get(c.get("ComparisonKind"), "=")
        if val is None:
            op = "is blank" if op == "=" else op
        return {"field": f, "mode": "advanced", "op": op, "value": val}
    for key, op in (("Contains", "contains"), ("StartsWith", "starts with")):
        if key in cond:
            f = field_from_expr(cond[key].get("Left"))
            if f and "table" in f:
                return {"field": f, "mode": "advanced", "op": op, "value": literal(cond[key].get("Right"))}
            return None
    for key in ("And", "Or"):
        if key in cond:
            a, b = condition_to_spec(cond[key].get("Left")), condition_to_spec(cond[key].get("Right"))
            if not a or not b:
                return a or b if key == "And" else None
            if key == "Or" and a["field"] == b["field"] and all(_as_values(x) is not None for x in (a, b)):
                return {"field": a["field"], "mode": "basic", "values": _as_values(a) + _as_values(b)}
            if a["mode"] == b["mode"] == "advanced" and a["field"] == b["field"] and not a.get("op2"):
                a.update(op2=b["op"], value2=b.get("value"), join=key.lower())
                return a
            return None
    return None


def _as_values(spec: dict) -> Optional[list]:
    """A basic list filter, or an "= value" comparison, as a list of values (for OR-chains)."""
    if spec["mode"] == "basic" and not spec.get("invert"):
        return list(spec["values"])
    if spec["mode"] == "advanced" and spec.get("op") == "=" and not spec.get("op2"):
        return [spec.get("value")]
    return None


def _measure_condition(where) -> bool:
    return '"Measure"' in json.dumps(where) and '"Column"' not in json.dumps(where)


def filter_to_spec(flt: dict) -> Tuple[Optional[dict], Optional[str]]:
    """One Power BI filter card -> (PyBI filter spec | None, reason it was skipped | None)."""
    body = flt.get("filter")
    if not body:
        return None, None  # empty filter card - nothing selected
    ftype = str(flt.get("type") or "")
    if ftype in ("TopN",):
        return None, "Top N filters"
    if ftype in ("RelativeDate", "RelativeTime"):
        return None, "relative date filters"
    aliases = {f.get("Name"): f.get("Entity") for f in body.get("From", [])}
    where = _resolve(body.get("Where") or [], aliases)
    specs = [condition_to_spec((w or {}).get("Condition")) for w in where]
    specs = [s for s in specs if s]
    if not specs:
        return None, "filters on measures" if _measure_condition(where) else "some advanced filters"
    return specs[0], None


# ====================================================================== colours & themes

def _shade(hex_color: str, pct: float) -> str:
    try:
        h = hex_color.lstrip("#")
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    except (ValueError, AttributeError):
        return hex_color
    if pct > 0:
        r, g, b = (round(c + (255 - c) * pct) for c in (r, g, b))
    else:
        r, g, b = (round(c * (1 + pct)) for c in (r, g, b))
    return "#{:02X}{:02X}{:02X}".format(*(max(0, min(255, c)) for c in (r, g, b)))


class _Theme:
    def __init__(self, t: Optional[dict]):
        t = t or {}
        self.data = t.get("dataColors") or ["#118DFF", "#12239E", "#E66C37", "#6B007B", "#E044A7", "#744EC2", "#D9B300", "#D64550"]
        self.background = t.get("background") or "#FFFFFF"
        self.foreground = t.get("foreground") or "#252423"
        self.raw = t

    def color(self, c) -> Optional[str]:
        """Power BI colour object ({"solid": {"color": ...}} / literal / ThemeDataColor) -> '#RRGGBB'."""
        if c is None:
            return None
        if isinstance(c, dict):
            if "solid" in c:
                return self.color((c["solid"] or {}).get("color"))
            if "expr" in c:
                return self.color(c["expr"])
            if "Literal" in c:
                v = literal(c)
                return v if isinstance(v, str) and v.startswith("#") else None
            if "ThemeDataColor" in c:
                td = c["ThemeDataColor"]
                cid, pct = int(td.get("ColorId", 0)), float(td.get("Percent", 0) or 0)
                base = self.background if cid == 0 else self.foreground if cid == 1 else self.data[(cid - 2) % len(self.data)]
                return _shade(base, pct) if pct else base
            return None
        if isinstance(c, str) and c.startswith("#"):
            return c
        return None


# ====================================================================== visual mapping

CAT = {"Category": "category", "Series": "series", "Y": "values", "Legend": "series", "Values": "values"}
VISUALS = {
    "clusteredColumnChart": ("clusteredColumn", CAT), "columnChart": ("stackedColumn", CAT),
    "hundredPercentStackedColumnChart": ("percentColumn", CAT), "clusteredBarChart": ("clusteredBar", CAT),
    "barChart": ("stackedBar", CAT), "hundredPercentStackedBarChart": ("stackedBar", CAT),
    "lineChart": ("line", CAT), "areaChart": ("area", CAT), "stackedAreaChart": ("stackedArea", CAT),
    "hundredPercentStackedAreaChart": ("stackedArea", CAT), "ribbonChart": ("ribbon", CAT),
    "lineClusteredColumnComboChart": ("lineColumn", {"Category": "category", "Y": "values", "Y2": "lineValues"}),
    "lineStackedColumnComboChart": ("lineColumn", {"Category": "category", "Y": "values", "Y2": "lineValues"}),
    "waterfallChart": ("waterfall", {"Category": "category", "Y": "values"}),
    "scatterChart": ("scatter", {"Category": "category", "Details": "category", "Series": "series", "X": "x", "Y": "y", "Size": "size"}),
    "pieChart": ("pie", {"Category": "category", "Series": "category", "Y": "values", "Values": "values"}),
    "donutChart": ("donut", {"Category": "category", "Series": "category", "Y": "values", "Values": "values"}),
    "treemap": ("treemap", {"Group": "category", "Category": "category", "Details": "category", "Values": "values", "Y": "values"}),
    "funnel": ("funnel", {"Category": "category", "Y": "values", "Values": "values"}),
    "gauge": ("gauge", {"Y": "values", "Values": "values", "TargetValue": "target", "MaxValue": "max"}),
    "card": ("card", {"Values": "values"}), "cardVisual": ("card", {"Data": "values", "Values": "values"}),
    "multiRowCard": ("multiCard", {"Values": "values"}),
    "kpi": ("kpi", {"Indicator": "values", "TrendLine": "category", "Goal": "target"}),
    "tableEx": ("table", {"Values": "columns"}), "table": ("table", {"Values": "columns"}),
    "pivotTable": ("matrix", {"Rows": "rows", "Columns": "columns", "Values": "values"}),
    "matrix": ("matrix", {"Rows": "rows", "Columns": "columns", "Values": "values"}),
    "slicer": ("slicer", {"Values": "category", "Field": "category"}),
    "advancedSlicerVisual": ("slicer", {"Values": "category", "Field": "category"}),
    "listSlicer": ("slicer", {"Values": "category", "Field": "category"}),
    "textSlicer": ("slicer", {"Values": "category", "Field": "category"}),
}
# max fields per PyBI role (mirrors static/visuals.js)
ROLE_MAX = {"category": 1, "series": 1, "values": 8, "lineValues": 4, "x": 1, "y": 1, "size": 1, "target": 1, "max": 1,
            "columns": 30, "rows": 2}
VALUE_ROLES = {"values", "lineValues", "x", "y", "size", "target", "max"}
ROLE_MAX_BY_TYPE = {"waterfall": {"values": 1}, "pie": {"values": 1}, "donut": {"values": 1}, "treemap": {"values": 1},
                    "funnel": {"values": 1}, "gauge": {"values": 1}, "card": {"values": 1}, "kpi": {"values": 1},
                    "multiCard": {"values": 10}, "matrix": {"columns": 1}}
DECOR = {"shape", "basicShape"}
SKIP_QUIET = {"actionButton", "pageNavigator", "bookmarkNavigator"}
FRIENDLY = {"map": "Map", "filledMap": "Filled map", "shapeMap": "Shape map", "azureMap": "Azure map",
            "decompositionTreeVisual": "Decomposition tree", "keyDriversVisual": "Key influencers", "qnaVisual": "Q&A",
            "scriptVisual": "R visual", "pythonVisual": "Python visual", "aiNarratives": "Smart narrative",
            "paginatedReportVisual": "Paginated report", "powerAppsVisual": "Power Apps", "esriVisual": "ArcGIS map"}
AUTO_TITLE = {"clusteredColumn", "stackedColumn", "percentColumn", "clusteredBar", "stackedBar", "line", "area", "stackedArea",
              "ribbon", "lineColumn", "waterfall", "scatter", "pie", "donut", "treemap", "funnel", "gauge", "kpi"}


def _absolute_positions(visuals: list, groups: dict):
    """Visuals inside a group are stored relative to the group in newer files and absolute in older ones."""
    done: set = set()

    def place(v, depth=0):
        if v["name"] in done or depth > 20:
            return
        parent = groups.get(v.get("parent"))
        if parent is not None:
            place(parent, depth + 1)
            relative = v["x"] + v["w"] <= parent["w"] + 2 and v["y"] + v["h"] <= parent["h"] + 2
            outside = not (parent["x"] - 2 <= v["x"] <= parent["x"] + parent["w"] and parent["y"] - 2 <= v["y"] <= parent["y"] + parent["h"])
            if relative or outside:
                v["x"] += parent["x"]
                v["y"] += parent["y"]
        done.add(v["name"])

    for v in sorted(visuals, key=lambda v: v.get("type") != "__group"):
        place(v)


class _Converter:
    def __init__(self, pkg: _Package, tables: Dict[str, pd.DataFrame], model: dict, warn: list):
        self.pkg, self.tables, self.model, self.warn = pkg, tables, model, warn
        th = pkg.theme()
        self.theme = _Theme(th)
        self.custom_theme = th if th and th.get("_custom") else None
        self.skipped: Counter = Counter()
        self.unsupported: Counter = Counter()
        self.filter_skips: Counter = Counter()
        self.n = 0

    def _id(self, prefix="v"):
        self.n += 1
        return f"{prefix}{self.n}"

    # ------------------------------------------------ report
    def report(self, title: str) -> dict:
        pages = []
        for i, pg in enumerate(self.pkg.pages()):
            pages.append(self.page(pg, i))
        if not pages:
            pages = [{"id": "p1", "name": "Page 1", "visuals": [], "filters": [], "background": None}]
        rep = {"version": 1, "title": title, "theme": "pybi", "pages": pages,
               "measures": [m for m in self.model.get("measures", []) if m.get("name")],
               "calcColumns": self.model.get("calcColumns", []),
               "relationships": [dict(r, id=f"r{i + 1}") for i, r in enumerate(self.model.get("relationships", []))],
               "reportFilters": self.filters(self.pkg.report_filters()),
               "hiddenFields": sorted(set(self.model.get("hidden", []))),
               "columnProps": self.model.get("columnProps", {}), "formats": {},
               "source": {"type": "pbix", "file": title}}
        if self.custom_theme:
            t = self.custom_theme
            ct = {"name": t.get("name") or "Power BI theme", "palette": list(self.theme.data)}
            if t.get("background"):
                ct["card"] = t["background"]
            if t.get("foreground"):
                ct["text"] = t["foreground"]
            if t.get("tableAccent") or self.theme.data:
                ct["accent"] = t.get("tableAccent") or self.theme.data[0]
            rep["customTheme"] = ct
        self._summarise()
        return rep

    def _summarise(self):
        if self.unsupported:
            parts = ", ".join(f"{k} ({n})" if n > 1 else k for k, n in self.unsupported.most_common())
            self.warn.append(f"Not available in PyBI yet, shown as placeholders: {parts}.")
        if self.skipped:
            parts = ", ".join(f"{k} ({n})" if n > 1 else k for k, n in self.skipped.most_common())
            self.warn.append(f"Skipped (buttons, navigators and bookmarks are not supported yet): {parts}.")
        if self.filter_skips:
            self.warn.append("Some filters could not be converted and were left out: " + ", ".join(self.filter_skips) + ".")

    def filters(self, flts) -> list:
        out = []
        for f in flts or []:
            spec, why = filter_to_spec(f)
            if spec:
                out.append(spec)
            elif why:
                self.filter_skips[why] += 1
        return out

    # ------------------------------------------------ pages
    def page(self, pg: dict, i: int) -> dict:
        page = {"id": f"p{i + 1}", "name": pg["name"], "visuals": [], "filters": self.filters(pg.get("filters")),
                "background": None, "width": int(round(pg["width"])), "height": int(round(pg["height"]))}
        if page["width"] == 1280 and page["height"] == 720:
            page.pop("width")
            page.pop("height")
        if pg.get("hidden") or pg.get("tooltip"):
            page["hidden"] = True
        obj = pg.get("objects") or {}
        bg = self.theme.color(prop(obj, "background", "color"))
        transp = prop_value(obj, "background", "transparency", 0)
        if bg and (transp or 0) < 100:
            page["background"] = bg
        img = prop(obj, "background", "image")
        url = self.image_url(img)
        if url:
            page["wallpaper"] = url
        groups = {v["name"]: v for v in pg["visuals"] if v.get("type") == "__group"}
        _absolute_positions(pg["visuals"], groups)
        visuals = []
        for v in sorted(pg["visuals"], key=lambda v: v.get("z") or 0):
            if v.get("type") == "__group":
                continue
            hidden = v.get("hidden")
            parent = groups.get(v.get("parent"))
            while parent and not hidden:
                hidden = parent.get("hidden")
                parent = groups.get(parent.get("parent"))
            if hidden:
                continue
            out = self.visual(v)
            if out:
                visuals.append(out)
        for z, v in enumerate(visuals):
            v["z"] = z
        page["visuals"] = visuals
        return page

    # ------------------------------------------------ visuals
    def _base(self, v: dict, type_: str) -> dict:
        return {"id": self._id(), "type": type_, "x": int(round(v["x"])), "y": int(round(v["y"])),
                "w": max(20, int(round(v["w"]))), "h": max(20, int(round(v["h"]))), "title": "", "fields": {}, "format": {}}

    def visual(self, v: dict) -> Optional[dict]:
        t = v.get("type") or ""
        if t == "textbox":
            return self.textbox(v)
        if t == "image":
            return self.image(v)
        if t in DECOR:
            return self.shape(v)
        if t in SKIP_QUIET:
            label = {"actionButton": "buttons", "pageNavigator": "page navigators", "bookmarkNavigator": "bookmark navigators"}[t]
            self.skipped[label] += 1
            return None
        if t not in VISUALS:
            return self.placeholder(v, t)
        ptype, rolemap = VISUALS[t]
        out = self._base(v, ptype)
        fields: Dict[str, list] = {}
        for role, items in (v.get("roles") or {}).items():
            target = rolemap.get(role)
            if not target:
                continue
            chosen = items
            if ROLE_MAX.get(target) == 1 and len(items) > 1 and target in ("category", "series"):
                act = [x for x in items if x.get("active")]
                chosen = act[:1] or items[:1]  # hierarchy: show the level Power BI shows
            for it in chosen:
                f = field_from_expr(it.get("expr"))
                if not f:
                    continue
                if it.get("label") and it["label"] != (f.get("measure") or f.get("column")):
                    f["label"] = it["label"]
                if target in VALUE_ROLES and "column" in f and "agg" not in f:
                    f["agg"] = self._default_agg(f)
                if target not in VALUE_ROLES and target != "columns":
                    f.pop("agg", None)
                lst = fields.setdefault(target, [])
                if f not in lst:
                    lst.append(f)
        limits = dict(ROLE_MAX, **ROLE_MAX_BY_TYPE.get(ptype, {}))
        if ptype == "card" and len(fields.get("values", [])) > 1:
            out["type"] = ptype = "multiCard"
            limits = dict(ROLE_MAX, **ROLE_MAX_BY_TYPE["multiCard"])
        if ptype == "matrix" and len(fields.get("rows", [])) > 2:
            self.warn.append("Matrix visuals with more than two row fields were cut to the first two.")
        out["fields"] = {k: lst[:limits.get(k, 8)] for k, lst in fields.items() if lst}
        out["format"] = self.formats(v, ptype)
        out["title"] = self.title(v, ptype, out["fields"])
        if out["title"] is None:
            out["title"] = ""
            out["format"]["showTitle"] = False
        if ptype == "slicer":
            self.slicer(v, out)
        flt = self.filters(v.get("filters"))
        if flt:
            out["filters"] = flt
        return out

    def _default_agg(self, f: dict) -> str:
        df = self.tables.get(f.get("table"))
        if df is not None and f.get("column") in df.columns and pd.api.types.is_numeric_dtype(df[f["column"]]) \
                and not pd.api.types.is_bool_dtype(df[f["column"]]):
            return "sum"
        return "count"

    def title(self, v: dict, ptype: str, fields: dict) -> Optional[str]:
        vc = v.get("vcObjects") or {}
        show = prop_value(vc, "title", "show")
        text = prop_value(vc, "title", "text")
        if show is False:
            return None
        if isinstance(text, str) and text.strip():
            return text
        if ptype == "slicer":
            f = (fields.get("category") or [None])[0]
            return f and (f.get("label") or f.get("column")) or ""
        if ptype not in AUTO_TITLE and show is not True:
            return None
        from_lbl = lambda f: f.get("label") or f.get("measure") or ({"sum": "Sum of ", "avg": "Average of ", "count": "Count of ",
                                                                   "distinct": "Count of ", "min": "Min of ", "max": "Max of "}
                                                                  .get(f.get("agg"), "") + str(f.get("column")))
        vals = [from_lbl(f) for k in ("values", "y", "lineValues") for f in fields.get(k, [])]
        if ptype == "scatter":
            vals = [from_lbl(f) for k in ("x", "y") for f in fields.get(k, [])]
        dims = list(dict.fromkeys(from_lbl(f) for k in ("category", "series") for f in fields.get(k, [])))
        if not vals:
            return ""
        txt = " and ".join(vals)
        return txt + (" by " + " and ".join(dims) if dims else "")

    def formats(self, v: dict, ptype: str) -> dict:
        obj, vc = v.get("objects") or {}, v.get("vcObjects") or {}
        f: Dict[str, Any] = {}
        bshow = prop_value(vc, "background", "show")
        bcol = self.theme.color(prop(vc, "background", "color"))
        btr = prop_value(vc, "background", "transparency", 0) or 0
        if bshow is False or btr >= 100:
            f["background"] = "transparent"
        elif bcol:
            f["background"] = bcol
        if prop_value(vc, "border", "show"):
            f["border"] = True
            bc = self.theme.color(prop(vc, "border", "color"))
            if bc:
                f["borderColor"] = bc
        if prop_value(vc, "dropShadow", "show") is False:
            f["shadow"] = False
        tc = self.theme.color(prop(vc, "title", "fontColor"))
        if tc:
            f["titleColor"] = tc
        ts = prop_value(vc, "title", "fontSize")
        if isinstance(ts, (int, float)):
            f["titleSize"] = round(ts * 4 / 3)
        ta = prop_value(vc, "title", "alignment")
        if ta in ("left", "center", "right"):
            f["titleAlign"] = ta
        lbl = prop_value(obj, "labels", "show")
        if lbl is not None:
            f["dataLabels"] = bool(lbl)
        leg = prop_value(obj, "legend", "show")
        if leg is False:
            f["legend"] = False
        if ptype in ("line", "area", "stackedArea") and prop_value(obj, "lineStyles", "lineStyle") in ("smooth",):
            f["smooth"] = True
        if ptype in ("line", "lineColumn") and prop_value(obj, "lineStyles", "showMarker"):
            f["markers"] = True
        if prop_value(obj, "categoryAxis", "showAxisTitle") or prop_value(obj, "valueAxis", "showAxisTitle"):
            f["axisTitles"] = True
        if prop_value(obj, "valueAxis", "gridlineShow") is False:
            f["gridlines"] = False
        if ptype == "donut":
            r = prop_value(obj, "slices", "innerRadiusRatio")
            if isinstance(r, (int, float)):
                f["innerRadius"] = r / 100 if r > 1 else r
        dp = self.theme.color(prop(obj, "dataPoint", "fill"))
        if dp and ptype in ("funnel", "gauge", "card"):
            f["color"] = dp
        if ptype in ("card", "multiCard"):
            lc = self.theme.color(prop(obj, "labels", "color"))
            if lc:
                f["color"] = lc
            if prop_value(obj, "categoryLabels", "show") is False:
                f["showLabel"] = False
            f.pop("dataLabels", None)
        if ptype in ("table", "matrix"):
            f.pop("dataLabels", None)
            for o in v.get("orderBy") or []:
                fld = field_from_expr(_resolve(o.get("Expression") or o.get("field"), v.get("aliases") or {}))
                if fld:
                    f["sortBy"] = fld.get("measure") or fld.get("column")
                    f["sortDir"] = "desc" if o.get("Direction") in (2, "Descending") else "asc"
                    break
        return f

    def slicer(self, v: dict, out: dict):
        obj = v.get("objects") or {}
        mode = str(prop_value(obj, "data", "mode", "") or "").lower()
        out["format"]["style"] = {"dropdown": "dropdown", "between": "between", "before": "between", "after": "between",
                                  "basic": "list"}.get(mode, "list")
        if prop_value(obj, "selection", "singleSelect"):
            out["format"]["single"] = True
        sel = prop(obj, "general", "filter")
        body = (sel or {}).get("filter") if isinstance(sel, dict) else None
        if body:
            spec, _ = filter_to_spec({"filter": body})
            if spec and spec["mode"] == "basic" and not spec.get("invert"):
                out["state"] = {"values": spec["values"]}
            elif spec and spec["mode"] == "advanced":
                lo = spec["value"] if spec.get("op") in (">", ">=") else spec.get("value2") if spec.get("op2") in (">", ">=") else None
                hi = spec["value"] if spec.get("op") in ("<", "<=") else spec.get("value2") if spec.get("op2") in ("<", "<=") else None
                if lo is not None or hi is not None:
                    out["state"] = {"range": {"min": lo, "max": hi}}

    # ------------------------------------------------ text, shapes, images, placeholders
    def textbox(self, v: dict) -> dict:
        out = self._base(v, "textbox")
        paras = prop(v.get("objects") or {}, "general", "paragraphs") or []
        lines, sizes, colors, bold_all, any_text, align = [], [], [], True, False, None
        italic_all = True
        for p in paras:
            align = align or p.get("horizontalTextAlignment")
            parts = []
            for run in p.get("textRuns") or []:
                txt = str(run.get("value") or "")
                st = run.get("textStyle") or {}
                if txt.strip():
                    any_text = True
                    b = str(st.get("fontWeight", "")).lower() in ("bold", "700", "600", "800", "900")
                    bold_all = bold_all and b
                    italic_all = italic_all and st.get("fontStyle") == "italic"
                    parts.append((txt, b))
                    m = re.match(r"([\d.]+)\s*(pt|px)?", str(st.get("fontSize") or ""))
                    if m:
                        sz = float(m.group(1))
                        sizes.append(sz * 4 / 3 if (m.group(2) or "pt") == "pt" else sz)
                    if st.get("color"):
                        colors.append(st["color"])
                else:
                    parts.append((txt, False))
            lines.append(parts)
        text = "\n".join("".join(f"**{t}**" if b and not bold_all and t.strip() else t for t, b in parts) for parts in lines)
        f = out["format"]
        f.update(text=text if any_text else "", fontSize=round(max(sizes)) if sizes else 14, bold=bool(any_text and bold_all),
                 background="transparent", border=False, shadow=False)
        if italic_all and any_text:
            f["italic"] = True
        if colors:
            f["color"] = Counter(colors).most_common(1)[0][0]
        if align in ("center", "right"):
            f["align"] = align
        fb = self.formats(v, "textbox")
        if fb.get("background"):
            f["background"] = fb["background"]
        if fb.get("border"):
            f["border"], f["borderColor"] = True, fb.get("borderColor")
        return out

    def shape(self, v: dict) -> dict:
        out = self._base(v, "textbox")
        obj = v.get("objects") or {}
        fill = self.theme.color(prop(obj, "fill", "fillColor")) or self.theme.color(prop(obj, "fill", "color"))
        transp = prop_value(obj, "fill", "transparency", 0) or 0
        show = prop_value(obj, "fill", "show", True)
        kind = str(prop_value(obj, "general", "shapeType", "") or prop_value(obj, "shape", "tileShape", "") or "").lower()
        f = out["format"]
        f.update(text=str(prop_value(obj, "text", "text", "") or ""), background=fill if fill and show and transp < 100 else "transparent",
                 border=False, shadow=False, radius=0, align="center")
        line = self.theme.color(prop(obj, "line", "lineColor")) or self.theme.color(prop(obj, "outline", "lineColor"))
        if line and prop_value(obj, "line", "show", prop_value(obj, "outline", "show", True)) is not False:
            f["border"], f["borderColor"] = True, line
        if "oval" in kind or "ellipse" in kind:
            f["radius"] = min(out["w"], out["h"]) // 2
        elif "rounded" in kind:
            f["radius"] = int(prop_value(obj, "general", "roundEdge", 10) or 10)
        elif kind in ("line",):
            f["background"] = line or fill or self.theme.foreground
            out["h"] = max(2, min(out["h"], 3))
        return out

    def image_url(self, p) -> Optional[str]:
        if not isinstance(p, dict):
            return None
        item = None
        stack = [p]
        while stack:  # find {"ResourcePackageItem": {...}} or a plain URL anywhere in the object
            cur = stack.pop()
            if isinstance(cur, dict):
                if "ResourcePackageItem" in cur:
                    item = cur["ResourcePackageItem"]
                    break
                if "Literal" in cur:
                    val = literal(cur)
                    if isinstance(val, str) and val.startswith(("http://", "https://", "data:")):
                        return val
                stack.extend(cur.values())
            elif isinstance(cur, list):
                stack.extend(cur)
        if not item:
            return None
        raw = self.pkg.resource(item.get("ItemName", ""), item.get("PackageName") or "RegisteredResources")
        if not raw:
            return None
        if len(raw) > MAX_IMAGE_BYTES:
            self.warn.append(f"Image '{item.get('ItemName')}' is larger than 6 MB and was left out.")
            return None
        ext = Path(item.get("ItemName", "")).suffix.lower().lstrip(".")
        mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif", "svg": "svg+xml", "webp": "webp", "bmp": "bmp"}.get(ext, "png")
        return f"data:image/{mime};base64," + base64.b64encode(raw).decode("ascii")

    def image(self, v: dict) -> Optional[dict]:
        obj = v.get("objects") or {}
        url = self.image_url(prop(obj, "general", "imageUrl")) or self.image_url(prop(obj, "image", "sourceFile")) \
            or self.image_url(obj.get("general") or obj.get("image"))
        if not url:
            return None
        out = self._base(v, "image")
        scale = str(prop_value(obj, "imageScaling", "imageScalingType", "Fit") or "Fit").lower()
        out["format"] = {"src": url, "fit": {"normal": "none", "fill": "cover", "fit": "contain"}.get(scale, "contain"),
                         "background": "transparent", "border": False, "shadow": False}
        fb = self.formats(v, "image")
        if fb.get("background"):
            out["format"]["background"] = fb["background"]
        if fb.get("border"):
            out["format"]["border"], out["format"]["borderColor"] = True, fb.get("borderColor")
        return out

    def placeholder(self, v: dict, t: str) -> dict:
        name = FRIENDLY.get(t) or ("Custom visual" if (t.startswith("PBI_CV_") or re.search(r"[0-9A-F]{16}", t) or t[:1].isupper())
                                   else t or "Unknown visual")
        self.unsupported[name] += 1
        out = self._base(v, "textbox")
        title = prop_value(v.get("vcObjects") or {}, "title", "text") or ""
        out["format"] = {"text": f"{name}\n(not supported in PyBI yet)" + (f"\n{title}" if title else ""), "fontSize": 13,
                         "color": "#8A8886", "align": "center", "border": True, "borderColor": "#C8C6C4", "background": "#FAF9F8"}
        out["placeholder"] = t
        return out


# ====================================================================== DAX compatibility

_ENGINE_FUNCS: Optional[set] = None


def supported_dax_functions() -> set:
    """Function names the PyBI DAX engine understands (read from static/engine.js so the list never goes stale)."""
    global _ENGINE_FUNCS
    if _ENGINE_FUNCS is None:
        try:
            src = (Path(__file__).parent / "static" / "engine.js").read_text("utf-8")
            _ENGINE_FUNCS = set(re.findall(r'"([A-Z][A-Z0-9.]+)"', src))
        except OSError:
            _ENGINE_FUNCS = set()
    return _ENGINE_FUNCS


def dax_functions(expr: str) -> set:
    s = re.sub(r'"(?:[^"]|"")*"', '""', expr or "")       # strings
    s = re.sub(r"//[^\n]*|--[^\n]*|/\*.*?\*/", " ", s, flags=re.S)  # comments
    s = re.sub(r"'[^']*'|\[[^\]]*\]", " ", s)            # 'Table names' and [Columns]
    return {m.upper() for m in re.findall(r"\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(", s)}


def _dax_warnings(report: dict, warn: list):
    known = supported_dax_functions()
    if not known:
        return
    missing: Dict[str, List[str]] = {}
    for m in report.get("measures", []) + report.get("calcColumns", []):
        for fn in dax_functions(m.get("expression", "")) - known:
            missing.setdefault(fn, []).append(m.get("name"))
    if missing:
        parts = []
        for fn, ms in sorted(missing.items(), key=lambda kv: -len(kv[1])):
            parts.append(f"{fn} (used by {', '.join(ms[:3])}{' …' if len(ms) > 3 else ''})")
        warn.append("These DAX functions are not in PyBI's engine yet, so the measures that use them will show an error: "
                    + "; ".join(parts) + ".")
