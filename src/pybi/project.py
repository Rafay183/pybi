"""Project model: data sources + query steps + report definition, saved as a .pybi file."""
from __future__ import annotations

import io
import json
import math
import threading
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import pandas as pd

from . import __version__
from .transform import apply_steps, column_type, infer_types

FORMAT_VERSION = 1


def empty_report() -> dict:
    return {
        "version": FORMAT_VERSION,
        "title": "Untitled report",
        "theme": "pybi",
        "pages": [{"id": "p1", "name": "Page 1", "visuals": [], "filters": [], "background": None}],
        "measures": [],
        "calcColumns": [],
        "relationships": [],
        "reportFilters": [],
        "hiddenFields": [],
        "formats": {},
    }


class Source:
    def __init__(self, name: str, raw: pd.DataFrame, kind: str = "dataframe", origin: str = "", steps=None, connector=None):
        self.name = name
        self.raw = raw
        self.kind = kind
        self.origin = origin
        self.steps = list(steps or [])
        self.connector = connector  # {"id", "params" (no secrets), "table", "upload"} for refreshable sources
        self.refreshed = datetime.now().isoformat(timespec="seconds")

    def meta(self) -> dict:
        return {"name": self.name, "kind": self.kind, "origin": self.origin, "steps": self.steps,
                "rawColumns": [str(c) for c in self.raw.columns], "rawRows": int(len(self.raw)),
                "connector": self.connector, "refreshed": self.refreshed,
                "refreshable": bool(self.connector and not self.connector.get("upload"))}


def _json_value(v):
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(v, (pd.Timestamp, datetime)):
        return None if pd.isna(v) else v.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return str(v) if not isinstance(v, (int, str)) else v


def table_payload(df: pd.DataFrame) -> dict:
    """Columnar JSON payload consumed by the browser engine."""
    cols, data = [], {}
    for c in df.columns:
        name = str(c)
        ser = df[c]
        typ = column_type(ser)
        cols.append({"name": name, "type": typ})
        if typ == "number":
            arr = pd.to_numeric(ser, errors="coerce").astype(float)
            data[name] = [None if (x != x or x in (math.inf, -math.inf)) else (int(x) if float(x).is_integer() and abs(x) < 2**53 else x) for x in arr.tolist()]
        elif typ == "date":
            data[name] = [None if pd.isna(x) else x.strftime("%Y-%m-%dT%H:%M:%S") for x in ser]
        else:
            data[name] = [_json_value(x) for x in ser.tolist()]
    return {"columns": cols, "data": data, "rows": int(len(df))}


