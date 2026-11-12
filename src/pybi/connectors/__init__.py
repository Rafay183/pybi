"""PyBI data connectors: a catalog of 120+ sources powered by a handful of generic engines."""
from .base import Connector, ConnectorError, Param
from .catalog import BY_ID, CATALOG, CATEGORIES
from .engines import discover, run

__all__ = ["CATALOG", "BY_ID", "CATEGORIES", "Connector", "ConnectorError", "Param", "run", "discover", "catalog_json"]


def catalog_json():
    return {"categories": CATEGORIES, "connectors": [c.to_dict() for c in CATALOG], "count": len(CATALOG)}
