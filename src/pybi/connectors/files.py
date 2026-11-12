"""File format readers shared by uploads, paths, URLs, cloud storage, FTP and folders."""
from __future__ import annotations

import io
import json
import os
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, Optional

import pandas as pd

from .base import ConnectorError, need

TEXT_EXT = {".csv", ".txt", ".tsv", ".psv", ".dat"}
EXCEL_EXT = {".xlsx", ".xlsm", ".xls", ".xlsb", ".ods"}
SUPPORTED = sorted(TEXT_EXT | EXCEL_EXT | {".json", ".jsonl", ".ndjson", ".xml", ".html", ".htm", ".parquet", ".feather",
                                          ".arrow", ".orc", ".avro", ".sas7bdat", ".xpt", ".sav", ".zsav", ".por", ".dta",
                                          ".h5", ".hdf5", ".hdf", ".yaml", ".yml", ".pdf", ".zip", ".db", ".sqlite",
                                          ".sqlite3", ".duckdb", ".fwf"})


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _tmp(data: bytes, suffix: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
    return tmp.name


def _records_frame(obj) -> Dict[str, pd.DataFrame]:
    if isinstance(obj, list):
        return {"": pd.json_normalize(obj) if obj and isinstance(obj[0], dict) else pd.DataFrame({"value": obj})}
    if isinstance(obj, dict):
        lists = {k: v for k, v in obj.items() if isinstance(v, list)}
        if lists:
            return {k: (pd.json_normalize(v) if v and isinstance(v[0], dict) else pd.DataFrame({k: v})) for k, v in lists.items()}
        return {"": pd.json_normalize(obj)}
    return {"": pd.DataFrame({"value": [obj]})}


def read_bytes(filename: str, data: bytes, options: Optional[dict] = None) -> Dict[str, pd.DataFrame]:
    """Parse a file into one or more DataFrames keyed by suggested table name."""
    options = options or {}
    name = Path(filename).stem or "Table"
    ext = (options.get("format") or Path(filename).suffix).lower()
    if ext and not ext.startswith("."):
        ext = "." + ext
    bio = io.BytesIO(data)
    sheet = options.get("sheet") or None
    out: Dict[str, pd.DataFrame]

    if ext in (".fwf",):
        out = {name: pd.read_fwf(io.StringIO(_decode(data)))}
    elif ext in TEXT_EXT:
        sep = options.get("delimiter") or ("\t" if ext == ".tsv" else "|" if ext == ".psv" else None)
        header = 0 if options.get("header", True) not in (False, "false", "no") else None
        out = {name: pd.read_csv(io.StringIO(_decode(data)), sep=sep, engine="python", header=header,
                                 skiprows=int(options.get("skiprows") or 0))}
    elif ext in EXCEL_EXT:
        engine = {".xlsb": "pyxlsb", ".ods": "odf"}.get(ext)
        if engine == "pyxlsb":
            need("pyxlsb", "pyxlsb")
        if ext == ".xls":
            need("xlrd", "xlrd")
        sheets = pd.read_excel(bio, sheet_name=sheet if sheet else None, engine=engine,
                               skiprows=int(options.get("skiprows") or 0))
        if isinstance(sheets, pd.DataFrame):
            out = {sheet or name: sheets}
        else:
            out = {(sn if len(sheets) > 1 else name): df for sn, df in sheets.items() if not df.empty}
    elif ext == ".json":
        text = _decode(data).strip()
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            obj = [json.loads(line) for line in text.splitlines() if line.strip()]
        out = {(k or name): v for k, v in _records_frame(obj).items()}
    elif ext in (".jsonl", ".ndjson"):
        out = {name: pd.json_normalize([json.loads(x) for x in _decode(data).splitlines() if x.strip()])}
    elif ext == ".xml":
        xpath = options.get("xpath") or None
        out = {name: pd.read_xml(io.BytesIO(data), xpath=xpath) if xpath else pd.read_xml(io.BytesIO(data))}
    elif ext in (".html", ".htm"):
        out = read_html(_decode(data), name)
    elif ext == ".parquet":
        need("pyarrow", "pyarrow")
        out = {name: pd.read_parquet(bio)}
    elif ext in (".feather", ".arrow"):
        need("pyarrow", "pyarrow")
        out = {name: pd.read_feather(bio)}
    elif ext == ".orc":
        need("pyarrow", "pyarrow")
        out = {name: pd.read_orc(bio)}
    elif ext == ".avro":
        fastavro = need("fastavro", "fastavro")
        out = {name: pd.DataFrame(list(fastavro.reader(bio)))}
    elif ext in (".sas7bdat", ".xpt"):
        out = {name: pd.read_sas(bio, format="xport" if ext == ".xpt" else "sas7bdat", encoding="utf-8")}
    elif ext in (".sav", ".zsav", ".por"):
        need("pyreadstat", "pyreadstat")
        path = _tmp(data, ext)
        out = {name: pd.read_spss(path)}
        os.unlink(path)
    elif ext == ".dta":
        out = {name: pd.read_stata(bio)}
    elif ext in (".h5", ".hdf5", ".hdf"):
        need("tables", "tables")
        path = _tmp(data, ext)
        with pd.HDFStore(path, mode="r") as store:
            out = {k.strip("/"): store[k] for k in store.keys()}
        os.unlink(path)
    elif ext in (".yaml", ".yml"):
        yaml = need("yaml", "pyyaml")
        out = {(k or name): v for k, v in _records_frame(yaml.safe_load(_decode(data))).items()}
    elif ext == ".pdf":
        out = read_pdf_tables(data, name)
    elif ext == ".zip":
        out = {}
        with zipfile.ZipFile(bio) as z:
            for info in z.infolist():
                inner = Path(info.filename)
                if info.is_dir() or inner.name.startswith(".") or inner.suffix.lower() not in SUPPORTED or inner.suffix.lower() == ".zip":
                    continue
                for k, v in read_bytes(inner.name, z.read(info), options).items():
                    out[k] = v
        if not out:
            raise ConnectorError("No readable files found inside the ZIP archive")
    elif ext in (".db", ".sqlite", ".sqlite3"):
        path = _tmp(data, ext)
        out = read_sqlite(path, options.get("query"))
    elif ext == ".duckdb":
        duckdb = need("duckdb", "duckdb")
        path = _tmp(data, ext)
        con = duckdb.connect(path, read_only=True)
        try:
            if options.get("query"):
                out = {"Query": con.execute(options["query"]).df()}
            else:
                out = {t: con.execute(f'SELECT * FROM "{t}"').df() for (t,) in con.execute("SHOW TABLES").fetchall()}
        finally:
            con.close()
    else:
        raise ConnectorError(f"Unsupported file type '{ext}'. Supported: {', '.join(SUPPORTED)}")
    return {k: v for k, v in out.items() if isinstance(v, pd.DataFrame)}


def read_html(html: str, name: str = "Table") -> Dict[str, pd.DataFrame]:
    try:
        tables = pd.read_html(io.StringIO(html))
    except ValueError as exc:
        raise ConnectorError("No HTML tables found on that page") from exc
    out = {}
    for i, t in enumerate(tables):
        if t.shape[0] == 0 or t.shape[1] < 2:
            continue
        if isinstance(t.columns, pd.MultiIndex):
            t.columns = [" ".join(str(x) for x in c if not str(x).startswith("Unnamed")).strip() for c in t.columns]
        out[f"{name} - Table {i + 1}"] = t
    if not out:
        raise ConnectorError("No data tables found on that page")
    return out


def read_pdf_tables(data: bytes, name: str) -> Dict[str, pd.DataFrame]:
    pdfplumber = need("pdfplumber", "pdfplumber")
    out = {}
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            for tno, table in enumerate(page.extract_tables() or [], start=1):
                rows = [r for r in table if r and any(c not in (None, "") for c in r)]
                if len(rows) < 2:
                    continue
                header = [str(h or f"Column{j + 1}").strip() for j, h in enumerate(rows[0])]
                seen = {}
                for j, h in enumerate(header):
                    if h in seen:
                        header[j] = f"{h}.{seen[h]}"
                    seen[h] = seen.get(h, 0) + 1
                out[f"{name} p{pno} t{tno}"] = pd.DataFrame(rows[1:], columns=header)
    if not out:
        raise ConnectorError("No tables detected in the PDF (scanned PDFs need OCR first)")
    return out


def read_sqlite(path: str, query: Optional[str] = None) -> Dict[str, pd.DataFrame]:
    con = sqlite3.connect(path)
    try:
        if query:
            return {"Query": pd.read_sql_query(query, con)}
        names = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type in ('table','view') AND name NOT LIKE 'sqlite_%'")]
        return {n: pd.read_sql_query(f'SELECT * FROM "{n}"', con) for n in names}
    finally:
        con.close()


def read_folder(folder: str, pattern: str = "*", combine: bool = True, options: Optional[dict] = None) -> Dict[str, pd.DataFrame]:
    """Power BI 'Folder' connector: read every matching file, optionally appending them with a Source.Name column."""
    root = Path(os.path.expanduser(folder))
    if not root.is_dir():
        raise ConnectorError(f"Folder not found: {root}")
    files = [p for p in sorted(root.rglob(pattern or "*")) if p.is_file() and p.suffix.lower() in SUPPORTED]
    if not files:
        raise ConnectorError("No supported files in that folder")
    frames = []
    out = {}
    for p in files:
        for k, df in read_bytes(p.name, p.read_bytes(), options).items():
            if combine:
                df = df.copy()
                df.insert(0, "Source.Name", p.name if len(k) == 0 or k == p.stem else f"{p.name} | {k}")
                frames.append(df)
            else:
                out[k] = df
    if combine:
        return {root.name or "Folder": pd.concat(frames, ignore_index=True, sort=False)}
    return out
