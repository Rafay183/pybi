"""PyBI — an open-source, Python-powered business intelligence studio.

    pip install pybi-ray
    pybi run

Author: Muhammad Rafay Shaikh, from Pakistan.
"""
from __future__ import annotations

__version__ = "0.1.0"
__author__ = "Muhammad Rafay Shaikh"

from typing import Any


def run(project: str | None = None, port: int = 8050, open_browser: bool = True,
        private: bool = False, demo: bool = False, **dataframes: Any) -> None:
    """Start the PyBI studio.

    Pass pandas DataFrames as keyword arguments to load them as tables::

        import pybi
        pybi.run(Sales=df_sales, Products=df_products)
    """
    from .server import serve

    serve(project=project, host="127.0.0.1" if private else "0.0.0.0", port=port, open_browser=open_browser,
          dataframes=dataframes or None, sample=demo)


def show(**dataframes: Any) -> None:
    """Alias of :func:`run` for notebooks and scripts: ``pybi.show(Sales=df)``."""
    run(**dataframes)


__all__ = ["run", "show", "__version__"]
