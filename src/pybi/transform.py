"""PyBI Query Editor: Power Query style 'applied steps' executed with pandas.

Each step is a plain dict ``{"op": "<name>", ...params}`` so pipelines are
serialisable inside a ``.pybi`` project file and can be replayed at any time.
"""
from __future__ import annotations

import re
from typing import Callable, Optional

import numpy as np
import pandas as pd

STEP_LABELS = {
    "remove_columns": "Removed columns",
    "keep_columns": "Kept columns",
    "rename": "Renamed columns",
    "change_type": "Changed type",
    "filter_rows": "Filtered rows",
    "replace_values": "Replaced values",
    "fill_null": "Filled nulls",
    "remove_duplicates": "Removed duplicates",
    "remove_nulls": "Removed blank rows",
    "sort": "Sorted rows",
    "add_column": "Added custom column",
    "conditional_column": "Added conditional column",
    "split_column": "Split column",
    "text_transform": "Transformed text",
    "date_parts": "Extracted date parts",
    "group_by": "Grouped rows",
    "unpivot": "Unpivoted columns",
    "merge": "Merged queries",
    "append": "Appended queries",
    "keep_top": "Kept top rows",
    "promote_headers": "Promoted headers",
    "round": "Rounded",
}

_SAFE_NAME = re.compile(r"[^0-9a-zA-Z_]")


class StepError(ValueError):
    pass


def _col(df: pd.DataFrame, name: str) -> str:
    if name not in df.columns:
        raise StepError(f"Column '{name}' not found. Available: {', '.join(map(str, df.columns))}")
    return name


def _coerce_value(series: pd.Series, value):
    if value is None:
        return None
    if pd.api.types.is_numeric_dtype(series):
        try:
            return float(value)
        except (TypeError, ValueError):
            return value
    if pd.api.types.is_datetime64_any_dtype(series):
        try:
            return pd.to_datetime(value)
        except Exception:
            return value
    return value


def _filter(df: pd.DataFrame, s: dict) -> pd.DataFrame:
    c = _col(df, s["column"])
    op = s.get("operator", "=")
    ser = df[c]
    v = _coerce_value(ser, s.get("value"))
    if op == "=":
        m = ser == v
    elif op == "!=":
        m = ser != v
    elif op == ">":
        m = ser > v
    elif op == ">=":
        m = ser >= v
    elif op == "<":
        m = ser < v
    elif op == "<=":
        m = ser <= v
    elif op == "contains":
        m = ser.astype(str).str.contains(str(s.get("value", "")), case=False, regex=False)
    elif op == "not contains":
        m = ~ser.astype(str).str.contains(str(s.get("value", "")), case=False, regex=False)
    elif op == "starts with":
        m = ser.astype(str).str.startswith(str(s.get("value", "")))
    elif op == "ends with":
        m = ser.astype(str).str.endswith(str(s.get("value", "")))
    elif op == "in":
        vals = s.get("value") or []
        if isinstance(vals, str):
            vals = [x.strip() for x in vals.split(",")]
        m = ser.astype(str).isin([str(x) for x in vals])
    elif op == "is blank":
        m = ser.isna() | (ser.astype(str).str.strip() == "")
    elif op == "is not blank":
        m = ~(ser.isna() | (ser.astype(str).str.strip() == ""))
    else:
        raise StepError(f"Unknown operator '{op}'")
    return df[m.fillna(False)]


def _change_type(df: pd.DataFrame, s: dict) -> pd.DataFrame:
    c = _col(df, s["column"])
    to = s.get("to", "text")
    if to in ("number", "decimal"):
        df[c] = pd.to_numeric(df[c].astype(str).str.replace(",", "", regex=False).str.strip()
                              .replace({"": None, "nan": None, "None": None}), errors="coerce")
    elif to in ("integer", "whole"):
        df[c] = pd.to_numeric(df[c], errors="coerce").round().astype("Int64")
    elif to == "date":
        df[c] = pd.to_datetime(df[c], errors="coerce")
    elif to == "bool":
        df[c] = df[c].astype(str).str.lower().isin(["true", "1", "yes", "y", "t"])
    else:
        df[c] = df[c].where(df[c].isna(), df[c].astype(str))
    return df


def _add_column(df: pd.DataFrame, s: dict) -> pd.DataFrame:
    name = s["name"]
    expr = s["expression"]
    # Allow Power-BI-ish [Column] references; translate to backtick names for pandas.eval
    translated = re.sub(r"\[([^\]]+)\]", lambda m: f"`{m.group(1)}`", expr)
    if any(tok in translated for tok in ("__", "import", "lambda", "@")):
        raise StepError("Expression contains forbidden tokens")
    try:
        df[name] = df.eval(translated, engine="python")
    except Exception as exc:  # noqa: BLE001
        raise StepError(f"Could not evaluate expression: {exc}") from exc
    return df


