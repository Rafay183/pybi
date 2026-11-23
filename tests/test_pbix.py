"""Power BI (.pbix / .pbit) import."""
import io
import json
import os
import sys
import types
import zipfile
from pathlib import Path

import pandas as pd
import pytest

from pybi.cli import main as cli_main
from pybi.pbix import _format_from_string as fmt
from pybi.pbix import dax_functions, field_from_expr, filter_to_spec, literal, project_from_pbix, read_pbix, supported_dax_functions
from pybi.server import create_app

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


# ------------------------------------------------------------------ helpers to build Power BI files
def col(entity, prop, alias=None):
    return {"Column": {"Expression": {"SourceRef": {"Source": alias} if alias else {"Entity": entity}}, "Property": prop}}


def measure(entity, prop, alias=None):
    return {"Measure": {"Expression": {"SourceRef": {"Source": alias} if alias else {"Entity": entity}}, "Property": prop}}


def lit(v):
    return {"expr": {"Literal": {"Value": v}}}


def container(x, y, w, h, single=None, group=None, filters=None, name=None, parent=None, z=0):
    cfg = {"name": name or f"vc{x}{y}"}
    if single is not None:
        cfg["singleVisual"] = single
    if group is not None:
        cfg["singleVisualGroup"] = group
    if parent:
        cfg["parentGroupName"] = parent
    return {"x": x, "y": y, "z": z, "width": w, "height": h, "config": json.dumps(cfg), "filters": json.dumps(filters or [])}


def query(**roles):
    """roles: Role=[(expr, name)] -> (projections, prototypeQuery) with aliases like Power BI writes them."""
    entities, select, proj = {}, [], {}
    for role, items in roles.items():
        proj[role] = []
        for expr, name, *active in items:
            ent = json.dumps(expr)
            for k in ("Column", "Measure"):
                if k in expr:
                    e = expr[k]["Expression"]["SourceRef"]["Entity"]
                    alias = entities.setdefault(e, e[0].lower() + str(len(entities)))
                    expr = {k: {"Expression": {"SourceRef": {"Source": alias}}, "Property": expr[k]["Property"]}}
            if "Aggregation" in json.loads(ent):
                inner = json.loads(ent)["Aggregation"]
                e = inner["Expression"]["Column"]["Expression"]["SourceRef"]["Entity"]
                alias = entities.setdefault(e, e[0].lower() + str(len(entities)))
                inner["Expression"]["Column"]["Expression"]["SourceRef"] = {"Source": alias}
                expr = {"Aggregation": inner}
            select.append(dict(expr, Name=name))
            proj[role].append({"queryRef": name, **({"active": True} if active else {})})
    return proj, {"Version": 2, "From": [{"Name": a, "Entity": e, "Type": 0} for e, a in entities.items()], "Select": select}


def visual(vtype, objects=None, vc=None, **roles):
    proj, proto = query(**roles)
    sv = {"visualType": vtype, "projections": proj, "prototypeQuery": proto}
    if objects:
        sv["objects"] = objects
    if vc:
        sv["vcObjects"] = vc
    return sv


def basic_filter(entity, prop, values, negate=False):
    cond = {"In": {"Expressions": [col(entity, prop, "t")], "Values": [[{"Literal": {"Value": v}}] for v in values]}}
    if negate:
        cond = {"Not": {"Expression": cond}}
    return {"expression": col(entity, prop), "type": "Categorical",
            "filter": {"Version": 2, "From": [{"Name": "t", "Entity": entity}], "Where": [{"Condition": cond}]}}