class Project:
    def __init__(self):
        self.lock = threading.RLock()
        self.sources: Dict[str, Source] = {}
        self.report: dict = empty_report()
        self.path: Optional[Path] = None
        self._cache: Dict[str, pd.DataFrame] = {}
        self.dirty = False

    # ---------------- sources -----------------
    def unique_name(self, base: str) -> str:
        base = (base or "Table").strip() or "Table"
        name, i = base, 2
        while name in self.sources:
            name, i = f"{base} ({i})", i + 1
        return name

    def add_source(self, name: str, df: pd.DataFrame, kind: str = "dataframe", origin: str = "", detect=True, connector=None) -> str:
        with self.lock:
            df = clean_frame(df, detect)
            name = self.unique_name(name)
            self.sources[name] = Source(name, df, kind, origin, connector=connector)
            self._cache.clear()
            self.dirty = True
            return name

    def replace_raw(self, name: str, df: pd.DataFrame):
        with self.lock:
            src = self.sources[name]
            src.raw = clean_frame(df, True)
            src.refreshed = datetime.now().isoformat(timespec="seconds")
            self._cache.clear()
            self.dirty = True

    def remove_source(self, name: str):
        with self.lock:
            self.sources.pop(name, None)
            self._cache.clear()
            self.report["relationships"] = [r for r in self.report.get("relationships", [])
                                            if r.get("fromTable") != name and r.get("toTable") != name]
            self.dirty = True

    def rename_source(self, old: str, new: str):
        with self.lock:
            if old not in self.sources or not new or new in self.sources:
                raise ValueError("Invalid table name")
            src = self.sources.pop(old)
            src.name = new
            self.sources[new] = src
            self._cache.clear()
            txt = json.dumps(self.report)
            txt = txt.replace(f'"table": "{old}"', f'"table": "{new}"')
            txt = txt.replace(f'"fromTable": "{old}"', f'"fromTable": "{new}"').replace(f'"toTable": "{old}"', f'"toTable": "{new}"')
            self.report = json.loads(txt)
            for m in self.report.get("measures", []) + self.report.get("calcColumns", []):
                m["expression"] = m.get("expression", "").replace(f"{old}[", f"{new}[").replace(f"'{old}'[", f"'{new}'[")
                if m.get("table") == old:
                    m["table"] = new
            self.dirty = True

    def table(self, name: str, _stack=()) -> pd.DataFrame:
        with self.lock:
            if name in self._cache:
                return self._cache[name]
            if name not in self.sources:
                raise KeyError(f"Unknown table '{name}'")
            if name in _stack:
                raise ValueError("Circular reference between queries")
            src = self.sources[name]
            df = apply_steps(src.raw, src.steps, resolver=lambda n: self.table(n, _stack + (name,)))
            self._cache[name] = df
            return df

    def set_steps(self, name: str, steps: list):
        with self.lock:
            src = self.sources[name]
            old = src.steps
            src.steps = steps
            self._cache.clear()
            try:
                self.table(name)
            except Exception:
                src.steps = old
                self._cache.clear()
                raise
            self.dirty = True

    def preview(self, name: str, steps: list, limit: int = 200) -> pd.DataFrame:
        src = self.sources[name]
        df = apply_steps(src.raw, steps, resolver=lambda n: self.table(n))
        return df

    # ---------------- state -----------------
    def state(self) -> dict:
        with self.lock:
            tables, errors = {}, {}
            for n in self.sources:
                try:
                    tables[n] = table_payload(self.table(n))
                except Exception as exc:  # noqa: BLE001
                    errors[n] = str(exc)
            return {
                "app": {"name": "PyBI", "version": __version__},
                "project": {"name": self.path.stem if self.path else self.report.get("title", "Untitled"),
                            "path": str(self.path) if self.path else None},
                "report": self.report,
                "tables": tables,
                "sources": [s.meta() for s in self.sources.values()],
                "errors": errors,
            }

    # ---------------- persistence -----------------
    def to_bytes(self) -> bytes:
        with self.lock:
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                manifest = {"format": "pybi", "formatVersion": FORMAT_VERSION, "appVersion": __version__,
                            "savedAt": datetime.now().isoformat(timespec="seconds"),
                            "sources": []}
                for i, s in enumerate(self.sources.values()):
                    fname = f"sources/{i}.json"
                    z.writestr(fname, s.raw.to_json(orient="split", date_format="iso", index=False))
                    dtypes = {str(c): column_type(s.raw[c]) for c in s.raw.columns}
                    manifest["sources"].append({"name": s.name, "kind": s.kind, "origin": s.origin, "connector": s.connector,
                                                "steps": s.steps, "file": fname, "types": dtypes})
                z.writestr("manifest.json", json.dumps(manifest, indent=2))
                z.writestr("report.json", json.dumps(self.report, indent=2))
            return buf.getvalue()

    def save(self, path: Optional[str] = None) -> Path:
        p = Path(path) if path else self.path
        if p is None:
            raise ValueError("No file path given")
        if p.suffix != ".pybi":
            p = p.with_suffix(".pybi")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(self.to_bytes())
        self.path = p
        self.dirty = False
        return p

    @classmethod
    def from_bytes(cls, data: bytes) -> "Project":
        proj = cls()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            manifest = json.loads(z.read("manifest.json"))
            for s in manifest.get("sources", []):
                df = pd.read_json(io.StringIO(z.read(s["file"]).decode("utf-8")), orient="split", convert_dates=False)
                for col, typ in (s.get("types") or {}).items():
                    if col in df.columns and typ == "date":
                        df[col] = pd.to_datetime(df[col], errors="coerce")
                proj.sources[s["name"]] = Source(s["name"], df, s.get("kind", "dataframe"), s.get("origin", ""), s.get("steps"), s.get("connector"))
            proj.report = json.loads(z.read("report.json"))
        return proj

    @classmethod
    def load(cls, path: str) -> "Project":
        p = Path(path)
        proj = cls.from_bytes(p.read_bytes())
        proj.path = p
        return proj


# ---------------- connectors -----------------

def clean_frame(df: pd.DataFrame, detect: bool = True) -> pd.DataFrame:
    df = df.copy()
    cols, seen = [], {}
    for i, c in enumerate(df.columns):
        name = str(c).strip() or f"Column{i + 1}"
        if name in seen:
            seen[name] += 1
            name = f"{name}.{seen[name]}"
        else:
            seen[name] = 0
        cols.append(name)
    df.columns = cols
    for c in df.columns:  # timezone-aware datetimes -> naive UTC so they serialise consistently
        if isinstance(df[c].dtype, pd.DatetimeTZDtype):
            df[c] = df[c].dt.tz_convert("UTC").dt.tz_localize(None)
    return infer_types(df) if detect else df


def read_upload(filename: str, data: bytes, sheet: Optional[str] = None) -> Dict[str, pd.DataFrame]:
    """Turn an uploaded file into one or more DataFrames keyed by suggested table name."""
    from .connectors.files import read_bytes

    return read_bytes(filename, data, {"sheet": sheet} if sheet else None)


def read_sqlite(path: str, query: Optional[str] = None) -> Dict[str, pd.DataFrame]:
    from .connectors.files import read_sqlite as _rs

    return _rs(path, query)
