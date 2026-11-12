"""Exports: standalone interactive HTML, PowerPoint and PDF."""
from __future__ import annotations

import base64
import io
import json
from datetime import datetime
from importlib import resources

AUTHOR_CREDIT = "Muhammad Rafay Shaikh, from Pakistan"


def _static(name: str) -> str:
    return resources.files("pybi").joinpath("static", name).read_text(encoding="utf-8")


def _safe_json(obj) -> str:
    # prevent </script> breaking out of the embedding script tag
    return json.dumps(obj, separators=(",", ":")).replace("</", "<\\/")


def export_html(state: dict, title: str | None = None) -> str:
    """One self-contained HTML file: data + engine + charts. Opens offline in any browser, fully interactive."""
    payload = {"report": state["report"], "tables": state["tables"], "exportedAt": datetime.now().isoformat(timespec="minutes"),
               "app": state.get("app", {})}
    html = _static("viewer.html")
    title = title or state["report"].get("title") or "PyBI report"
    html = html.replace("{{TITLE}}", title.replace("<", "&lt;"))
    html = html.replace('<link rel="stylesheet" href="/static/app.css">', "<style>\n" + _static("app.css") + "\n</style>")
    for js in ("d3.min.js", "engine.js", "visuals.js", "runtime.js", "viewer.js"):
        html = html.replace(f'<script src="/static/{js}"></script>', "<script>\n" + _static(js).replace("</script", "<\\/script") + "\n</script>")
    html = html.replace("<!--EMBED-->", "<script>window.PYBI_EMBED = " + _safe_json(payload) + ";</script>")
    return html


def _decode_png(data_url: str) -> bytes:
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    return base64.b64decode(data_url)


def export_pptx(pages: list, title: str) -> bytes:
    """pages: [{"name": str, "png": dataURL, "width": px, "height": px}] rendered by the browser."""
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.util import Emu, Pt

    prs = Presentation()
    prs.slide_width = Emu(12192000)  # 13.333 in (16:9)
    prs.slide_height = Emu(6858000)
    blank = prs.slide_layouts[6]

    cover = prs.slides.add_slide(blank)
    bg = cover.background.fill
    bg.solid()
    bg.fore_color.rgb = RGBColor(0x11, 0x18, 0x27)
    box = cover.shapes.add_textbox(Emu(700000), Emu(2300000), Emu(10800000), Emu(1400000))
    tf = box.text_frame
    tf.text = title
    tf.paragraphs[0].runs[0].font.size = Pt(40)
    tf.paragraphs[0].runs[0].font.bold = True
    tf.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    p = tf.add_paragraph()
    p.text = f"{len(pages)} page(s) · exported {datetime.now():%d %b %Y}"
    p.runs[0].font.size = Pt(16)
    p.runs[0].font.color.rgb = RGBColor(0xF2, 0xC8, 0x11)
    p2 = tf.add_paragraph()
    p2.text = f"Built with PyBI · {AUTHOR_CREDIT}"
    p2.runs[0].font.size = Pt(12)
    p2.runs[0].font.color.rgb = RGBColor(0x9C, 0xA3, 0xAF)

    sw, sh = prs.slide_width, prs.slide_height
    for page in pages:
        slide = prs.slides.add_slide(blank)
        img = io.BytesIO(_decode_png(page["png"]))
        w, h = page.get("width", 1280), page.get("height", 720)
        scale = min(sw / w, sh / h)
        pw, ph = int(w * scale), int(h * scale)
        slide.shapes.add_picture(img, int((sw - pw) / 2), int((sh - ph) / 2), pw, ph)
        if slide.has_notes_slide or True:
            slide.notes_slide.notes_text_frame.text = page.get("name", "")
    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


def export_pdf(pages: list) -> bytes:
    from PIL import Image

    images = []
    for page in pages:
        im = Image.open(io.BytesIO(_decode_png(page["png"])))
        if im.mode in ("RGBA", "P"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.convert("RGBA").split()[-1])
            im = bg
        images.append(im.convert("RGB"))
    if not images:
        raise ValueError("Nothing to export")
    out = io.BytesIO()
    images[0].save(out, format="PDF", save_all=True, append_images=images[1:], resolution=150)
    return out.getvalue()