def layout():
    year = {"HierarchyLevel": {"Expression": {"Hierarchy": {"Expression": {"PropertyVariationSource": {
        "Expression": {"SourceRef": {"Entity": "Sales"}}, "Name": "Variation", "Property": "OrderDate"}}, "Hierarchy": "Date Hierarchy"}},
        "Level": "Year"}}
    qty = {"Aggregation": {"Expression": col("Sales", "Qty"), "Function": 0}}
    slicer_sel = {"filter": {"Version": 2, "From": [{"Name": "p", "Entity": "Products"}],
                             "Where": [{"Condition": {"In": {"Expressions": [col("Products", "Category", "p")],
                                                              "Values": [[{"Literal": {"Value": "'Bikes'"}}]]}}}]}}
    adv = {"expression": col("Sales", "Qty"), "type": "Advanced", "filter": {"Version": 2, "From": [{"Name": "s", "Entity": "Sales"}], "Where": [
        {"Condition": {"And": {"Left": {"Comparison": {"ComparisonKind": 2, "Left": col("Sales", "Qty", "s"), "Right": {"Literal": {"Value": "1L"}}}},
                                "Right": {"Comparison": {"ComparisonKind": 3, "Left": col("Sales", "Qty", "s"), "Right": {"Literal": {"Value": "10L"}}}}}}}]}}
    topn = {"type": "TopN", "filter": {"Version": 2, "From": [], "Where": [{"Condition": {}}]}}
    page1 = [
        container(10, 10, 400, 60, {"visualType": "textbox", "objects": {"general": [{"properties": {"paragraphs": [
            {"textRuns": [{"value": "Sales ", "textStyle": {"fontSize": "24pt", "fontWeight": "bold", "color": "#112233"}},
                          {"value": "report", "textStyle": {"fontSize": "24pt"}}], "horizontalTextAlignment": "center"}]}}]}}),
        container(20, 100, 600, 300, visual("clusteredColumnChart", objects={"labels": [{"properties": {"show": lit("true")}}]},
                                            Category=[(year, "Year", True)], Y=[(measure("Sales", "Revenue"), "Sales.Revenue")],
                                            Series=[(col("Products", "Category"), "Products.Category")]),
                  filters=[basic_filter("Products", "Category", ["'Junk'"], negate=True)]),
        container(640, 100, 200, 100, visual("card", Values=[(measure("Sales", "Revenue"), "m1")])),
        container(640, 220, 200, 100, visual("card", Values=[(measure("Sales", "Revenue"), "m1"), (qty, "q")])),
        container(860, 100, 200, 200, visual("slicer", objects={"data": [{"properties": {"mode": lit("'Dropdown'")}}],
                                                                "general": [{"properties": {"filter": slicer_sel}}]},
                                             Values=[(col("Products", "Category"), "Products.Category")])),
        container(20, 420, 600, 250, visual("pivotTable", vc={"title": [{"properties": {"show": lit("true"), "text": lit("'My matrix'")}}]},
                                            Rows=[(col("Products", "Category"), "c")], Values=[(qty, "q")]),
                  filters=[adv, topn]),
        container(640, 420, 300, 200, visual("map", vc={"title": [{"properties": {"text": lit("'Sales by city'")}}]})),
        container(960, 420, 100, 40, {"visualType": "actionButton"}),
        container(960, 480, 100, 100, {"visualType": "shape", "objects": {"fill": [{"properties": {"fillColor": {"solid": {"color": {
            "expr": {"ThemeDataColor": {"ColorId": 2, "Percent": 0}}}}}}}]}}),
        container(1100, 10, 150, 80, {"visualType": "image", "objects": {"general": [{"properties": {"imageUrl": {"expr": {
            "ResourcePackageItem": {"PackageName": "RegisteredResources", "PackageType": 1, "ItemName": "logo123.png"}}}}}]}}),
        container(900, 600, 300, 100, group={"displayName": "Group"}, name="grp"),
        container(10, 10, 100, 50, visual("card", Values=[(measure("Sales", "Revenue"), "m1")]), name="child", parent="grp"),
        container(0, 0, 10, 10, {"visualType": "card", "display": {"mode": "hidden"}}),
    ]
    sections = [
        {"name": "s1", "displayName": "Overview", "ordinal": 0, "width": 1280, "height": 720, "visualContainers": page1,
         "filters": json.dumps([basic_filter("Products", "Category", ["'Bikes'", "'Helmets'"])]),
         "config": json.dumps({"objects": {"background": [{"properties": {"color": {"solid": {"color": lit("'#F0F0F0'")}},
                                                                          "transparency": lit("0D")}}]}})},
        {"name": "s2", "displayName": "Tooltip", "ordinal": 1, "width": 320, "height": 240, "visualContainers": [],
         "filters": "[]", "config": json.dumps({"visibility": 1, "type": 2})},
    ]
    return {"id": 0, "sections": sections, "config": "{}", "filters": json.dumps([basic_filter("Sales", "Region", ["'North'"])])}


