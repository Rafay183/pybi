/* PyBI viewer: read-only interactive dashboards for the network link and exported HTML files. */
(function () {
  "use strict";
  const V = window.PyBIVisuals;
  const $ = (id) => document.getElementById(id);
  let rt = null, revision = -1;

  function fit() {
    if (!rt) return;
    const stage = $("vstage"); const { w, h } = rt.pageSize();
    const z = Math.min((stage.clientWidth - 40) / w, 2.5);
    const c = $("vcanvas");
    c.style.transform = "scale(" + z + ")"; c.style.transformOrigin = "top left";
    c.parentElement.style.minHeight = h * z + 30 + "px";
    c.style.marginLeft = Math.max(0, (stage.clientWidth - w * z) / 2) + "px";
  }

  function tabs() {
    const nav = $("vpages"); nav.innerHTML = "";
    rt.report.pages.forEach((p, i) => {
      if (p.hidden) return;
      const b = document.createElement("button"); b.textContent = p.name; b.className = i === rt.pageIndex ? "on" : "";
      b.onclick = () => { rt.pageIndex = i; rt.selection = null; rt.render(); tabs(); fit(); location.hash = "page=" + i; };
      nav.appendChild(b);
    });
  }

  function load(data, keepPage) {
    const page = keepPage && rt ? rt.pageIndex : (parseInt((location.hash.match(/page=(\d+)/) || [])[1]) || 0);
    // keep viewer-side slicer selections when the live report refreshes
    const states = {};
    if (rt) for (const p of rt.report.pages) for (const v of p.visuals) if (v.state) states[v.id] = v.state;
    rt = new window.PyBIRuntime({ report: data.report, tables: data.tables, canvas: $("vcanvas"), editable: false, hooks: {} });
    if (keepPage) for (const p of rt.report.pages) for (const v of p.visuals) if (states[v.id]) v.state = states[v.id];
    rt.pageIndex = Math.min(page, rt.report.pages.length - 1);
    document.title = data.report.title || "PyBI report";
    $("vtitle").textContent = data.report.title || "PyBI report";
    if (data.exportedAt) $("vstamp").textContent = "· exported " + data.exportedAt.replace("T", " ");
    rt.render(); tabs(); fit();
  }

  async function poll() {
    try {
      const r = await fetch("/api/revision", { cache: "no-store" }); const j = await r.json();
      if (j.revision !== revision) { revision = j.revision; const s = await (await fetch("/api/view-state", { cache: "no-store" })).json(); load(s, true); }
    } catch (e) { /* server stopped: keep showing last state */ }
    setTimeout(poll, 4000);
  }

  $("vreset").onclick = () => rt && rt.resetFilters();
  $("vpng").onclick = async () => { const p = await rt.pagePNG(null, 2); V.download((rt.report.title || "report") + " - " + p.name + ".png", p.png); };
  $("vfull").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  $("vcanvas").addEventListener("click", (e) => { if (e.target.id === "vcanvas") rt.clearSelection(); });
  document.addEventListener("click", () => document.querySelectorAll(".ddmenu.open").forEach((m) => m.classList.remove("open")));
  window.addEventListener("resize", fit);

  if (window.PYBI_EMBED) load(window.PYBI_EMBED);
  else { $("vlive").style.display = ""; poll(); }
})();
