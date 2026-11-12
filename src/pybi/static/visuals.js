/* PyBI visuals: d3-based renderers for every visual type, themes, tooltips and page export.
 * Author: Muhammad Rafay Shaikh, from Pakistan. MIT License. */
(function (global) {
  "use strict";
  const E = global.PyBIEngine;
  const fmtV = E.fmtValue;
  const FONT = "Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif";

  const THEMES = {
    pybi: { name: "PyBI", palette: ["#118DFF", "#12239E", "#E66C37", "#6B007B", "#E044A7", "#744EC2", "#D9B300", "#D64550", "#197278", "#1AAB40"], page: "#EEF1F5", card: "#FFFFFF", text: "#252423", sub: "#605E5C", grid: "#E6E6E6", accent: "#118DFF" },
    executive: { name: "Executive", palette: ["#1B365D", "#3E7CB1", "#81A4CD", "#DBE4EE", "#F17300", "#054A91", "#6C757D", "#A1C181"], page: "#F4F5F7", card: "#FFFFFF", text: "#1B1B1B", sub: "#5F6B7A", grid: "#E3E6EA", accent: "#F17300" },
    sunset: { name: "Sunset", palette: ["#F94144", "#F3722C", "#F8961E", "#F9C74F", "#90BE6D", "#43AA8B", "#577590", "#277DA1"], page: "#FFF8F0", card: "#FFFFFF", text: "#2B2D42", sub: "#6C6F7F", grid: "#F1E6DA", accent: "#F3722C" },
    emerald: { name: "Emerald", palette: ["#047857", "#10B981", "#34D399", "#065F46", "#F59E0B", "#3B82F6", "#8B5CF6", "#EF4444"], page: "#ECFDF5", card: "#FFFFFF", text: "#064E3B", sub: "#4B6B5F", grid: "#D1FAE5", accent: "#10B981" },
    midnight: { name: "Midnight (dark)", palette: ["#4CC9F0", "#F72585", "#7209B7", "#FFD166", "#06D6A0", "#4361EE", "#FF8C42", "#B5179E"], page: "#0B1020", card: "#151B2E", text: "#E5E7EB", sub: "#9CA3AF", grid: "#26304A", accent: "#4CC9F0" },
    mono: { name: "Monochrome", palette: ["#111827", "#374151", "#6B7280", "#9CA3AF", "#D1D5DB", "#4B5563", "#1F2937", "#E5E7EB"], page: "#F3F4F6", card: "#FFFFFF", text: "#111827", sub: "#6B7280", grid: "#E5E7EB", accent: "#111827" },
  };

  // [roleKey, label, maxFields, accepts: 'any'|'value'|'dim']
  const CAT_ROLES = [["category", "X-axis", 1, "dim"], ["series", "Legend", 1, "dim"], ["values", "Y-axis", 8, "value"]];
  const TYPES = {
    clusteredColumn: { label: "Clustered column", roles: CAT_ROLES, group: "Charts" },
    stackedColumn: { label: "Stacked column", roles: CAT_ROLES, group: "Charts" },
    percentColumn: { label: "100% stacked column", roles: CAT_ROLES, group: "Charts" },
    clusteredBar: { label: "Clustered bar", roles: [["category", "Y-axis", 1, "dim"], ["series", "Legend", 1, "dim"], ["values", "X-axis", 8, "value"]], group: "Charts" },
    stackedBar: { label: "Stacked bar", roles: [["category", "Y-axis", 1, "dim"], ["series", "Legend", 1, "dim"], ["values", "X-axis", 8, "value"]], group: "Charts" },
    line: { label: "Line chart", roles: CAT_ROLES, group: "Charts" },
    area: { label: "Area chart", roles: CAT_ROLES, group: "Charts" },
    stackedArea: { label: "Stacked area", roles: CAT_ROLES, group: "Charts" },
    lineColumn: { label: "Line & column", roles: [["category", "X-axis", 1, "dim"], ["values", "Column y-axis", 4, "value"], ["lineValues", "Line y-axis", 4, "value"]], group: "Charts" },
    waterfall: { label: "Waterfall", roles: [["category", "Category", 1, "dim"], ["values", "Y-axis", 1, "value"]], group: "Charts" },
    scatter: { label: "Scatter / bubble", roles: [["category", "Values (details)", 1, "dim"], ["series", "Legend", 1, "dim"], ["x", "X-axis", 1, "value"], ["y", "Y-axis", 1, "value"], ["size", "Size", 1, "value"]], group: "Charts" },
    pie: { label: "Pie chart", roles: [["category", "Legend", 1, "dim"], ["values", "Values", 1, "value"]], group: "Charts" },
    donut: { label: "Donut chart", roles: [["category", "Legend", 1, "dim"], ["values", "Values", 1, "value"]], group: "Charts" },
    treemap: { label: "Treemap", roles: [["category", "Category", 1, "dim"], ["values", "Values", 1, "value"]], group: "Charts" },
    funnel: { label: "Funnel", roles: [["category", "Category", 1, "dim"], ["values", "Values", 1, "value"]], group: "Charts" },
    ribbon: { label: "Ribbon (rank)", roles: CAT_ROLES, group: "Charts" },
    gauge: { label: "Gauge", roles: [["values", "Value", 1, "value"], ["target", "Target value", 1, "value"], ["max", "Maximum value", 1, "value"]], group: "KPIs" },
    card: { label: "Card", roles: [["values", "Fields", 1, "value"]], group: "KPIs" },
    multiCard: { label: "Multi-row card", roles: [["values", "Fields", 10, "value"]], group: "KPIs" },
    kpi: { label: "KPI", roles: [["values", "Value", 1, "value"], ["category", "Trend axis", 1, "dim"], ["target", "Target", 1, "value"]], group: "KPIs" },
    table: { label: "Table", roles: [["columns", "Columns", 30, "any"]], group: "Tables" },
    matrix: { label: "Matrix", roles: [["rows", "Rows", 2, "dim"], ["columns", "Columns", 1, "dim"], ["values", "Values", 8, "value"]], group: "Tables" },
    slicer: { label: "Slicer", roles: [["category", "Field", 1, "dim"]], group: "Filters" },
    textbox: { label: "Text box", roles: [], group: "Other" },
    narrative: { label: "Smart narrative", roles: [["category", "Explain by", 1, "dim"], ["values", "Measure", 1, "value"]], group: "Other" },
  };

  const ICONS = {
    clusteredColumn: '<rect x="3" y="10" width="4" height="10"/><rect x="8" y="5" width="4" height="15"/><rect x="14" y="12" width="4" height="8"/><rect x="19" y="8" width="2" height="12"/>',
    stackedColumn: '<rect x="4" y="12" width="5" height="8"/><rect x="4" y="6" width="5" height="6" opacity=".5"/><rect x="11" y="9" width="5" height="11"/><rect x="11" y="4" width="5" height="5" opacity=".5"/><rect x="18" y="14" width="3" height="6"/>',
    percentColumn: '<rect x="4" y="4" width="5" height="16" opacity=".5"/><rect x="4" y="10" width="5" height="10"/><rect x="11" y="4" width="5" height="16" opacity=".5"/><rect x="11" y="13" width="5" height="7"/><rect x="18" y="4" width="3" height="16" opacity=".5"/>',
    clusteredBar: '<rect x="4" y="3" width="14" height="4"/><rect x="4" y="9" width="9" height="4"/><rect x="4" y="15" width="16" height="4"/>',
    stackedBar: '<rect x="4" y="4" width="9" height="5"/><rect x="13" y="4" width="6" height="5" opacity=".5"/><rect x="4" y="12" width="6" height="5"/><rect x="10" y="12" width="9" height="5" opacity=".5"/>',
    line: '<polyline points="3,18 8,11 13,14 21,5" fill="none" stroke="currentColor" stroke-width="2"/>',
    area: '<path d="M3 20 L3 15 L9 9 L14 12 L21 5 L21 20Z" opacity=".7"/>',
    stackedArea: '<path d="M3 20 L3 12 L9 8 L14 10 L21 5 L21 20Z" opacity=".45"/><path d="M3 20 L3 16 L9 13 L14 15 L21 11 L21 20Z"/>',
    lineColumn: '<rect x="4" y="11" width="4" height="9"/><rect x="10" y="8" width="4" height="12"/><rect x="16" y="13" width="4" height="7"/><polyline points="3,9 9,5 15,7 21,3" fill="none" stroke="currentColor" stroke-width="2"/>',
    waterfall: '<rect x="3" y="12" width="4" height="8"/><rect x="8" y="7" width="4" height="5" opacity=".6"/><rect x="13" y="9" width="4" height="3" opacity=".6"/><rect x="18" y="9" width="3" height="11"/>',
    scatter: '<circle cx="6" cy="16" r="2"/><circle cx="11" cy="9" r="3"/><circle cx="17" cy="13" r="2"/><circle cx="18" cy="5" r="1.6"/>',
    pie: '<path d="M12 3 A9 9 0 1 0 21 12 L12 12Z" opacity=".7"/><path d="M13.5 1.6 A9 9 0 0 1 22.4 10.5 L13.5 10.5Z"/>',
    donut: '<path d="M12 3a9 9 0 1 0 9 9h-4a5 5 0 1 1-5-5z" opacity=".7"/><path d="M13 2a9 9 0 0 1 9 9h-4a5 5 0 0 0-5-5z"/>',
    treemap: '<rect x="3" y="3" width="10" height="18"/><rect x="14" y="3" width="7" height="10" opacity=".6"/><rect x="14" y="14" width="7" height="7" opacity=".4"/>',
    funnel: '<rect x="3" y="4" width="18" height="4"/><rect x="6" y="10" width="12" height="4" opacity=".7"/><rect x="9" y="16" width="6" height="4" opacity=".5"/>',
    ribbon: '<path d="M3 6 L9 6 L15 14 L21 14 L21 18 L15 18 L9 10 L3 10Z" opacity=".7"/><path d="M3 14 L9 14 L15 6 L21 6 L21 10 L15 10 L9 18 L3 18Z" opacity=".4"/>',
    gauge: '<path d="M3 17 A9 9 0 0 1 21 17" fill="none" stroke="currentColor" stroke-width="3" opacity=".35"/><path d="M3 17 A9 9 0 0 1 15 8.5" fill="none" stroke="currentColor" stroke-width="3"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="15.5" font-size="8" text-anchor="middle" font-weight="700">123</text>',
    multiCard: '<rect x="3" y="4" width="18" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="13" width="18" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    kpi: '<path d="M3 18 L8 13 L12 15 L20 6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 6 L20 6 L20 10" fill="none" stroke="currentColor" stroke-width="2"/>',
    table: '<rect x="3" y="4" width="18" height="16" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 9h18M3 14h18M10 4v16" stroke="currentColor" stroke-width="1.2"/>',
    matrix: '<rect x="3" y="4" width="18" height="16" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 9h18M8 4v16M14 9v11M3 14h18" stroke="currentColor" stroke-width="1.2"/>',
    slicer: '<path d="M4 5h16l-6 7v6l-4 2v-8z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    textbox: '<text x="12" y="17" font-size="15" text-anchor="middle" font-weight="700" font-family="serif">A</text>',
    narrative: '<path d="M4 6h16M4 10h12M4 14h16M4 18h9" stroke="currentColor" stroke-width="1.8"/>',
  };
  const icon = (t) => '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">' + (ICONS[t] || "") + "</svg>";

  // ------------------------------------------------------------ tooltip
  let tip;
  function tooltip() {
    if (!tip) { tip = document.createElement("div"); tip.className = "pybi-tip"; document.body.appendChild(tip); }
    return tip;
  }
  function showTip(ev, rows) {
    const t = tooltip();
    t.innerHTML = rows.map(([k, v, c]) => '<div class="tr">' + (c ? '<i style="background:' + c + '"></i>' : "") + "<span>" + esc(k) + "</span><b>" + esc(v) + "</b></div>").join("");
    t.style.display = "block";
    const x = ev.clientX + 14, y = ev.clientY + 12;
    const r = t.getBoundingClientRect();
    t.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
    t.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  }
  function hideTip() { if (tip) tip.style.display = "none"; }
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ------------------------------------------------------------ helpers
  function colorsFor(visual, theme, n) {
    const custom = (visual.format && visual.format.colors) || [];
    const base = theme.palette;
    return d3.range(Math.max(n, 1)).map((i) => custom[i] || (n === 1 && visual.format && visual.format.color) || base[i % base.length]);
  }
  function catText(c) { return fmtV(c); }
  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function measureText(s, size) { return String(s).length * size * 0.56; }

  function makeSvg(el, w, h) {
    const svg = d3.select(el).append("svg").attr("class", "chart").attr("width", w).attr("height", h).attr("viewBox", "0 0 " + w + " " + h)
      .attr("xmlns", "http://www.w3.org/2000/svg").style("font-family", FONT);
    return svg;
  }

  function legend(svg, items, x, y, w, theme, orient) {
    const g = svg.append("g").attr("class", "legend").attr("transform", "translate(" + x + "," + y + ")");
    let cx = 0, cy = 0;
    items.forEach((it) => {
      const label = truncate(it.name, 28);
      const lw = 16 + measureText(label, 11) + 12;
      if (orient !== "vertical" && cx + lw > w && cx > 0) { cx = 0; cy += 16; }
      const gi = g.append("g").attr("transform", "translate(" + cx + "," + cy + ")");
      gi.append("circle").attr("cx", 5).attr("cy", 6).attr("r", 5).attr("fill", it.color);
      gi.append("text").attr("x", 14).attr("y", 10).attr("font-size", 11).attr("fill", theme.sub).text(label);
      if (orient === "vertical") cy += 17; else cx += lw;
    });
    return orient === "vertical" ? cy : cy + 18;
  }

  function axisStyle(g, theme) {
    g.selectAll("text").attr("fill", theme.sub).attr("font-size", 11);
    g.selectAll("line").attr("stroke", theme.grid);
    g.select(".domain").attr("stroke", theme.grid);
  }

  function selectedOpacity(sel, value) { return !sel || !sel.size || sel.has(value) ? 1 : 0.3; }

  // ------------------------------------------------------------ category charts
  function renderCategory(el, v, r, o) {
    const theme = o.theme, f = v.format || {}, W = o.width, H = o.height;
    const horizontal = ["clusteredBar", "stackedBar"].includes(v.type);
    const stacked = ["stackedColumn", "stackedBar", "percentColumn", "stackedArea"].includes(v.type);
    const percent = v.type === "percentColumn";
    const isLine = ["line", "area", "stackedArea"].includes(v.type);
    const series = r.series.slice();
    const lines = (r.lines || []).slice();
    const all = series.concat(lines);
    const colors = colorsFor(v, theme, all.length);
    all.forEach((s, i) => (s.color = colors[i]));
    const svg = makeSvg(el, W, H);
    const showLegend = f.legend !== false && (all.length > 1 || r.legendField);
    let top = 6;
    if (showLegend) top += legend(svg, all.map((s) => ({ name: s.name, color: s.color })), 8, 4, W - 16, theme);
    const cats = r.categories;
    const n = cats.length;
    // values
    let data = cats.map((c, i) => {
      const row = { c, i };
      series.forEach((s, j) => (row[j] = s.values[i] || 0));
      return row;
    });
    if (percent) data.forEach((row) => { const t = series.reduce((a, _, j) => a + Math.abs(row[j]), 0) || 1; series.forEach((_, j) => (row[j] = row[j] / t)); });
    let maxV, minV;
    if (stacked) {
      maxV = d3.max(data, (row) => series.reduce((a, _, j) => a + Math.max(0, row[j]), 0)) || 0;
      minV = d3.min(data, (row) => series.reduce((a, _, j) => a + Math.min(0, row[j]), 0)) || 0;
    } else {
      maxV = d3.max(series, (s) => d3.max(s.values, (x) => x || 0)) || 0;
      minV = Math.min(0, d3.min(series, (s) => d3.min(s.values, (x) => x || 0)) || 0);
    }
    const yfmt = percent ? { type: "percent", decimals: 0 } : (series[0] && series[0].fmt) || {};
    const longest = d3.max(cats, (c) => truncate(catText(c), 18).length) || 4;
    const valW = Math.max(30, measureText(fmtV(maxV, yfmt, true), 11) + 10);
    const m = horizontal
      ? { l: Math.min(150, longest * 6.4 + 14), r: 16, t: top + 6, b: f.axisTitles === false ? 22 : 34 }
      : { l: f.axisTitles === false ? valW : valW + 14, r: lines.length ? 50 : 14, t: top + 8, b: 0 };
    // x-axis label rotation for columns
    let rotate = false;
    if (!horizontal) {
      const slot = (W - m.l - m.r) / Math.max(n, 1);
      rotate = longest * 6.2 > slot && n > 3;
      m.b = (rotate ? Math.min(80, longest * 5 + 18) : 26) + (f.axisTitles === false ? 0 : 14);
    }
    const iw = Math.max(10, W - m.l - m.r), ih = Math.max(10, H - m.t - m.b);
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    const band = d3.scaleBand().domain(d3.range(n)).range(horizontal ? [0, ih] : [0, iw]).padding(isLine ? 0 : 0.22);
    const point = d3.scalePoint().domain(d3.range(n)).range([0, iw]).padding(0.3);
    const lin = d3.scaleLinear().domain([minV, maxV === minV ? minV + 1 : maxV]).nice().range(horizontal ? [0, iw] : [ih, 0]);
    // grid & axes
    if (f.gridlines !== false) {
      const ticks = lin.ticks(horizontal ? Math.max(2, Math.floor(iw / 90)) : Math.max(2, Math.floor(ih / 40)));
      g.append("g").selectAll("line").data(ticks).join("line")
        .attr("x1", horizontal ? (d) => lin(d) : 0).attr("x2", horizontal ? (d) => lin(d) : iw)
        .attr("y1", horizontal ? 0 : (d) => lin(d)).attr("y2", horizontal ? ih : (d) => lin(d))
        .attr("stroke", theme.grid).attr("stroke-dasharray", "2,3");
    }
    const tickFmt = (d) => fmtV(d, yfmt, true);
    const catLabel = (i) => truncate(catText(cats[i]), rotate ? 16 : 18);
    if (horizontal) {
      axisStyle(g.append("g").call(d3.axisLeft(band).tickFormat(catLabel).tickSize(0).tickPadding(6)), theme);
      axisStyle(g.append("g").attr("transform", "translate(0," + ih + ")").call(d3.axisBottom(lin).ticks(Math.max(2, Math.floor(iw / 90))).tickFormat(tickFmt).tickSize(0).tickPadding(6)), theme);
    } else {
      const xs = isLine ? point : band;
      const every = Math.ceil(n / Math.max(1, Math.floor(iw / (rotate ? 22 : 40))));
      const xa = g.append("g").attr("transform", "translate(0," + ih + ")").call(d3.axisBottom(xs).tickFormat((i) => (i % every === 0 ? catLabel(i) : "")).tickSize(0).tickPadding(7));
      axisStyle(xa, theme);
      if (rotate) xa.selectAll("text").attr("transform", "rotate(-40)").attr("text-anchor", "end").attr("dx", "-0.3em").attr("dy", "0.4em");
      axisStyle(g.append("g").call(d3.axisLeft(lin).ticks(Math.max(2, Math.floor(ih / 40))).tickFormat(tickFmt).tickSize(0).tickPadding(6)), theme);
    }
    g.selectAll(".domain").attr("stroke", "none");
    if (f.axisTitles !== false) {
      const ct = r.catLabel || "", vt = series.length === 1 && !r.legendField ? series[0].name : "";
      if (horizontal) {
        if (vt) g.append("text").attr("x", iw / 2).attr("y", ih + 30).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", theme.sub).text(truncate(vt, 40));
      } else {
        g.append("text").attr("x", iw / 2).attr("y", ih + m.b - 4).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", theme.sub).text(truncate(ct, 50));
        if (vt) g.append("text").attr("transform", "rotate(-90)").attr("x", -ih / 2).attr("y", -m.l + 11).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", theme.sub).text(truncate(vt, 40));
      }
    }
    const sel = o.selection;
    const tipRows = (i, highlight) => [[r.catLabel || "Category", catText(cats[i])]].concat(all.map((s) => [s.name, fmtV(s.values[i], s.fmt), s.color]));
    const click = (ev, i) => { ev.stopPropagation(); if (o.onSelect && r.catField) o.onSelect(cats[i], ev.ctrlKey || ev.metaKey); };
    const labelsOn = f.dataLabels;

    if (!isLine) {
      const sub = d3.scaleBand().domain(d3.range(series.length)).range([0, band.bandwidth()]).padding(0.06);
      series.forEach((s, j) => {
        const rects = g.append("g").selectAll("rect").data(data).join("rect")
          .attr("fill", s.color).attr("rx", f.rounded === false ? 0 : 2)
          .attr("opacity", (d) => selectedOpacity(sel, cats[d.i])).style("cursor", r.catField ? "pointer" : "default")
          .on("mousemove", (ev, d) => showTip(ev, tipRows(d.i))).on("mouseleave", hideTip).on("click", (ev, d) => click(ev, d.i));
        const base = (d) => (stacked ? series.slice(0, j).reduce((a, _, k) => a + (Math.sign(d[k]) === Math.sign(d[j]) ? d[k] : 0), 0) : 0);
        if (horizontal) {
          rects.attr("y", (d) => band(d.i) + (stacked ? 0 : sub(j))).attr("height", stacked ? band.bandwidth() : sub.bandwidth())
            .attr("x", (d) => lin(Math.min(base(d), base(d) + d[j]))).attr("width", (d) => Math.abs(lin(base(d) + d[j]) - lin(base(d))));
        } else {
          rects.attr("x", (d) => band(d.i) + (stacked ? 0 : sub(j))).attr("width", stacked ? band.bandwidth() : sub.bandwidth())
            .attr("y", (d) => lin(Math.max(base(d), base(d) + d[j]))).attr("height", (d) => Math.abs(lin(base(d)) - lin(base(d) + d[j])));
        }
        if (labelsOn && (!stacked || series.length === 1)) {
          g.append("g").selectAll("text").data(data).join("text").attr("font-size", 10).attr("fill", theme.sub)
            .attr("text-anchor", horizontal ? "start" : "middle")
            .attr("x", (d) => (horizontal ? lin(d[j]) + 4 : band(d.i) + (stacked ? band.bandwidth() / 2 : sub(j) + sub.bandwidth() / 2)))
            .attr("y", (d) => (horizontal ? band(d.i) + (stacked ? band.bandwidth() / 2 : sub(j) + sub.bandwidth() / 2) + 3 : lin(d[j]) - 4))
            .text((d) => fmtV(d[j], percent ? yfmt : s.fmt, true));
        }
      });
    } else {
      const curve = f.smooth === false ? d3.curveLinear : d3.curveMonotoneX;
      let cum = data.map(() => 0);
      series.forEach((s, j) => {
        const y0 = cum.slice();
        const y1 = data.map((d, i) => (stacked ? y0[i] + d[j] : d[j]));
        if (stacked) cum = y1;
        const pts = data.map((d, i) => ({ i, y0: y0[i], y1: y1[i], blank: E.isBlank(s.values[i]) }));
        if (v.type !== "line") {
          g.append("path").datum(pts).attr("fill", s.color).attr("opacity", stacked ? 0.75 : 0.22)
            .attr("d", d3.area().curve(curve).x((d) => point(d.i)).y0((d) => lin(stacked ? d.y0 : Math.max(0, minV))).y1((d) => lin(d.y1)));
        }
        g.append("path").datum(pts.filter((p) => !p.blank || stacked)).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", f.lineWidth || 2.4)
          .attr("d", d3.line().curve(curve).x((d) => point(d.i)).y((d) => lin(d.y1)));
        if (f.markers !== false && n <= 60) {
          g.append("g").selectAll("circle").data(pts.filter((p) => !p.blank)).join("circle").attr("cx", (d) => point(d.i)).attr("cy", (d) => lin(d.y1))
            .attr("r", 3.2).attr("fill", theme.card).attr("stroke", s.color).attr("stroke-width", 2).attr("opacity", (d) => selectedOpacity(sel, cats[d.i]));
        }
        if (labelsOn) g.append("g").selectAll("text").data(pts.filter((p) => !p.blank)).join("text").attr("x", (d) => point(d.i)).attr("y", (d) => lin(d.y1) - 7)
          .attr("text-anchor", "middle").attr("font-size", 10).attr("fill", theme.sub).text((d) => fmtV(s.values[d.i], s.fmt, true));
      });
      // hover rail
      const step = n > 1 ? point(1) - point(0) : iw;
      g.append("g").selectAll("rect").data(data).join("rect").attr("x", (d) => point(d.i) - step / 2).attr("width", step).attr("y", 0).attr("height", ih)
        .attr("fill", "transparent").style("cursor", r.catField ? "pointer" : "default")
        .on("mousemove", (ev, d) => showTip(ev, tipRows(d.i))).on("mouseleave", hideTip).on("click", (ev, d) => click(ev, d.i));
    }
    // secondary line axis (combo)
    if (lines.length) {
      const lmax = d3.max(lines, (s) => d3.max(s.values, (x) => x || 0)) || 1;
      const lmin = Math.min(0, d3.min(lines, (s) => d3.min(s.values, (x) => x || 0)) || 0);
      const l2 = d3.scaleLinear().domain([lmin, lmax]).nice().range([ih, 0]);
      axisStyle(g.append("g").attr("transform", "translate(" + iw + ",0)").call(d3.axisRight(l2).ticks(Math.max(2, Math.floor(ih / 40))).tickFormat((d) => fmtV(d, lines[0].fmt, true)).tickSize(0).tickPadding(6)), theme);
      g.selectAll(".domain").attr("stroke", "none");
      lines.forEach((s) => {
        const pts = s.values.map((y, i) => ({ i, y })).filter((p) => !E.isBlank(p.y));
        const x = (i) => band(i) + band.bandwidth() / 2;
        g.append("path").datum(pts).attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 2.6).attr("d", d3.line().curve(d3.curveMonotoneX).x((d) => x(d.i)).y((d) => l2(d.y)));
        g.append("g").selectAll("circle").data(pts).join("circle").attr("cx", (d) => x(d.i)).attr("cy", (d) => l2(d.y)).attr("r", 3.5).attr("fill", theme.card).attr("stroke", s.color).attr("stroke-width", 2)
          .on("mousemove", (ev, d) => showTip(ev, tipRows(d.i))).on("mouseleave", hideTip);
        if (labelsOn) g.append("g").selectAll("text").data(pts).join("text").attr("x", (d) => x(d.i)).attr("y", (d) => l2(d.y) - 8).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", s.color).text((d) => fmtV(d.y, s.fmt, true));
      });
    }
    svg.on("click", () => o.onSelect && o.onSelect(null));
  }

  // ------------------------------------------------------------ ribbon (rank) chart
  function renderRibbon(el, v, r, o) {
    const theme = o.theme, W = o.width, H = o.height;
    const svg = makeSvg(el, W, H);
    const colors = colorsFor(v, theme, r.series.length);
    let top = 4 + legend(svg, r.series.map((s, i) => ({ name: s.name, color: colors[i] })), 8, 4, W - 16, theme);
    const m = { l: 10, r: 10, t: top + 6, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b; const n = r.categories.length;
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    const band = d3.scaleBand().domain(d3.range(n)).range([0, iw]).padding(0.45);
    const totals = r.categories.map((_, i) => r.series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
    const k = ih / (d3.max(totals) || 1);
    const pos = r.categories.map((_, i) => {
      const order = r.series.map((s, j) => [j, s.values[i] || 0]).sort((a, b) => a[1] - b[1]);
      let y = ih; const out = {};
      order.forEach(([j, val]) => { const hgt = Math.max(0, val) * k; out[j] = { y0: y - hgt, y1: y }; y -= hgt; });
      return out;
    });
    r.series.forEach((s, j) => {
      for (let i = 0; i < n; i++) {
        const p = pos[i][j]; const x = band(i);
        g.append("rect").attr("x", x).attr("width", band.bandwidth()).attr("y", p.y0).attr("height", p.y1 - p.y0).attr("fill", colors[j])
          .on("mousemove", (ev) => showTip(ev, [[r.catLabel, catText(r.categories[i])], [s.name, fmtV(s.values[i], s.fmt), colors[j]]])).on("mouseleave", hideTip);
        if (i < n - 1) {
          const q = pos[i + 1][j]; const x1 = x + band.bandwidth(), x2 = band(i + 1);
          g.append("path").attr("d", "M" + x1 + "," + p.y0 + " C" + (x1 + x2) / 2 + "," + p.y0 + " " + (x1 + x2) / 2 + "," + q.y0 + " " + x2 + "," + q.y0 + " L" + x2 + "," + q.y1 + " C" + (x1 + x2) / 2 + "," + q.y1 + " " + (x1 + x2) / 2 + "," + p.y1 + " " + x1 + "," + p.y1 + "Z")
            .attr("fill", colors[j]).attr("opacity", 0.35);
        }
      }
    });
    axisStyle(g.append("g").attr("transform", "translate(0," + ih + ")").call(d3.axisBottom(band).tickFormat((i) => truncate(catText(r.categories[i]), 12)).tickSize(0).tickPadding(6)), theme);
    g.selectAll(".domain").attr("stroke", "none");
  }

  // ------------------------------------------------------------ pie / donut
  function renderPie(el, v, r, o) {
    const theme = o.theme, f = v.format || {}, W = o.width, H = o.height;
    const s = r.series[0]; if (!s) return;
    const items = r.categories.map((c, i) => ({ c, v: Math.max(0, s.values[i] || 0) })).filter((d) => d.v > 0);
    const colors = colorsFor(v, theme, items.length).map((c, i) => (f.colors && f.colors[i]) || theme.palette[i % theme.palette.length]);
    const svg = makeSvg(el, W, H);
    const legendW = f.legend === false ? 0 : Math.min(170, W * 0.36);
    const cx = (W - legendW) / 2, cy = H / 2;
    const R = Math.max(10, Math.min(cx, cy) - (f.dataLabels === false ? 8 : 26));
    const inner = v.type === "donut" ? R * (f.innerRadius ?? 0.58) : 0;
    const total = d3.sum(items, (d) => d.v);
    const arcs = d3.pie().sort(null).value((d) => d.v)(items);
    const arc = d3.arc().innerRadius(inner).outerRadius(R).padAngle(0.008).cornerRadius(2);
    const g = svg.append("g").attr("transform", "translate(" + cx + "," + cy + ")");
    g.selectAll("path").data(arcs).join("path").attr("d", arc).attr("fill", (d, i) => colors[i]).attr("stroke", theme.card).attr("stroke-width", 1.5)
      .attr("opacity", (d) => selectedOpacity(o.selection, d.data.c)).style("cursor", "pointer")
      .on("mousemove", (ev, d) => showTip(ev, [[r.catLabel, catText(d.data.c)], [s.name, fmtV(d.data.v, s.fmt), colors[d.index]], ["% of total", fmtV(d.data.v / total, { type: "percent" })]]))
      .on("mouseleave", hideTip).on("click", (ev, d) => { ev.stopPropagation(); o.onSelect && o.onSelect(d.data.c, ev.ctrlKey || ev.metaKey); });
    if (f.dataLabels !== false) {
      const la = d3.arc().innerRadius(R + 12).outerRadius(R + 12);
      g.selectAll("text.l").data(arcs.filter((d) => d.endAngle - d.startAngle > 0.22)).join("text").attr("class", "l")
        .attr("transform", (d) => "translate(" + la.centroid(d) + ")").attr("text-anchor", (d) => ((d.startAngle + d.endAngle) / 2 > Math.PI ? "end" : "start"))
        .attr("font-size", 10.5).attr("fill", theme.sub).attr("dy", "0.35em").text((d) => fmtV(d.data.v / total, { type: "percent", decimals: 0 }));
    }
    if (inner > 30) {
      g.append("text").attr("text-anchor", "middle").attr("dy", "-0.2em").attr("font-size", Math.min(22, inner / 2.6)).attr("font-weight", 600).attr("fill", theme.text).text(fmtV(total, s.fmt, true));
      g.append("text").attr("text-anchor", "middle").attr("dy", "1.3em").attr("font-size", 10.5).attr("fill", theme.sub).text(truncate(s.name, 22));
    }
    if (legendW) legend(svg, items.slice(0, Math.floor((H - 10) / 17)).map((d, i) => ({ name: catText(d.c), color: colors[i] })), W - legendW + 4, Math.max(6, H / 2 - Math.min(items.length, Math.floor((H - 10) / 17)) * 8.5), legendW - 8, theme, "vertical");
    svg.on("click", () => o.onSelect && o.onSelect(null));
  }

  // ------------------------------------------------------------ treemap
  function renderTreemap(el, v, r, o) {
    const theme = o.theme, W = o.width, H = o.height; const s = r.series[0]; if (!s) return;
    const items = r.categories.map((c, i) => ({ c, v: Math.max(0, s.values[i] || 0), i })).filter((d) => d.v > 0);
    const colors = theme.palette;
    const svg = makeSvg(el, W, H);
    const root = d3.hierarchy({ children: items }).sum((d) => d.v).sort((a, b) => b.value - a.value);
    d3.treemap().size([W, H]).paddingInner(2).round(true)(root);
    const total = root.value || 1;
    const leaf = svg.selectAll("g").data(root.leaves()).join("g").attr("transform", (d) => "translate(" + d.x0 + "," + d.y0 + ")");
    leaf.append("rect").attr("width", (d) => d.x1 - d.x0).attr("height", (d) => d.y1 - d.y0).attr("fill", (d, i) => (v.format && v.format.colors && v.format.colors[i]) || colors[i % colors.length])
      .attr("opacity", (d) => selectedOpacity(o.selection, d.data.c)).style("cursor", "pointer")
      .on("mousemove", (ev, d) => showTip(ev, [[r.catLabel, catText(d.data.c)], [s.name, fmtV(d.data.v, s.fmt)], ["% of total", fmtV(d.data.v / total, { type: "percent" })]]))
      .on("mouseleave", hideTip).on("click", (ev, d) => { ev.stopPropagation(); o.onSelect && o.onSelect(d.data.c, ev.ctrlKey || ev.metaKey); });
    leaf.filter((d) => d.x1 - d.x0 > 46 && d.y1 - d.y0 > 26).append("text").attr("x", 6).attr("y", 16).attr("font-size", 11.5).attr("fill", "#fff").attr("font-weight", 600)
      .text((d) => truncate(catText(d.data.c), Math.floor((d.x1 - d.x0) / 7))).style("pointer-events", "none");
    leaf.filter((d) => d.x1 - d.x0 > 46 && d.y1 - d.y0 > 42).append("text").attr("x", 6).attr("y", 31).attr("font-size", 10.5).attr("fill", "rgba(255,255,255,.85)")
      .text((d) => fmtV(d.data.v, s.fmt, true)).style("pointer-events", "none");
    svg.on("click", () => o.onSelect && o.onSelect(null));
  }

  // ------------------------------------------------------------ funnel
  function renderFunnel(el, v, r, o) {
    const theme = o.theme, W = o.width, H = o.height; const s = r.series[0]; if (!s) return;
    const items = r.categories.map((c, i) => ({ c, v: s.values[i] || 0 }));
    const svg = makeSvg(el, W, H);
    const max = d3.max(items, (d) => d.v) || 1; const first = items[0] ? items[0].v : 1;
    const labelW = Math.min(130, W * 0.3);
    const bh = Math.min(42, (H - 10) / Math.max(items.length, 1));
    const color = (v.format && v.format.color) || theme.palette[0];
    items.forEach((d, i) => {
      const w = Math.max(2, ((W - labelW - 20) * d.v) / max); const x = labelW + (W - labelW - 10 - w) / 2; const y = 5 + i * bh;
      svg.append("rect").attr("x", x).attr("y", y).attr("width", w).attr("height", bh - 5).attr("rx", 2).attr("fill", color)
        .attr("opacity", selectedOpacity(o.selection, d.c) * (1 - i * 0.05)).style("cursor", "pointer")
        .on("mousemove", (ev) => showTip(ev, [[r.catLabel, catText(d.c)], [s.name, fmtV(d.v, s.fmt)], ["% of first", fmtV(d.v / first, { type: "percent" })]]))
        .on("mouseleave", hideTip).on("click", (ev) => { ev.stopPropagation(); o.onSelect && o.onSelect(d.c, ev.ctrlKey || ev.metaKey); });
      svg.append("text").attr("x", labelW - 8).attr("y", y + bh / 2).attr("text-anchor", "end").attr("font-size", 11).attr("fill", theme.sub).text(truncate(catText(d.c), 20));
      svg.append("text").attr("x", x + w / 2).attr("y", y + bh / 2).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", w > 60 ? "#fff" : theme.text).attr("font-weight", 600).style("pointer-events", "none").text(fmtV(d.v, s.fmt, true));
    });
  }

  // ------------------------------------------------------------ waterfall
  function renderWaterfall(el, v, r, o) {
    const theme = o.theme, W = o.width, H = o.height; const s = r.series[0]; if (!s) return;
    const f = v.format || {};
    let run = 0;
    const items = r.categories.map((c, i) => { const val = s.values[i] || 0; const d = { c, v: val, a: run, b: run + val }; run += val; return d; });
    items.push({ c: "Total", v: run, a: 0, b: run, total: true });
    const svg = makeSvg(el, W, H);
    const m = { l: 56, r: 10, t: 12, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    const x = d3.scaleBand().domain(d3.range(items.length)).range([0, iw]).padding(0.25);
    const y = d3.scaleLinear().domain([Math.min(0, d3.min(items, (d) => Math.min(d.a, d.b))), d3.max(items, (d) => Math.max(d.a, d.b)) || 1]).nice().range([ih, 0]);
    g.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y).attr("stroke", theme.grid).attr("stroke-dasharray", "2,3");
    const up = f.upColor || "#1AAB40", down = f.downColor || "#D64550", tot = f.totalColor || theme.palette[0];
    g.selectAll("rect").data(items).join("rect").attr("x", (d, i) => x(i)).attr("width", x.bandwidth()).attr("y", (d) => y(Math.max(d.a, d.b))).attr("height", (d) => Math.max(1, Math.abs(y(d.a) - y(d.b))))
      .attr("fill", (d) => (d.total ? tot : d.v >= 0 ? up : down)).attr("rx", 2).attr("opacity", (d) => (d.total ? 1 : selectedOpacity(o.selection, d.c)))
      .on("mousemove", (ev, d) => showTip(ev, [[r.catLabel, catText(d.c)], [d.total ? "Total" : "Change", fmtV(d.v, s.fmt)], ["Running total", fmtV(d.b, s.fmt)]]))
      .on("mouseleave", hideTip).on("click", (ev, d) => { ev.stopPropagation(); if (!d.total && o.onSelect) o.onSelect(d.c, ev.ctrlKey || ev.metaKey); });
    g.selectAll("text.v").data(items).join("text").attr("class", "v").attr("x", (d, i) => x(i) + x.bandwidth() / 2).attr("y", (d) => y(Math.max(d.a, d.b)) - 4).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", theme.sub).text((d) => fmtV(d.v, s.fmt, true));
    axisStyle(g.append("g").attr("transform", "translate(0," + ih + ")").call(d3.axisBottom(x).tickFormat((i) => truncate(catText(items[i].c), 12)).tickSize(0).tickPadding(6)), theme);
    axisStyle(g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat((d) => fmtV(d, s.fmt, true)).tickSize(0).tickPadding(6)), theme);
    g.selectAll(".domain").attr("stroke", "none");
  }

  // ------------------------------------------------------------ scatter
  function renderScatter(el, v, r, o) {
    const theme = o.theme, f = v.format || {}, W = o.width, H = o.height;
    const svg = makeSvg(el, W, H);
    const seriesNames = Array.from(new Set(r.points.map((p) => p.series ?? r.yLabel)));
    const colors = colorsFor(v, theme, seriesNames.length);
    const cmap = new Map(seriesNames.map((s, i) => [s, colors[i]]));
    let top = 6;
    if (seriesNames.length > 1 && f.legend !== false) top += legend(svg, seriesNames.map((s) => ({ name: fmtV(s), color: cmap.get(s) })), 8, 4, W - 16, theme);
    const m = { l: 62, r: 16, t: top + 8, b: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    const x = d3.scaleLinear().domain(d3.extent(r.points, (p) => p.x)).nice().range([0, iw]);
    const y = d3.scaleLinear().domain(d3.extent(r.points, (p) => p.y)).nice().range([ih, 0]);
    const size = d3.scaleSqrt().domain([0, d3.max(r.points, (p) => p.size || 1) || 1]).range([4, Math.min(28, Math.min(iw, ih) / 9)]);
    g.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y).attr("stroke", theme.grid).attr("stroke-dasharray", "2,3");
    axisStyle(g.append("g").attr("transform", "translate(0," + ih + ")").call(d3.axisBottom(x).ticks(Math.max(2, iw / 90)).tickFormat((d) => fmtV(d, r.xFmt, true)).tickSize(0).tickPadding(6)), theme);
    axisStyle(g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat((d) => fmtV(d, r.yFmt, true)).tickSize(0).tickPadding(6)), theme);
    g.selectAll(".domain").attr("stroke", "none");
    g.append("text").attr("x", iw / 2).attr("y", ih + 32).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", theme.sub).text(r.xLabel);
    g.append("text").attr("transform", "rotate(-90)").attr("x", -ih / 2).attr("y", -48).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", theme.sub).text(r.yLabel);
    const pts = r.points.slice().sort((a, b) => (b.size || 0) - (a.size || 0));
    g.selectAll("circle").data(pts).join("circle").attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y)).attr("r", (p) => (r.sizeLabel ? size(p.size || 0) : 5.5))
      .attr("fill", (p) => cmap.get(p.series ?? r.yLabel)).attr("fill-opacity", (p) => 0.7 * selectedOpacity(o.selection, p.label)).attr("stroke", theme.card).style("cursor", "pointer")
      .on("mousemove", (ev, p) => showTip(ev, [[r.catLabel || "Point", catText(p.label)], [r.xLabel, fmtV(p.x, r.xFmt)], [r.yLabel, fmtV(p.y, r.yFmt)]].concat(r.sizeLabel ? [[r.sizeLabel, fmtV(p.size)]] : [])))
      .on("mouseleave", hideTip).on("click", (ev, p) => { ev.stopPropagation(); if (r.catField && o.onSelect) o.onSelect(p.label, ev.ctrlKey || ev.metaKey); });
    if (f.dataLabels !== false && pts.length <= 24) g.selectAll("text.pl").data(pts).join("text").attr("class", "pl").attr("x", (p) => x(p.x) + (r.sizeLabel ? size(p.size || 0) : 6) + 3).attr("y", (p) => y(p.y) + 3).attr("font-size", 9.5).attr("fill", theme.sub).style("pointer-events", "none").text((p) => truncate(catText(p.label), 16));
    svg.on("click", () => o.onSelect && o.onSelect(null));
  }

  // ------------------------------------------------------------ gauge / card / kpi
  function renderGauge(el, v, r, o) {
    const theme = o.theme, W = o.width, H = o.height;
    const svg = makeSvg(el, W, H);
    const R = Math.max(20, Math.min(W / 2 - 16, H - 46));
    const cx = W / 2, cy = Math.min(H - 30, R + 18);
    const min = r.min || 0, max = r.max || 1;
    const k = d3.scaleLinear().domain([min, max]).range([-Math.PI / 2, Math.PI / 2]).clamp(true);
    const arc = d3.arc().innerRadius(R * 0.68).outerRadius(R).cornerRadius(3);
    const g = svg.append("g").attr("transform", "translate(" + cx + "," + cy + ")");
    g.append("path").attr("d", arc({ startAngle: -Math.PI / 2, endAngle: Math.PI / 2 })).attr("fill", theme.grid);
    const color = (v.format && v.format.color) || theme.palette[0];
    g.append("path").attr("d", arc({ startAngle: -Math.PI / 2, endAngle: k(r.value || 0) })).attr("fill", color)
      .on("mousemove", (ev) => showTip(ev, [[r.label, fmtV(r.value, r.fmt)]].concat(r.target != null ? [[r.targetLabel || "Target", fmtV(r.target, r.fmt)], ["Achieved", fmtV((r.value || 0) / (r.target || 1), { type: "percent" })]] : []))).on("mouseleave", hideTip);
    if (r.target != null) {
      const a = k(r.target) - Math.PI / 2;
      g.append("line").attr("x1", Math.cos(a) * R * 0.62).attr("y1", Math.sin(a) * R * 0.62).attr("x2", Math.cos(a) * R * 1.06).attr("y2", Math.sin(a) * R * 1.06).attr("stroke", theme.text).attr("stroke-width", 2.5);
    }
    g.append("text").attr("text-anchor", "middle").attr("y", -R * 0.12).attr("font-size", Math.max(14, Math.min(30, R / 3.2))).attr("font-weight", 600).attr("fill", theme.text).text(fmtV(r.value, r.fmt, true));
    if (r.target != null) g.append("text").attr("text-anchor", "middle").attr("y", 8).attr("font-size", 11).attr("fill", theme.sub).text(fmtV((r.value || 0) / (r.target || 1), { type: "percent", decimals: 0 }) + " of target");
    g.append("text").attr("x", -R * 0.84).attr("y", 16).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", theme.sub).text(fmtV(min, r.fmt, true));
    g.append("text").attr("x", R * 0.84).attr("y", 16).attr("text-anchor", "middle").attr("font-size", 10).attr("fill", theme.sub).text(fmtV(max, r.fmt, true));
    if (r.target != null) svg.append("text").attr("x", W / 2).attr("y", H - 6).attr("text-anchor", "middle").attr("font-size", 10.5).attr("fill", theme.sub).text((r.targetLabel || "Target") + ": " + fmtV(r.target, r.fmt, true));
  }

  function renderCard(el, v, r, o) {
    const theme = o.theme, f = v.format || {}, W = o.width, H = o.height;
    const svg = makeSvg(el, W, H);
    const txt = fmtV(r.value, r.fmt, f.compact !== false);
    const size = f.fontSize || Math.max(14, Math.min(H * 0.42, (W * 0.9) / Math.max(4, txt.length * 0.6)));
    const color = f.color || theme.text;
    svg.append("text").attr("x", W / 2).attr("y", H / 2 + size * 0.2).attr("text-anchor", "middle").attr("font-size", size).attr("font-weight", 600).attr("fill", color).text(txt)
      .on("mousemove", (ev) => showTip(ev, [[r.label, fmtV(r.value, r.fmt)]])).on("mouseleave", hideTip);
    if (f.showLabel !== false) svg.append("text").attr("x", W / 2).attr("y", H / 2 + size * 0.2 + 20).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", theme.sub).text(truncate(r.label, 40));
    if (f.accent !== false) svg.append("rect").attr("x", 0).attr("y", 0).attr("width", 4).attr("height", H).attr("fill", f.accentColor || theme.accent);
  }

  function renderMultiCard(el, v, r, o) {
    const theme = o.theme, W = o.width, H = o.height;
    const svg = makeSvg(el, W, H);
    const n = r.items.length || 1; const cols = W > 420 && n > 2 ? Math.min(n, Math.floor(W / 180)) : 1;
    const rows = Math.ceil(n / cols); const cw = W / cols, ch = H / rows;
    r.items.forEach((it, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      svg.append("rect").attr("x", x + 6).attr("y", y + ch * 0.18).attr("width", 3).attr("height", ch * 0.64).attr("fill", theme.palette[i % theme.palette.length]);
      svg.append("text").attr("x", x + 16).attr("y", y + ch / 2).attr("font-size", Math.min(26, ch * 0.38)).attr("font-weight", 600).attr("fill", theme.text).text(fmtV(it.value, it.fmt, true));
      svg.append("text").attr("x", x + 16).attr("y", y + ch / 2 + 16).attr("font-size", 11).attr("fill", theme.sub).text(truncate(it.label, 32));
    });
  }

  function renderKPI(el, v, r, o) {
    const theme = o.theme, W = o.width, H = o.height;
    const svg = makeSvg(el, W, H);
    const good = r.target == null || (r.value || 0) >= r.target;
    const higherBetter = !(v.format && v.format.lowerIsBetter);
    const ok = higherBetter ? good : !good;
    const col = ok ? "#1AAB40" : "#D64550";
    if (r.trend && r.trend.length > 1) {
      const x = d3.scalePoint().domain(d3.range(r.trend.length)).range([0, W]);
      const y = d3.scaleLinear().domain(d3.extent(r.trend, (d) => d.v)).range([H - 4, H * 0.45]);
      svg.append("path").datum(r.trend).attr("fill", col).attr("opacity", 0.14).attr("d", d3.area().curve(d3.curveMonotoneX).x((d, i) => x(i)).y0(H).y1((d) => y(d.v)));
      svg.append("path").datum(r.trend).attr("fill", "none").attr("stroke", col).attr("stroke-width", 2).attr("d", d3.line().curve(d3.curveMonotoneX).x((d, i) => x(i)).y((d) => y(d.v)));
    }
    const size = Math.max(16, Math.min(H * 0.3, W / 7));
    svg.append("text").attr("x", W / 2).attr("y", H * 0.32).attr("text-anchor", "middle").attr("font-size", size).attr("font-weight", 600).attr("fill", theme.text).text(fmtV(r.value, r.fmt, true));
    if (r.target != null) {
      const diff = r.target ? (r.value - r.target) / Math.abs(r.target) : 0;
      svg.append("text").attr("x", W / 2).attr("y", H * 0.32 + 20).attr("text-anchor", "middle").attr("font-size", 11.5).attr("fill", col).attr("font-weight", 600)
        .text((diff >= 0 ? "▲ " : "▼ ") + fmtV(Math.abs(diff), { type: "percent" }) + " vs " + (r.targetLabel || "target") + " (" + fmtV(r.target, r.fmt, true) + ")");
    }
    if (r.period != null) svg.append("text").attr("x", 8).attr("y", 14).attr("font-size", 10.5).attr("fill", theme.sub).text(catText(r.period));
    svg.on("mousemove", (ev) => showTip(ev, [[r.label, fmtV(r.value, r.fmt)]].concat(r.target != null ? [[r.targetLabel || "Target", fmtV(r.target, r.fmt)]] : []))).on("mouseleave", hideTip);
  }

  // ------------------------------------------------------------ HTML visuals: table, matrix, slicer, textbox, narrative
  function cellStyle(val, colIdx, r, f, theme) {
    if (!f.dataBars || !r.columns[colIdx].isMeasure || typeof val !== "number") return "";
    const max = d3.max(r.rows, (row) => Math.abs(row[colIdx] || 0)) || 1;
    const pct = Math.round((Math.abs(val) / max) * 100);
    const c = val < 0 ? "rgba(214,69,80,.22)" : hexA(theme.palette[0], 0.22);
    return "background:linear-gradient(90deg," + c + " " + pct + "%,transparent " + pct + "%)";
  }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; }

  function renderTable(el, v, r, o) {
    const theme = o.theme, f = v.format || {};
    const wrap = document.createElement("div"); wrap.className = "ptable"; wrap.style.fontSize = (f.fontSize || 12) + "px"; wrap.style.color = theme.text;
    let h = "<table><thead><tr>" + r.columns.map((c, i) => '<th data-i="' + i + '" class="' + (c.isMeasure ? "num" : "") + '">' + esc(c.label) + ((f.sortBy ?? -1) === i ? (f.sortDir === "asc" ? " ▲" : " ▼") : "") + "</th>").join("") + "</tr></thead><tbody>";
    const sel = o.selection;
    for (const row of r.rows.slice(0, 2000)) {
      const key = row[0];
      h += '<tr class="' + (sel && sel.size && !sel.has(key) ? "dim" : "") + '" data-k="' + esc(JSON.stringify(key)) + '">' + row.map((val, i) => '<td class="' + (r.columns[i].isMeasure ? "num" : "") + '" style="' + cellStyle(val, i, r, f, theme) + '">' + esc(r.columns[i].isMeasure ? fmtV(val, r.columns[i].fmt) : fmtV(val)) + "</td>").join("") + "</tr>";
    }
    h += "</tbody>";
    if (r.total) h += '<tfoot><tr>' + r.total.map((val, i) => '<td class="' + (r.columns[i].isMeasure ? "num" : "") + '">' + esc(r.columns[i].isMeasure ? fmtV(val, r.columns[i].fmt) : val) + "</td>").join("") + "</tr></tfoot>";
    wrap.innerHTML = h + "</table>";
    if (f.zebra !== false) wrap.classList.add("zebra");
    el.appendChild(wrap);
    wrap.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { if (o.onFormat) { const i = +th.dataset.i; o.onFormat({ sortBy: i, sortDir: f.sortBy === i && f.sortDir !== "asc" ? "asc" : "desc" }); } }));
    if (o.onSelect && v.fields && v.fields.columns && v.fields.columns[0] && !E.isValueField(v.fields.columns[0])) {
      wrap.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", (ev) => { o.onSelect(JSON.parse(tr.dataset.k), ev.ctrlKey || ev.metaKey); }));
    }
  }

  function renderMatrix(el, v, r, o) {
    const theme = o.theme, f = v.format || {};
    const wrap = document.createElement("div"); wrap.className = "ptable matrix"; wrap.style.fontSize = (f.fontSize || 12) + "px"; wrap.style.color = theme.text;
    const ms = r.measures; const multi = ms.length > 1;
    const colHeads = r.colField ? r.colVals : [null];
    let h = "<table><thead>";
    if (r.colField) {
      h += '<tr><th rowspan="' + (multi ? 2 : 1) + '">' + esc(r.rowLabel) + "</th>" + colHeads.map((c) => '<th class="num" colspan="' + ms.length + '">' + esc(fmtV(c)) + "</th>").join("") + '<th class="num" colspan="' + ms.length + '">Total</th></tr>';
      if (multi) h += "<tr>" + colHeads.concat(["t"]).map(() => ms.map((m) => '<th class="num">' + esc(m.label) + "</th>").join("")).join("") + "</tr>";
    } else {
      h += "<tr><th>" + esc(r.rowLabel) + "</th>" + ms.map((m) => '<th class="num">' + esc(m.label) + "</th>").join("") + "</tr>";
    }
    h += "</thead><tbody>";
    const expanded = o.expanded || {};
    const cells = (row) => (r.colField ? row.cells.concat([row.total]) : [row.total]).map((cell) => cell.map((val, j) => '<td class="num">' + esc(fmtV(val, ms[j].fmt)) + "</td>").join("")).join("");
    r.rows.forEach((row, ri) => {
      const hasKids = row.children && row.children.length; const open = f.expandAll || expanded[ri];
      h += '<tr class="lvl0' + (o.selection && o.selection.size && !o.selection.has(row.label) ? " dim" : "") + '" data-ri="' + ri + '"><td>' + (hasKids ? '<span class="tog" data-ri="' + ri + '">' + (open ? "−" : "+") + "</span>" : "") + esc(fmtV(row.label)) + "</td>" + cells(row) + "</tr>";
      if (hasKids && open) row.children.forEach((ch) => (h += '<tr class="lvl1"><td>' + esc(fmtV(ch.label)) + "</td>" + cells(ch) + "</tr>"));
    });
    h += '</tbody><tfoot><tr><td>Total</td>' + cells(r.grand) + "</tr></tfoot></table>";
    wrap.innerHTML = h;
    el.appendChild(wrap);
    wrap.querySelectorAll(".tog").forEach((t) => t.addEventListener("click", (ev) => { ev.stopPropagation(); const ri = +t.dataset.ri; expanded[ri] = !expanded[ri]; if (o.onExpand) o.onExpand(expanded); }));
    if (o.onSelect) wrap.querySelectorAll("tr.lvl0").forEach((tr) => tr.addEventListener("click", (ev) => o.onSelect(r.rows[+tr.dataset.ri].label, ev.ctrlKey || ev.metaKey)));
  }

  function renderSlicer(el, v, r, o) {
    const f = v.format || {}; const style = f.style || (r.type === "number" && !(v.fields.category[0] || {}).level && r.values.length > 30 ? "between" : "list");
    const cur = new Set(o.slicerValues || []);
    const wrap = document.createElement("div"); wrap.className = "slicer " + style; wrap.style.color = o.theme.text;
    const emit = () => o.onSlicer && o.onSlicer(Array.from(cur));
    if (style === "between" || style === "range") {
      const rng = o.slicerRange || {};
      const isDate = r.type === "date";
      const lo = r.values[0], hi = r.values[r.values.length - 1];
      wrap.innerHTML = '<div class="between"><input type="' + (isDate ? "date" : "number") + '" class="lo" placeholder="' + esc(fmtV(lo)) + '" value="' + esc(rng.min != null ? (isDate ? String(rng.min).slice(0, 10) : rng.min) : "") + '"><span>to</span><input type="' + (isDate ? "date" : "number") + '" class="hi" placeholder="' + esc(fmtV(hi)) + '" value="' + esc(rng.max != null ? (isDate ? String(rng.max).slice(0, 10) : rng.max) : "") + '"></div><div class="hint">' + esc(fmtV(lo)) + " – " + esc(fmtV(hi)) + "</div>";
      const send = () => { const a = wrap.querySelector(".lo").value, b = wrap.querySelector(".hi").value; o.onSlicerRange && o.onSlicerRange({ min: a === "" ? null : isDate ? a + "T00:00:00" : +a, max: b === "" ? null : isDate ? b + "T23:59:59" : +b }); };
      wrap.querySelectorAll("input").forEach((i) => i.addEventListener("change", send));
    } else if (style === "dropdown") {
      const label = cur.size ? (cur.size === 1 ? fmtV(Array.from(cur)[0]) : cur.size + " selected") : "All";
      wrap.innerHTML = '<button class="dd">' + esc(label) + '<span>▾</span></button><div class="ddmenu"><input class="search" placeholder="Search"><div class="opts"></div></div>';
      const menu = wrap.querySelector(".ddmenu"); const opts = wrap.querySelector(".opts");
      const draw = (q) => {
        opts.innerHTML = '<label class="opt all"><input type="checkbox" ' + (cur.size ? "" : "checked") + ' data-all="1"> Select all</label>' + r.values.filter((x) => !q || String(fmtV(x)).toLowerCase().includes(q)).slice(0, 500).map((x, i) => '<label class="opt"><input type="checkbox" data-i="' + r.values.indexOf(x) + '" ' + (cur.has(x) ? "checked" : "") + "> " + esc(fmtV(x)) + "</label>").join("");
        opts.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => {
          if (inp.dataset.all) cur.clear(); else { const val = r.values[+inp.dataset.i]; inp.checked ? cur.add(val) : cur.delete(val); }
          emit();
        }));
      };
      draw("");
      wrap.querySelector(".dd").addEventListener("click", (ev) => { ev.stopPropagation(); document.querySelectorAll(".ddmenu.open").forEach((m) => m !== menu && m.classList.remove("open")); menu.classList.toggle("open"); });
      wrap.querySelector(".search").addEventListener("input", (ev) => draw(ev.target.value.toLowerCase()));
      menu.addEventListener("click", (ev) => ev.stopPropagation());
    } else if (style === "tiles") {
      wrap.innerHTML = r.values.slice(0, 80).map((x, i) => '<button class="tile ' + (cur.has(x) ? "on" : "") + '" data-i="' + i + '">' + esc(fmtV(x)) + "</button>").join("");
      wrap.querySelectorAll(".tile").forEach((b) => b.addEventListener("click", (ev) => {
        const val = r.values[+b.dataset.i];
        if (f.single || !(ev.ctrlKey || ev.metaKey || f.multi)) { const had = cur.has(val) && cur.size === 1; cur.clear(); if (!had) cur.add(val); }
        else cur.has(val) ? cur.delete(val) : cur.add(val);
        emit();
      }));
    } else {
      wrap.innerHTML = (r.values.length > 8 ? '<input class="search" placeholder="Search">' : "") + '<div class="opts"></div>';
      const opts = wrap.querySelector(".opts");
      const draw = (q) => {
        opts.innerHTML = '<label class="opt all"><input type="checkbox" ' + (cur.size ? "" : "checked") + ' data-all="1"> Select all</label>' + r.values.filter((x) => !q || String(fmtV(x)).toLowerCase().includes(q)).slice(0, 500).map((x) => '<label class="opt"><input type="' + (f.single ? "radio" : "checkbox") + '" name="' + v.id + '" data-i="' + r.values.indexOf(x) + '" ' + (cur.has(x) ? "checked" : "") + "> " + esc(fmtV(x)) + "</label>").join("");
        opts.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => {
          if (inp.dataset.all) cur.clear(); else { const val = r.values[+inp.dataset.i]; if (f.single) cur.clear(); inp.checked ? cur.add(val) : cur.delete(val); }
          emit();
        }));
      };
      draw("");
      const s = wrap.querySelector(".search"); if (s) s.addEventListener("input", (ev) => draw(ev.target.value.toLowerCase()));
    }
    el.appendChild(wrap);
  }

  function renderText(el, v, o) {
    const f = v.format || {};
    const d = document.createElement("div"); d.className = "textbox";
    d.style.cssText = "font-size:" + (f.fontSize || 16) + "px;font-weight:" + (f.bold ? 700 : 400) + ";font-style:" + (f.italic ? "italic" : "normal") + ";color:" + (f.color || o.theme.text) + ";text-align:" + (f.align || "left") + ";";
    d.innerHTML = esc(f.text || "Double-click to add text").replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    el.appendChild(d);
  }

  function renderNarrative(el, v, r, o) {
    const d = document.createElement("div"); d.className = "narrative"; d.style.color = o.theme.text;
    const s = r.series && r.series[0];
    if (!s || !r.categories.length) { d.textContent = "Add a measure and a field to explain it by."; el.appendChild(d); return; }
    const vals = r.categories.map((c, i) => ({ c, v: s.values[i] || 0 }));
    const total = d3.sum(vals, (x) => x.v);
    const sorted = vals.slice().sort((a, b) => b.v - a.v);
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    const share = total ? top.v / total : 0;
    const mean = total / vals.length;
    const above = vals.filter((x) => x.v > mean).length;
    let txt = "<p><b>" + esc(s.name) + "</b> totals <b>" + esc(fmtV(total, s.fmt)) + "</b> across " + vals.length + " " + esc(r.catLabel || "items") + ".</p>";
    txt += "<p><b>" + esc(catText(top.c)) + "</b> leads with " + esc(fmtV(top.v, s.fmt)) + " (" + esc(fmtV(share, { type: "percent" })) + " of the total)";
    if (sorted.length > 1) txt += ", while <b>" + esc(catText(bottom.c)) + "</b> is lowest at " + esc(fmtV(bottom.v, s.fmt));
    txt += ".</p><p>" + above + " of " + vals.length + " are above the average of " + esc(fmtV(mean, s.fmt)) + ".";
    const ordinal = r.catField && vals.length > 2 && ["number", "date"].includes(typeof r.categories[0] === "number" ? "number" : /^\d{4}/.test(String(r.categories[0])) ? "date" : "text");
    if (ordinal) {
      const first = vals[0].v, last = vals[vals.length - 1].v;
      if (first) txt += " From <b>" + esc(catText(vals[0].c)) + "</b> to <b>" + esc(catText(vals[vals.length - 1].c)) + "</b> it " + (last >= first ? "grew" : "fell") + " by " + esc(fmtV(Math.abs(last - first) / Math.abs(first), { type: "percent" })) + ".";
    }
    d.innerHTML = txt + "</p>";
    el.appendChild(d);
  }

  // ------------------------------------------------------------ dispatcher
  function render(el, v, r, o) {
    el.innerHTML = "";
    if (v.type === "textbox") return renderText(el, v, o);
    if (!r || r.empty) {
      const meta = TYPES[v.type];
      el.innerHTML = '<div class="empty">' + icon(v.type) + "<div>" + (meta ? "Add fields: " + meta.roles.map((x) => x[1]).join(", ") : "Unknown visual") + "</div></div>";
      return;
    }
    if (r.errors && r.errors.length && !hasData(r)) { el.innerHTML = '<div class="empty err">⚠ ' + esc(r.errors[0]) + "</div>"; return; }
    if (r.categories && !r.categories.length && v.type !== "narrative") { el.innerHTML = '<div class="empty">No data for the current filters</div>'; return; }
    try {
      switch (v.type) {
        case "pie": case "donut": return renderPie(el, v, r, o);
        case "treemap": return renderTreemap(el, v, r, o);
        case "funnel": return renderFunnel(el, v, r, o);
        case "waterfall": return renderWaterfall(el, v, r, o);
        case "ribbon": return renderRibbon(el, v, r, o);
        case "scatter": return r.points.length ? renderScatter(el, v, r, o) : (el.innerHTML = '<div class="empty">No data</div>');
        case "gauge": return renderGauge(el, v, r, o);
        case "card": return renderCard(el, v, r, o);
        case "multiCard": return renderMultiCard(el, v, r, o);
        case "kpi": return renderKPI(el, v, r, o);
        case "table": return renderTable(el, v, r, o);
        case "matrix": return renderMatrix(el, v, r, o);
        case "slicer": return renderSlicer(el, v, r, o);
        case "narrative": return renderNarrative(el, v, r, o);
        default: return renderCategory(el, v, r, o);
      }
    } catch (e) {
      console.error(e);
      el.innerHTML = '<div class="empty err">⚠ ' + esc(e.message) + "</div>";
    }
  }
  function hasData(r) { return (r.categories && r.categories.length) || (r.rows && r.rows.length) || (r.points && r.points.length) || r.value != null || (r.items && r.items.length); }

  // ------------------------------------------------------------ page export (SVG -> PNG)
  function htmlVisualSVG(v, r, w, h, theme) {
    // vector fallback for HTML-based visuals so exports contain everything
    const f = v.format || {};
    let s = "";
    const t = (x, y, txt, opt) => '<text x="' + x + '" y="' + y + '" font-size="' + ((opt && opt.size) || 11) + '" fill="' + ((opt && opt.color) || theme.text) + '"' + (opt && opt.anchor ? ' text-anchor="' + opt.anchor + '"' : "") + (opt && opt.bold ? ' font-weight="600"' : "") + ">" + esc(txt) + "</text>";
    if (v.type === "textbox") {
      const lines = String(f.text || "").split("\n");
      const size = f.fontSize || 16; const anchor = f.align === "center" ? "middle" : f.align === "right" ? "end" : "start";
      const x = anchor === "middle" ? w / 2 : anchor === "end" ? w - 6 : 6;
      lines.forEach((ln, i) => (s += t(x, 6 + size * (i + 1), ln.replace(/\*\*/g, ""), { size, color: f.color || theme.text, bold: f.bold, anchor })));
      return s;
    }
    if (!r || r.empty) return s;
    if (v.type === "slicer") {
      const sel = (v.state && v.state.values) || [];
      const range = v.state && v.state.range;
      const label = range && (range.min != null || range.max != null) ? fmtV(range.min) + " – " + fmtV(range.max) : sel.length ? sel.map((x) => fmtV(x)).join(", ") : "All";
      s += '<rect x="2" y="2" width="' + (w - 4) + '" height="' + Math.min(30, h - 4) + '" rx="3" fill="none" stroke="' + theme.grid + '"/>' + t(10, Math.min(30, h - 4) / 2 + 6, truncate(label, Math.floor(w / 7)));
      return s;
    }
    if (v.type === "narrative") return t(6, 18, "Smart narrative (see interactive version)", { color: theme.sub });
    if (v.type === "table" || v.type === "matrix") {
      let headers, rows, total;
      if (v.type === "table") {
        headers = r.columns.map((c) => c.label);
        rows = r.rows.map((row) => row.map((val, i) => (r.columns[i].isMeasure ? fmtV(val, r.columns[i].fmt) : fmtV(val))));
        total = r.total ? r.total.map((val, i) => (r.columns[i].isMeasure ? fmtV(val, r.columns[i].fmt) : String(val))) : null;
      } else {
        const ms = r.measures; const cols = r.colField ? r.colVals.map((c) => fmtV(c)).concat(["Total"]) : ms.map((m) => m.label);
        headers = [r.rowLabel].concat(r.colField && ms.length > 1 ? cols.flatMap((c) => ms.map((m) => c + " " + m.label)) : cols);
        const cells = (row) => (r.colField ? row.cells.concat([row.total]) : [row.total]).flatMap((cell) => cell.map((val, j) => fmtV(val, ms[j].fmt)));
        rows = r.rows.map((row) => [fmtV(row.label)].concat(cells(row)));
        total = ["Total"].concat(cells(r.grand));
      }
      const rh = 21; const maxRows = Math.max(0, Math.floor((h - rh * 2 - 4) / rh));
      const cw = w / headers.length;
      const numeric = headers.map((_, i) => i > 0 && rows.length && /^[-$€£¥₨\d(]/.test(String(rows[0][i])));
      const cellTxt = (txt, i, y, bold) => t(numeric[i] ? (i + 1) * cw - 6 : i * cw + 6, y, truncate(txt, Math.floor(cw / 6.4)), { anchor: numeric[i] ? "end" : "start", bold, size: 11 });
      s += '<rect x="0" y="0" width="' + w + '" height="' + rh + '" fill="' + theme.grid + '"/>';
      headers.forEach((hd, i) => (s += cellTxt(hd, i, 15, true)));
      rows.slice(0, maxRows).forEach((row, ri) => {
        const y = rh * (ri + 1);
        if (ri % 2) s += '<rect x="0" y="' + y + '" width="' + w + '" height="' + rh + '" fill="' + hexA(theme.palette[0], 0.05) + '"/>';
        row.forEach((cell, i) => (s += cellTxt(cell, i, y + 15)));
      });
      if (total) { const y = rh * (Math.min(rows.length, maxRows) + 1); s += '<line x1="0" x2="' + w + '" y1="' + y + '" y2="' + y + '" stroke="' + theme.text + '"/>'; total.forEach((cell, i) => (s += cellTxt(cell, i, y + 15, true))); }
      return s;
    }
    return s;
  }

  function pageSVG(page, items, theme, W, H) {
    let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" font-family="' + FONT + '">';
    s += '<rect width="' + W + '" height="' + H + '" fill="' + ((page.background) || theme.page) + '"/>';
    for (const it of items) {
      const v = it.visual, f = v.format || {};
      const bg = f.background === "transparent" ? null : f.background || theme.card;
      s += '<g transform="translate(' + v.x + "," + v.y + ')">';
      if (bg) s += '<rect width="' + v.w + '" height="' + v.h + '" rx="' + (f.radius ?? 6) + '" fill="' + bg + '"' + (f.border ? ' stroke="' + (f.borderColor || theme.grid) + '"' : "") + "/>";
      let off = 0;
      const title = v.title && f.showTitle !== false && v.type !== "textbox";
      if (title) { s += '<text x="12" y="22" font-size="' + (f.titleSize || 13) + '" font-weight="600" fill="' + (f.titleColor || theme.text) + '">' + esc(v.title) + "</text>"; off = 30; }
      const svgEl = it.el && it.el.querySelector("svg.chart");
      s += '<g transform="translate(' + (v.type === "textbox" ? 4 : 8) + "," + (off + 4) + ')">';
      if (svgEl) {
        const clone = svgEl.cloneNode(true); clone.removeAttribute("class");
        s += new XMLSerializer().serializeToString(clone);
      } else {
        s += htmlVisualSVG(v, it.result, v.w - 16, v.h - off - 10, theme);
      }
      s += "</g></g>";
    }
    s += '<text x="' + (W - 8) + '" y="' + (H - 6) + '" font-size="9" text-anchor="end" fill="' + theme.sub + '" opacity=".7">Made with PyBI</text>';
    return s + "</svg>";
  }

  function svgToPNG(svg, W, H, scale) {
    scale = scale || 2;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = W * scale; c.height = H * scale;
        const ctx = c.getContext("2d"); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, W, H);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Could not render image"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }

  function download(name, href) {
    const a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  global.PyBIVisuals = { THEMES, TYPES, ICONS, icon, render, pageSVG, svgToPNG, download, esc, hideTip, FONT };
})(typeof window !== "undefined" ? window : globalThis);