def schema():
    return {"name": "m", "model": {"tables": [
        {"name": "Sales", "columns": [{"name": "OrderDate", "dataType": "dateTime"}, {"name": "Qty", "dataType": "int64"},
                                      {"name": "ProductID", "dataType": "int64", "isHidden": True},
                                      {"name": "Big", "type": "calculated", "expression": "IF(Sales[Qty] > 5, \"Y\", \"N\")"}],
         "measures": [{"name": "Revenue", "expression": ["SUMX(Sales,", " Sales[Qty] * RELATED(Products[Price]))"], "formatString": "\\$#,0.00"},
                      {"name": "Odd", "expression": "PATHLENGTH(\"a|b\")"}]},
        {"name": "Products", "columns": [{"name": "ProductID"}, {"name": "Category"}, {"name": "Price", "formatString": "0.0%"},
                                         {"name": "Month", "sortByColumn": "MonthNo"}, {"name": "MonthNo"}]},
        {"name": "LocalDateTable_123", "isHidden": True, "columns": [{"name": "Date"}]}],
        "relationships": [{"fromTable": "Sales", "fromColumn": "ProductID", "toTable": "Products", "toColumn": "ProductID",
                           "crossFilteringBehavior": "bothDirections"},
                          {"fromTable": "Sales", "fromColumn": "OrderDate", "toTable": "LocalDateTable_123", "toColumn": "Date"}]}}


def build_pbix(model="schema", report="layout") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        if report == "layout":
            z.writestr("Report/Layout", json.dumps(layout()).encode("utf-16-le"))
        elif report == "pbir":
            for path, obj in pbir_files().items():
                z.writestr(path, json.dumps(obj))
        z.writestr("Report/StaticResources/RegisteredResources/logo123.png", PNG)
        z.writestr("Report/StaticResources/RegisteredResources/MyTheme.json",
                   json.dumps({"name": "Corporate", "dataColors": ["#AA0000", "#00AA00", "#0000AA"], "foreground": "#101010"}))
        if model == "schema":
            z.writestr("DataModelSchema", json.dumps(schema()).encode("utf-16-le"))
        elif model == "vertipaq":
            z.writestr("DataModel", b"\x00fake")
        z.writestr("Version", "1.28".encode("utf-16-le"))
    return buf.getvalue()


def pbir_files():
    root = "Report/definition/"
    v1 = {"name": "v1", "position": {"x": 5, "y": 6, "z": 0, "width": 300, "height": 200},
          "visual": {"visualType": "lineChart", "query": {"queryState": {
              "Category": {"projections": [{"field": col("Sales", "OrderDate"), "queryRef": "Sales.OrderDate", "active": True}]},
              "Y": {"projections": [{"field": measure("Sales", "Revenue"), "queryRef": "Sales.Revenue", "displayName": "Rev"}]}}}}}
    v2 = {"name": "v2", "position": {"x": 400, "y": 6, "z": 1, "width": 200, "height": 120},
          "visual": {"visualType": "cardVisual", "query": {"queryState": {"Data": {"projections": [
              {"field": measure("Sales", "Revenue"), "queryRef": "Sales.Revenue"}]}}}}}
    return {
        root + "report.json": {"filterConfig": {"filters": [basic_filter("Sales", "Region", ["'West'"])]}},
        root + "pages/pages.json": {"pageOrder": ["b", "a"]},
        root + "pages/a/page.json": {"name": "a", "displayName": "Second", "width": 1280, "height": 720},
        root + "pages/b/page.json": {"name": "b", "displayName": "First", "width": 1600, "height": 900,
                                     "filterConfig": {"filters": [basic_filter("Products", "Category", ["'Bikes'"])]}},
        root + "pages/b/visuals/v1/visual.json": v1,
        root + "pages/b/visuals/v2/visual.json": v2,
    }