def _conditional(df: pd.DataFrame, s: dict) -> pd.DataFrame:
    name = s["name"]
    result = pd.Series([s.get("else")] * len(df), index=df.index, dtype=object)
    done = pd.Series(False, index=df.index)
    for rule in s.get("rules", []):
        sub = _filter(df, rule)
        hit = df.index.isin(sub.index) & ~done
        result[hit] = rule.get("output")
        done |= hit
    df[name] = result
    return df


def _text(df: pd.DataFrame, s: dict) -> pd.DataFrame:
    c = _col(df, s["column"])
    how = s.get("transform", "trim")
    ser = df[c].astype("string")
    fn = {
        "trim": lambda x: x.str.strip(),
        "upper": lambda x: x.str.upper(),
        "lower": lambda x: x.str.lower(),
        "title": lambda x: x.str.title(),
        "clean": lambda x: x.str.replace(r"\s+", " ", regex=True).str.strip(),
        "length": lambda x: x.str.len(),
    }.get(how)
    if fn is None:
        raise StepError(f"Unknown text transform '{how}'")
    df[s.get("new_name") or c] = fn(ser)
    return df


def _date_parts(df: pd.DataFrame, s: dict) -> pd.DataFrame:
    c = _col(df, s["column"])
    d = pd.to_datetime(df[c], errors="coerce")
    for part in s.get("parts", ["year", "month"]):
        key = f"{c} {part.title()}"
        if part == "year":
            df[key] = d.dt.year
        elif part == "quarter":
            df[key] = "Q" + d.dt.quarter.astype("Int64").astype(str)
        elif part == "month":
            df[key] = d.dt.month
        elif part == "month_name":
            df[f"{c} Month Name"] = d.dt.strftime("%b")
        elif part == "day":
            df[key] = d.dt.day
        elif part == "weekday":
            df[f"{c} Weekday"] = d.dt.strftime("%a")
        elif part == "year_month":
            df[f"{c} Year-Month"] = d.dt.strftime("%Y-%m")
    return df


def _group(df: pd.DataFrame, s: dict) -> pd.DataFrame:
    by = [_col(df, c) for c in s.get("by", [])]
    aggs = {}
    for a in s.get("aggregations", []):
        func = a.get("func", "sum")
        func = {"count": "count", "distinct": "nunique", "avg": "mean", "average": "mean"}.get(func, func)
        col = a.get("column") or (by[0] if by else df.columns[0])
        aggs[a.get("name") or f"{func} of {col}"] = pd.NamedAgg(column=_col(df, col), aggfunc=func)
    if not aggs:
        aggs["Count"] = pd.NamedAgg(column=by[0] if by else df.columns[0], aggfunc="size")
    return df.groupby(by, dropna=False).agg(**aggs).reset_index() if by else df.agg(
        {v.column: v.aggfunc for v in aggs.values()}).to_frame().T


