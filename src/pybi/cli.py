"""Command line interface:  pybi run | pybi demo | pybi export | pybi convert | pybi version"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="pybi", description="PyBI - open-source business intelligence studio in Python")
    sub = parser.add_subparsers(dest="cmd")

    run = sub.add_parser("run", help="start the PyBI studio in your browser")
    run.add_argument("project", nargs="?", help="a .pybi project, a Power BI file (.pbix/.pbit) or a data file (csv/xlsx/json/parquet) to open")
    run.add_argument("--port", "-p", type=int, default=8050)
    run.add_argument("--private", action="store_true", help="only this computer can connect (no network view link)")
    run.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    run.add_argument("--demo", action="store_true", help="start with the demo sales dataset and dashboard")

    demo = sub.add_parser("demo", help="start the studio with the demo dashboard")
    demo.add_argument("--port", "-p", type=int, default=8050)
    demo.add_argument("--private", action="store_true")
    demo.add_argument("--no-browser", action="store_true")

    exp = sub.add_parser("export", help="export a .pybi project to a standalone interactive HTML file")
    exp.add_argument("project")
    exp.add_argument("--out", "-o", help="output .html path")

    conv = sub.add_parser("convert", help="convert a Power BI file (.pbix/.pbit) to a .pybi project")
    conv.add_argument("file")
    conv.add_argument("--out", "-o", help="output .pybi path")

    sub.add_parser("version", help="print the version")

    args = parser.parse_args(argv)
    if args.cmd in (None, "run", "demo"):
        from .server import serve

        project = getattr(args, "project", None)
        dataframes = None
        if project and Path(project).suffix.lower() not in (".pybi", ".pbix", ".pbit", ""):
            from .project import read_upload

            p = Path(project)
            dataframes = read_upload(p.name, p.read_bytes())
            project = None
        serve(project=project, host="127.0.0.1" if getattr(args, "private", False) else "0.0.0.0",
              port=getattr(args, "port", 8050), open_browser=not getattr(args, "no_browser", False),
              dataframes=dataframes, sample=args.cmd == "demo" or getattr(args, "demo", False))
        return 0
    if args.cmd == "export":
        from .exporters import export_html
        from .project import Project

        proj = Project.load(args.project)
        out = Path(args.out or Path(args.project).with_suffix(".html"))
        out.write_text(export_html(proj.state()), encoding="utf-8")
        print(f"Exported {out}")
        return 0
    if args.cmd == "convert":
        from .pbix import project_from_pbix

        proj, imp = project_from_pbix(args.file)
        out = proj.save(args.out or str(Path(args.file).with_suffix(".pybi")))
        i = imp.info
        print(f"Converted {Path(args.file).name} -> {out}")
        print(f"  {i['pages']} pages, {i['visuals']} visuals, {i['tables']} tables ({i['rows']:,} rows), "
              f"{i['measures']} measures, {i['relationships']} relationships")
        for w in imp.warnings:
            print(f"  ! {w}")
        return 0
    if args.cmd == "version":
        print(f"PyBI {__version__}")
        return 0
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