def by_type(page, t):
    return [v for v in page["visuals"] if v["type"] == t]


# ------------------------------------------------------------------ unit pieces
def test_literals_and_formats():
    assert literal({"Literal": {"Value": "'O''Neil'"}}) == "O'Neil"
    assert literal("2019L") == 2019 and literal("1.5D") == 1.5 and literal("3M") == 3.0
    assert literal("datetime'2020-01-31T00:00:00'") == "2020-01-31T00:00:00"
    assert literal("true") is True and literal("null") is None
    assert fmt("\\$#,0.00;(\\$#,0.00)") == {"type": "currency", "symbol": "$", "decimals": 2}
    assert fmt("0.0%") == {"type": "percent", "decimals": 1}
    assert fmt("#,0") == {"type": "whole"}
    assert fmt("dd/mm/yyyy") is None and fmt(None) is None


def test_fields_and_filters():
    assert field_from_expr(col("Sales", "Qty")) == {"table": "Sales", "column": "Qty"}
    assert field_from_expr({"Aggregation": {"Expression": col("Sales", "Qty"), "Function": 1}})["agg"] == "avg"
    spec, why = filter_to_spec(basic_filter("Products", "Category", ["'A'", "'B'"], negate=True))
    assert spec == {"field": {"table": "Products", "column": "Category"}, "mode": "basic", "values": ["A", "B"], "invert": True}
    ors = {"Or": {"Left": {"Comparison": {"ComparisonKind": 0, "Left": col("T", "C", "t"), "Right": {"Literal": {"Value": "1L"}}}},
                  "Right": {"Comparison": {"ComparisonKind": 0, "Left": col("T", "C", "t"), "Right": {"Literal": {"Value": "2L"}}}}}}
    spec, _ = filter_to_spec({"filter": {"From": [{"Name": "t", "Entity": "T"}], "Where": [{"Condition": ors}]}})
    assert spec["mode"] == "basic" and spec["values"] == [1, 2]


def test_dax_function_scan():
    assert dax_functions('CALCULATE(SUM(\'Sales Table\'[Amount (USD)]), "SUM(x)") // MAX(') == {"CALCULATE", "SUM"}
    assert {"CALCULATE", "SUMX", "DIVIDE"} <= supported_dax_functions()


