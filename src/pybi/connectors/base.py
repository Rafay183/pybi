"""Connector primitives: parameter specs, the Connector record, templating and optional-dependency checks."""
from __future__ import annotations

import importlib
import string
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


class ConnectorError(Exception):
    """A user-facing connector problem (bad credentials, missing driver, unreachable host...)."""

    def __init__(self, message: str, install: Optional[str] = None):
        super().__init__(message)
        self.install = install


def need(module: str, pip_name: Optional[str] = None):
    """Import an optional driver or raise a friendly 'pip install ...' error."""
    try:
        return importlib.import_module(module)
    except ImportError as exc:
        pkg = pip_name or module
        raise ConnectorError(f"This connector needs the '{pkg}' package. Install it with:  pip install {pkg}", install=pkg) from exc


@dataclass
class Param:
    key: str
    label: str
    type: str = "text"  # text | password | number | select | textarea | checkbox | file | json
    required: bool = False
    default: Any = None
    help: str = ""
    options: Optional[list] = None
    secret: bool = False
    advanced: bool = False
    placeholder: str = ""

    def to_dict(self):
        return {k: v for k, v in self.__dict__.items() if v not in (None, "", False) or k in ("key", "label", "type")}


@dataclass
class Connector:
    id: str
    name: str
    category: str
    engine: str
    params: List[Param] = field(default_factory=list)
    config: Dict[str, Any] = field(default_factory=dict)
    description: str = ""
    install: Optional[str] = None  # pip package(s) needed beyond PyBI's own dependencies
    multi: bool = False  # can return several tables (shows a navigator)
    docs: str = ""
    tags: str = ""

    def to_dict(self):
        return {"id": self.id, "name": self.name, "category": self.category, "engine": self.engine,
                "description": self.description, "install": self.install, "multi": self.multi, "docs": self.docs,
                "params": [p.to_dict() for p in self.params], "tags": self.tags}


class _SafeFormatter(string.Formatter):
    def get_value(self, key, args, kwargs):
        v = kwargs.get(key, "")
        return "" if v is None else v


_fmt = _SafeFormatter()


def render(obj, params: Dict[str, Any]):
    """Fill {placeholders} in strings / dicts / lists with parameter values (missing -> empty)."""
    if isinstance(obj, str):
        if "{" not in obj:
            return obj
        try:
            return _fmt.format(obj, **params)
        except (ValueError, IndexError):
            return obj
    if isinstance(obj, dict):
        return {render(k, params): render(v, params) for k, v in obj.items()}
    if isinstance(obj, list):
        return [render(v, params) for v in obj]
    return obj


def dig(obj, path: Optional[str]):
    """Follow a dot path like 'data.items' or 'results.0.rows' through dicts and lists.
    Keys that themselves contain dots (e.g. '@odata.nextLink') are matched first."""
    if path in (None, "", "."):
        return obj
    path = str(path)
    if isinstance(obj, dict) and path in obj:
        return obj[path]
    head, _, rest = path.partition(".")
    if isinstance(obj, dict):
        # try the longest dotted key prefix that exists
        parts = path.split(".")
        for i in range(len(parts), 0, -1):
            key = ".".join(parts[:i])
            if key in obj:
                return obj[key] if i == len(parts) else dig(obj[key], ".".join(parts[i:]))
        return None
    if isinstance(obj, list):
        try:
            nxt = obj[int(head)]
        except (ValueError, IndexError):
            return None
        return dig(nxt, rest) if rest else nxt
    return None
