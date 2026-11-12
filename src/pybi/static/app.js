/* PyBI Studio — the report editor.
 * Author: Muhammad Rafay Shaikh, from Pakistan. MIT License. */
(function () {
  "use strict";
  const E = window.PyBIEngine, V = window.PyBIVisuals, esc = V.esc;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const h = (tag, attrs, html) => { const el = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === "class") el.className = attrs[k]; else if (k.startsWith("on")) el.addEventListener(k.slice(2), attrs[k]); else el.setAttribute(k, attrs[k]); } if (html != null) el.innerHTML = html; return el; };
  const uid = (p) => (p || "v") + Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const S = { report: null, tables: {}, sources: [], info: {}, view: "report", selected: null, history: [], future: [], zoom: null, grid: false, collapsed: {}, vizTab: "build", clipboard: null, fieldSearch: "", openTables: {} };
  let RT = null;

  // ================================================================ API
  async function api(path, body, method) {
    const opt = { method: method || (body !== undefined ? "POST" : "GET"), headers: {} };
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
    const r = await fetch(path, opt);
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("json")) { if (!r.ok) throw new Error("Request failed (" + r.status + ")"); return r; }
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || "Request failed");
    return j;
  }
  async function download(path, body, fallbackName) {
    const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { let m = "Export failed"; try { m = (await r.json()).error || m; } catch (e) { /* not json */ } throw new Error(m); }
    const blob = await r.blob();
    const cd = r.headers.get("content-disposition") || ""; const m = /filename="?([^";]+)"?/.exec(cd);
    V.download(m ? m[1] : fallbackName, URL.createObjectURL(blob));
  }
  function toast(msg, isErr) { $$(".toast").forEach((x) => x.remove()); const t = h("div", { class: "toast" + (isErr ? " err" : "") }, esc(msg)); document.body.appendChild(t); setTimeout(() => t.remove(), isErr ? 6000 : 2600); }
  async function busy(msg, fn) { const b = h("div", { class: "busy" }, "<span>" + esc(msg) + "</span>"); document.body.appendChild(b); try { return await fn(); } catch (e) { toast(e.message, true); } finally { b.remove(); } }

  // ================================================================ state & history
  function applyState(st) {
    S.report = st.report; S.tables = st.tables; S.sources = st.sources;
    S.report.pages = S.report.pages && S.report.pages.length ? S.report.pages : [{ id: "p1", name: "Page 1", visuals: [], filters: [] }];
    for (const k of ["measures", "calcColumns", "relationships", "reportFilters"]) S.report[k] = S.report[k] || [];
    S.report.columnProps = S.report.columnProps || {};
    if (st.errors && Object.keys(st.errors).length) toast("Query errors: " + Object.entries(st.errors).map(([k, v]) => k + ": " + v).join("; "), true);
    const page = RT ? RT.pageIndex : 0;
    RT = new window.PyBIRuntime({
      report: S.report, tables: S.tables, canvas: $("#canvas"), editable: true,
      hooks: { decorate, selectVisual: (id) => selectVisual(id), changed: () => persist(), afterRender: afterRender },
    });
    RT.pageIndex = Math.min(page, S.report.pages.length - 1);
    if (S.selected && !findVisual(S.selected)) S.selected = null;
    renderAll();
  }

  function snapshot() { return JSON.stringify(S.report); }
  let lastSnap = null;
  function commit(opts) {
    opts = opts || {};
    const snap = snapshot();
    if (lastSnap && snap !== lastSnap) { S.history.push(lastSnap); if (S.history.length > 80) S.history.shift(); S.future = []; }
    lastSnap = snap;
    if (opts.model) RT.rebuild();
    if (opts.render !== false) { RT.render(); }
    renderPanes(); renderPages();
    if (S.view === "data") renderDataView();
    if (S.view === "model") renderModelView();
    persist();
  }
  function undo() { if (!S.history.length) return; S.future.push(snapshot()); restore(S.history.pop()); }
  function redo() { if (!S.future.length) return; S.history.push(snapshot()); restore(S.future.pop()); }
  function restore(snap) { const r = JSON.parse(snap); Object.keys(S.report).forEach((k) => delete S.report[k]); Object.assign(S.report, r); lastSnap = snap; RT.report = S.report; RT.rebuild(); if (S.selected && !findVisual(S.selected)) S.selected = null; renderAll(); persist(); }

  let saveTimer = null;
  function persist() {
    $("#saveState").textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await api("/api/report", S.report); $("#saveState").textContent = "All changes synced"; } catch (e) { $("#saveState").textContent = "Not synced"; }
    }, 500);
  }

  const page = () => RT.page;
  function findVisual(id) { for (const p of S.report.pages) for (const v of p.visuals) if (v.id === id) return v; return null; }
  const selVisual = () => (S.selected ? page().visuals.find((v) => v.id === S.selected) : null);

  function renderAll() {
    $("#docTitle").value = S.report.title || "Untitled report";
    document.title = (S.report.title || "Untitled") + " · PyBI Studio";
    renderRibbon(); renderPages(); renderPanes(); setView(S.view, true);
    lastSnap = snapshot();
  }

  // ================================================================ ribbon
  function renderRibbon() {
    const groups = [
      ["Data", [["⊕", "Get data", openGetData, "primary"], ["⇄", "Transform", () => openQueryEditor()], ["⟳", "Refresh", refreshData], ["☷", "Sample", loadSample]]],
      ["Insert", [["▤", "New page", addPage], ["T", "Text box", () => addVisual("textbox")], ["▥", "Visual", () => addVisual("clusteredColumn")], ["⧉", "Slicer", () => addVisual("slicer")]]],
      ["Calculations", [["ƒx", "New measure", () => openMeasureEditor()], ["▦", "New column", () => openColumnEditor()], ["📅", "Date table", openDateTable], ["⛓", "Relationships", openRelationships]]],
      ["Smart", [["✨", "Auto dashboard", autoDashboard, "star"], ["❓", "Ask data", () => $("#askBox").focus(), "star"]]],
      ["View", [["🎨", "Theme", openTheme], ["⋮⋮", "Gridlines", () => { S.grid = !S.grid; afterRender(); }], ["↶", "Undo", undo], ["↷", "Redo", redo]]],
      ["File", [["🗋", "New", newReport], ["📂", "Open", openProject], ["💾", "Save", saveProject], ["⇩", "Export", exportMenu, "primary"]]],
    ];
    const rb = $("#ribbon"); rb.innerHTML = "";
    for (const [label, btns] of groups) {
      const g = h("div", { class: "rgroup" }); const b = h("div", { class: "btns" });
      for (const [ic, name, fn, cls] of btns) { const el = h("button", { class: "rbtn " + (cls || ""), title: name }, '<span class="ic">' + ic + "</span>" + name); el.addEventListener("click", (ev) => fn(ev)); b.appendChild(el); }
      g.appendChild(b); g.appendChild(h("div", { class: "glabel" }, label)); rb.appendChild(g);
    }
  }

  // ================================================================ views
  function setView(v, silent) {
    S.view = v;
    $$(".rail button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
    $("#reportView").classList.toggle("hidden", v !== "report");
    $("#pagebar").classList.toggle("hidden", v !== "report");
    $("#dataView").classList.toggle("hidden", v !== "data");
    $("#modelView").classList.toggle("hidden", v !== "model");
    $("#filtersPane").classList.toggle("hidden", v !== "report");
    $("#vizPane").classList.toggle("hidden", v !== "report");
    if (v === "report") { RT.render(); fitZoom(); }
    if (v === "data") renderDataView();
    if (v === "model") renderModelView();
    renderPanes();
  }
  $$(".rail button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

  function fitZoom() {
    const stage = $("#reportView"); const { w, h: ph } = RT.pageSize();
    const z = S.zoom || Math.max(0.3, Math.min(1.6, (stage.clientWidth - 50) / w));
    const c = $("#canvas"); c.style.transform = "scale(" + z + ")";
    $("#holder").style.width = w * z + "px"; $("#holder").style.height = ph * z + "px";
    RT.zoom = z;
    const zl = $("#zoomLabel"); if (zl) zl.textContent = Math.round(z * 100) + "%";
  }
  window.addEventListener("resize", () => S.view === "report" && fitZoom());

  function afterRender() {
    $("#canvas").classList.toggle("gridon", S.grid);
    if (S.selected && RT.frames[S.selected]) RT.frames[S.selected].classList.add("sel");
    const empty = !page().visuals.length;
    let w = $("#welcome");
    if (empty && !Object.keys(S.tables).length) {
      if (!w) {
        w = h("div", { id: "welcome", class: "welcome" }, '<div class="card"><h1>Welcome to PyBI</h1><p>Open-source business intelligence that runs on your own computer. Connect data, model it, write DAX-style measures and design interactive dashboards.</p><div class="acts"><button class="btn primary" data-a="get">⊕ Get data</button><button class="btn" data-a="sample">☷ Try the demo dashboard</button><button class="btn" data-a="open">📂 Open .pybi file</button></div><div class="credit">PyBI · created by Muhammad Rafay Shaikh, from Pakistan</div></div>');
        $("#reportView").appendChild(w);
        w.addEventListener("click", (e) => { const a = e.target.dataset.a; if (a === "get") openGetData(); if (a === "sample") loadSample(); if (a === "open") openProject(); });
      }
    } else if (w) w.remove();
  }

  // ================================================================ canvas editing
  function decorate(frame, v) {
    for (const d of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) { const hd = h("div", { class: "h " + d }); hd.dataset.dir = d; frame.appendChild(hd); }
    const m = h("div", { class: "vmenu" }, '<button data-a="focus" title="Focus mode">⤢</button><button data-a="dup" title="Duplicate">⧉</button><button data-a="more" title="More options">⋯</button>');
    frame.appendChild(m);
    m.addEventListener("pointerdown", (e) => e.stopPropagation());
    m.addEventListener("click", (e) => {
      e.stopPropagation(); const a = e.target.dataset.a; const vv = findVisual(frame.dataset.id);
      if (a === "focus") RT.focus(vv);
      if (a === "dup") duplicateVisual(vv);
      if (a === "more") visualMenu(e, vv);
    });
    frame.addEventListener("pointerdown", (e) => startDrag(e, frame));
    frame.addEventListener("dblclick", (e) => { const vv = findVisual(frame.dataset.id); if (vv.type === "textbox") { selectVisual(vv.id); S.vizTab = "format"; renderPanes(); setTimeout(() => { const ta = $("#vizPane textarea"); if (ta) ta.focus(); }, 30); } });
    frame.addEventListener("contextmenu", (e) => { e.preventDefault(); visualMenu(e, findVisual(frame.dataset.id)); });
    frame.addEventListener("dragover", (e) => { e.preventDefault(); frame.classList.add("dragover"); });
    frame.addEventListener("dragleave", () => frame.classList.remove("dragover"));
    frame.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); frame.classList.remove("dragover"); const f = dragField(e); if (f) { selectVisual(frame.dataset.id); addFieldToVisual(findVisual(frame.dataset.id), f); } });
  }

  function selectVisual(id, keepPane) {
    if (S.selected === id) return;
    S.selected = id;
    $$("#canvas .visual").forEach((f) => f.classList.toggle("sel", f.dataset.id === id));
    renderPanes();
  }

  function startDrag(e, frame) {
    if (e.button !== 0) return;
    const v = findVisual(frame.dataset.id); if (!v) return;
    const isHandle = e.target.classList.contains("h");
    const interactive = e.target.closest("input,select,textarea,button,.ddmenu,.opt,.tog,th,.tile");
    selectVisual(v.id);
    if (interactive && !isHandle) return;
    if (!isHandle && e.target.closest(".vbody") && !e.altKey && v.type !== "textbox") {
      // allow interacting with the chart (cross-filter) — drag starts only after movement threshold
    }
    e.preventDefault();
    const dir = isHandle ? e.target.dataset.dir : null;
    const z = RT.zoom || 1; const sx = e.clientX, sy = e.clientY; const o = { x: v.x, y: v.y, w: v.w, h: v.h };
    let moved = false;
    const others = page().visuals.filter((x) => x.id !== v.id);
    const { w: PW, h: PH } = RT.pageSize();
    const snap = (val, cands) => { for (const c of cands) if (Math.abs(val - c) < 6) return [c, c]; return [Math.round(val / 4) * 4, null]; };
    const guides = [];
    const clearGuides = () => { guides.forEach((g) => g.remove()); guides.length = 0; };
    const guide = (x, y, horiz) => { const g = h("div", { class: "guide" }); Object.assign(g.style, horiz ? { left: "0px", top: y + "px", width: PW + "px", height: "1px" } : { left: x + "px", top: "0px", width: "1px", height: PH + "px" }); $("#canvas").appendChild(g); guides.push(g); };
    const xs = [0, PW].concat(...others.map((a) => [a.x, a.x + a.w])); const ys = [0, PH].concat(...others.map((a) => [a.y, a.y + a.h]));
    const onMove = (ev) => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved && !isHandle && e.target.closest(".vbody svg") && !moved) { /* dragging on a chart still moves the visual */ }
      moved = true; clearGuides();
      if (!dir) {
        let [nx, gx] = snap(o.x + dx, xs); let [nx2, gx2] = snap(o.x + dx + o.w, xs);
        let [ny, gy] = snap(o.y + dy, ys); let [ny2, gy2] = snap(o.y + dy + o.h, ys);
        v.x = gx2 != null && gx == null ? nx2 - o.w : nx; v.y = gy2 != null && gy == null ? ny2 - o.h : ny;
        if (gx != null) guide(gx, 0); else if (gx2 != null) guide(gx2, 0);
        if (gy != null) guide(0, gy, true); else if (gy2 != null) guide(0, gy2, true);
        v.x = Math.max(0, Math.min(PW - 20, v.x)); v.y = Math.max(0, Math.min(PH - 20, v.y));
      } else {
        if (dir.includes("e")) v.w = Math.max(60, snap(o.x + o.w + dx, xs)[0] - o.x);
        if (dir.includes("s")) v.h = Math.max(40, snap(o.y + o.h + dy, ys)[0] - o.y);
        if (dir.includes("w")) { const nx = Math.min(o.x + o.w - 60, snap(o.x + dx, xs)[0]); v.w = o.w + (o.x - nx); v.x = nx; }
        if (dir.includes("n")) { const ny = Math.min(o.y + o.h - 40, snap(o.y + dy, ys)[0]); v.h = o.h + (o.y - ny); v.y = ny; }
      }
      Object.assign(frame.style, { left: v.x + "px", top: v.y + "px", width: v.w + "px", height: v.h + "px" });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); clearGuides();
      if (moved) { if (dir) RT.renderVisual(v); commit({ render: false }); }
    };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }

  $("#canvas").addEventListener("pointerdown", (e) => { if (e.target.id === "canvas") { RT.clearSelection(); selectVisual(null); } });
  $("#canvas").addEventListener("dragover", (e) => e.preventDefault());
  $("#canvas").addEventListener("drop", (e) => {
    e.preventDefault(); const f = dragField(e); if (!f) return;
    const r = $("#canvas").getBoundingClientRect(); const z = RT.zoom || 1;
    const x = (e.clientX - r.left) / z, y = (e.clientY - r.top) / z;
    const v = newVisual(isMeasureLike(f) ? "card" : f.type === "date" ? "line" : "table", Math.max(0, x - 150), Math.max(0, y - 100));
    addFieldToVisual(v, f);
  });
  document.addEventListener("click", (e) => { $$(".ddmenu.open").forEach((m) => m.classList.remove("open")); if (!e.target.closest(".menu")) closeMenu(); });

  function newVisual(type, x, y) {
    const sizes = { card: [260, 120], slicer: [220, type === "slicer" ? 160 : 60], textbox: [420, 60], gauge: [320, 220], kpi: [280, 190], table: [480, 300], matrix: [520, 300], multiCard: [300, 200] };
    const [w, hh] = sizes[type] || [460, 300];
    const pos = x != null ? { x, y } : freeSpot(w, hh) || { x: 40, y: 40 };
    const v = { id: uid(), type, x: Math.round(pos.x), y: Math.round(pos.y), w, h: hh, title: "", fields: {}, format: {}, z: nextZ() };
    if (type === "textbox") v.format = { text: "Text", fontSize: 18, bold: true, background: "transparent" };
    page().visuals.push(v); S.selected = v.id; commit();
    return v;
  }
  function addVisual(type) { newVisual(type); }
  function nextZ() { return Math.max(0, ...page().visuals.map((v) => v.z || 0)) + 1; }
  function freeSpot(w, hh) {
    const { w: PW, h: PH } = RT.pageSize();
    for (let y = 16; y < PH - hh; y += 16) for (let x = 16; x < PW - w; x += 16) {
      if (!page().visuals.some((v) => x < v.x + v.w + 8 && x + w + 8 > v.x && y < v.y + v.h + 8 && y + hh + 8 > v.y)) return { x, y };
    }
    return null;
  }
  function duplicateVisual(v) { const c = clone(v); c.id = uid(); c.x += 24; c.y += 24; c.z = nextZ(); page().visuals.push(c); S.selected = c.id; commit(); }
  function deleteVisual(v) { const p = page(); p.visuals = p.visuals.filter((x) => x.id !== v.id); if (S.selected === v.id) S.selected = null; if (RT.selection && RT.selection.visualId === v.id) RT.selection = null; commit(); }

  function visualMenu(e, v) {
    showMenu(e, [
      ["Duplicate", () => duplicateVisual(v)], ["Copy  (Ctrl+C)", () => (S.clipboard = clone(v))],
      ["Focus mode", () => RT.focus(v)], ["Export data (CSV)", () => RT.exportData(v)],
      ["Show as table", () => showAsTable(v)], null,
      ["Bring to front", () => { v.z = nextZ(); commit(); }], ["Send to back", () => { v.z = Math.min(0, ...page().visuals.map((x) => x.z || 0)) - 1; commit(); }],
      [v.hidden ? "Show visual" : "Hide in viewer", () => { v.hidden = !v.hidden; commit(); }], null,
      ["Move to page ▸ " + S.report.pages.filter((p) => p !== page()).map((p) => p.name).slice(0, 1).join(""), () => movePage(v)],
      ["Delete", () => deleteVisual(v)],
    ]);
  }
  function movePage(v) {
    const others = S.report.pages.filter((p) => p !== page()); if (!others.length) return toast("Add another page first");
    showMenu({ clientX: 300, clientY: 200 }, others.map((p) => [p.name, () => { page().visuals = page().visuals.filter((x) => x !== v); p.visuals.push(v); commit(); }]));
  }
  function showAsTable(v) {
    const r = RT.results[v.id]; if (!r) return;
    const t = { type: "table", fields: { columns: [].concat(v.fields.category || [], v.fields.rows || [], v.fields.series || [], v.fields.values || [], v.fields.lineValues || [], v.fields.x || [], v.fields.y || []) }, format: {} };
    const res = E.query(RT.model, t, RT.filtersFor(v), S.report);
    const m = modal("Data behind: " + (v.title || V.TYPES[v.type].label), '<div class="vbody" style="height:60vh"></div>', [["Close"]], "wide");
    V.render($(".vbody", m), t, res, { width: 860, height: 500, theme: RT.theme });
  }

  // ================================================================ menus & modals
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function showMenu(e, items) {
    closeMenu();
    menuEl = h("div", { class: "menu" });
    for (const it of items) {
      if (!it) { menuEl.appendChild(h("div", { class: "sep" })); continue; }
      const d = h("div", { class: it[2] ? "on" : "" }, esc(it[0]));
      d.addEventListener("click", (ev) => { ev.stopPropagation(); closeMenu(); it[1](); });
      menuEl.appendChild(d);
    }
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.min(e.clientX, window.innerWidth - r.width - 6) + "px";
    menuEl.style.top = Math.min(e.clientY, window.innerHeight - r.height - 6) + "px";
    if (e.stopPropagation) e.stopPropagation();
  }

  function modal(title, body, buttons, size) {
    const bg = h("div", { class: "modal-bg" });
    const m = h("div", { class: "modal " + (size || "") });
    m.innerHTML = '<div class="mhd"><span>' + esc(title) + '</span><button class="x">✕</button></div><div class="mbd"></div><div class="mft"></div>';
    if (typeof body === "string") $(".mbd", m).innerHTML = body; else $(".mbd", m).appendChild(body);
    const close = () => bg.remove();
    m.close = close;
    $(".x", m).onclick = close;
    for (const [label, fn, cls] of buttons || []) {
      const b = h("button", { class: "btn " + (cls || "") }, esc(label));
      b.onclick = async () => { if (!fn) return close(); const keep = await fn(m); if (keep !== false) close(); };
      $(".mft", m).appendChild(b);
    }
    if (!buttons || !buttons.length) $(".mft", m).remove();
    bg.appendChild(m); document.body.appendChild(bg);
    bg.addEventListener("pointerdown", (e) => { if (e.target === bg) close(); });
    setTimeout(() => { const f = $("input,textarea,select", m); if (f) f.focus(); }, 30);
    return m;
  }

  /** small form builder → Promise<values|null> */
  function form(title, fields, okLabel) {
    return new Promise((resolve) => {
      let html = "";
      for (const f of fields) {
        const id = "f_" + f.key;
        if (f.type === "info") { html += '<p style="color:#605e5c">' + f.label + "</p>"; continue; }
        html += '<label class="f" for="' + id + '">' + esc(f.label) + "</label>";
        if (f.type === "select") html += '<select id="' + id + '">' + f.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(v) + '"' + (String(v) === String(f.value) ? " selected" : "") + ">" + esc(l) + "</option>"; }).join("") + "</select>";
        else if (f.type === "multi") html += '<select id="' + id + '" multiple size="' + Math.min(8, f.options.length) + '">' + f.options.map((o) => '<option value="' + esc(o) + '"' + ((f.value || []).includes(o) ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
        else if (f.type === "textarea") html += '<textarea id="' + id + '" class="code">' + esc(f.value || "") + "</textarea>";
        else if (f.type === "checkbox") html += '<input type="checkbox" id="' + id + '"' + (f.value ? " checked" : "") + ">";
        else html += '<input type="' + (f.type || "text") + '" id="' + id + '" value="' + esc(f.value ?? "") + '" placeholder="' + esc(f.placeholder || "") + '">';
        if (f.help) html += '<div style="font-size:11px;color:#8a8886;margin-top:2px">' + f.help + "</div>";
      }
      let done = false;
      const m = modal(title, html, [["Cancel", () => { done = true; resolve(null); }], [okLabel || "OK", (mm) => {
        const out = {};
        for (const f of fields) {
          if (f.type === "info") continue;
          const el = $("#f_" + f.key, mm);
          out[f.key] = f.type === "multi" ? Array.from(el.selectedOptions).map((o) => o.value) : f.type === "checkbox" ? el.checked : f.type === "number" ? (el.value === "" ? null : +el.value) : el.value;
        }
        done = true; resolve(out);
      }, "primary"]]);
      const obs = new MutationObserver(() => { if (!document.body.contains(m) && !done) { done = true; resolve(null); obs.disconnect(); } });
      obs.observe(document.body, { childList: true });
    });
  }

  // ================================================================ pages
  function renderPages() {
    const bar = $("#pagebar"); bar.innerHTML = "";
    S.report.pages.forEach((p, i) => {
      const b = h("button", { class: "ptab" + (i === RT.pageIndex ? " on" : "") }, esc(p.name) + (p.hidden ? " 👁‍🗨" : ""));
      b.onclick = () => { if (RT.pageIndex !== i) { RT.pageIndex = i; RT.selection = null; S.selected = null; RT.render(); fitZoom(); renderPages(); renderPanes(); } };
      b.ondblclick = () => renamePage(p, b);
      b.oncontextmenu = (e) => { e.preventDefault(); showMenu(e, [["Rename", () => renamePage(p, b)], ["Duplicate page", () => dupPage(p)], [p.hidden ? "Show page" : "Hide page in viewer", () => { p.hidden = !p.hidden; commit(); }], ["Page background…", () => pageBackground(p)], ["Page size…", () => pageSize(p)], null, ["Move left", () => movePageIdx(i, -1)], ["Move right", () => movePageIdx(i, 1)], null, ["Delete page", () => deletePage(i)]]); };
      bar.appendChild(b);
    });
    const add = h("button", { class: "add", title: "New page" }, "+"); add.onclick = addPage; bar.appendChild(add);
    const zoom = h("div", { class: "zoom" }, '<span>Zoom</span><button class="btn" style="padding:1px 8px" id="zfit">Fit</button><input type="range" min="30" max="200" id="zr"><span id="zoomLabel"></span>');
    bar.appendChild(zoom);
    $("#zr", zoom).value = Math.round((RT.zoom || 1) * 100);
    $("#zr", zoom).oninput = (e) => { S.zoom = e.target.value / 100; fitZoom(); };
    $("#zfit", zoom).onclick = () => { S.zoom = null; fitZoom(); $("#zr").value = Math.round(RT.zoom * 100); };
    fitZoom();
  }
  function addPage() { S.report.pages.push({ id: uid("p"), name: "Page " + (S.report.pages.length + 1), visuals: [], filters: [] }); RT.pageIndex = S.report.pages.length - 1; S.selected = null; commit(); }
  function dupPage(p) { const c = clone(p); c.id = uid("p"); c.name = p.name + " (copy)"; c.visuals.forEach((v) => (v.id = uid())); S.report.pages.splice(S.report.pages.indexOf(p) + 1, 0, c); RT.pageIndex = S.report.pages.indexOf(c); commit(); }
  function deletePage(i) { if (S.report.pages.length === 1) return toast("A report needs at least one page"); if (!confirm("Delete page '" + S.report.pages[i].name + "'?")) return; S.report.pages.splice(i, 1); RT.pageIndex = Math.max(0, Math.min(RT.pageIndex, S.report.pages.length - 1)); S.selected = null; commit(); }
  function movePageIdx(i, d) { const j = i + d; if (j < 0 || j >= S.report.pages.length) return; const p = S.report.pages.splice(i, 1)[0]; S.report.pages.splice(j, 0, p); RT.pageIndex = j; commit(); }
  function renamePage(p, b) {
    const inp = h("input", { value: p.name }); b.innerHTML = ""; b.appendChild(inp); inp.focus(); inp.select();
    const done = () => { p.name = inp.value.trim() || p.name; commit(); };
    inp.addEventListener("blur", done); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.value = p.name; inp.blur(); } });
  }
  async function pageBackground(p) { const r = await form("Page background", [{ key: "bg", label: "Background colour (blank = theme)", type: "color", value: p.background || RT.theme.page }, { key: "reset", label: "Use theme colour", type: "checkbox" }]); if (r) { p.background = r.reset ? null : r.bg; commit(); } }
  async function pageSize(p) {
    const r = await form("Page size", [{ key: "size", label: "Size", type: "select", value: (p.width || 1280) + "x" + (p.height || 720), options: [["1280x720", "16:9 (1280×720)"], ["1280x960", "4:3 (1280×960)"], ["1280x1800", "Tall / scrolling (1280×1800)"], ["816x1056", "Letter (816×1056)"], ["720x1280", "Mobile (720×1280)"]] }]);
    if (r) { const [w, hh] = r.size.split("x").map(Number); p.width = w; p.height = hh; commit(); fitZoom(); }
  }

  // ================================================================ panes
  function renderPanes() {
    if (S.view === "report") { renderFiltersPane(); renderVizPane(); }
    renderDataPane();
  }
  function paneHead(id, title, sub) {
    const el = $("#" + id); el.classList.toggle("collapsed", !!S.collapsed[id]);
    el.innerHTML = '<div class="phead"><span>' + title + (sub ? " <small>" + sub + "</small>" : "") + "</span><span>" + (S.collapsed[id] ? "»" : "«") + "</span></div>";
    $(".phead", el).onclick = () => { S.collapsed[id] = !S.collapsed[id]; renderPanes(); fitZoom(); };
    const body = h("div", { class: "pbody" }); el.appendChild(body);
    return body;
  }

  // ---------------- fields pane
  const typeIcon = (t) => ({ number: "Σ", date: "📅", bool: "◐", text: "Aa" }[t] || "Aa");
  function usedKeys(v) {
    const s = new Set(); if (!v) return s;
    for (const k in v.fields || {}) for (const f of v.fields[k] || []) s.add(f.measure ? "m:" + f.measure : f.table + "[" + f.column + "]");
    return s;
  }
  function renderDataPane() {
    const body = paneHead("dataPane", "Data", "");
    if (S.collapsed.dataPane) return;
    const used = usedKeys(selVisual());
    const q = S.fieldSearch.toLowerCase();
    const search = h("input", { class: "search", placeholder: "Search fields", value: S.fieldSearch });
    search.oninput = () => { S.fieldSearch = search.value; renderDataPane(); const s = $("#dataPane .search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); };
    const wrap = h("div", { class: "fields" }); wrap.appendChild(search); body.appendChild(wrap);
    const names = Object.keys(RT.model.tables);
    if (!names.length) wrap.appendChild(h("div", { class: "empty", style: "height:auto;padding:20px 6px" }, 'No data yet.<br><button class="btn primary" style="margin-top:8px">Get data</button>'));
    const gb = $(".empty button", wrap); if (gb) gb.onclick = openGetData;
    for (const t of names) {
      const T = RT.model.tables[t];
      const ms = S.report.measures.filter((m) => (m.table || names[0]) === t);
      const hidden = new Set(S.report.hiddenFields || []);
      const cols = T.columns.filter((c) => S.view !== "report" || !hidden.has(t + "[" + c.name + "]"));
      const items = ms.map((m) => ({ kind: "measure", name: m.name, m })).concat(cols.map((c) => ({ kind: "column", name: c.name, c })))
        .filter((it) => !q || it.name.toLowerCase().includes(q) || t.toLowerCase().includes(q));
      if (q && !items.length) continue;
      const open = S.openTables[t] !== false && (S.openTables[t] || q || names.length <= 6);
      const box = h("div", { class: "ftable" });
      const tn = h("div", { class: "tn" }, '<span class="car">' + (open ? "▼" : "▶") + '</span><span>⊞ ' + esc(t) + '</span><button class="tmenu" title="Table options">⋯</button>');
      tn.onclick = (e) => { if (e.target.classList.contains("tmenu")) return tableMenu(e, t); S.openTables[t] = !open; renderDataPane(); };
      box.appendChild(tn);
      if (open) for (const it of items) {
        const key = it.kind === "measure" ? "m:" + it.name : t + "[" + it.name + "]";
        const isCalc = it.c && it.c.calc;
        const row = h("div", { class: "fitem" + (used.has(key) ? " used" : ""), draggable: "true", title: it.kind === "measure" ? it.m.expression : t + "[" + it.name + "] · " + (it.c.type) + (isCalc ? " · calculated" : "") }, (S.view === "report" ? '<input type="checkbox"' + (used.has(key) ? " checked" : "") + ">" : "") + '<span class="ty' + (it.kind === "measure" ? " m" : "") + '">' + (it.kind === "measure" ? "ƒx" : isCalc ? "ƒ" + typeIcon(it.c.type).slice(0, 1) : typeIcon(it.c.type)) + '</span><span class="nm">' + esc(it.name) + '</span><button class="more">⋯</button>');
        const payload = it.kind === "measure" ? { kind: "measure", measure: it.name } : { kind: "column", table: t, column: it.name, type: it.c.type };
        row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-pybi-field", JSON.stringify(payload)); e.dataTransfer.effectAllowed = "copy"; });
        const cb = $("input", row);
        if (cb) cb.addEventListener("change", () => {
          const v = selVisual();
          if (cb.checked) { if (v) addFieldToVisual(v, payload); else { const nv = newVisual(isMeasureLike(payload) ? "card" : payload.type === "date" ? "line" : payload.type === "number" ? "card" : "table"); addFieldToVisual(nv, payload); } }
          else if (v) { removeFieldEverywhere(v, payload); }
        });
        $(".more", row).onclick = (e) => { e.stopPropagation(); fieldMenu(e, t, it); };
        row.addEventListener("dblclick", () => it.kind === "measure" && openMeasureEditor(it.m));
        box.appendChild(row);
      }
      wrap.appendChild(box);
    }
  }
  function tableMenu(e, t) {
    showMenu(e, [["New measure", () => openMeasureEditor(null, t)], ["New column", () => openColumnEditor(null, t)], ["Edit query", () => openQueryEditor(t)], ["Refresh data", () => refreshTable(t)], ["View data", () => { S.dataTable = t; setView("data"); }], ["Download CSV", () => (location.href = "/api/table/" + encodeURIComponent(t) + ".csv")], null, ["Rename table", () => renameTable(t)], ["Delete table", () => deleteTable(t)]]);
  }
  function fieldMenu(e, t, it) {
    if (it.kind === "measure") return showMenu(e, [["Edit measure", () => openMeasureEditor(it.m)], ["Duplicate", () => { const m = clone(it.m); m.name = uniqueMeasure(m.name + " copy"); S.report.measures.push(m); commit({ model: true }); }], ["Delete measure", () => { if (confirm("Delete measure [" + it.name + "]?")) { S.report.measures = S.report.measures.filter((m) => m !== it.m); commit({ model: true }); } }]]);
    const key = t + "[" + it.name + "]"; const props = S.report.columnProps[key] || {};
    const hidden = (S.report.hiddenFields || []).includes(key);
    const items = [
      ["Quick measure: Sum", () => quickMeasure(t, it.name, "SUM")], ["Quick measure: Average", () => quickMeasure(t, it.name, "AVERAGE")], ["Quick measure: Distinct count", () => quickMeasure(t, it.name, "DISTINCTCOUNT")], null,
      ["Format…", () => columnFormat(t, it.name)], ["Sort by column…", () => sortByColumn(t, it.name)], [hidden ? "Unhide" : "Hide in report view", () => { const hf = new Set(S.report.hiddenFields || []); hidden ? hf.delete(key) : hf.add(key); S.report.hiddenFields = Array.from(hf); commit(); }],
    ];
    if (it.c.calc) items.push(null, ["Edit column", () => openColumnEditor(S.report.calcColumns.find((c) => c.table === t && c.name === it.name))], ["Delete column", () => { S.report.calcColumns = S.report.calcColumns.filter((c) => !(c.table === t && c.name === it.name)); commit({ model: true }); }]);
    if (props.sortBy) items.push(["Clear sort-by (" + props.sortBy + ")", () => { delete props.sortBy; commit({ model: true }); }]);
    showMenu(e, items);
  }
  function uniqueMeasure(n) { let name = n, i = 2; while (S.report.measures.some((m) => m.name === name) || allColumnsNamed(name)) name = n + " " + i++; return name; }
  function allColumnsNamed() { return false; }
  function quickMeasure(t, c, fn) {
    const label = { SUM: "Total", AVERAGE: "Average", DISTINCTCOUNT: "Distinct" }[fn] + " " + c;
    const q = t.match(/^[A-Za-z_][A-Za-z0-9_]*$/) ? t : "'" + t + "'";
    S.report.measures.push({ name: uniqueMeasure(label), expression: fn + "(" + q + "[" + c + "])", table: t, format: fn === "DISTINCTCOUNT" ? { type: "whole" } : {} });
    commit({ model: true }); toast("Measure [" + label + "] created");
  }
  async function columnFormat(t, c) {
    const key = t + "[" + c + "]"; const props = S.report.columnProps[key] = S.report.columnProps[key] || {}; const f = props.format || {};
    const r = await form("Format " + c, [{ key: "type", label: "Format", type: "select", value: f.type || "auto", options: [["auto", "Auto"], ["whole", "Whole number"], ["decimal", "Decimal"], ["currency", "Currency"], ["percent", "Percentage"]] }, { key: "decimals", label: "Decimal places", type: "number", value: f.decimals ?? "" }, { key: "symbol", label: "Currency symbol", value: f.symbol || "$" }]);
    if (r) { props.format = { type: r.type, symbol: r.symbol }; if (r.decimals != null) props.format.decimals = r.decimals; commit({ model: true }); }
  }
  async function sortByColumn(t, c) {
    const cols = RT.model.tables[t].columns.map((x) => x.name).filter((x) => x !== c);
    const r = await form("Sort '" + c + "' by column", [{ key: "by", label: "Sort by", type: "select", options: [["", "(none)"]].concat(cols.map((x) => [x, x])), value: (S.report.columnProps[t + "[" + c + "]"] || {}).sortBy || "" }]);
    if (r) { const k = t + "[" + c + "]"; S.report.columnProps[k] = S.report.columnProps[k] || {}; if (r.by) S.report.columnProps[k].sortBy = r.by; else delete S.report.columnProps[k].sortBy; commit({ model: true }); }
  }

  // ---------------- field ↔ visual
  function dragField(e) { try { return JSON.parse(e.dataTransfer.getData("application/x-pybi-field")); } catch (er) { return null; } }
  const isMeasureLike = (f) => f.kind === "measure";
  const keyLike = (name) => /(^id$|id$|_id|key$|code$|number$|^year$|zip|phone)/i.test(name) && !/paid|valid|bid/i.test(name);
  function toRef(f, role) {
    if (f.kind === "measure") return { measure: f.measure };
    const ref = { table: f.table, column: f.column };
    const accepts = role[3];
    if (accepts === "value") ref.agg = f.type === "number" && !keyLike(f.column) ? "sum" : f.type === "number" ? "count" : "count";
    if (accepts === "any" && f.type === "number" && !keyLike(f.column)) ref.agg = "sum";
    return ref;
  }
  function roleFor(v, f) {
    const meta = V.TYPES[v.type]; if (!meta) return null;
    const value = isMeasureLike(f) || (f.type === "number" && !keyLike(f.column));
    const roles = meta.roles;
    const has = (r) => (v.fields[r[0]] || []).length;
    const pick = (pred) => roles.find((r) => pred(r) && has(r) < r[2]);
    if (value) return pick((r) => r[3] === "value") || pick((r) => r[3] === "any") || pick((r) => r[3] === "dim");
    return pick((r) => r[3] === "dim") || pick((r) => r[3] === "any") || pick((r) => r[3] === "value");
  }
  function addFieldToVisual(v, f, roleKey) {
    if (!v) return;
    if (v.type === "card" && !isMeasureLike(f) && f.type !== "number" && !roleKey) { v.type = "clusteredColumn"; }
    if (v.type === "textbox") { v.type = isMeasureLike(f) ? "card" : "table"; }
    const meta = V.TYPES[v.type];
    const role = roleKey ? meta.roles.find((r) => r[0] === roleKey) : roleFor(v, f);
    if (!role) return toast("This visual has no free field well for that field");
    v.fields[role[0]] = v.fields[role[0]] || [];
    const ref = toRef(f, role);
    if (role[3] === "dim" && f.type === "date" && !["slicer", "table", "matrix"].includes(v.type)) ref.level = "yearMonth";
    if (v.fields[role[0]].length >= role[2]) v.fields[role[0]].splice(role[2] - 1, 1);
    v.fields[role[0]].push(ref);
    if (!v.title && v.type !== "card" && v.type !== "slicer" && v.type !== "textbox") v.title = autoTitle(v);
    if (v.type === "slicer" && !v.title) v.title = E.fieldLabel(ref);
    if (v.type === "slicer" && f.type === "date") v.format = Object.assign({}, v.format, { style: "between" });
    S.selected = v.id; commit();
  }
  function removeFieldEverywhere(v, f) {
    for (const k in v.fields) v.fields[k] = (v.fields[k] || []).filter((x) => !(f.kind === "measure" ? x.measure === f.measure : x.table === f.table && x.column === f.column));
    commit();
  }
  function autoTitle(v) {
    const F = v.fields; const vals = (F.values || F.columns || F.x || []).filter(Boolean).map(E.fieldLabel);
    const by = (F.category || F.rows || []).filter(Boolean).map(E.fieldLabel);
    const lg = (F.series || []).filter(Boolean).map(E.fieldLabel);
    if (v.type === "table") return "";
    return (vals.join(" and ") || "") + (by.length ? " by " + by.join(", ") : "") + (lg.length ? " and " + lg.join(", ") : "");
  }

  // ---------------- visualizations pane
  function renderVizPane() {
    const body = paneHead("vizPane", "Visualizations");
    if (S.collapsed.vizPane) return;
    const v = selVisual();
    const grid = h("div", { class: "vgrid" });
    for (const [t, meta] of Object.entries(V.TYPES)) {
      const b = h("button", { class: v && v.type === t ? "on" : "", title: meta.label }, V.icon(t));
      b.onclick = () => { if (v) convertVisual(v, t); else newVisual(t); };
      grid.appendChild(b);
    }
    body.appendChild(grid);
    if (!v) { body.appendChild(h("div", { class: "empty", style: "height:auto;padding:16px 4px" }, "Select a visual on the canvas to edit its fields and format, or click a visual type to add one.<br><br>Tip: drag a field from the Data pane straight onto the canvas.")); return; }
    const tabs = h("div", { class: "tabs" }, '<button data-t="build">Build</button><button data-t="format">Format</button><button data-t="analytics">General</button>');
    $$("button", tabs).forEach((b) => { b.classList.toggle("on", b.dataset.t === S.vizTab); b.onclick = () => { S.vizTab = b.dataset.t; renderVizPane(); }; });
    body.appendChild(tabs);
    if (S.vizTab === "build") buildWells(body, v);
    else if (S.vizTab === "format") buildFormat(body, v);
    else buildGeneral(body, v);
  }
  function convertVisual(v, t) {
    const all = [].concat(...Object.values(v.fields || {}).map((x) => x || []));
    const oldType = v.type; v.type = t; v.fields = {};
    const meta = V.TYPES[t];
    for (const ref of all) {
      const isVal = E.isValueField(ref);
      const role = meta.roles.find((r) => (isVal ? r[3] === "value" || r[3] === "any" : r[3] === "dim" || r[3] === "any") && (v.fields[r[0]] || []).length < r[2]);
      if (role) { v.fields[role[0]] = v.fields[role[0]] || []; v.fields[role[0]].push(ref); }
    }
    if (t === "textbox") v.format = Object.assign({ text: "Text", fontSize: 18 }, v.format);
    if (oldType === "textbox") v.format = {};
    commit();
  }
  function buildWells(body, v) {
    const meta = V.TYPES[v.type];
    if (!meta.roles.length) { body.appendChild(h("div", { class: "empty", style: "height:auto" }, "This visual has no data fields. Use the Format tab.")); return; }
    for (const role of meta.roles) {
      const [key, label, max] = role;
      const well = h("div", { class: "well" }, '<div class="wl">' + esc(label) + (max > 1 ? ' <small style="color:#a19f9d">(up to ' + max + ")</small>" : "") + '</div><div class="zone"></div>');
      const zone = $(".zone", well);
      const list = v.fields[key] || [];
      if (!list.length) zone.appendChild(h("div", { class: "ph" }, "Add data fields here"));
      list.forEach((ref, i) => {
        const chip = h("div", { class: "chip", draggable: "true" }, '<span class="nm" title="' + esc(ref.measure ? "[" + ref.measure + "]" : ref.table + "[" + ref.column + "]") + '">' + esc(E.fieldLabel(ref)) + '</span><button class="opt" title="Options">▾</button><button class="rm" title="Remove">✕</button>');
        $(".rm", chip).onclick = () => { list.splice(i, 1); commit(); };
        $(".opt", chip).onclick = (e) => chipMenu(e, v, key, i);
        chip.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-pybi-chip", JSON.stringify({ key, i })); });
        zone.appendChild(chip);
      });
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("over"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault(); zone.classList.remove("over");
        const chipData = e.dataTransfer.getData("application/x-pybi-chip");
        if (chipData) { const c = JSON.parse(chipData); const ref = v.fields[c.key].splice(c.i, 1)[0]; v.fields[key] = v.fields[key] || []; if (v.fields[key].length >= max) v.fields[key].pop(); v.fields[key].push(ref); return commit(); }
        const f = dragField(e); if (f) addFieldToVisual(v, f, key);
      });
      body.appendChild(well);
    }
    // drill / date level helper text
    body.appendChild(h("div", { style: "font-size:11px;color:#8a8886" }, "Tip: use ▾ on a field to change aggregation, date level (Year / Quarter / Month) or rename it for this visual."));
  }
  function chipMenu(e, v, key, i) {
    const ref = v.fields[key][i]; const items = [];
    if (!ref.measure) {
      const typ = RT.model.colType(ref.table, ref.column);
      const aggs = typ === "number" ? [["sum", "Sum"], ["avg", "Average"], ["min", "Minimum"], ["max", "Maximum"], ["median", "Median"], ["count", "Count"], ["distinct", "Count (Distinct)"]] : [["count", "Count"], ["distinct", "Count (Distinct)"], ["min", "First"], ["max", "Last"]];
      items.push([ref.agg ? "Don't summarize" : "Summarize (Sum/Count)", () => { if (ref.agg) delete ref.agg; else ref.agg = typ === "number" ? "sum" : "count"; commit(); }, !ref.agg]);
      for (const [a, l] of aggs) items.push([l, () => { ref.agg = a; commit(); }, ref.agg === a]);
      if (typ === "date") { items.push(null); for (const [lv, l] of [[null, "Date (no hierarchy)"], ["year", "Year"], ["yearQuarter", "Year-Quarter"], ["quarter", "Quarter"], ["yearMonth", "Year-Month"], ["month", "Month"], ["weekday", "Weekday"], ["day", "Day"]]) items.push([l, () => { if (lv) ref.level = lv; else delete ref.level; commit(); }, (ref.level || null) === lv]); }
    }
    items.push(null, ["Rename for this visual…", async () => { const r = await form("Rename field", [{ key: "label", label: "Display name", value: E.fieldLabel(ref) }]); if (r) { if (r.label) ref.label = r.label; else delete ref.label; commit(); } }]);
    if (ref.measure) items.push(["Edit measure", () => openMeasureEditor(S.report.measures.find((m) => m.name === ref.measure))]);
    items.push(["Move up", () => { if (i > 0) { const a = v.fields[key]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; commit(); } }], ["Remove", () => { v.fields[key].splice(i, 1); commit(); }]);
    showMenu(e, items);
  }

  function buildGeneral(body, v) {
    const rows = [["X", "x"], ["Y", "y"], ["Width", "w"], ["Height", "h"]];
    let html = '<div class="psec"><div class="t">Position & size</div>' + rows.map(([l, k]) => '<div class="frow"><label>' + l + '</label><input type="number" data-k="' + k + '" value="' + Math.round(v[k]) + '"></div>').join("") + "</div>";
    html += '<div class="psec"><div class="t">Interactions</div><div class="frow"><label>Ignore cross-filtering from other visuals</label><input type="checkbox" class="toggle" data-f="ignoreCrossFilter"' + ((v.format || {}).ignoreCrossFilter ? " checked" : "") + "></div>";
    if (v.type === "slicer") html += '<div class="frow"><label>Sync across all pages</label><input type="checkbox" class="toggle" data-f="sync"' + ((v.format || {}).sync ? " checked" : "") + "></div>";
    html += '<div class="frow"><label>Hide in viewer</label><input type="checkbox" class="toggle" data-hid="1"' + (v.hidden ? " checked" : "") + "></div></div>";
    html += '<div class="psec"><div class="t">Align</div><div style="display:flex;gap:4px;flex-wrap:wrap">' + [["⇤", "left"], ["⇥", "right"], ["⤒", "top"], ["⤓", "bottom"], ["⇹", "hcenter"], ["⇕", "vcenter"]].map(([ic, a]) => '<button class="btn" style="padding:3px 8px" data-al="' + a + '" title="Align ' + a + ' on page">' + ic + "</button>").join("") + "</div></div>";
    html += '<div class="psec"><div class="t">Visual ID</div><code style="font-size:11px">' + v.id + "</code></div>";
    const d = h("div", null, html); body.appendChild(d);
    $$("input[data-k]", d).forEach((inp) => inp.addEventListener("change", () => { v[inp.dataset.k] = Math.max(0, +inp.value); commit(); }));
    $$("input[data-f]", d).forEach((inp) => inp.addEventListener("change", () => { v.format = Object.assign({}, v.format, { [inp.dataset.f]: inp.checked }); commit(); }));
    $$("input[data-hid]", d).forEach((inp) => inp.addEventListener("change", () => { v.hidden = inp.checked; commit(); }));
    $$("button[data-al]", d).forEach((b) => b.addEventListener("click", () => {
      const { w, h: ph } = RT.pageSize(); const a = b.dataset.al;
      if (a === "left") v.x = 0; if (a === "right") v.x = w - v.w; if (a === "top") v.y = 0; if (a === "bottom") v.y = ph - v.h;
      if (a === "hcenter") v.x = Math.round((w - v.w) / 2); if (a === "vcenter") v.y = Math.round((ph - v.h) / 2); commit();
    }));
  }

  function formatSpec(v) {
    const t = v.type; const f = v.format || {};
    const chart = ["clusteredColumn", "stackedColumn", "percentColumn", "clusteredBar", "stackedBar", "line", "area", "stackedArea", "lineColumn", "ribbon"].includes(t);
    const S1 = [];
    S1.push({ title: "Title", rows: [["Title text", "@title", "text"], ["Show title", "showTitle", "toggle", true], ["Font size", "titleSize", "number", 13], ["Colour", "titleColor", "color", RT.theme.text], ["Alignment", "titleAlign", "select", "left", ["left", "center", "right"]]] });
    if (chart) S1.push({ title: "Chart", rows: [["Legend", "legend", "toggle", true], ["Data labels", "dataLabels", "toggle", false], ["Gridlines", "gridlines", "toggle", true], ["Axis titles", "axisTitles", "toggle", true], ["Rounded bars", "rounded", "toggle", true],
      ["Sort", "sort", "select", "", [["", "Auto"], ["value-desc", "Value ↓"], ["value-asc", "Value ↑"], ["category-asc", "Category A→Z"], ["category-desc", "Category Z→A"]]], ["Top N (0 = all)", "topN", "number", 0]].concat(["line", "area", "stackedArea"].includes(t) ? [["Smooth lines", "smooth", "toggle", true], ["Markers", "markers", "toggle", true], ["Line width", "lineWidth", "number", 2.4]] : []) });
    if (["pie", "donut"].includes(t)) S1.push({ title: "Chart", rows: [["Legend", "legend", "toggle", true], ["Data labels", "dataLabels", "toggle", true], ["Inner radius (donut)", "innerRadius", "number", 0.58], ["Sort", "sort", "select", "", [["", "Auto"], ["value-desc", "Value ↓"], ["category-asc", "Category A→Z"]]], ["Top N (0 = all)", "topN", "number", 0]] });
    if (["treemap", "funnel", "waterfall"].includes(t)) S1.push({ title: "Chart", rows: [["Sort", "sort", "select", "", [["", "Auto"], ["value-desc", "Value ↓"], ["value-asc", "Value ↑"], ["category-asc", "Category A→Z"]]], ["Top N (0 = all)", "topN", "number", 0]].concat(t === "waterfall" ? [["Increase colour", "upColor", "color", "#1AAB40"], ["Decrease colour", "downColor", "color", "#D64550"], ["Total colour", "totalColor", "color", RT.theme.palette[0]]] : t === "funnel" ? [["Bar colour", "color", "color", RT.theme.palette[0]]] : []) });
    if (t === "scatter") S1.push({ title: "Chart", rows: [["Legend", "legend", "toggle", true], ["Point labels", "dataLabels", "toggle", true]] });
    if (t === "card") S1.push({ title: "Callout value", rows: [["Font size (0 = auto)", "fontSize", "number", 0], ["Colour", "color", "color", RT.theme.text], ["Compact (K/M)", "compact", "toggle", true], ["Category label", "showLabel", "toggle", true], ["Accent bar", "accent", "toggle", true], ["Accent colour", "accentColor", "color", RT.theme.accent]] });
    if (t === "gauge") S1.push({ title: "Gauge axis", rows: [["Minimum", "min", "number", 0], ["Maximum (blank = auto)", "max", "number", ""], ["Fill colour", "color", "color", RT.theme.palette[0]]] });
    if (t === "kpi") S1.push({ title: "KPI", rows: [["Lower is better", "lowerIsBetter", "toggle", false]] });
    if (t === "table" || t === "matrix") S1.push({ title: "Grid", rows: [["Font size", "fontSize", "number", 12], ["Totals", "totals", "toggle", true], ["Zebra rows", "zebra", "toggle", true]].concat(t === "table" ? [["Data bars on measures", "dataBars", "toggle", false], ["Top N rows (0 = all)", "topN", "number", 0]] : [["Expand all rows", "expandAll", "toggle", false]]) });
    if (t === "slicer") S1.push({ title: "Slicer", rows: [["Style", "style", "select", "list", [["list", "Vertical list"], ["dropdown", "Dropdown"], ["tiles", "Tiles / buttons"], ["between", "Between (range)"]]], ["Single select", "single", "toggle", false], ["Multi-select tiles without Ctrl", "multi", "toggle", false]] });
    if (t === "textbox") S1.push({ title: "Text", rows: [["Text (use **bold**)", "text", "textarea", ""], ["Font size", "fontSize", "number", 16], ["Bold", "bold", "toggle", false], ["Italic", "italic", "toggle", false], ["Colour", "color", "color", RT.theme.text], ["Alignment", "align", "select", "left", ["left", "center", "right"]]] });
    if (chart || ["pie", "donut", "treemap", "scatter"].includes(t)) {
      const r = RT.results[v.id]; const names = r && r.series ? r.series.concat(r.lines || []).map((s) => s.name) : r && r.categories && ["pie", "donut", "treemap"].includes(t) ? r.categories.map(String) : [];
      if (["pie", "donut", "treemap"].includes(t) && r && r.categories) names.splice(0, names.length, ...r.categories.map((c) => E.fmtValue(c)));
      S1.push({ title: "Colours", rows: names.slice(0, 12).map((n, i) => [n, "colors." + i, "color", RT.theme.palette[i % RT.theme.palette.length]]).concat([["Reset colours", "colors", "reset"]]) });
    }
    S1.push({ title: "Visual background & border", rows: [["Background", "background", "color", RT.theme.card], ["Transparent background", "background:transparent", "toggle", f.background === "transparent"], ["Border", "border", "toggle", false], ["Border colour", "borderColor", "color", RT.theme.grid], ["Corner radius", "radius", "number", 6], ["Shadow", "shadow", "toggle", true]] });
    return S1;
  }
  function buildFormat(body, v) {
    v.format = v.format || {};
    const f = v.format;
    formatSpec(v).forEach((sec, si) => {
      const det = h("details", { class: "fsec" }); if (si < 2) det.open = true;
      det.innerHTML = "<summary>" + esc(sec.title) + "</summary>";
      for (const [label, key, type, def, opts] of sec.rows) {
        const row = h("div", { class: "frow" + (type === "textarea" ? " block" : "") });
        const get = () => { if (key === "@title") return v.title || ""; if (key.startsWith("colors.")) return (f.colors || [])[+key.split(".")[1]] ?? def; if (key === "background:transparent") return f.background === "transparent"; return f[key] ?? def; };
        const set = (val) => {
          if (key === "@title") v.title = val;
          else if (key.startsWith("colors.")) { f.colors = f.colors || []; f.colors[+key.split(".")[1]] = val; }
          else if (key === "background:transparent") { if (val) f.background = "transparent"; else delete f.background; }
          else if (val === "" || val === null) delete f[key]; else f[key] = val;
          commit({ render: false }); RT.renderVisual(v);
          if (RT.frames[v.id]) RT.frames[v.id].classList.add("sel");
        };
        let ctl;
        if (type === "toggle") { ctl = h("input", { type: "checkbox", class: "toggle" }); ctl.checked = !!get(); ctl.onchange = () => set(ctl.checked); }
        else if (type === "select") { ctl = h("select"); ctl.innerHTML = opts.map((o) => { const [a, b] = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(a) + '"' + (String(get()) === String(a) ? " selected" : "") + ">" + esc(b) + "</option>"; }).join(""); ctl.onchange = () => set(ctl.value); }
        else if (type === "color") { ctl = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(get()) ? get() : "#118dff" }); ctl.oninput = () => set(ctl.value); }
        else if (type === "number") { ctl = h("input", { type: "number", value: get() ?? "", step: "any" }); ctl.onchange = () => set(ctl.value === "" ? null : +ctl.value || (ctl.value === "0" ? 0 : null)); }
        else if (type === "textarea") { ctl = h("textarea"); ctl.value = get(); ctl.oninput = () => { f.text = ctl.value; RT.renderVisual(v); RT.frames[v.id].classList.add("sel"); }; ctl.onchange = () => commit({ render: false }); }
        else if (type === "reset") { ctl = h("button", { class: "btn", style: "padding:2px 8px" }, "Reset"); ctl.onclick = () => { delete f.colors; delete f.color; commit(); }; }
        else { ctl = h("input", { type: "text", value: get() }); ctl.onchange = () => set(ctl.value); }
        row.appendChild(h("label", null, esc(label))); row.appendChild(ctl); det.appendChild(row);
      }
      body.appendChild(det);
    });
  }

  // ---------------- filters pane
  function renderFiltersPane() {
    const body = paneHead("filtersPane", "Filters");
    if (S.collapsed.filtersPane) return;
    const v = selVisual();
    const section = (title, list, onChange, defaults) => {
      const sec = h("div", { class: "psec" }, '<div class="t">' + esc(title) + "</div>");
      (defaults || []).forEach((ref) => {
        if (list.some((x) => x.field.table === ref.table && x.field.column === ref.column)) return;
        sec.appendChild(h("div", { class: "fdrop", style: "text-align:left;border-style:solid;background:#faf9f8" }, esc(E.fieldLabel(Object.assign({}, ref, { agg: null }))) + ' <small style="color:#a19f9d">is (All)</small>'));
      });
      list.forEach((spec, i) => sec.appendChild(filterCard(spec, () => { list.splice(i, 1); onChange(); }, onChange)));
      const drop = h("div", { class: "fdrop" }, "Drag fields here");
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); const f = dragField(e); if (f && f.kind === "column") { list.push({ field: { table: f.table, column: f.column }, mode: "basic", values: [] }); onChange(); } else if (f) toast("Filters work on columns (use a measure in a visual-level Top N instead)"); });
      sec.appendChild(drop);
      const add = h("select", { class: "fadd" }, '<option value="">+ Add filter…</option>' + Object.values(RT.model.tables).map((T) => '<optgroup label="' + esc(T.name) + '">' + T.columns.map((c) => '<option value="' + esc(JSON.stringify([T.name, c.name])) + '">' + esc(c.name) + "</option>").join("") + "</optgroup>").join(""));
      add.onchange = () => { if (!add.value) return; const [t, c] = JSON.parse(add.value); list.push({ field: { table: t, column: c }, mode: "basic", values: [] }); onChange(); };
      sec.appendChild(add);
      return sec;
    };
    if (v && v.type !== "textbox") {
      v.filters = v.filters || [];
      const defaults = [].concat(...Object.values(v.fields || {}).map((x) => x || [])).filter((r) => r.table);
      body.appendChild(section("Filters on this visual", v.filters, () => commit(), defaults));
    }
    page().filters = page().filters || [];
    body.appendChild(section("Filters on this page", page().filters, () => commit()));
    body.appendChild(section("Filters on all pages", S.report.reportFilters, () => commit()));
  }
  function filterCard(spec, onRemove, onChange) {
    const card = h("div", { class: "fcard" });
    const label = E.fieldLabel(spec.field);
    const summary = spec.mode === "advanced" ? (spec.op ? spec.op + " " + (spec.value ?? "") + (spec.op2 ? " " + (spec.join || "and") + " " + spec.op2 + " " + (spec.value2 ?? "") : "") : "(All)") : spec.mode === "range" ? (spec.min ?? "…") + " – " + (spec.max ?? "…") : spec.values && spec.values.length ? (spec.invert ? "not " : "") + spec.values.slice(0, 3).map((x) => E.fmtValue(x)).join(", ") + (spec.values.length > 3 ? " +" + (spec.values.length - 3) : "") : "is (All)";
    card.innerHTML = '<div class="fh"><div><b>' + esc(label) + "</b><small>" + esc(summary) + '</small></div><div><button class="clr" title="Clear">⌫</button><button class="rm" title="Remove">✕</button></div></div>';
    const fb = h("div", { class: "fb" + (spec._open ? "" : " hidden") });
    card.appendChild(fb);
    $(".fh", card).onclick = (e) => { if (e.target.closest("button")) return; spec._open = !spec._open; fb.classList.toggle("hidden"); };
    $(".rm", card).onclick = onRemove;
    $(".clr", card).onclick = () => { spec.values = []; spec.op = ""; spec.min = spec.max = null; onChange(); };
    let vals = [];
    try { vals = RT.model.sortValues(spec.field.table, spec.field.column, spec.field.level, RT.model.distinct(spec.field.table, spec.field.column, spec.field.level, [])); } catch (e) { vals = []; }
    const isNum = RT.model.colType(spec.field.table, spec.field.column) !== "text";
    fb.innerHTML = '<select class="mode"><option value="basic">Basic filtering</option><option value="advanced">Advanced filtering</option>' + (isNum ? '<option value="range">Range (between)</option>' : "") + "</select><div class='fbody'></div>";
    $(".mode", fb).value = spec.mode || "basic";
    $(".mode", fb).onchange = (e) => { spec.mode = e.target.value; spec._open = true; onChange(); };
    const fbody = $(".fbody", fb);
    if (spec.mode === "advanced") {
      const ops = ["", "=", "!=", ">", ">=", "<", "<=", "contains", "not contains", "starts with", "is blank", "is not blank"];
      const opSel = (k) => '<select data-k="' + k + '">' + ops.map((o) => '<option' + (spec[k] === o ? " selected" : "") + ' value="' + o + '">' + (o || "Show items when the value…") + "</option>").join("") + "</select>";
      fbody.innerHTML = opSel("op") + '<input type="text" data-k="value" value="' + esc(spec.value ?? "") + '"><select data-k="join"><option value="and">And</option><option value="or"' + (spec.join === "or" ? " selected" : "") + ">Or</option></select>" + opSel("op2") + '<input type="text" data-k="value2" value="' + esc(spec.value2 ?? "") + '"><button class="btn primary" style="width:100%;margin-top:4px">Apply filter</button>';
      $("button", fbody).onclick = () => { $$("[data-k]", fbody).forEach((el) => (spec[el.dataset.k] = el.value)); onChange(); };
    } else if (spec.mode === "range") {
      fbody.innerHTML = '<input type="text" data-k="min" placeholder="From" value="' + esc(spec.min ?? "") + '"><input type="text" data-k="max" placeholder="To" value="' + esc(spec.max ?? "") + '"><button class="btn primary" style="width:100%;margin-top:4px">Apply</button>';
      $("button", fbody).onclick = () => { $$("[data-k]", fbody).forEach((el) => (spec[el.dataset.k] = el.value === "" ? null : el.value)); onChange(); };
    } else {
      const sel = new Set(spec.values || []);
      fbody.innerHTML = '<input type="text" placeholder="Search" class="fs"><label style="font-size:12px;display:flex;gap:4px;margin:3px 0"><input type="checkbox" class="inv"' + (spec.invert ? " checked" : "") + '> Exclude selected (NOT)</label><div class="vals"></div>';
      const draw = (q) => {
        $(".vals", fbody).innerHTML = vals.filter((x) => !q || String(E.fmtValue(x)).toLowerCase().includes(q)).slice(0, 400).map((x) => '<label><input type="checkbox" data-i="' + vals.indexOf(x) + '"' + (sel.has(x) ? " checked" : "") + "> " + esc(E.fmtValue(x)) + "</label>").join("");
        $$(".vals input", fbody).forEach((cb) => cb.onchange = () => { const val = vals[+cb.dataset.i]; cb.checked ? sel.add(val) : sel.delete(val); spec.values = Array.from(sel); spec._open = true; onChange(); });
      };
      draw("");
      $(".fs", fbody).oninput = (e) => draw(e.target.value.toLowerCase());
      $(".inv", fbody).onchange = (e) => { spec.invert = e.target.checked; spec._open = true; onChange(); };
    }
    return card;
  }

  // ================================================================ data view
  function renderDataView() {
    const dv = $("#dataView"); dv.innerHTML = "";
    const names = Object.keys(RT.model.tables);
    if (!names.length) { dv.innerHTML = '<div class="empty">No tables yet. Use Get data.</div>'; return; }
    if (!S.dataTable || !RT.model.tables[S.dataTable]) S.dataTable = names[0];
    const T = RT.model.tables[S.dataTable];
    const main = h("div", { style: "flex:1;display:flex;flex-direction:column;min-width:0" });
    const top = h("div", { class: "dtop" });
    const sel = h("select", null, names.map((n) => '<option' + (n === S.dataTable ? " selected" : "") + ">" + esc(n) + "</option>").join(""));
    sel.onchange = () => { S.dataTable = sel.value; S.dataSort = null; renderDataView(); };
    top.appendChild(h("b", null, "Table")); top.appendChild(sel);
    for (const [label, fn] of [["ƒx New measure", () => openMeasureEditor(null, S.dataTable)], ["▦ New column", () => openColumnEditor(null, S.dataTable)], ["⇄ Edit query", () => openQueryEditor(S.dataTable)], ["⇩ CSV", () => (location.href = "/api/table/" + encodeURIComponent(S.dataTable) + ".csv")]]) { const b = h("button", { class: "btn" }, label); b.onclick = fn; top.appendChild(b); }
    top.appendChild(h("span", { class: "info" }, T.rows.toLocaleString() + " rows · " + T.columns.length + " columns" + (T.rows > 1000 ? " · showing first 1,000" : "")));
    main.appendChild(top);
    const grid = h("div", { class: "grid" });
    let idx = Array.from({ length: T.rows }, (_, i) => i);
    if (S.dataSort) { const col = T.data[S.dataSort.c]; idx.sort((a, b) => S.dataSort.d * E.compareValues(col[a], col[b])); }
    idx = idx.slice(0, 1000);
    let html = "<table><thead><tr>" + T.columns.map((c) => '<th class="' + (c.calc ? "calc" : "") + '" data-c="' + esc(c.name) + '"><span class="ct">' + typeIcon(c.type) + "</span>" + esc(c.name) + (S.dataSort && S.dataSort.c === c.name ? (S.dataSort.d > 0 ? " ▲" : " ▼") : "") + "</th>").join("") + "</tr></thead><tbody>";
    for (const i of idx) html += "<tr>" + T.columns.map((c) => { const val = T.data[c.name][i]; const fmt = (S.report.columnProps[S.dataTable + "[" + c.name + "]"] || {}).format; return '<td class="' + (c.type === "number" ? "num" : "") + '">' + esc(E.isBlank(val) ? "" : c.type === "number" ? E.fmtValue(val, fmt || { decimals: Number.isInteger(val) ? 0 : 2 }) : E.fmtValue(val)) + "</td>"; }).join("") + "</tr>";
    grid.innerHTML = html + "</tbody></table>";
    $$("th", grid).forEach((th) => { th.onclick = () => { const c = th.dataset.c; S.dataSort = S.dataSort && S.dataSort.c === c ? { c, d: -S.dataSort.d } : { c, d: 1 }; renderDataView(); }; th.oncontextmenu = (e) => { e.preventDefault(); const col = T.columns.find((x) => x.name === th.dataset.c); fieldMenu(e, S.dataTable, { kind: "column", name: col.name, c: col }); }; });
    main.appendChild(grid); dv.appendChild(main);
    const errs = Object.entries(RT.model.errors);
    if (errs.length) top.appendChild(h("span", { style: "color:#d64550", title: errs.map((e) => e.join(": ")).join("\n") }, "⚠ " + errs.length + " formula error(s)"));
  }

  // ================================================================ model view
  function renderModelView() {
    const mv = $("#modelView"); mv.innerHTML = "";
    const tb = h("div", { class: "mtoolbar" });
    for (const [l, fn, c] of [["⛓ Manage relationships", openRelationships, "primary"], ["✨ Autodetect", autodetectRelationships], ["📅 New date table", openDateTable], ["⟲ Auto layout", () => { S.report.modelLayout = {}; renderModelView(); }]]) { const b = h("button", { class: c || "" }, l); b.onclick = fn; tb.appendChild(b); }
    tb.appendChild(h("span", { style: "color:#605e5c;align-self:center;margin-left:8px" }, "Drag a column onto a column in another table to create a relationship. Click a line to edit it."));
    mv.appendChild(tb);
    const layout = S.report.modelLayout = S.report.modelLayout || {};
    const names = Object.keys(RT.model.tables);
    if (names.some((n) => !layout[n])) starLayout(names, layout);
    const svg = d3.select(mv).append("svg").attr("class", "rels").attr("width", 3000).attr("height", 2000);
    const boxes = {};
    for (const n of names) {
      const T = RT.model.tables[n];
      const box = h("div", { class: "mtable" }, '<div class="mh"><span>' + esc(n) + '</span><small>' + T.rows.toLocaleString() + ' rows</small></div><div class="mc">' + T.columns.map((c) => '<div class="mcol" draggable="true" data-c="' + esc(c.name) + '"><span class="ty">' + typeIcon(c.type) + "</span>" + esc(c.name) + (c.calc ? " <small style='color:#c19c00'>ƒ</small>" : "") + "</div>").join("") + S.report.measures.filter((m) => m.table === n).map((m) => '<div class="mcol" style="color:#8a6d00"><span class="ty">ƒx</span>' + esc(m.name) + "</div>").join("") + "</div>");
      box.style.left = layout[n].x + "px"; box.style.top = layout[n].y + "px";
      mv.appendChild(box); boxes[n] = box;
      const mh = $(".mh", box);
      mh.addEventListener("pointerdown", (e) => {
        const sx = e.clientX, sy = e.clientY, o = Object.assign({}, layout[n]);
        const mm = (ev) => { layout[n].x = Math.max(0, o.x + ev.clientX - sx); layout[n].y = Math.max(50, o.y + ev.clientY - sy); box.style.left = layout[n].x + "px"; box.style.top = layout[n].y + "px"; drawRels(); };
        const up = () => { window.removeEventListener("pointermove", mm); window.removeEventListener("pointerup", up); persist(); };
        window.addEventListener("pointermove", mm); window.addEventListener("pointerup", up);
      });
      $$(".mcol[data-c]", box).forEach((col) => {
        col.addEventListener("dragstart", (e) => e.dataTransfer.setData("application/x-pybi-rel", JSON.stringify([n, col.dataset.c])));
        col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
        col.addEventListener("dragleave", () => col.classList.remove("drop"));
        col.addEventListener("drop", (e) => { e.preventDefault(); col.classList.remove("drop"); const d = e.dataTransfer.getData("application/x-pybi-rel"); if (!d) return; const [t2, c2] = JSON.parse(d); if (t2 === n) return toast("Pick a column in a different table"); createRelationship(t2, c2, n, col.dataset.c); });
      });
      $(".mc", box).addEventListener("scroll", drawRels);
    }
    function colY(t, c) { const box = boxes[t]; const el = $('.mcol[data-c="' + CSS.escape(c) + '"]', box); const mc = $(".mc", box); let y = layout[t].y + 32; if (el) { y += el.offsetTop - mc.scrollTop + 10; y = Math.max(layout[t].y + 30, Math.min(layout[t].y + 30 + mc.clientHeight, y)); } return y; }
    function drawRels() {
      svg.selectAll("*").remove();
      for (const r of S.report.relationships) {
        if (!boxes[r.fromTable] || !boxes[r.toTable]) continue;
        const a = layout[r.fromTable], b = layout[r.toTable];
        const right = a.x < b.x;
        const x1 = right ? a.x + 200 : a.x, x2 = right ? b.x : b.x + 200;
        const y1 = colY(r.fromTable, r.fromColumn), y2 = colY(r.toTable, r.toColumn);
        const mx = (x1 + x2) / 2;
        const g = svg.append("g");
        g.append("path").attr("d", "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2).attr("fill", "none").attr("stroke", r.active === false ? "#c8c6c4" : "#605e5c").attr("stroke-width", 2).attr("stroke-dasharray", r.active === false ? "5,4" : null)
          .on("click", (e) => relationshipDialog(r));
        g.append("text").attr("x", x1 + (right ? 6 : -12)).attr("y", y1 - 5).attr("font-size", 12).attr("font-weight", 700).attr("fill", "#605e5c").text("*");
        g.append("text").attr("x", x2 + (right ? -12 : 6)).attr("y", y2 - 5).attr("font-size", 12).attr("font-weight", 700).attr("fill", "#605e5c").text("1");
        g.append("text").attr("x", mx).attr("y", (y1 + y2) / 2 - 6).attr("font-size", 13).attr("text-anchor", "middle").attr("fill", "#118dff").text(r.crossFilter === "both" ? "⇆" : "→");
      }
    }
    requestAnimationFrame(drawRels);
  }
  function starLayout(names, layout) {
    // fact table in the middle, its lookup tables in a ring, further lookups pushed outwards
    const rows = (n) => RT.model.tables[n].rows;
    const rels = S.report.relationships;
    const fact = names.reduce((a, b) => (rows(b) > rows(a) ? b : a), names[0]);
    const cx = 520, cy = 330, placed = new Set([fact]);
    layout[fact] = { x: cx, y: cy - 60 };
    const ring1 = names.filter((n) => n !== fact && rels.some((r) => (r.fromTable === fact && r.toTable === n) || (r.toTable === fact && r.fromTable === n)));
    ring1.forEach((n, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(ring1.length, 1); layout[n] = { x: Math.round(cx + Math.cos(a) * 400), y: Math.round(cy + Math.sin(a) * 250) }; placed.add(n); });
    let rest = names.filter((n) => !placed.has(n));
    rest.forEach((n, i) => {
      const parent = ring1.find((p) => rels.some((r) => (r.fromTable === p && r.toTable === n) || (r.toTable === p && r.fromTable === n)));
      if (parent) { const p = layout[parent]; const dx = p.x - cx, dy = p.y - cy; const len = Math.hypot(dx, dy) || 1; layout[n] = { x: Math.round(p.x + (dx / len) * 260), y: Math.round(p.y + (dy / len) * 200 + 40) }; }
      else layout[n] = { x: 40 + i * 230, y: cy + 380 };
    });
    let minX = Infinity, minY = Infinity;
    for (const n of names) { minX = Math.min(minX, layout[n].x); minY = Math.min(minY, layout[n].y); }
    for (const n of names) { layout[n].x += 30 - minX; layout[n].y += 70 - minY; }
  }
  function createRelationship(t1, c1, t2, c2) {
    // decide which side is "one" (unique values)
    const uniq = (t, c) => { const col = RT.model.column(t, c); return new Set(col).size === col.length; };
    let from = [t1, c1], to = [t2, c2];
    if (uniq(t1, c1) && !uniq(t2, c2)) { from = [t2, c2]; to = [t1, c1]; }
    if (!uniq(to[0], to[1])) { if (!confirm("Neither column has unique values. PyBI supports many-to-one relationships; '" + to[0] + "[" + to[1] + "]' will be treated as the 'one' side (first match wins). Continue?")) return; }
    if (S.report.relationships.some((r) => r.fromTable === from[0] && r.toTable === to[0] && r.active !== false)) { if (!confirm("There is already an active relationship between these tables. Add this one as inactive?")) return; S.report.relationships.push({ id: uid("r"), fromTable: from[0], fromColumn: from[1], toTable: to[0], toColumn: to[1], crossFilter: "single", active: false }); }
    else S.report.relationships.push({ id: uid("r"), fromTable: from[0], fromColumn: from[1], toTable: to[0], toColumn: to[1], crossFilter: "single", active: true });
    commit({ model: true }); toast("Relationship created: " + from.join("[") + "] *→1 " + to.join("[") + "]");
  }
  function relationshipDialog(r) {
    const tables = Object.keys(RT.model.tables);
    const colsOf = (t) => (RT.model.tables[t] ? RT.model.tables[t].columns.map((c) => c.name) : []);
    const m = modal("Edit relationship", '<label class="f">From table (many side)</label><select id="rft">' + tables.map((t) => "<option" + (t === r.fromTable ? " selected" : "") + ">" + esc(t) + "</option>").join("") + '</select><label class="f">Column</label><select id="rfc"></select><label class="f">To table (one side)</label><select id="rtt">' + tables.map((t) => "<option" + (t === r.toTable ? " selected" : "") + ">" + esc(t) + "</option>").join("") + '</select><label class="f">Column</label><select id="rtc"></select><label class="f">Cross filter direction</label><select id="rcf"><option value="single">Single (one → many)</option><option value="both">Both</option></select><label class="f"><input type="checkbox" id="ract"> Make this relationship active</label>',
      [["Delete", () => { S.report.relationships = S.report.relationships.filter((x) => x !== r); commit({ model: true }); }, "danger"], ["Cancel"], ["Save", (mm) => { r.fromTable = $("#rft", mm).value; r.fromColumn = $("#rfc", mm).value; r.toTable = $("#rtt", mm).value; r.toColumn = $("#rtc", mm).value; r.crossFilter = $("#rcf", mm).value; r.active = $("#ract", mm).checked; commit({ model: true }); }, "primary"]]);
    const fill = (sel, t, v) => { sel.innerHTML = colsOf(t).map((c) => "<option" + (c === v ? " selected" : "") + ">" + esc(c) + "</option>").join(""); };
    fill($("#rfc", m), r.fromTable, r.fromColumn); fill($("#rtc", m), r.toTable, r.toColumn);
    $("#rft", m).onchange = (e) => fill($("#rfc", m), e.target.value); $("#rtt", m).onchange = (e) => fill($("#rtc", m), e.target.value);
    $("#rcf", m).value = r.crossFilter || "single"; $("#ract", m).checked = r.active !== false;
  }
  function openRelationships() {
    const rows = S.report.relationships.map((r, i) => '<tr><td>' + (r.active === false ? "☐" : "☑") + "</td><td>" + esc(r.fromTable + " [" + r.fromColumn + "]") + "</td><td>*→1</td><td>" + esc(r.toTable + " [" + r.toColumn + "]") + "</td><td>" + (r.crossFilter === "both" ? "Both" : "Single") + '</td><td><button class="btn" data-i="' + i + '">Edit</button></td></tr>').join("");
    const m = modal("Manage relationships", (rows ? '<table class="ptable" style="width:100%"><thead><tr><th>Active</th><th>From</th><th></th><th>To</th><th>Filter</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" : "<p>No relationships yet.</p>") + '<p style="color:#605e5c;font-size:12px">Tip: in Model view you can drag one column onto another to relate tables.</p>', [["✨ Autodetect", () => { autodetectRelationships(); }], ["+ New", () => { const t = Object.keys(RT.model.tables); if (t.length < 2) { toast("You need at least two tables"); return; } const r = { id: uid("r"), fromTable: t[0], fromColumn: RT.model.tables[t[0]].columns[0].name, toTable: t[1], toColumn: RT.model.tables[t[1]].columns[0].name, crossFilter: "single", active: true }; S.report.relationships.push(r); relationshipDialog(r); }], ["Close"]], "wide");
    $$("button[data-i]", m).forEach((b) => (b.onclick = () => { m.close(); relationshipDialog(S.report.relationships[+b.dataset.i]); }));
  }
  function autodetectRelationships() {
    const tables = Object.values(RT.model.tables); let added = 0;
    for (const A of tables) for (const B of tables) {
      if (A === B) continue;
      for (const ca of A.columns) {
        const cb = B.columns.find((c) => c.name.toLowerCase() === ca.name.toLowerCase() && c.type === ca.type);
        if (!cb || ca.type === "bool") continue;
        const bu = new Set(B.data[cb.name]).size === B.rows; const au = new Set(A.data[ca.name]).size === A.rows;
        if (!bu || (au && A.rows <= B.rows)) continue;
        if (S.report.relationships.some((r) => (r.fromTable === A.name && r.toTable === B.name) || (r.fromTable === B.name && r.toTable === A.name))) continue;
        S.report.relationships.push({ id: uid("r"), fromTable: A.name, fromColumn: ca.name, toTable: B.name, toColumn: cb.name, crossFilter: "single", active: true }); added++;
      }
    }
    commit({ model: true }); toast(added ? "Found " + added + " relationship(s)" : "No new relationships found (matching column names with unique values on one side)");
  }

  // ================================================================ measures & columns
  const FN_GROUPS = {
    Aggregation: ["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "COUNTROWS", "DISTINCTCOUNT", "MEDIAN", "SUMX", "AVERAGEX", "MINX", "MAXX", "COUNTX", "RANKX", "STDEV.S", "CONCATENATEX"],
    "Filter context": ["CALCULATE", "FILTER", "ALL", "ALLEXCEPT", "ALLSELECTED", "REMOVEFILTERS", "KEEPFILTERS", "VALUES", "DISTINCT", "SELECTEDVALUE", "HASONEVALUE", "ISFILTERED", "TOPN", "RELATED", "RELATEDTABLE", "LOOKUPVALUE"],
    "Time intelligence": ["TOTALYTD", "TOTALQTD", "TOTALMTD", "DATESYTD", "DATESMTD", "DATESQTD", "SAMEPERIODLASTYEAR", "DATEADD", "PARALLELPERIOD", "PREVIOUSMONTH", "PREVIOUSYEAR", "DATESBETWEEN", "DATESINPERIOD"],
    Logical: ["IF", "SWITCH", "AND", "OR", "NOT", "IFERROR", "ISBLANK", "COALESCE", "BLANK", "TRUE", "FALSE"],
    "Math & text": ["DIVIDE", "ROUND", "ABS", "INT", "MOD", "POWER", "SQRT", "FORMAT", "CONCATENATE", "LEFT", "RIGHT", "MID", "UPPER", "LOWER", "LEN", "SUBSTITUTE", "CONTAINSSTRING"],
    Dates: ["YEAR", "MONTH", "DAY", "QUARTER", "WEEKDAY", "WEEKNUM", "DATE", "TODAY", "EOMONTH", "EDATE", "DATEDIFF", "FIRSTDATE", "LASTDATE"],
  };
  function formulaSidebar() {
    let html = '<div class="side"><div class="g">Fields (click to insert)</div>';
    for (const T of Object.values(RT.model.tables)) { html += '<div class="g">' + esc(T.name) + "</div>"; for (const c of T.columns) html += '<div data-ins="' + esc(quoteT(T.name) + "[" + c.name + "]") + '">' + esc(c.name) + "</div>"; }
    html += '<div class="g">Measures</div>' + S.report.measures.map((m) => '<div data-ins="[' + esc(m.name) + ']">ƒx ' + esc(m.name) + "</div>").join("");
    html += "</div><div class=\"side\">" + Object.entries(FN_GROUPS).map(([g, fns]) => '<div class="g">' + g + "</div>" + fns.map((f) => '<div data-ins="' + f + '(">' + f + "</div>").join("")).join("") + "</div>";
    return html;
  }
  const quoteT = (t) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? t : "'" + t.replace(/'/g, "''") + "'");
  function wireInsert(m) {
    const ta = $("textarea", m);
    $$("[data-ins]", m).forEach((d) => d.addEventListener("click", () => { const s = ta.selectionStart, e = ta.selectionEnd; ta.value = ta.value.slice(0, s) + d.dataset.ins + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s + d.dataset.ins.length; ta.dispatchEvent(new Event("input")); }));
  }
  function openMeasureEditor(existing, table) {
    const names = Object.keys(RT.model.tables);
    const m0 = existing || { name: uniqueMeasure("New measure"), expression: "", table: table || names[0], format: {} };
    const f = m0.format || {};
    const m = modal(existing ? "Edit measure" : "New measure", '<div style="display:flex;gap:10px"><div style="flex:1"><label class="f">Name</label><input type="text" id="mn" value="' + esc(m0.name) + '"></div><div style="width:170px"><label class="f">Home table</label><select id="mt">' + names.map((n) => "<option" + (n === m0.table ? " selected" : "") + ">" + esc(n) + "</option>").join("") + '</select></div></div><label class="f">Formula (DAX-style)</label><textarea id="mx" class="code" spellcheck="false" placeholder="e.g. DIVIDE(SUM(Sales[Profit]), SUM(Sales[Revenue]))">' + esc(m0.expression) + '</textarea><div id="mres"></div><div style="display:flex;gap:10px"><div style="flex:1"><label class="f">Format</label><select id="mf"><option value="auto">Auto</option><option value="whole">Whole number</option><option value="decimal">Decimal</option><option value="currency">Currency</option><option value="percent">Percentage</option></select></div><div style="width:110px"><label class="f">Decimals</label><input type="number" id="md" value="' + esc(f.decimals ?? "") + '"></div><div style="width:90px"><label class="f">Symbol</label><input type="text" id="ms" value="' + esc(f.symbol ?? "$") + '"></div></div><label class="f">Insert</label><div class="fnref">' + formulaSidebar() + "</div>",
      [["Cancel"], [existing ? "Save" : "Create", (mm) => {
        const name = $("#mn", mm).value.trim(); const expr = $("#mx", mm).value.trim();
        if (!name || !expr) { $("#mres", mm).innerHTML = '<div class="err">Name and formula are required</div>'; return false; }
        if (S.report.measures.some((x) => x.name === name && x !== existing)) { $("#mres", mm).innerHTML = '<div class="err">A measure with this name already exists</div>'; return false; }
        try { E.parse(expr); } catch (e) { $("#mres", mm).innerHTML = '<div class="err">' + esc(e.message) + "</div>"; return false; }
        const fmt = { type: $("#mf", mm).value }; if ($("#md", mm).value !== "") fmt.decimals = +$("#md", mm).value; if (fmt.type === "currency") fmt.symbol = $("#ms", mm).value;
        if (existing && existing.name !== name) renameMeasureRefs(existing.name, name);
        const rec = existing || {}; Object.assign(rec, { name, expression: expr, table: $("#mt", mm).value, format: fmt });
        if (!existing) S.report.measures.push(rec);
        commit({ model: true }); toast("Measure [" + name + "] saved");
      }, "primary"]], "wide");
    $("#mf", m).value = f.type || "auto";
    wireInsert(m);
    const check = () => {
      const expr = $("#mx", m).value.trim(); const out = $("#mres", m); if (!expr) { out.innerHTML = ""; return; }
      try {
        const ast = E.parse(expr);
        const tmp = new E.Model({ tables: S.tables, relationships: S.report.relationships, measures: S.report.measures.filter((x) => x !== existing), calcColumns: S.report.calcColumns, columnProps: S.report.columnProps });
        const val = tmp.eval(ast, { filters: [], row: null, vars: {} });
        out.innerHTML = '<div class="okm">✓ Valid. Value with no filters: <b>' + esc(E.fmtValue(val, { type: $("#mf", m).value, decimals: $("#md", m).value === "" ? undefined : +$("#md", m).value, symbol: $("#ms", m).value })) + "</b></div>";
      } catch (e) { out.innerHTML = '<div class="err">' + esc(e.message) + "</div>"; }
    };
    let t; $("#mx", m).addEventListener("input", () => { clearTimeout(t); t = setTimeout(check, 350); }); check();
  }
  function renameMeasureRefs(oldN, newN) {
    const re = new RegExp("\\[" + oldN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\]", "g");
    for (const m of S.report.measures) m.expression = m.expression.replace(re, "[" + newN + "]");
    for (const p of S.report.pages) for (const v of p.visuals) for (const k in v.fields || {}) for (const f of v.fields[k] || []) if (f.measure === oldN) f.measure = newN;
  }
  function openColumnEditor(existing, table) {
    const names = Object.keys(RT.model.tables); if (!names.length) return toast("Load data first");
    const c0 = existing || { table: table || names[0], name: "New column", expression: "" };
    const m = modal(existing ? "Edit calculated column" : "New calculated column", '<div style="display:flex;gap:10px"><div style="flex:1"><label class="f">Column name</label><input type="text" id="cn" value="' + esc(c0.name) + '"></div><div style="width:200px"><label class="f">Table</label><select id="ct">' + names.map((n) => "<option" + (n === c0.table ? " selected" : "") + ">" + esc(n) + "</option>").join("") + '</select></div></div><label class="f">Row formula — evaluated for every row. Use Table[Column], RELATED(Other[Column]), IF, SWITCH, YEAR, FORMAT…</label><textarea id="cx" class="code" spellcheck="false" placeholder="e.g. Sales[Quantity] * RELATED(Products[Price])">' + esc(c0.expression) + '</textarea><div id="cres"></div><label class="f">Insert</label><div class="fnref">' + formulaSidebar() + "</div>",
      [["Cancel"], [existing ? "Save" : "Create", (mm) => {
        const name = $("#cn", mm).value.trim(), t = $("#ct", mm).value, expr = $("#cx", mm).value.trim();
        try { E.parse(expr); } catch (e) { $("#cres", mm).innerHTML = '<div class="err">' + esc(e.message) + "</div>"; return false; }
        const clash = RT.model.tables[t].columns.find((c) => c.name === name && !c.calc);
        if (clash) { $("#cres", mm).innerHTML = '<div class="err">Column name already exists in ' + esc(t) + "</div>"; return false; }
        const rec = existing || {}; Object.assign(rec, { table: t, name, expression: expr });
        if (!existing) S.report.calcColumns.push(rec);
        commit({ model: true }); toast("Column " + t + "[" + name + "] saved");
      }, "primary"]], "wide");
    wireInsert(m);
    const check = () => {
      const expr = $("#cx", m).value.trim(); const t = $("#ct", m).value; const out = $("#cres", m); if (!expr) { out.innerHTML = ""; return; }
      try {
        const ast = E.parse(expr); const vals = [];
        for (let i = 0; i < Math.min(5, RT.model.tables[t].rows); i++) vals.push(RT.model.eval(ast, { filters: [], row: { table: t, i }, vars: {} }));
        out.innerHTML = '<div class="okm">✓ Preview of first rows: ' + vals.map((v) => esc(E.fmtValue(v))).join(", ") + "</div>";
      } catch (e) { out.innerHTML = '<div class="err">' + esc(e.message) + "</div>"; }
    };
    let tm; $("#cx", m).addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(check, 350); }); $("#ct", m).onchange = check; check();
  }

  // ================================================================ get data
  // ---------------- Get data: connector gallery (120+ sources)
  const CAT_COLORS = { File: "#118DFF", Database: "#12239E", "NoSQL & search": "#197278", "Cloud storage": "#E66C37", "Web & online files": "#6B007B", "Generic & developer": "#252423",
    "Developer tools": "#744EC2", "Project & productivity": "#D9B300", "CRM & sales": "#E044A7", "Finance & payments": "#1AAB40", "Marketing & analytics": "#D64550",
    "Support & ITSM": "#0E7C86", "HR & time tracking": "#8A6D00", "E-commerce & CMS": "#B83280", "Microsoft & Google": "#0078D4", "Public data": "#2F855A", Popular: "#F2C811" };
  const POPULAR = ["excel", "csv", "json", "folder", "web", "gsheets_public", "sqlite", "postgresql", "mysql", "sqlserver", "rest_api", "python", "sharepoint_list", "salesforce", "worldbank", "pdf"];
  let CATALOG = null;
  async function loadCatalog() { if (!CATALOG) CATALOG = await api("/api/connectors"); return CATALOG; }
  const initials = (n) => n.replace(/\(.*?\)/g, "").split(/[\s/&.-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  async function openGetData(startId) {
    let cat;
    try { cat = await loadCatalog(); } catch (e) { return toast(e.message, true); }
    const m = modal("Get data", '<div class="gd"><div class="gd-side"><input class="gd-search" placeholder="Search ' + cat.count + ' connectors…"><div class="gd-cats"></div></div><div class="gd-main"></div></div>', [], "full");
    const side = $(".gd-cats", m), main = $(".gd-main", m), search = $(".gd-search", m);
    let current = "Popular";
    const byId = Object.fromEntries(cat.connectors.map((c) => [c.id, c]));
    const counts = {}; cat.connectors.forEach((c) => (counts[c.category] = (counts[c.category] || 0) + 1));
    const cats = ["Popular", "All"].concat(cat.categories);
    function drawSide() {
      side.innerHTML = cats.map((c) => '<div class="gd-cat' + (c === current ? " on" : "") + '" data-c="' + esc(c) + '"><span>' + esc(c) + "</span><small>" + (c === "All" ? cat.count : c === "Popular" ? POPULAR.length + 3 : counts[c] || 0) + "</small></div>").join("") + '<div class="gd-note">Need another source? Use <b>REST API</b>, <b>ODBC</b>, <b>SQLAlchemy URL</b> or <b>Python script</b> — they connect to almost anything.</div>';
      $$(".gd-cat", side).forEach((d) => (d.onclick = () => { current = d.dataset.c; search.value = ""; drawSide(); drawGrid(); }));
    }
    function tile(c) {
      const color = CAT_COLORS[c.category] || "#605e5c";
      return '<button class="gd-tile" data-id="' + c.id + '"><span class="gd-badge" style="background:' + color + '">' + esc(initials(c.name)) + '</span><span class="gd-txt"><b>' + esc(c.name) + "</b><small>" + esc(c.description || c.category) + "</small>" + (c.install ? '<i class="gd-pip">pip install ' + esc(c.install) + "</i>" : "") + "</span></button>";
    }
    function drawGrid() {
      const q = search.value.trim().toLowerCase();
      let list = q ? cat.connectors.filter((c) => (c.name + " " + c.category + " " + c.description + " " + c.id).toLowerCase().includes(q))
        : current === "All" ? cat.connectors : current === "Popular" ? POPULAR.map((id) => byId[id]).filter(Boolean) : cat.connectors.filter((c) => c.category === current);
      let html = "";
      if (!q && current === "Popular") html += '<button class="gd-tile" data-special="sample"><span class="gd-badge" style="background:#F2C811;color:#111">☷</span><span class="gd-txt"><b>Demo sales dataset</b><small>A ready-made 3-page dashboard to explore</small></span></button><button class="gd-tile" data-special="paste"><span class="gd-badge" style="background:#605e5c">✎</span><span class="gd-txt"><b>Enter / paste data</b><small>Type a small table or paste from Excel</small></span></button><button class="gd-tile" data-special="pybi"><span class="gd-badge" style="background:#111827">.pb</span><span class="gd-txt"><b>Open .pybi project</b><small>A saved PyBI report</small></span></button>';
      html += list.map(tile).join("");
      main.innerHTML = '<div class="gd-head"><h3>' + esc(q ? list.length + " result(s) for “" + q + "”" : current) + '</h3><span>' + cat.count + ' connectors · drop a file anywhere here to load it</span></div><div class="gd-grid">' + (html || '<div class="empty">No connector matches. Try “REST API”, “ODBC” or “Python script”.</div>') + "</div>";
      $$(".gd-tile[data-id]", main).forEach((b) => (b.onclick = () => openConnector(byId[b.dataset.id])));
      $$(".gd-tile[data-special]", main).forEach((b) => (b.onclick = async () => {
        const k = b.dataset.special;
        if (k === "sample") { m.close(); loadSample(); }
        if (k === "pybi") { m.close(); openProject(); }
        if (k === "paste") { const r = await form("Enter data", [{ key: "name", label: "Table name", value: "Table" }, { key: "text", label: "Paste rows from Excel or type CSV (first row = headers)", type: "textarea" }]); if (r) await busy("Creating table…", async () => { applyState(await api("/api/paste", r)); m.close(); }); }
      }));
    }
    search.oninput = drawGrid;
    // drop files anywhere on the gallery
    main.addEventListener("dragover", (e) => { e.preventDefault(); main.classList.add("over"); });
    main.addEventListener("dragleave", () => main.classList.remove("over"));
    main.addEventListener("drop", async (e) => {
      e.preventDefault(); main.classList.remove("over"); const files = Array.from(e.dataTransfer.files); if (!files.length) return;
      const fd = new FormData(); files.forEach((f) => fd.append("file", f));
      await busy("Loading " + files.length + " file(s)…", async () => { const st = await api("/api/upload", fd); applyState(st); m.close(); toast("Loaded: " + (st.added || []).join(", ")); if (Object.keys(S.tables).length > 1) autodetectRelationships(); });
    });

    function openConnector(c) {
      const basic = c.params.filter((p) => !p.advanced), adv = c.params.filter((p) => p.advanced);
      const field = (p) => {
        const id = "cp_" + p.key; const lab = '<label class="f" for="' + id + '">' + esc(p.label) + (p.required ? ' <b style="color:#d64550">*</b>' : "") + "</label>";
        let ctl;
        if (p.type === "select") ctl = '<select id="' + id + '">' + (p.options || []).map((o) => "<option" + (String(o) === String(p.default) ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
        else if (p.type === "textarea" || p.type === "json") ctl = '<textarea id="' + id + '" class="code" style="min-height:' + (p.type === "json" ? 60 : 110) + 'px" placeholder="' + esc(p.placeholder || "") + '">' + esc(p.default ?? "") + "</textarea>";
        else if (p.type === "checkbox") return '<label class="f" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="' + id + '"' + (p.default ? " checked" : "") + "> " + esc(p.label) + "</label>";
        else if (p.type === "file") ctl = '<input type="file" id="' + id + '">';
        else ctl = '<input type="' + (p.type === "password" ? "password" : p.type === "number" ? "number" : "text") + '" id="' + id + '" value="' + esc(p.default ?? "") + '" placeholder="' + esc(p.placeholder || "") + '" autocomplete="off">';
        return lab + ctl + (p.help ? '<div class="hint">' + esc(p.help) + "</div>" : "");
      };
      const color = CAT_COLORS[c.category] || "#605e5c";
      main.innerHTML = '<div class="gd-conn"><button class="btn gd-back">← All connectors</button><div class="gd-chead"><span class="gd-badge big" style="background:' + color + '">' + esc(initials(c.name)) + "</span><div><h3>" + esc(c.name) + "</h3><div>" + esc(c.description) + '</div><small style="color:#8a8886">' + esc(c.category) + (c.install ? " · requires <code>pip install " + esc(c.install) + "</code>" : " · works out of the box") + '</small></div></div><div class="gd-cols"><div class="gd-form">' + basic.map(field).join("") + (adv.length ? '<details class="gd-adv"><summary>Advanced options</summary>' + adv.map(field).join("") + "</details>" : "") +
        (c.params.some((p) => p.secret) ? '<label class="f" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="cp__remember" checked> Remember credentials on this computer (stored in ~/.pybi, never in the report file)</label>' : "") +
        '<div class="gd-err"></div><div class="gd-actions"><button class="btn" data-a="preview">👁 Preview</button><button class="btn primary" data-a="load">⤓ Load</button></div></div><div class="gd-nav"><div class="gd-navlist"></div><div class="gd-prev"><div class="empty">Click <b>Preview</b> to see the data before loading.' + (c.multi ? "<br>For sources with several tables you'll pick which ones to load." : "") + "</div></div></div></div></div>";
      $(".gd-back", main).onclick = drawGrid;
      const errBox = $(".gd-err", main), nav = $(".gd-navlist", main), prev = $(".gd-prev", main);
      let tables = null, chosen = new Set();
      const body = () => {
        const params = {}; let file = null;
        for (const p of c.params) {
          const el = $("#cp_" + p.key, main); if (!el) continue;
          if (p.type === "file") { if (el.files && el.files[0]) file = el.files[0]; continue; }
          params[p.key] = p.type === "checkbox" ? el.checked : el.value;
        }
        const fd = new FormData(); fd.append("params", JSON.stringify(params)); if (file) fd.append("file", file);
        const rem = $("#cp__remember", main); fd.append("remember", rem ? String(rem.checked) : "true");
        return fd;
      };
      const showErr = (e) => {
        errBox.innerHTML = '<div class="err">⚠ ' + esc(e.message) + "</div>" + (e.install ? '<div class="gd-install">Run in your terminal: <code>pip install ' + esc(e.install) + '</code> <button class="btn" style="padding:1px 8px">Copy</button></div>' : "");
        const b = $(".gd-install button", errBox); if (b) b.onclick = () => navigator.clipboard.writeText("pip install " + e.install).then(() => toast("Copied"));
      };
      async function call(action, extra) {
        const fd = body(); for (const k in extra || {}) fd.append(k, extra[k]);
        const r = await fetch("/api/connectors/" + c.id + "/" + action, { method: "POST", body: fd });
        const j = await r.json(); if (!r.ok || j.error) { const e = new Error(j.error || "Failed"); e.install = j.install; throw e; }
        return j;
      }
      function drawPreview(payload) {
        const names = Object.keys(payload.tables || {});
        if (!names.length) { prev.innerHTML = '<div class="empty">No rows returned</div>'; return; }
        const T = payload.tables[names[0]];
        let html = '<div class="gd-ptitle"><b>' + esc(names[0]) + "</b> · " + T.columns.length + " columns · showing " + T.rows + " rows</div><div class='qgrid'><table><thead><tr>" + T.columns.map((col) => "<th>" + esc(col.name) + "</th>").join("") + "</tr></thead><tbody>";
        for (let i = 0; i < Math.min(T.rows, 100); i++) html += "<tr>" + T.columns.map((col) => { const v = T.data[col.name][i]; return E.isBlank(v) ? '<td class="null">null</td>' : "<td>" + esc(E.fmtValue(v)) + "</td>"; }).join("") + "</tr>";
        prev.innerHTML = html + "</tbody></table></div>";
      }
      function drawNav() {
        nav.innerHTML = !tables ? "" : '<div class="gd-ptitle"><b>Navigator</b> · ' + tables.length + ' tables <button class="btn" style="padding:0 6px;float:right" data-all="1">All</button></div><input class="gd-search" placeholder="Filter tables" style="margin:4px 0">' + '<div class="gd-tlist">' + tables.map((t) => '<label data-t="' + esc(t) + '"><input type="checkbox"' + (chosen.has(t) ? " checked" : "") + "> " + esc(t) + "</label>").join("") + "</div>";
        if (!tables) return;
        $$(".gd-tlist label", nav).forEach((l) => {
          $("input", l).onchange = (e) => { e.target.checked ? chosen.add(l.dataset.t) : chosen.delete(l.dataset.t); };
          l.onclick = async (e) => { if (e.target.tagName === "INPUT") return; $$(".gd-tlist label", nav).forEach((x) => x.classList.toggle("on", x === l)); prev.innerHTML = '<div class="empty">Loading preview…</div>'; try { drawPreview(await call("preview", { tables: JSON.stringify([l.dataset.t]) })); } catch (er) { prev.innerHTML = ""; showErr(er); } };
        });
        $("[data-all]", nav).onclick = () => { if (chosen.size === tables.length) chosen.clear(); else tables.forEach((t) => chosen.add(t)); drawNav(); };
        $(".gd-search", nav).oninput = (e) => $$(".gd-tlist label", nav).forEach((l) => (l.style.display = l.dataset.t.toLowerCase().includes(e.target.value.toLowerCase()) ? "" : "none"));
      }
      $('[data-a="preview"]', main).onclick = async () => {
        errBox.innerHTML = ""; prev.innerHTML = '<div class="empty">Connecting…</div>';
        try {
          if (c.multi) { const d = await call("discover"); tables = d.tables; if (tables && tables.length) { if (!chosen.size) chosen.add(tables[0]); drawNav(); drawPreview(await call("preview", { tables: JSON.stringify([tables[0]]) })); return; } tables = null; drawNav(); }
          drawPreview(await call("preview"));
        } catch (e) { prev.innerHTML = '<div class="empty">No preview</div>'; showErr(e); }
      };
      $('[data-a="load"]', main).onclick = async () => {
        errBox.innerHTML = "";
        if (c.multi && tables === null) {
          try { const d = await call("discover"); tables = d.tables; } catch (e) { return showErr(e); }
          if (tables && tables.length > 1 && !chosen.size) { chosen.add(tables[0]); drawNav(); errBox.innerHTML = '<div class="okm">Pick the tables to load in the Navigator, then press Load again.</div>'; return; }
        }
        const extra = tables && tables.length ? { tables: JSON.stringify(Array.from(chosen.size ? chosen : [tables[0]])) } : {};
        await busy("Loading from " + c.name + "…", async () => {
          try {
            const st = await call("load", extra); applyState(st); m.close();
            toast("Loaded " + (st.added || []).length + " table(s) from " + c.name + ": " + (st.added || []).join(", "));
            if (Object.keys(S.tables).length > 1) autodetectRelationships();
          } catch (e) { showErr(e); }
        });
      };
    }
    drawSide();
    if (startId && byId[startId]) openConnector(byId[startId]); else drawGrid();
  }
  async function refreshData() {
    await busy("Refreshing all connected sources…", async () => {
      const st = await api("/api/refresh-all", {});
      applyState(st);
      const f = Object.entries(st.failed || {});
      toast((st.refreshed || []).length + " source(s) refreshed" + (f.length ? " · " + f.length + " failed: " + f.map(([k, v]) => k + " (" + v + ")").join("; ") : ""), !!f.length);
    });
  }
  async function refreshTable(t) { await busy("Refreshing " + t + "…", async () => { applyState(await api("/api/source/" + encodeURIComponent(t) + "/refresh", {})); toast(t + " refreshed"); }); }

  async function loadSample() {
    if (Object.keys(S.tables).length && !confirm("Load the demo dataset and dashboard? This replaces the current report.")) return;
    await busy("Building demo dashboard…", async () => { applyState(await api("/api/sample", {})); S.history = []; toast("Demo loaded — explore the 3 pages, click charts to cross-filter"); });
  }
  async function openDateTable() {
    const dateCols = []; for (const T of Object.values(RT.model.tables)) for (const c of T.columns) if (c.type === "date") dateCols.push(T.name + "|" + c.name);
    const r = await form("New date table", [{ key: "col", label: "Base it on (and relate it to) a date column", type: "select", options: [["", "— none, use start/end —"]].concat(dateCols.map((d) => [d, d.replace("|", " › ")])) }, { key: "start", label: "or start date", type: "date" }, { key: "end", label: "end date", type: "date" }, { key: "name", label: "Table name", value: "Calendar" }, { key: "i", type: "info", label: "Creates Date, Year, Quarter, Month, Month Name (sorted), Year-Month and Weekday columns — ready for time intelligence like TOTALYTD and SAMEPERIODLASTYEAR." }]);
    if (!r) return;
    const body = { name: r.name, start: r.start, end: r.end };
    if (r.col) { const [t, c] = r.col.split("|"); body.table = t; body.column = c; }
    await busy("Creating date table…", async () => { await api("/api/report", S.report); applyState(await api("/api/datetable", body)); toast("Date table created"); });
  }
  async function renameTable(t) { const r = await form("Rename table", [{ key: "name", label: "New name", value: t }]); if (r && r.name && r.name !== t) await busy("Renaming…", async () => { await api("/api/report", S.report); applyState(await api("/api/source/" + encodeURIComponent(t) + "/rename", { name: r.name })); }); }
  async function deleteTable(t) { if (!confirm("Delete table '" + t + "' and its relationships?")) return; await busy("Deleting…", async () => { await api("/api/report", S.report); applyState(await api("/api/source/" + encodeURIComponent(t), undefined, "DELETE")); }); }

  // ================================================================ query editor (Power Query style)
  async function openQueryEditor(focus) {
    if (!S.sources.length) return openGetData();
    const work = {}; S.sources.forEach((s) => (work[s.name] = clone(s.steps || [])));
    const st = { q: focus && work[focus] ? focus : S.sources[0].name, stepIdx: null, sel: [], data: null };
    const m = modal("Query editor — transform data", '<div class="qe"><div class="ql"></div><div class="qm"><div class="qtool"></div><div class="qgrid"></div><div class="qstatus"></div></div><div class="qr"></div></div>', [["Cancel"], ["Close & apply", async () => {
      const changed = S.sources.filter((s) => JSON.stringify(s.steps || []) !== JSON.stringify(work[s.name]));
      if (!changed.length) return;
      let last;
      await busy("Applying " + changed.length + " query change(s)…", async () => { await api("/api/report", S.report); for (const s of changed) last = await api("/api/source/" + encodeURIComponent(s.name) + "/steps", { steps: work[s.name] }); applyState(last); });
    }, "primary"]], "full");
    const labels = (S.info.stepLabels) || {};
    const ql = $(".ql", m), tool = $(".qtool", m), grid = $(".qgrid", m), status = $(".qstatus", m), qr = $(".qr", m);
    const steps = () => work[st.q];
    const cols = () => (st.data ? st.data.table.columns.map((c) => c.name) : []);
    const needCol = () => { if (!st.sel.length) { toast("Select a column first (click its header)"); return null; } return st.sel[0]; };
    const addStep = (s) => { const arr = steps(); const at = st.stepIdx == null ? arr.length : st.stepIdx + 1; arr.splice(at, 0, s); st.stepIdx = at === arr.length - 1 ? null : at; refresh(); };
    async function refresh() {
      ql.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Queries [' + S.sources.length + "]</div>" + S.sources.map((s) => '<div class="q' + (s.name === st.q ? " on" : "") + '" data-q="' + esc(s.name) + '"><span>⊞ ' + esc(s.name) + "</span><small>" + (work[s.name].length || "") + "</small></div>").join("") + '<div style="margin-top:10px;display:flex;flex-direction:column;gap:4px"><button class="btn" data-a="dup">Duplicate query</button><button class="btn" data-a="new">+ New source</button></div>';
      $$(".q", ql).forEach((d) => (d.onclick = () => { st.q = d.dataset.q; st.stepIdx = null; st.sel = []; refresh(); }));
      $('[data-a="dup"]', ql).onclick = async () => { await api("/api/report", S.report); const r = await api("/api/source/" + encodeURIComponent(st.q) + "/duplicate", {}); S.sources = r.sources; r.sources.forEach((s) => { if (!work[s.name]) work[s.name] = clone(s.steps || []); }); st.q = r.added[0]; refresh(); };
      $('[data-a="new"]', ql).onclick = () => { m.close(); openGetData(); };
      const arr = steps(); const upto = st.stepIdx == null ? arr.length : st.stepIdx + 1;
      qr.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Applied steps</div><div class="step' + (upto === 0 ? " on" : "") + '" data-i="-1"><span>Source</span></div>' + arr.map((s, i) => '<div class="step' + (i === upto - 1 ? " on" : "") + '" data-i="' + i + '"><span>' + esc(labels[s.op] || s.op) + (s.column ? " · " + esc(s.column) : "") + '</span><button data-del="' + i + '">✕</button></div>').join("") + '<div style="margin-top:10px;font-size:11.5px;color:#8a8886">Click a step to preview the data at that point. New steps are inserted after the selected step.</div><details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px">Advanced editor (JSON)</summary><textarea class="code" style="width:100%;height:160px;font-size:11px">' + esc(JSON.stringify(arr, null, 1)) + '</textarea><button class="btn" style="margin-top:4px">Apply JSON</button></details>';
      $$(".step", qr).forEach((d) => (d.onclick = (e) => { if (e.target.dataset.del != null) return; const i = +d.dataset.i; st.stepIdx = i === arr.length - 1 ? null : i; refresh(); }));
      $$("[data-del]", qr).forEach((b) => (b.onclick = () => { arr.splice(+b.dataset.del, 1); st.stepIdx = null; refresh(); }));
      $("details button", qr).onclick = () => { try { work[st.q] = JSON.parse($("details textarea", qr).value); st.stepIdx = null; refresh(); } catch (e) { toast("Invalid JSON: " + e.message, true); } };
      grid.innerHTML = '<div class="empty">Loading preview…</div>';
      try {
        st.data = await api("/api/source/" + encodeURIComponent(st.q) + "/preview", { steps: arr.slice(0, upto) });
      } catch (e) { grid.innerHTML = '<div class="qerr">⚠ ' + esc(e.message) + "</div>"; status.textContent = ""; return; }
      const T = st.data.table; const prof = Object.fromEntries(st.data.profile.map((p) => [p.name, p]));
      st.sel = st.sel.filter((c) => T.columns.some((x) => x.name === c));
      let html = "<table><thead><tr><th style='color:#8a8886'>#</th>" + T.columns.map((c) => { const p = prof[c.name] || {}; return '<th data-c="' + esc(c.name) + '" class="' + (st.sel.includes(c.name) ? "sel" : "") + '"><span class="ty">' + typeIcon(c.type) + "</span>" + esc(c.name) + ' ▾<span class="q" style="--v:' + (p.valid ?? 100) + '%"></span><small>' + (p.valid ?? 100) + "% valid · " + (p.distinct ?? 0) + " distinct</small></th>"; }).join("") + "</tr></thead><tbody>";
      for (let i = 0; i < T.rows; i++) html += "<tr><td style='color:#8a8886'>" + (i + 1) + "</td>" + T.columns.map((c) => { const v = T.data[c.name][i]; return E.isBlank(v) ? '<td class="null">null</td>' : "<td>" + esc(E.fmtValue(v)) + "</td>"; }).join("") + "</tr>";
      grid.innerHTML = html + "</tbody></table>";
      status.innerHTML = "<span>" + T.columns.length + " columns, " + st.data.rowCount.toLocaleString() + " rows" + (st.data.rowCount > T.rows ? " (previewing first " + T.rows + ")" : "") + "</span><span>" + (st.sel.length ? "Selected: " + st.sel.map(esc).join(", ") : "Click a column header to select it (Ctrl+click for several)") + "</span>";
      $$("th[data-c]", grid).forEach((th) => {
        th.onclick = (e) => { const c = th.dataset.c; if (e.ctrlKey || e.metaKey || e.shiftKey) st.sel = st.sel.includes(c) ? st.sel.filter((x) => x !== c) : st.sel.concat([c]); else st.sel = [c]; $$("th[data-c]", grid).forEach((x) => x.classList.toggle("sel", st.sel.includes(x.dataset.c))); status.lastChild.textContent = "Selected: " + st.sel.join(", "); };
        th.oncontextmenu = (e) => { e.preventDefault(); st.sel = [th.dataset.c]; colMenu(e, th.dataset.c); };
        th.ondblclick = async () => { const r = await form("Rename column", [{ key: "n", label: "New name", value: th.dataset.c }]); if (r && r.n && r.n !== th.dataset.c) addStep({ op: "rename", mapping: { [th.dataset.c]: r.n } }); };
      });
    }
    function colMenu(e, c) {
      showMenu(e, [["Rename…", async () => { const r = await form("Rename column", [{ key: "n", label: "New name", value: c }]); if (r && r.n) addStep({ op: "rename", mapping: { [c]: r.n } }); }],
        ["Remove", () => addStep({ op: "remove_columns", columns: [c] })], ["Remove other columns", () => addStep({ op: "keep_columns", columns: st.sel.length ? st.sel : [c] })], null,
        ...["number", "integer", "text", "date", "bool"].map((t) => ["Change type → " + t, () => addStep({ op: "change_type", column: c, to: t })]), null,
        ["Sort ascending", () => addStep({ op: "sort", column: c, ascending: true })], ["Sort descending", () => addStep({ op: "sort", column: c, ascending: false })],
        ["Filter rows…", () => tools.filter()], ["Replace values…", () => tools.replace()], ["Fill down", () => addStep({ op: "fill_null", column: c, method: "down" })],
        ["Remove empty", () => addStep({ op: "filter_rows", column: c, operator: "is not blank" })], ["Remove duplicates", () => addStep({ op: "remove_duplicates", columns: [c] })]]);
    }
    const tools = {
      "Choose columns": async () => { const r = await form("Choose columns", [{ key: "c", label: "Columns to keep (Ctrl+click)", type: "multi", options: cols(), value: cols() }]); if (r) addStep({ op: "keep_columns", columns: r.c }); },
      "Remove columns": () => { if (needCol()) addStep({ op: "remove_columns", columns: st.sel }); },
      "Use first row as headers": () => addStep({ op: "promote_headers" }),
      "Change type": async () => { const c = needCol(); if (!c) return; const r = await form("Change type of " + c, [{ key: "to", label: "Data type", type: "select", options: [["number", "Decimal number"], ["integer", "Whole number"], ["text", "Text"], ["date", "Date / time"], ["bool", "True/False"]] }]); if (r) for (const col of st.sel) addStep({ op: "change_type", column: col, to: r.to }); },
      filter: async () => { const c = needCol(); if (!c) return; const r = await form("Filter rows where " + c, [{ key: "operator", label: "Condition", type: "select", options: ["=", "!=", ">", ">=", "<", "<=", "contains", "not contains", "starts with", "ends with", "in", "is blank", "is not blank"] }, { key: "value", label: "Value (for 'in', comma separated)" }]); if (r) addStep({ op: "filter_rows", column: c, operator: r.operator, value: r.value }); },
      replace: async () => { const c = needCol(); if (!c) return; const r = await form("Replace values in " + c, [{ key: "find", label: "Value to find" }, { key: "replace", label: "Replace with" }, { key: "partial", label: "Match part of the text", type: "checkbox" }]); if (r) addStep({ op: "replace_values", column: c, find: r.find, replace: r.replace, partial: r.partial }); },
      "Fill": async () => { const c = needCol(); if (!c) return; const r = await form("Fill blanks in " + c, [{ key: "method", label: "Method", type: "select", options: [["down", "Fill down"], ["up", "Fill up"], ["value", "With a value"], ["mean", "With the average"]] }, { key: "value", label: "Value" }]); if (r) addStep({ op: "fill_null", column: c, method: r.method, value: r.value }); },
      "Remove duplicates": () => addStep({ op: "remove_duplicates", columns: st.sel.length ? st.sel : null }),
      "Remove blank rows": () => addStep({ op: "remove_nulls", columns: st.sel.length ? st.sel : null }),
      "Keep top rows": async () => { const r = await form("Keep top rows", [{ key: "n", label: "Number of rows", type: "number", value: 100 }]); if (r) addStep({ op: "keep_top", n: r.n }); },
      "Custom column": async () => { const r = await form("Add custom column", [{ key: "name", label: "New column name", value: "Custom" }, { key: "expression", label: "Formula — use [Column] names, + - * /, comparisons", type: "textarea", value: st.sel.length ? "[" + st.sel[0] + "]" : "" }, { key: "i", type: "info", label: "Examples: [Quantity] * [UnitPrice] · [Revenue] - [Cost] · [Score] > 50" }]); if (r) addStep({ op: "add_column", name: r.name, expression: r.expression }); },
      "Conditional column": async () => { const c = needCol(); if (!c) return; const r = await form("Conditional column (based on " + c + ")", [{ key: "name", label: "New column name", value: c + " Group" }, { key: "op1", label: "If " + c, type: "select", options: ["=", "!=", ">", ">=", "<", "<=", "contains"] }, { key: "v1", label: "Value" }, { key: "o1", label: "Then output" }, { key: "op2", label: "Else if " + c + " (optional)", type: "select", options: ["", "=", "!=", ">", ">=", "<", "<=", "contains"] }, { key: "v2", label: "Value" }, { key: "o2", label: "Then output" }, { key: "else", label: "Else output", value: "Other" }]); if (r) { const rules = [{ column: c, operator: r.op1, value: r.v1, output: r.o1 }]; if (r.op2) rules.push({ column: c, operator: r.op2, value: r.v2, output: r.o2 }); addStep({ op: "conditional_column", name: r.name, rules, else: r.else }); } },
      "Split column": async () => { const c = needCol(); if (!c) return; const r = await form("Split " + c + " by delimiter", [{ key: "delimiter", label: "Delimiter", value: "," }, { key: "max_parts", label: "Number of parts", type: "number", value: 2 }]); if (r) addStep({ op: "split_column", column: c, delimiter: r.delimiter, max_parts: r.max_parts }); },
      "Format text": async () => { const c = needCol(); if (!c) return; const r = await form("Format text in " + c, [{ key: "t", label: "Transform", type: "select", options: [["trim", "Trim"], ["clean", "Clean whitespace"], ["upper", "UPPERCASE"], ["lower", "lowercase"], ["title", "Capitalize Each Word"], ["length", "Length (new column)"]] }]); if (r) addStep({ op: "text_transform", column: c, transform: r.t, new_name: r.t === "length" ? c + " Length" : null }); },
      "Date parts": async () => { const c = needCol(); if (!c) return; const r = await form("Extract from " + c, [{ key: "p", label: "Parts (Ctrl+click)", type: "multi", options: ["year", "quarter", "month", "month_name", "year_month", "day", "weekday"], value: ["year", "month"] }]); if (r) addStep({ op: "date_parts", column: c, parts: r.p }); },
      "Round": async () => { const c = needCol(); if (!c) return; const r = await form("Round " + c, [{ key: "d", label: "Decimal places", type: "number", value: 2 }]); if (r) addStep({ op: "round", column: c, digits: r.d }); },
      "Group by": async () => { const r = await form("Group by", [{ key: "by", label: "Group by columns (Ctrl+click)", type: "multi", options: cols(), value: st.sel }, { key: "func", label: "Operation", type: "select", options: [["sum", "Sum"], ["mean", "Average"], ["min", "Min"], ["max", "Max"], ["count", "Count rows"], ["nunique", "Count distinct"], ["median", "Median"]] }, { key: "column", label: "Column", type: "select", options: cols() }, { key: "name", label: "New column name", value: "Total" }]); if (r) addStep({ op: "group_by", by: r.by, aggregations: [{ column: r.column, func: r.func, name: r.name }] }); },
      "Unpivot": async () => { const r = await form("Unpivot columns", [{ key: "ids", label: "Columns to KEEP as identifiers (all others become rows)", type: "multi", options: cols(), value: st.sel }, { key: "a", label: "Attribute column name", value: "Attribute" }, { key: "v", label: "Value column name", value: "Value" }]); if (r) addStep({ op: "unpivot", id_columns: r.ids, attribute: r.a, value: r.v }); },
      "Merge queries": async () => { const others = S.sources.map((s) => s.name).filter((n) => n !== st.q); if (!others.length) return toast("Add another query first"); const r = await form("Merge queries (lookup)", [{ key: "left_on", label: "Column in " + st.q, type: "select", options: cols(), value: st.sel[0] }, { key: "right", label: "Merge with query", type: "select", options: others }, { key: "right_on", label: "Matching column in that query (type exact name)" }, { key: "how", label: "Join kind", type: "select", options: [["left", "Left outer"], ["inner", "Inner"], ["outer", "Full outer"], ["right", "Right outer"]] }]); if (r) addStep({ op: "merge", left_on: r.left_on, right: r.right, right_on: r.right_on || r.left_on, how: r.how }); },
      "Append queries": async () => { const others = S.sources.map((s) => s.name).filter((n) => n !== st.q); if (!others.length) return toast("Add another query first"); const r = await form("Append queries", [{ key: "s", label: "Append these queries below " + st.q, type: "multi", options: others }]); if (r && r.s.length) addStep({ op: "append", sources: r.s }); },
    };
    tool.innerHTML = "";
    for (const name of ["Choose columns", "Remove columns", "Use first row as headers", "Change type", "Filter rows", "Replace values", "Fill", "Remove duplicates", "Remove blank rows", "Keep top rows", "Custom column", "Conditional column", "Split column", "Format text", "Date parts", "Round", "Group by", "Unpivot", "Merge queries", "Append queries"]) {
      const fn = tools[name] || (name === "Filter rows" ? tools.filter : tools.replace);
      const b = h("button", null, esc(name)); b.onclick = fn; tool.appendChild(b);
    }
    refresh();
  }

  // ================================================================ smart features
  function autoDashboard() {
    const tables = Object.values(RT.model.tables); if (!tables.length) return openGetData();
    const fact = tables.reduce((a, b) => (b.rows > a.rows ? b : a));
    const reach = (t) => t === fact.name || RT.model.path(fact.name, t);
    let meas = S.report.measures.filter((m) => !m.error).slice(0, 4).map((m) => ({ measure: m.name }));
    if (!meas.length) meas = fact.columns.filter((c) => c.type === "number" && !keyLike(c.name)).slice(0, 4).map((c) => ({ table: fact.name, column: c.name, agg: "sum" }));
    if (!meas.length) meas = [{ table: fact.name, column: fact.columns[0].name, agg: "count" }];
    const dims = [];
    const isDateTable = (T) => T !== fact && T.columns.some((c) => c.type === "date");
    for (const T of tables) if (reach(T.name) && !isDateTable(T)) for (const c of T.columns) if (c.type === "text" && !/(month|quarter|weekday|day|year)/i.test(c.name)) { const n = new Set(T.data[c.name]).size; if (n > 1 && n <= 40) dims.push({ table: T.name, column: c.name, n }); }
    dims.sort((a, b) => a.n - b.n);
    let dateCol = null;
    for (const T of tables) if (reach(T.name)) { const c = T.columns.find((x) => x.type === "date"); if (c) { dateCol = { table: T.name, column: c.name }; if (T === fact || RT.model.relationships.some((r) => r.toTable === T.name)) break; } }
    const p = { id: uid("p"), name: "Auto insights", visuals: [], filters: [] };
    const add = (type, x, y, w, hh, title, fields, format) => p.visuals.push({ id: uid(), type, x, y, w, h: hh, title, fields, format: format || {} });
    add("textbox", 20, 12, 800, 50, "", {}, { text: "✨ Auto insights: " + fact.name, fontSize: 24, bold: true, background: "transparent" });
    if (dims[0]) add("slicer", 1040, 12, 220, 50, E.fieldLabel(dims[0]), { category: [dims[0]] }, { style: "dropdown" });
    const cw = (1240 - (meas.length - 1) * 14) / meas.length;
    meas.forEach((m, i) => add("card", 20 + i * (cw + 14), 76, cw, 110, "", { values: [m] }));
    const m0 = meas[0];
    if (dateCol) add("area", 20, 200, 760, 250, E.fieldLabel(m0) + " over time", { category: [Object.assign({}, dateCol, { level: "yearMonth" })], values: [m0] });
    else if (dims[2]) add("line", 20, 200, 760, 250, E.fieldLabel(m0) + " by " + dims[2].column, { category: [dims[2]], values: [m0] });
    if (dims[0]) add("donut", 794, 200, 466, 250, E.fieldLabel(m0) + " by " + dims[0].column, { category: [dims[0]], values: [m0] });
    if (dims[1]) add("clusteredBar", 20, 464, 420, 240, E.fieldLabel(m0) + " by " + dims[1].column, { category: [dims[1]], values: [m0] }, { dataLabels: true });
    const big = dims.slice().sort((a, b) => b.n - a.n)[0];
    if (big) add("narrative", 454, 464, 300, 240, "Smart narrative", { category: [big], values: [m0] });
    if (big) add("table", 768, 464, 492, 240, "Top " + big.column, { columns: [big].concat(meas.slice(0, 3)) }, { topN: 10, dataBars: true });
    S.report.pages.push(p); RT.pageIndex = S.report.pages.length - 1; S.selected = null; commit();
    toast("Created page 'Auto insights' with " + p.visuals.length + " visuals");
  }

  // natural-language Q&A
  function askData(q) {
    q = q.trim(); if (!q) return;
    const text = q.toLowerCase();
    const fields = [];
    for (const m of S.report.measures) fields.push({ kind: "measure", name: m.name, ref: { measure: m.name } });
    for (const T of Object.values(RT.model.tables)) for (const c of T.columns) fields.push({ kind: "column", name: c.name, type: c.type, ref: { table: T.name, column: c.name }, table: T.name });
    const norm = (s) => s.toLowerCase().replace(/[_\-]/g, " ");
    const found = [];
    for (const f of fields.sort((a, b) => b.name.length - a.name.length)) {
      const n = norm(f.name); const i = text.indexOf(n);
      if (i >= 0 && !found.some((x) => i >= x.i && i < x.i + x.len)) found.push(Object.assign({ i, len: n.length }, f));
    }
    found.sort((a, b) => a.i - b.i);
    const byIdx = text.search(/\b(by|per|for each|across|over)\b/);
    let values = found.filter((f) => f.kind === "measure" || (f.type === "number" && !keyLike(f.name) && (byIdx < 0 || f.i < byIdx)));
    let dims = found.filter((f) => !values.includes(f));
    if (!values.length) {
      const fact = Object.values(RT.model.tables).reduce((a, b) => (b.rows > a.rows ? b : a), { rows: -1 });
      if (/count|how many|number of/.test(text) && fact.name) values = [{ ref: { table: fact.name, column: fact.columns[0].name, agg: "count" }, name: "Count" }];
      else return toast("I couldn't find a measure or numeric column in that question. Try e.g. '" + (S.report.measures[0] ? S.report.measures[0].name : "Sales") + " by " + "Region'", true);
    }
    values = values.map((v) => (v.ref.measure || v.ref.agg ? v.ref : Object.assign({}, v.ref, { agg: /average|avg|mean/.test(text) ? "avg" : /max|highest/.test(text) ? "max" : /min|lowest/.test(text) ? "min" : "sum" })));
    let type = dims.length ? "clusteredColumn" : values.length > 1 ? "multiCard" : "card";
    const dim = dims[0] ? Object.assign({}, dims[0].ref) : null;
    if (dim && dims[0].type === "date") { dim.level = /year/.test(text) ? "year" : /quarter/.test(text) ? "yearQuarter" : /day|daily/.test(text) ? "day" : "yearMonth"; type = "line"; }
    if (/trend|over time|monthly|by month|timeline/.test(text) && dim) type = "line";
    const kw = [["pie", "pie"], ["donut", "donut"], ["doughnut", "donut"], ["treemap", "treemap"], ["funnel", "funnel"], ["table", "table"], ["matrix", "matrix"], ["scatter", "scatter"], ["bubble", "scatter"], ["area", "area"], ["line", "line"], ["horizontal", "clusteredBar"], ["bar", "clusteredBar"], ["column", "clusteredColumn"], ["stacked", "stackedColumn"], ["waterfall", "waterfall"], ["gauge", "gauge"], ["kpi", "kpi"], ["card", "card"]];
    for (const [k, t] of kw) if (new RegExp("\\b" + k + "\\b").test(text)) { type = t; break; }
    const v = { id: uid(), type, x: 0, y: 0, w: 520, h: 320, title: q.charAt(0).toUpperCase() + q.slice(1), fields: {}, format: {}, z: nextZ() };
    if (["table"].includes(type)) v.fields.columns = (dim ? [dim] : []).concat(values);
    else if (type === "matrix") { v.fields.rows = dim ? [dim] : []; if (dims[1]) v.fields.columns = [dims[1].ref]; v.fields.values = values; }
    else if (type === "scatter") { v.fields.category = dim ? [dim] : []; v.fields.x = [values[0]]; v.fields.y = [values[1] || values[0]]; }
    else if (["card", "gauge", "kpi"].includes(type)) { v.fields.values = [values[0]]; if (type === "kpi" && dim) v.fields.category = [dim]; v.w = 300; v.h = 160; }
    else if (type === "multiCard") v.fields.values = values;
    else { v.fields.category = dim ? [dim] : []; v.fields.values = ["pie", "donut", "treemap", "funnel", "waterfall"].includes(type) ? [values[0]] : values; if (dims[1] && !["pie", "donut", "treemap", "funnel", "waterfall"].includes(type)) { v.fields.series = [dims[1].ref]; v.fields.values = [values[0]]; if (type === "clusteredColumn") v.type = "stackedColumn"; } }
    const top = /\btop\s+(\d+)/.exec(text) || /\b(\d+)\s+(best|highest|largest)/.exec(text);
    const bottom = /\bbottom\s+(\d+)/.exec(text) || /\b(\d+)\s+(worst|lowest|smallest)/.exec(text);
    if (top) v.format.topN = +top[1]; if (bottom) { v.format.topN = +bottom[1]; v.format.sort = "value-asc"; }
    let pos = freeSpot(v.w, v.h);
    if (!pos) { S.report.pages.push({ id: uid("p"), name: "Q&A", visuals: [], filters: [] }); RT.pageIndex = S.report.pages.length - 1; S.selected = null; pos = { x: 20, y: 20 }; }
    v.x = pos.x; v.y = pos.y;
    page().visuals.push(v); S.selected = v.id; commit();
    toast("Created " + V.TYPES[v.type].label + " — refine it in the Visualizations pane");
  }
  $("#askBox").addEventListener("keydown", (e) => { if (e.key === "Enter") { askData(e.target.value); e.target.value = ""; } });

  // ================================================================ theme
  function openTheme() {
    const html = '<div class="getdata">' + Object.entries(V.THEMES).map(([k, t]) => '<button data-t="' + k + '" style="' + (S.report.theme === k ? "border-color:#118dff;background:#e8f3ff" : "") + '"><div style="display:flex;gap:2px">' + t.palette.slice(0, 6).map((c) => '<span style="width:16px;height:22px;background:' + c + ';display:inline-block;border-radius:2px"></span>').join("") + '</div><span style="font-size:12px">' + esc(t.name) + '</span><span style="width:60px;height:10px;background:' + t.page + ';border:1px solid #ddd"></span></button>').join("") + "</div>";
    const m = modal("Report theme", html, [["Close"]]);
    $$("button[data-t]", m).forEach((b) => (b.onclick = () => { S.report.theme = b.dataset.t; commit(); m.close(); }));
  }

  // ================================================================ file & export
  async function newReport() { if (!confirm("Start a new, empty report? Unsaved changes in the current one will be lost (an autosave is kept in ~/.pybi).")) return; await busy("Creating…", async () => { applyState(await api("/api/new", {})); S.history = []; }); }
  function openProject() {
    const fi = h("input", { type: "file", accept: ".pybi" });
    fi.onchange = async () => { const fd = new FormData(); fd.append("file", fi.files[0]); await busy("Opening…", async () => { applyState(await api("/api/open", fd)); S.history = []; toast("Opened " + fi.files[0].name); }); };
    fi.click();
  }
  async function saveProject() {
    await busy("Saving…", async () => {
      const r = await api("/api/save", { report: S.report });
      toast("Saved to " + r.path);
    });
  }
  function exportMenu(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    showMenu({ clientX: rect.left, clientY: rect.bottom + 2, stopPropagation: () => e.stopPropagation() }, [
      ["🖼  This page as PNG image", () => exportPNG(false)], ["🖼  All pages as PNG images", () => exportPNG(true)],
      ["📊  PowerPoint (.pptx)", exportPPTX], ["📄  PDF document", exportPDF],
      ["🌐  Interactive HTML (works offline)", exportHTML], null,
      ["💾  Download project (.pybi)", () => download("/api/download-project", null, "report.pybi")], ["🖨  Print", () => window.print()],
    ]);
  }
  async function exportPNG(all) {
    await busy("Rendering image…", async () => {
      const pages = all ? await RT.allPagesPNG(2) : [await RT.pagePNG(null, 2)];
      for (const p of pages) V.download((S.report.title || "report") + " - " + p.name + ".png", p.png);
      RT.render(); afterRender();
    });
  }
  async function exportPPTX() { await busy("Building PowerPoint…", async () => { const pages = await RT.allPagesPNG(2); RT.render(); await download("/api/export/pptx", { title: S.report.title, pages: pages.map(({ name, png, width, height }) => ({ name, png, width, height })) }, "report.pptx"); toast("PowerPoint exported"); }); }
  async function exportPDF() { await busy("Building PDF…", async () => { const pages = await RT.allPagesPNG(2); RT.render(); await download("/api/export/pdf", { title: S.report.title, pages: pages.map(({ name, png, width, height }) => ({ name, png, width, height })) }, "report.pdf"); toast("PDF exported"); }); }
  async function exportHTML() { await busy("Packing interactive HTML…", async () => { await download("/api/export/html", { report: S.report }, "report.html"); toast("Interactive HTML exported — open it in any browser, no Python needed"); }); }

  async function share() {
    let info = S.info; try { info = S.info = await api("/api/info"); } catch (e) { /* keep */ }
    const body = info.shared
      ? '<p>Anyone on the same Wi-Fi / office network can open this live, read-only link. It updates automatically as you edit.</p><div class="share-url"><input type="text" readonly value="' + esc(info.shareUrl) + '"><button class="btn primary" id="cp">Copy</button></div><p style="font-size:12px;color:#605e5c">Viewers can use slicers, cross-filtering, focus mode and download images, but cannot edit. Your firewall may ask to allow Python the first time.</p>'
      : '<p>Network sharing is off because PyBI was started with <code>--private</code>.</p><p>Restart with <code>pybi run</code> (without --private) to get a link for your network.</p>';
    const m = modal("Share report", body + '<hr style="border:0;border-top:1px solid #e1dfdd"><p><b>Share outside your network</b></p><p style="font-size:12.5px">Export an <b>interactive HTML</b> file — one file with data and charts that opens in any browser, even offline. Email it, put it on a shared drive, or host it on GitHub Pages / Netlify.</p>', [["Open viewer", () => window.open("/view", "_blank")], ["Export HTML", exportHTML], ["Close"]]);
    const cp = $("#cp", m); if (cp) cp.onclick = () => { navigator.clipboard.writeText(info.shareUrl).then(() => toast("Link copied")); };
  }
  $("#shareBtn").onclick = share;
  $("#docTitle").addEventListener("change", (e) => { S.report.title = e.target.value.trim() || "Untitled report"; document.title = S.report.title + " · PyBI Studio"; commit({ render: false }); });

  // ================================================================ keyboard
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input,textarea,select,[contenteditable]")) return;
    const ctrl = e.ctrlKey || e.metaKey; const v = selVisual();
    if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); saveProject(); }
    else if (ctrl && e.key.toLowerCase() === "c" && v) { S.clipboard = clone(v); toast("Visual copied"); }
    else if (ctrl && e.key.toLowerCase() === "v" && S.clipboard) { const c = clone(S.clipboard); c.id = uid(); c.x += 20; c.y += 20; c.z = nextZ(); page().visuals.push(c); S.selected = c.id; commit(); }
    else if (ctrl && e.key.toLowerCase() === "d" && v) { e.preventDefault(); duplicateVisual(v); }
    else if ((e.key === "Delete" || e.key === "Backspace") && v && S.view === "report") { e.preventDefault(); deleteVisual(v); }
    else if (e.key === "Escape") { RT.clearSelection(); selectVisual(null); }
    else if (v && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault(); const d = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") v.x -= d; if (e.key === "ArrowRight") v.x += d; if (e.key === "ArrowUp") v.y -= d; if (e.key === "ArrowDown") v.y += d;
      RT.renderVisual(v); RT.frames[v.id].classList.add("sel"); clearTimeout(S.nudge); S.nudge = setTimeout(() => commit({ render: false }), 400);
    }
  });

  // ================================================================ boot
  (async function boot() {
    try {
      S.info = await api("/api/info");
      applyState(await api("/api/state"));
    } catch (e) { document.body.innerHTML = '<div class="empty" style="height:100vh">Could not reach the PyBI server: ' + esc(e.message) + "</div>"; }
  })();
})();
