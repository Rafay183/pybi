/* PyBI report runtime: renders pages, manages slicers, cross-filtering and filter context.
 * Shared by the studio (editor) and the viewer / exported HTML.
 * Author: Muhammad Rafay Shaikh, from Pakistan. MIT License. */
(function (global) {
  "use strict";
  const E = global.PyBIEngine, V = global.PyBIVisuals;

  class Runtime {
    constructor(opts) {
      this.report = opts.report;
      this.tables = opts.tables || {};
      this.canvas = opts.canvas;
      this.editable = !!opts.editable;
      this.hooks = opts.hooks || {};
      this.pageIndex = 0;
      this.selection = null; // {visualId, field, values:Set}
      this.expanded = {};
      this.results = {};
      this.zoom = 1;
      this.rebuild();
    }

    rebuild() {
      const r = this.report;
      this.model = new E.Model({ tables: this.tables, relationships: r.relationships || [], measures: r.measures || [], calcColumns: r.calcColumns || [], columnProps: r.columnProps || {} });
      return this.model;
    }

    get page() { return this.report.pages[this.pageIndex] || this.report.pages[0]; }
    get theme() { return V.THEMES[this.report.theme] || V.THEMES.pybi; }
    pageSize() { const p = this.page; return { w: p.width || 1280, h: p.height || 720 }; }

    // ------------------------------------------------------------ filter context
    specFilters(list) { return (list || []).map(E.filterFromSpec).filter(Boolean); }

    slicerFilters(page, exceptId) {
      const out = [];
      const pages = this.report.syncSlicers ? this.report.pages : [page];
      for (const pg of pages) for (const v of pg.visuals) {
        if (v.type !== "slicer" || v.id === exceptId || !v.state) continue;
        if (pg !== page && !(v.format && v.format.sync)) continue;
        const f = (v.fields.category || [])[0]; if (!f) continue;
        if (v.state.values && v.state.values.length) out.push(E.inFilter(f.table, f.column, v.state.values, f.level));
        if (v.state.range && (v.state.range.min != null || v.state.range.max != null)) out.push(E.filterFromSpec({ field: f, mode: "range", min: v.state.range.min, max: v.state.range.max }));
      }
      return out.filter(Boolean);
    }

    filtersFor(v, page) {
      page = page || this.page;
      let fs = this.specFilters(this.report.reportFilters).concat(this.specFilters(page.filters)).concat(this.slicerFilters(page, v.id));
      const sel = this.selection;
      if (sel && sel.visualId !== v.id && sel.page === page.id && sel.values.size && !(v.format && v.format.ignoreCrossFilter)) {
        fs.push(E.inFilter(sel.field.table, sel.field.column, Array.from(sel.values), sel.field.level));
      }
      fs = fs.concat(this.specFilters(v.filters));
      return fs;
    }

    queryVisual(v, page) {
      if (v.type === "textbox") return null;
      const filters = this.filtersFor(v, page);
      if (v.type === "slicer") v._slicerFilters = this.specFilters(this.report.reportFilters).concat(this.specFilters((page || this.page).filters)).concat(this.slicerFilters(page || this.page, v.id));
      try { return E.query(this.model, v, filters, this.report); }
      catch (e) { console.error(e); return { empty: false, errors: [e.message] }; }
    }

    // ------------------------------------------------------------ rendering
    render() {
      const page = this.page; const theme = this.theme; const { w, h } = this.pageSize();
      const c = this.canvas;
      c.style.width = w + "px"; c.style.height = h + "px";
      c.style.background = page.background || theme.page;
      if (page.wallpaper) c.style.backgroundImage = "url(" + page.wallpaper + ")";
      c.innerHTML = "";
      c.classList.toggle("dark", theme.name.includes("dark"));
      this.frames = {};
      const visuals = page.visuals.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
      for (const v of visuals) this.renderVisual(v);
      if (this.hooks.afterRender) this.hooks.afterRender();
    }

    renderVisual(v) {
      const theme = this.theme; const f = v.format || {};
      let frame = this.frames && this.frames[v.id];
      if (!frame) {
        frame = document.createElement("div");
        frame.className = "visual t-" + v.type;
        frame.dataset.id = v.id;
        this.canvas.appendChild(frame);
        this.frames[v.id] = frame;
        if (this.hooks.decorate) this.hooks.decorate(frame, v);
      }
      if (v.hidden && !this.editable) { frame.style.display = "none"; return; }
      Object.assign(frame.style, {
        left: v.x + "px", top: v.y + "px", width: v.w + "px", height: v.h + "px",
        background: f.background === "transparent" ? "transparent" : f.background || theme.card,
        borderRadius: (f.radius ?? 6) + "px",
        border: f.border ? "1px solid " + (f.borderColor || theme.grid) : "1px solid transparent",
        boxShadow: f.shadow === false || f.background === "transparent" ? "none" : "",
        zIndex: v.z || 0,
        opacity: v.hidden ? 0.4 : 1,
      });
      let head = frame.querySelector(":scope > .vhead");
      let body = frame.querySelector(":scope > .vbody");
      if (!head) { head = document.createElement("div"); head.className = "vhead"; frame.appendChild(head); }
      if (!body) { body = document.createElement("div"); body.className = "vbody"; frame.appendChild(body); }
      const showTitle = v.title && f.showTitle !== false && v.type !== "textbox";
      head.style.display = showTitle ? "" : "none";
      head.innerHTML = showTitle ? '<span style="font-size:' + (f.titleSize || 13) + "px;color:" + (f.titleColor || theme.text) + ";text-align:" + (f.titleAlign || "left") + '">' + V.esc(v.title) + "</span>" : "";
      if (!this.editable) {
        const tools = document.createElement("div"); tools.className = "vtools";
        tools.innerHTML = '<button title="Focus mode" data-act="focus">⤢</button>' + (["table", "matrix"].includes(v.type) || v.fields && v.fields.category ? '<button title="Export data (CSV)" data-act="csv">⇩</button>' : "");
        head.appendChild(tools);
        tools.addEventListener("click", (ev) => { const a = ev.target.dataset.act; if (a === "focus") this.focus(v); if (a === "csv") this.exportData(v); });
      }
      const headH = v.type === "slicer" ? 24 : 34;
      const bw = v.w - (v.type === "textbox" ? 8 : 16), bh = v.h - (showTitle ? headH : 8) - 8;
      body.style.height = bh + "px";
      const result = this.queryVisual(v);
      this.results[v.id] = result;
      const sel = this.selection && this.selection.visualId === v.id ? this.selection.values : null;
      V.render(body, v, result, {
        width: Math.max(20, bw), height: Math.max(20, bh), theme, selection: sel,
        onSelect: (val, additive) => this.select(v, val, additive),
        slicerValues: v.state && v.state.values, slicerRange: v.state && v.state.range,
        onSlicer: (vals) => { v.state = Object.assign({}, v.state, { values: vals }); this.changed(true); },
        onSlicerRange: (rng) => { v.state = Object.assign({}, v.state, { range: rng }); this.changed(true); },
        onFormat: (patch) => { v.format = Object.assign({}, v.format, patch); this.changed(true); },
        expanded: (this.expanded[v.id] = this.expanded[v.id] || {}),
        onExpand: () => this.renderVisual(v),
      });
    }

    select(v, val, additive) {
      const field = v.type === "table" ? (v.fields.columns || [])[0] : v.type === "matrix" ? (v.fields.rows || [])[0] : (v.fields.category || [])[0];
      if (val === null || val === undefined || !field || E.isValueField(field)) {
        if (this.selection) { this.selection = null; this.renderAllButSlicersFocus(); }
        return;
      }
      if (this.editable && this.hooks.selectVisual) this.hooks.selectVisual(v.id, true);
      let values = this.selection && this.selection.visualId === v.id ? new Set(this.selection.values) : new Set();
      if (additive) values.has(val) ? values.delete(val) : values.add(val);
      else values = values.size === 1 && values.has(val) ? new Set() : new Set([val]);
      this.selection = values.size ? { visualId: v.id, field, values, page: this.page.id } : null;
      this.renderAllButSlicersFocus();
    }

    clearSelection() { if (this.selection) { this.selection = null; this.renderAllButSlicersFocus(); } }

    renderAllButSlicersFocus() {
      const active = document.activeElement;
      for (const v of this.page.visuals) {
        // keep slicer search boxes usable while typing
        if (v.type === "slicer" && this.frames[v.id] && this.frames[v.id].contains(active)) continue;
        this.renderVisual(v);
      }
    }

    changed(persist) {
      this.renderAllButSlicersFocus();
      if (persist && this.hooks.changed) this.hooks.changed("slicer");
    }

    resetFilters() {
      for (const p of this.report.pages) for (const v of p.visuals) if (v.type === "slicer") v.state = {};
      this.selection = null;
      this.render();
      if (this.hooks.changed) this.hooks.changed("slicer");
    }

    // ------------------------------------------------------------ focus mode & data export
    focus(v) {
      const ov = document.createElement("div"); ov.className = "focus-overlay";
      ov.innerHTML = '<div class="focus-box"><div class="focus-head"><b>' + V.esc(v.title || V.TYPES[v.type].label) + '</b><button>✕ Back to report</button></div><div class="focus-body"></div></div>';
      document.body.appendChild(ov);
      const body = ov.querySelector(".focus-body");
      const draw = () => {
        const r = body.getBoundingClientRect();
        V.render(body, v, this.queryVisual(v), { width: r.width - 10, height: r.height - 10, theme: this.theme, expanded: {}, onExpand: draw });
      };
      requestAnimationFrame(draw);
      ov.querySelector("button").onclick = () => ov.remove();
      ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
    }

    exportData(v) {
      const r = this.results[v.id]; if (!r) return;
      let header = [], rows = [];
      if (r.columns) { header = r.columns.map((c) => c.label); rows = r.rows; }
      else if (r.categories) { header = [r.catLabel || "Category"].concat(r.series.concat(r.lines || []).map((s) => s.name)); rows = r.categories.map((c, i) => [c].concat(r.series.concat(r.lines || []).map((s) => s.values[i]))); }
      else if (r.points) { header = [r.catLabel, r.xLabel, r.yLabel]; rows = r.points.map((p) => [p.label, p.x, p.y]); }
      else if (r.rows && r.measures) { header = [r.rowLabel, "Total"]; rows = r.rows.map((x) => [x.label].concat(x.total)); }
      const csv = [header].concat(rows).map((row) => row.map((x) => { const s = x == null ? "" : String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n");
      V.download((v.title || v.type) + ".csv", URL.createObjectURL(new Blob([csv], { type: "text/csv" })));
    }

    // ------------------------------------------------------------ export
    async pagePNG(index, scale) {
      const prev = this.pageIndex; const prevSel = this.selection;
      if (index != null && index !== this.pageIndex) { this.pageIndex = index; this.selection = null; this.render(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
      const page = this.page; const { w, h } = this.pageSize();
      const items = page.visuals.filter((v) => !v.hidden).slice().sort((a, b) => (a.z || 0) - (b.z || 0)).map((v) => ({ visual: v, result: this.results[v.id], el: this.frames[v.id] && this.frames[v.id].querySelector(".vbody") }));
      const svg = V.pageSVG(page, items, this.theme, w, h);
      const png = await V.svgToPNG(svg, w, h, scale || 2);
      if (index != null && prev !== index) { this.pageIndex = prev; this.selection = prevSel; this.render(); }
      return { name: page.name, png, width: w, height: h, svg };
    }

    async allPagesPNG(scale) {
      const out = [];
      for (let i = 0; i < this.report.pages.length; i++) out.push(await this.pagePNG(i, scale));
      return out;
    }
  }

  global.PyBIRuntime = Runtime;
})(typeof window !== "undefined" ? window : globalThis);