# ------------------------------------------------------------------ whole files
def test_layout_report_and_schema_model():
    imp = read_pbix(build_pbix(), "Sales.pbit")
    rep = imp.report
    assert [p["name"] for p in rep["pages"]] == ["Overview", "Tooltip"]
    p1, p2 = rep["pages"]
    assert p2["hidden"] and p2["width"] == 320
    assert p1["background"] == "#F0F0F0"
    assert p1["filters"][0]["values"] == ["Bikes", "Helmets"]
    assert rep["reportFilters"][0]["field"] == {"table": "Sales", "column": "Region"}

    txt = by_type(p1, "textbox")[0]
    assert txt["format"]["text"] == "**Sales **report" and txt["format"]["fontSize"] == 32 and txt["format"]["align"] == "center"
    chart = by_type(p1, "clusteredColumn")[0]
    assert chart["fields"]["category"] == [{"table": "Sales", "column": "OrderDate", "level": "year"}]
    assert chart["fields"]["values"] == [{"measure": "Revenue"}]
    assert chart["fields"]["series"] == [{"table": "Products", "column": "Category"}]
    assert chart["format"]["dataLabels"] is True and chart["title"] == "Revenue by OrderDate and Category"
    assert chart["filters"][0]["invert"] is True
    cards = by_type(p1, "card")
    assert len(cards) == 2  # one plain card + the grouped one; the hidden card is dropped
    grouped = [c for c in cards if c["x"] == 910][0]
    assert grouped["y"] == 610  # child position is relative to its group
    multi = by_type(p1, "multiCard")[0]
    assert multi["fields"]["values"][1] == {"table": "Sales", "column": "Qty", "agg": "sum"}
    slicer = by_type(p1, "slicer")[0]
    assert slicer["format"]["style"] == "dropdown" and slicer["state"] == {"values": ["Bikes"]} and slicer["title"] == "Category"
    matrix = by_type(p1, "matrix")[0]
    assert matrix["title"] == "My matrix" and matrix["fields"]["rows"] == [{"table": "Products", "column": "Category"}]
    assert matrix["filters"][0]["op"] == ">=" and matrix["filters"][0]["op2"] == "<" and matrix["filters"][0]["value2"] == 10
    img = by_type(p1, "image")[0]
    assert img["format"]["src"].startswith("data:image/png;base64,")
    holders = [v for v in p1["visuals"] if v.get("placeholder")]
    assert holders and "Map" in holders[0]["format"]["text"] and "Sales by city" in holders[0]["format"]["text"]
    shape = [v for v in by_type(p1, "textbox") if v["format"].get("background") == "#AA0000"]
    assert shape, "shape fill uses the report theme's first data colour"
    assert rep["customTheme"]["palette"][:3] == ["#AA0000", "#00AA00", "#0000AA"]

    # model from DataModelSchema
    assert set(imp.tables) == {"Sales", "Products"}
    assert list(imp.tables["Sales"].columns) == ["OrderDate", "Qty", "ProductID"]
    rev = next(m for m in rep["measures"] if m["name"] == "Revenue")
    assert "RELATED(Products[Price])" in rev["expression"] and rev["format"]["type"] == "currency"
    assert rep["calcColumns"] == [{"table": "Sales", "name": "Big", "expression": 'IF(Sales[Qty] > 5, "Y", "N")'}]
    assert rep["relationships"] == [{"fromTable": "Sales", "fromColumn": "ProductID", "toTable": "Products", "toColumn": "ProductID",
                                     "crossFilter": "both", "active": True, "id": "r1"}]
    assert "Sales[ProductID]" in rep["hiddenFields"]
    assert rep["columnProps"]["Products[Month]"]["sortBy"] == "MonthNo"

    w = " ".join(imp.warnings)
    assert "PATHLENGTH" in w and "Map" in w and "buttons" in w and "Top N" in w and "template" in w


def test_pbir_report():
    imp = read_pbix(build_pbix(report="pbir"), "New.pbix")
    rep = imp.report
    assert [p["name"] for p in rep["pages"]] == ["First", "Second"]
    first = rep["pages"][0]
    assert first["width"] == 1600 and first["filters"][0]["values"] == ["Bikes"]
    line = by_type(first, "line")[0]
    assert (line["x"], line["y"], line["w"], line["h"]) == (5, 6, 300, 200)
    assert line["fields"]["values"] == [{"measure": "Revenue", "label": "Rev"}]
    assert by_type(first, "card")[0]["fields"]["values"] == [{"measure": "Revenue"}]
    assert rep["reportFilters"][0]["values"] == ["West"]


class FakePBIXRay:
    """Stands in for pbixray.PBIXRay with the same attribute names."""

    def __init__(self, path):
        assert Path(path).exists()
        self.tables = ["Sales", "Products", "LocalDateTable_1"]
        self.dax_measures = pd.DataFrame([{"TableName": "Sales", "Name": "Revenue", "Expression": "SUM(Sales[Amount])"}])
        self.dax_columns = pd.DataFrame([{"TableName": "Sales", "ColumnName": "Amount2", "Expression": "Sales[Amount] * 2"}])
        self.relationships = pd.DataFrame([
            {"FromTableName": "Products", "FromColumnName": "ID", "ToTableName": "Sales", "ToColumnName": "ProductID",
             "IsActive": 1, "Cardinality": "1:M", "CrossFilteringBehavior": "Single"},
            {"FromTableName": "Sales", "FromColumnName": "Date", "ToTableName": "LocalDateTable_1", "ToColumnName": "Date",
             "IsActive": 1, "Cardinality": "M:1", "CrossFilteringBehavior": "Single"}])
        self.tmschema_tables = pd.DataFrame([{"Name": "Sales", "IsHidden": 0}, {"Name": "Products", "IsHidden": 0}])
        self.tmschema_columns = pd.DataFrame([
            {"ID": 1, "TableName": "Sales", "Name": "Amount", "IsHidden": 0, "FormatString": "\\$#,0", "SortByColumnID": None},
            {"ID": 2, "TableName": "Sales", "Name": "ProductID", "IsHidden": 1, "FormatString": None, "SortByColumnID": None}])
        self.rls = pd.DataFrame()

    def get_table(self, name):
        if name == "Sales":
            return pd.DataFrame({"ProductID": [1, 2, 1], "Amount": [10.0, 20.0, 5.0], "Date": pd.to_datetime(["2024-01-01"] * 3),
                                 "Region": pd.Categorical(["N", "S", "N"])})
        return pd.DataFrame({"ID": [1, 2], "Name": ["Bike", "Helmet"]})

    def close(self):
        pass


