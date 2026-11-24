"""The extended visual gallery (visuals_plus.js) ships, registers 50+ types and is inlined in exports."""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from pybi.exporters import export_html
from pybi.project import Project
from pybi.sample import sample_report, sample_tables

STATIC = Path(__file__).resolve().parents[1] / "src" / "pybi" / "static"
SRC = (STATIC / "visuals_plus.js").read_text(encoding="utf-8")
IDS = re.findall(r'^  def\("(\w+)", "([^"]+)", (\w+)', SRC, re.M)


def test_at_least_fifty_unique_visuals():
    ids = [i for i, _, _ in IDS]
    assert len(ids) >= 50
    assert len(ids) == len(set(ids))


def test_every_visual_has_icon_and_render():
    for vid, _, _ in IDS:
        block = SRC[SRC.index('def("' + vid + '"'):]
        block = block[: block.index("\n  def(", 5)] if "\n  def(" in block[5:] else block
        assert "icon:" in block, vid
        assert "render" in block, vid


def test_pages_load_the_gallery():
    for page in ("index.html", "viewer.html"):
        html = (STATIC / page).read_text(encoding="utf-8")
        assert html.index("visuals.js") < html.index("visuals_plus.js") < html.index("runtime.js")


def test_export_inlines_gallery():
    p = Project()
    for n, df in sample_tables().items():
        p.add_source(n, df, "sample", "demo", detect=False)
    p.report = sample_report()
    assert "PyBIVisualsPlus" in export_html(p.state())


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_registers_in_node():
    script = (
        "globalThis.d3={};const fs=require('fs');"
        "for (const f of ['engine.js','visuals.js','visuals_plus.js']) eval(fs.readFileSync(process.argv[1]+'/'+f,'utf8'));"
        "const t=Object.values(PyBIVisuals.TYPES).filter(m=>m.plus);"
        "if(t.length<50||t.some(m=>typeof m.query!=='function'||typeof m.render!=='function'))process.exit(1);"
        "console.log(t.length)"
    )
    out = subprocess.run(["node", "-e", script, str(STATIC)], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[-800:]
    assert int(out.stdout.strip()) >= 50
