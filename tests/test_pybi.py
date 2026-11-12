import io
import json

import pandas as pd
import pytest

from pybi.exporters import export_html, export_pptx
from pybi.project import Project, read_upload
from pybi.sample import sample_report, sample_tables
from pybi.server import create_app
from pybi.transform import StepError, apply_steps


@pytest.fixture()
def project():
    p = Project()
    for n, df in sample_tables().items():
        p.add_source(n, df, "sample", detect=False)
    p.report = sample_report()
    return p


def test_sample_state(project):
    st = project.state()
    assert set(st["tables"]) == {"Sales", "Products", "Customers", "Calendar", "Targets"}
    assert st["tables"]["Sales"]["rows"] > 1000
    assert not st["errors"]


def test_steps():
    df = pd.DataFrame({"a": ["1", "2", None, "4"], "b": ["x", "y", "y", "z"], "d": ["2024-01-05"] * 4})
    out = apply_steps(df, [
        {"op": "change_type", "column": "a", "to": "number"},
        {"op": "fill_null", "column": "a", "method": "value", "value": 0},
        {"op": "filter_rows", "column": "b", "operator": "!=", "value": "z"},
        {"op": "add_column", "name": "a2", "expression": "[a] * 2"},
        {"op": "date_parts", "column": "d", "parts": ["year"]},
        {"op": "group_by", "by": ["b"], "aggregations": [{"column": "a2", "func": "sum", "name": "total"}]},
    ])
    assert out.set_index("b")["total"].to_dict() == {"x": 2.0, "y": 4.0}
    with pytest.raises(StepError):
        apply_steps(df, [{"op": "remove_columns", "columns": ["nope"]}])


def test_roundtrip(project):
    p2 = Project.from_bytes(project.to_bytes())
    assert p2.report["title"] == project.report["title"]
    assert len(p2.table("Sales")) == len(project.table("Sales"))
    assert str(p2.table("Calendar")["Date"].dtype).startswith("datetime64")


def test_read_csv():
    dfs = read_upload("people.csv", b"name,age\nAli,30\nSara,25\n")
    assert list(dfs["people"].columns) == ["name", "age"]


def test_exports(project):
    html = export_html(project.state())
    assert "PYBI_EMBED" in html and "/static/" not in html.split("PYBI_EMBED")[0][-2000:]
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 36), "white").save(buf, "PNG")
    import base64
    png = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    data = export_pptx([{"name": "p", "png": png, "width": 64, "height": 36}], "t")
    assert data[:2] == b"PK"


def test_server(project):
    app = create_app(project)
    c = app.test_client()
    assert c.get("/api/state").status_code == 200
    assert c.post("/api/report", json=project.report).status_code == 200
    r = c.post("/api/source/Sales/preview", json={"steps": [{"op": "keep_top", "n": 5}]})
    assert json.loads(r.data)["rowCount"] == 5
    # remote clients can view but not edit
    assert c.get("/api/state", environ_base={"REMOTE_ADDR": "10.0.0.5"}).status_code == 403
    assert c.get("/api/view-state", environ_base={"REMOTE_ADDR": "10.0.0.5"}).status_code == 200