@pytest.fixture()
def fake_pbixray(monkeypatch):
    mod = types.ModuleType("pbixray")
    mod.PBIXRay = FakePBIXRay
    monkeypatch.setitem(sys.modules, "pbixray", mod)


def test_vertipaq_model_via_pbixray(fake_pbixray):
    proj, imp = project_from_pbix(build_pbix(model="vertipaq"), "Report.pbix")
    assert set(imp.tables) == {"Sales", "Products"}
    assert imp.tables["Sales"]["Region"].dtype == object
    rep = proj.report
    assert rep["relationships"][0]["fromTable"] == "Sales" and rep["relationships"][0]["toTable"] == "Products"
    assert len(rep["relationships"]) == 1
    assert rep["measures"][0]["name"] == "Revenue"
    assert rep["calcColumns"][0]["name"] == "Amount2"
    assert rep["columnProps"]["Sales[Amount]"]["format"]["type"] == "currency"
    assert "Sales[ProductID]" in rep["hiddenFields"]
    st = proj.state()
    assert st["tables"]["Sales"]["rows"] == 3 and not st["errors"]
    assert imp.info["rows"] == 5


def test_vertipaq_without_pbixray(monkeypatch):
    monkeypatch.setitem(sys.modules, "pbixray", None)
    imp = read_pbix(build_pbix(model="vertipaq"), "Report.pbix")
    assert imp.tables == {} and imp.report["pages"]
    assert any("pybi-ray[pbix]" in w for w in imp.warnings)


def test_live_connection_and_bad_files():
    imp = read_pbix(build_pbix(model=None), "Live.pbix")
    assert any("live connection" in w for w in imp.warnings)
    with pytest.raises(ValueError):
        read_pbix(b"not a zip", "x.pbix")


def test_server_open_pbix_and_cli_convert(tmp_path):
    app = create_app()
    c = app.test_client()
    r = c.post("/api/open", data={"file": (io.BytesIO(build_pbix()), "Sales.pbit")}, content_type="multipart/form-data")
    assert r.status_code == 200, r.get_json()
    st = r.get_json()
    assert st["pbix"]["info"]["pages"] == 2 and st["report"]["pages"][0]["name"] == "Overview"
    assert set(st["tables"]) == {"Sales", "Products"}
    r = c.post("/api/open", data={"file": (io.BytesIO(b"junk"), "x.pbix")}, content_type="multipart/form-data")
    assert r.status_code == 400

    src = tmp_path / "Sales.pbit"
    src.write_bytes(build_pbix())
    assert cli_main(["convert", str(src)]) == 0
    from pybi.project import Project
    proj = Project.load(str(tmp_path / "Sales.pybi"))
    assert proj.report["pages"][0]["name"] == "Overview"


SAMPLES = os.environ.get("PYBI_PBIX_SAMPLES")


@pytest.mark.skipif(not SAMPLES, reason="set PYBI_PBIX_SAMPLES to a folder of real .pbix files")
def test_real_power_bi_files():
    files = sorted(Path(SAMPLES).glob("*.pbix"))
    assert files
    for f in files:
        imp = read_pbix(f, load_data=False)
        json.dumps(imp.report)
        for p in imp.report["pages"]:
            for v in p["visuals"]:
                assert v["w"] > 0 and v["h"] > 0