def apply_step(df: pd.DataFrame, s: dict, resolver: Optional[Callable[[str], pd.DataFrame]] = None) -> pd.DataFrame:
    op = s.get("op")
    df = df.copy()
    if op == "remove_columns":
        return df.drop(columns=[_col(df, c) for c in s.get("columns", [])])
    if op == "keep_columns":
        return df[[_col(df, c) for c in s.get("columns", [])]]
    if op == "rename":
        return df.rename(columns={_col(df, k): v for k, v in s.get("mapping", {}).items()})
    if op == "change_type":
        return _change_type(df, s)
    if op == "filter_rows":
        return _filter(df, s)
    if op == "replace_values":
        c = _col(df, s["column"])
        find = _coerce_value(df[c], s.get("find"))
        repl = _coerce_value(df[c], s.get("replace"))
        if s.get("partial") and df[c].dtype == object:
            df[c] = df[c].astype(str).str.replace(str(s.get("find")), str(s.get("replace")), regex=False)
        else:
            df[c] = df[c].replace(find, repl)
        return df
    if op == "fill_null":
        c = _col(df, s["column"])
        method = s.get("method", "value")
        if method == "down":
            df[c] = df[c].ffill()
        elif method == "up":
            df[c] = df[c].bfill()
        elif method == "mean":
            df[c] = df[c].fillna(pd.to_numeric(df[c], errors="coerce").mean())
        else:
            df[c] = df[c].fillna(_coerce_value(df[c], s.get("value")))
        return df
    if op == "remove_duplicates":
        cols = s.get("columns") or None
        return df.drop_duplicates(subset=cols)
    if op == "remove_nulls":
        cols = s.get("columns") or None
        return df.dropna(subset=cols, how="any" if cols else "all")
    if op == "sort":
        cols = s.get("columns") or [s.get("column")]
        return df.sort_values([_col(df, c) for c in cols], ascending=bool(s.get("ascending", True)))
    if op == "add_column":
        return _add_column(df, s)
    if op == "conditional_column":
        return _conditional(df, s)
    if op == "split_column":
        c = _col(df, s["column"])
        parts = df[c].astype(str).str.split(s.get("delimiter", ","), expand=True, n=int(s.get("max_parts", 2)) - 1)
        names = s.get("names") or [f"{c}.{i + 1}" for i in range(parts.shape[1])]
        for i in range(parts.shape[1]):
            df[names[i] if i < len(names) else f"{c}.{i + 1}"] = parts[i].str.strip()
        if s.get("drop_original", True):
            df = df.drop(columns=[c])
        return df
    if op == "text_transform":
        return _text(df, s)
    if op == "date_parts":
        return _date_parts(df, s)
    if op == "group_by":
        return _group(df, s)
    if op == "unpivot":
        ids = [_col(df, c) for c in s.get("id_columns", [])]
        return df.melt(id_vars=ids, var_name=s.get("attribute", "Attribute"), value_name=s.get("value", "Value"))
    if op == "merge":
        if resolver is None:
            raise StepError("Merge needs access to other queries")
        right = resolver(s["right"])
        cols = s.get("columns") or [c for c in right.columns if c != s["right_on"]]
        right = right[[s["right_on"]] + [c for c in cols if c != s["right_on"]]]
        merged = df.merge(right, how=s.get("how", "left"), left_on=_col(df, s["left_on"]), right_on=s["right_on"],
                          suffixes=("", f" ({s['right']})"))
        if s["right_on"] != s["left_on"] and s["right_on"] in merged.columns:
            merged = merged.drop(columns=[s["right_on"]])
        return merged
    if op == "append":
        if resolver is None:
            raise StepError("Append needs access to other queries")
        return pd.concat([df] + [resolver(n) for n in s.get("sources", [])], ignore_index=True)
    if op == "keep_top":
        return df.head(int(s.get("n", 100)))
    if op == "promote_headers":
        new = df.iloc[0].astype(str).tolist()
        df = df.iloc[1:].reset_index(drop=True)
        df.columns = new
        return df
    if op == "round":
        c = _col(df, s["column"])
        df[c] = pd.to_numeric(df[c], errors="coerce").round(int(s.get("digits", 2)))
        return df
    raise StepError(f"Unknown step '{op}'")


def apply_steps(df: pd.DataFrame, steps: list, resolver=None) -> pd.DataFrame:
    for i, step in enumerate(steps or []):
        try:
            df = apply_step(df, step, resolver)
        except StepError as exc:
            raise StepError(f"Step {i + 1} ({STEP_LABELS.get(step.get('op'), step.get('op'))}): {exc}") from exc
        except KeyError as exc:
            raise StepError(f"Step {i + 1}: missing parameter {exc}") from exc
    return df.reset_index(drop=True)


def infer_types(df: pd.DataFrame) -> pd.DataFrame:
    """Light 'detect data type' pass, like Power Query does on import."""
    df = df.copy()
    for c in df.columns:
        ser = df[c]
        if ser.dtype != object and not pd.api.types.is_string_dtype(ser):
            continue
        sample = ser.dropna().astype(str).head(500)
        if sample.empty:
            continue
        num = pd.to_numeric(sample.str.replace(",", "", regex=False), errors="coerce")
        if num.notna().mean() > 0.97:
            df[c] = pd.to_numeric(ser.astype(str).str.replace(",", "", regex=False), errors="coerce")
            continue
        looks_date = sample.str.contains(r"^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}", regex=True).mean() > 0.9
        if looks_date:
            parsed = pd.to_datetime(ser, errors="coerce")
            if parsed.notna().mean() > 0.9:
                df[c] = parsed
    return df


def column_type(ser: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(ser):
        return "bool"
    if pd.api.types.is_numeric_dtype(ser):
        return "number"
    if pd.api.types.is_datetime64_any_dtype(ser):
        return "date"
    return "text"


def profile(df: pd.DataFrame) -> list:
    """Column quality / distribution summary for the query editor."""
    out = []
    n = max(len(df), 1)
    for c in df.columns:
        ser = df[c]
        blank = int(ser.isna().sum())
        item = {
            "name": str(c),
            "type": column_type(ser),
            "valid": round(100 * (n - blank) / n, 1),
            "empty": round(100 * blank / n, 1),
            "distinct": int(ser.nunique(dropna=True)),
        }
        if item["type"] == "number" and ser.notna().any():
            item.update(min=float(np.nanmin(ser)), max=float(np.nanmax(ser)), mean=float(np.nanmean(ser)))
        out.append(item)
    return out
