/* PyBI visuals+ : 56 more visuals for analysts and data scientists.
 * Statistics, comparison, radial, part-to-whole, flow & network, time & finance, KPI & text.
 * Every visual plugs into the same engine: field wells, filters, cross-filtering, tooltips, themes and exports.
 * Author: Muhammad Rafay Shaikh, from Pakistan. MIT License. */
(function (global) {
  "use strict";
  const V = global.PyBIVisuals, E = global.PyBIEngine;
  if (!V || !E || !global.d3) return;
  const esc = V.esc;
  const nf = (x, fmt) => E.fmtValue(x, fmt, true);
  const full = (x, fmt) => E.fmtValue(x, fmt);

  // =================================================================== queries
  // cat   : category (+ legend) with one or more values      -> engine category result {categories, series}
  // rows  : combinations of several fields (hierarchies, pairs, tasks) -> {recs:[{category:[...], values:[...]}]}
  // raw   : row-level numbers (no aggregation) for statistics -> {n, cols, groups}
  // gauge : one value against a target / maximum
  function catQuery(meta) {
    return (model, v, filters, report) => {
      const F = v.fields || {};
      const values = [];
      for (const k of meta.vals || ["values"]) for (const f of F[k] || []) if (f) values.push(f);
      const fmt = Object.assign({}, meta.sort ? { sort: meta.sort } : {}, v.format || {});
      const r = E.query(model, { type: meta.ordinal ? "line" : "__plus", fields: { category: F.category, series: F.series, values }, format: fmt }, filters, report);
      if (meta.vals && !r.empty) r.roleNames = meta.vals.map((k) => ((F[k] || [])[0] ? E.fieldLabel(F[k][0]) : null));
      return r;
    };
  }

  function rowsQuery(meta) {
    return (model, v, filters, report) => {
      const F = v.fields || {};
      const cols = [], spec = [];
      for (const k of meta.rows) for (const f of F[k] || []) if (f) { cols.push(f); spec.push(k); }
      for (const k of meta.need || []) if (!(F[k] || []).length) return { empty: true };
      const r = E.query(model, { type: "table", fields: { columns: cols }, format: { totals: false } }, filters, report);
      if (r.empty) return r;
      const recs = r.rows.map((row) => { const o = {}; spec.forEach((k, j) => { (o[k] = o[k] || []).push(row[j]); }); return o; });
      const fmts = {}; spec.forEach((k, j) => { if (!fmts[k]) fmts[k] = r.columns[j].fmt; });
      const labels = {}; spec.forEach((k, j) => { (labels[k] = labels[k] || []).push(r.columns[j].label); });
      return { recs, labels, fmts, errors: r.errors, catField: (F.category || [])[0] || null };
    };
  }

  function rawQuery(meta) {
    return (model, v, filters, report) => {
      const F = v.fields || {};
      const fields = [];
      for (const k of meta.raw) for (const f of F[k] || []) if (f) fields.push(f);
      if (fields.length < (meta.minRaw || 1)) return { empty: true };
      if (fields.some((f) => f.measure)) return { errors: [meta.label + " needs numeric columns (drag a column, not a measure)"] };
      const base = fields[0].table;
      if (!model.tables[base]) return { errors: ["Table '" + base + "' is not loaded"] };
      const rows = model.rowsFor(base, filters);
      const gets = fields.map((f) => model.getter(base, f.table, f.column, null));
      if (gets.some((g) => !g)) return { errors: ["All value columns must come from the same or related tables"] };
      const cat = (F.category || [])[0];
      const cg = cat ? model.getter(base, cat.table, cat.column, cat.level) : null;
      const maxRows = meta.maxRows || 60000;
      const step = Math.max(1, Math.ceil(rows.length / maxRows));
      const cols = fields.map(() => []); const gidx = new Map(); const order = [];
      let n = 0;
      const num = (x) => (typeof x === "number" ? x : x instanceof Date ? +x : x == null || x === "" ? NaN : +x);
      for (let k = 0; k < rows.length; k += step) {
        const i = rows[k];
        const vals = gets.map((g) => num(g(i)));
        if (vals.some((x) => !isFinite(x))) continue;
        for (let j = 0; j < vals.length; j++) cols[j].push(vals[j]);
        if (cg) { const c = cg(i); let a = gidx.get(c); if (!a) { a = []; gidx.set(c, a); order.push(c); } a.push(n); }
        n++;
      }
      let groups;
      if (cg) {
        const sorted = model.sortValues(cat.table, cat.column, cat.level, order.filter((c) => !E.isBlank(c))).concat(order.filter((c) => E.isBlank(c)));
        groups = sorted.slice(0, meta.maxGroups || 30).map((c) => ({ raw: c, name: E.fmtValue(c), idx: gidx.get(c) }));
      } else groups = [{ raw: null, name: E.fieldLabel(fields[0]), idx: d3.range(n) }];
      groups.forEach((g) => { g.cols = cols.map((col) => g.idx.map((i) => col[i])); });
      return { n, sampled: step > 1, cols: fields.map((f, j) => ({ label: E.fieldLabel(f), fmt: E.fieldFormat(model, f, report), values: cols[j] })), groups, catField: cat || null, catLabel: cat ? E.fieldLabel(cat) : "" };
    };
  }

  function gaugeQuery() {
    return (model, v, filters, report) => E.query(model, { type: "gauge", fields: v.fields, format: v.format || {} }, filters, report);
  }

  // =================================================================== shared helpers
  function frame(el, o, m) {
    const svg = V.makeSvg(el, o.width, o.height);
    const g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    svg.on("click", () => o.onSelect && o.onSelect(null));
    return { svg, g, w: Math.max(10, o.width - m.l - m.r), h: Math.max(10, o.height - m.t - m.b) };
  }
  function empty(el, msg) { el.innerHTML = '<div class="empty">' + esc(msg) + "</div>"; }
  function pal(v, o, n) { return V.colorsFor(v, o.theme, n); }
  function tip(sel, rows) { sel.on("mousemove", (ev, d) => V.showTip(ev, rows(d))).on("mouseleave", V.hideTip); }
  function pick(o, c) { return (ev) => { ev.stopPropagation(); if (o.onSelect && c !== undefined) o.onSelect(c, ev.ctrlKey || ev.metaKey); }; }
  function op(o, c) { return V.selectedOpacity(o.selection, c); }
  function yAxis(g, y, w, o, fmt, ticks) {
    const a = g.append("g").call(d3.axisLeft(y).ticks(ticks || 5).tickFormat((d) => nf(d, fmt)).tickSize(-w).tickPadding(6));
    V.axisStyle(a, o.theme); a.select(".domain").remove(); a.selectAll(".tick line").attr("stroke-dasharray", "2,3");
    return a;
  }
  function xAxisLin(g, x, h, o, fmt, ticks) {
    const a = g.append("g").attr("transform", "translate(0," + h + ")").call(d3.axisBottom(x).ticks(ticks || Math.max(2, Math.min(6, Math.floor(Math.abs(x.range()[1] - x.range()[0]) / 75)))).tickFormat((d) => nf(d, fmt)).tickSize(-h).tickPadding(6));
    V.axisStyle(a, o.theme); a.select(".domain").remove(); a.selectAll(".tick line").attr("stroke-dasharray", "2,3");
    return a;
  }
  function xAxisBand(g, x, h, o, fmtLabel) {
    const a = g.append("g").attr("transform", "translate(0," + h + ")").call(d3.axisBottom(x).tickFormat((d) => V.truncate(fmtLabel ? fmtLabel(d) : d, 14)).tickSize(0).tickPadding(8));
    V.axisStyle(a, o.theme); a.select(".domain").attr("stroke", o.theme.grid);
    const n = x.domain().length, bw = x.bandwidth ? x.step() : 40;
    if (n > 1 && bw < 46) a.selectAll("text").attr("text-anchor", "end").attr("transform", "rotate(-35)").attr("dx", "-4").attr("dy", "2");
    const every = bw < 46 ? Math.ceil(20 / Math.max(1, bw)) : 1;
    if (every > 1) a.selectAll("text").attr("display", (_, i) => (i % every ? "none" : null));
    return a;
  }
  function yAxisBand(g, y, o) {
    const a = g.append("g").call(d3.axisLeft(y).tickFormat((d) => V.truncate(d, 18)).tickSize(0).tickPadding(6));
    V.axisStyle(a, o.theme); a.select(".domain").remove();
    return a;
  }
  function legendTop(svg, names, colors, o, x) {
    return V.legend(svg, names.map((n, i) => ({ name: n, color: colors[i] })), x || 4, 2, o.width - 8, o.theme);
  }
  function label(g, x, y, text, o, opts) {
    opts = opts || {};
    return g.append("text").attr("x", x).attr("y", y).attr("font-size", opts.size || 10).attr("fill", opts.color || o.theme.sub)
      .attr("text-anchor", opts.anchor || "middle").attr("font-weight", opts.weight || null).attr("dominant-baseline", opts.baseline || null).text(text);
  }
  const catName = (c) => E.fmtValue(c);
  // spread label positions so none sit closer than `gap` (keeps input order)
  function dodge(ys, gap, lo, hi) {
    const idx = ys.map((y, i) => i).sort((a, b) => ys[a] - ys[b]); const out = ys.slice();
    for (let k = 1; k < idx.length; k++) out[idx[k]] = Math.max(out[idx[k]], out[idx[k - 1]] + gap);
    const over = idx.length ? out[idx[idx.length - 1]] - hi : 0;
    if (over > 0) for (let k = idx.length - 1; k >= 0; k--) { out[idx[k]] -= over; if (k < idx.length - 1) out[idx[k]] = Math.min(out[idx[k]], out[idx[k + 1]] - gap); }
    idx.forEach((i) => (out[i] = Math.max(lo - 4, out[i])));
    return out;
  }
  function catRows(r) {
    // flatten an engine category result: [{c, name, vals:[per series], i}]
    return r.categories.map((c, i) => ({ c, name: catName(c), i, vals: r.series.map((s) => s.values[i]) }));
  }
  const n0 = (x) => (x == null || !isFinite(x) ? 0 : +x);
  function contrast(hex) {
    const c = d3.color(hex); if (!c) return "#fff";
    const { r, g, b } = c.rgb(); return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#252423" : "#ffffff";
  }
  function seqScale(o, domain, reverse) {
    const base = o.theme.palette[0];
    const lo = d3.interpolateRgb(o.theme.card === "#151B2E" ? "#1c2440" : "#f3f6fb", base);
    return d3.scaleSequential(reverse ? (t) => lo(1 - t) : lo).domain(domain);
  }

  // ----- statistics
  const sortNum = (a) => Float64Array.from(a).sort();
  function quart(a) {
    const s = sortNum(a);
    const q1 = d3.quantileSorted(s, 0.25), med = d3.quantileSorted(s, 0.5), q3 = d3.quantileSorted(s, 0.75);
    const iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    let wl = q1, wh = q3; for (const x of s) { if (x >= lo) { wl = x; break; } } for (let i = s.length - 1; i >= 0; i--) if (s[i] <= hi) { wh = s[i]; break; }
    return { s, q1, med, q3, iqr, wl, wh, mean: d3.mean(s), out: Array.from(s).filter((x) => x < wl || x > wh), min: s[0], max: s[s.length - 1], n: s.length };
  }
  function bandwidth(a) {
    const s = sortNum(a), sd = d3.deviation(s) || 1, iqr = (d3.quantileSorted(s, 0.75) - d3.quantileSorted(s, 0.25)) || sd;
    return 0.9 * Math.min(sd, iqr / 1.34) * Math.pow(s.length, -0.2) || 1;
  }
  function kde(a, xs, bw) {
    bw = bw || bandwidth(a);
    const k = 1 / (Math.sqrt(2 * Math.PI) * bw * a.length);
    const sample = a.length > 4000 ? a.filter((_, i) => i % Math.ceil(a.length / 4000) === 0) : a;
    const kk = 1 / (Math.sqrt(2 * Math.PI) * bw * sample.length);
    return xs.map((x) => { let s = 0; for (const v of sample) { const u = (x - v) / bw; s += Math.exp(-0.5 * u * u); } return [x, s * (sample === a ? k : kk) * (sample === a ? 1 : 1)]; });
  }
  function normInv(p) {
    // Acklam's rational approximation of the inverse normal CDF
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  function pearson(x, y) {
    const n = x.length; if (n < 3) return NaN;
    const mx = d3.mean(x), my = d3.mean(y); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxy / Math.sqrt(sxx * syy);
  }
  function linreg(x, y) {
    const mx = d3.mean(x), my = d3.mean(y); let sxy = 0, sxx = 0;
    for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const slope = sxx ? sxy / sxx : 0, icpt = my - slope * mx, r = pearson(x, y);
    return { slope, icpt, r2: r * r };
  }
  function groupColors(v, o, r) { return pal(v, o, r.groups.length); }
  function sampleNote(svg, r, o) {
    if (r.sampled) label(svg, o.width - 4, o.height - 2, "sampled from a large table", o, { anchor: "end", size: 9 });
  }
  // =================================================================== registry
  const DEFS = {};
  function def(id, label, group, roles, opts) { DEFS[id] = Object.assign({ label, group, roles }, opts); }
  const R = {
    dist: [["category", "Group by (optional)", 1, "dim"], ["values", "Value (numeric column)", 1, "raw"]],
    cat: [["category", "Category", 1, "dim"], ["values", "Values", 1, "value"]],
    catLegend: [["category", "Category", 1, "dim"], ["series", "Legend", 1, "dim"], ["values", "Values", 1, "value"]],
    catMulti: [["category", "Category", 1, "dim"], ["series", "Legend", 1, "dim"], ["values", "Values", 6, "value"]],
    time: [["category", "Date / time axis", 1, "dim"], ["series", "Legend", 1, "dim"], ["values", "Value", 1, "value"]],
    hier: [["category", "Levels (outer → inner)", 4, "dim"], ["values", "Size", 1, "value"]],
    pair: [["category", "From / rows", 1, "dim"], ["series", "To / columns", 1, "dim"], ["values", "Weight", 1, "value"]],
  };
  const F = {
    legend: ["Legend", "legend", "toggle", true],
    labels: ["Data labels", "dataLabels", "toggle", true],
    labelsOff: ["Data labels", "dataLabels", "toggle", false],
    topN: ["Top N (0 = all)", "topN", "number", 0],
    sort: ["Sort", "sort", "select", "", [["", "Auto"], ["value-desc", "Value ↓"], ["value-asc", "Value ↑"], ["category-asc", "Category A→Z"], ["category-desc", "Category Z→A"]]],
    bins: ["Bins (0 = auto)", "bins", "number", 0],
    color: ["Colour", "color", "color", null],
  };

  // =================================================================== 1. STATISTICS & DISTRIBUTION
  const STAT = "Statistics & distribution";

  def("histogram", "Histogram", STAT, R.dist, { raw: ["values"], format: [F.bins, ["Show normal curve", "normal", "toggle", false], ["Stack groups", "stacked", "toggle", true], F.legend], icon: '<rect x="3" y="13" width="3" height="7"/><rect x="7" y="8" width="3" height="12"/><rect x="11" y="4" width="3" height="16"/><rect x="15" y="9" width="3" height="11"/><rect x="19" y="15" width="2" height="5"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}, cols = groupColors(v, o, r), all = r.cols[0].values;
      const ext = d3.extent(all); if (ext[0] === ext[1]) { ext[0] -= 0.5; ext[1] += 0.5; }
      const nb = f.bins > 0 ? f.bins : Math.min(60, Math.max(8, Math.ceil(Math.log2(all.length) + 1) * 2));
      const binner = d3.bin().domain(ext).thresholds(d3.ticks(ext[0], ext[1], nb));
      const per = r.groups.map((g) => binner(g.cols[0]));
      const bins = per[0].map((b, i) => ({ x0: b.x0, x1: b.x1, counts: per.map((p) => (p[i] ? p[i].length : 0)) }));
      const stacked = f.stacked !== false;
      const fr = frame(el, o, { l: 44, r: 10, t: r.groups.length > 1 && f.legend !== false ? 26 : 8, b: 26 });
      if (r.groups.length > 1 && f.legend !== false) legendTop(fr.svg, r.groups.map((g) => g.name), cols, o);
      const x = d3.scaleLinear().domain([bins[0].x0, bins[bins.length - 1].x1]).range([0, fr.w]);
      const ymax = d3.max(bins, (b) => (stacked ? d3.sum(b.counts) : d3.max(b.counts))) || 1;
      const y = d3.scaleLinear().domain([0, ymax]).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, {}); xAxisLin(fr.g, x, fr.h, o, r.cols[0].fmt);
      bins.forEach((b) => {
        let acc = 0;
        b.counts.forEach((c, gi) => {
          if (!c) return;
          const bx = x(b.x0) + 1, bw = Math.max(1, x(b.x1) - x(b.x0) - 2);
          const w2 = stacked ? bw : bw / b.counts.length, xx = stacked ? bx : bx + w2 * gi;
          const rect = fr.g.append("rect").attr("x", xx).attr("width", w2).attr("y", y(acc + (stacked ? c : 0) + (stacked ? 0 : c))).attr("height", fr.h - y(c)).attr("fill", cols[gi]).attr("rx", 1.5)
            .attr("opacity", op(o, r.groups[gi].raw)).style("cursor", r.catField ? "pointer" : null).on("click", pick(o, r.catField ? r.groups[gi].raw : undefined));
          if (stacked) rect.attr("y", y(acc + c));
          tip(rect, () => [[r.groups[gi].name, ""], ["Range", nf(b.x0, r.cols[0].fmt) + " – " + nf(b.x1, r.cols[0].fmt)], ["Count", full(c)]]);
          if (stacked) acc += c;
        });
      });
      if (f.normal) {
        const mu = d3.mean(all), sd = d3.deviation(all) || 1, bw = bins[0].x1 - bins[0].x0;
        const pts = d3.range(0, 101).map((i) => { const xx = x.domain()[0] + (x.domain()[1] - x.domain()[0]) * i / 100; return [xx, all.length * bw * Math.exp(-0.5 * ((xx - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI))]; });
        fr.g.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(Math.min(d[1], y.domain()[1]))).curve(d3.curveBasis)(pts)).attr("fill", "none").attr("stroke", o.theme.text).attr("stroke-width", 1.5).attr("stroke-dasharray", "4,3");
      }
      sampleNote(fr.svg, r, o);
    } });

  function distAxis(r, o, el, v, horizontalCats) {
    const f = v.format || {}, showLegend = false;
    const fr = frame(el, o, { l: horizontalCats ? 90 : 46, r: 12, t: 10, b: horizontalCats ? 26 : 30 });
    const all = r.cols[0].values; const ext = d3.extent(all); const pad = (ext[1] - ext[0]) * 0.06 || 1;
    const names = r.groups.map((g) => g.name);
    const band = d3.scaleBand().domain(names).range(horizontalCats ? [0, fr.h] : [0, fr.w]).padding(0.25);
    const val = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice().range(horizontalCats ? [0, fr.w] : [fr.h, 0]);
    if (horizontalCats) { xAxisLin(fr.g, val, fr.h, o, r.cols[0].fmt); yAxisBand(fr.g, band, o); }
    else { yAxis(fr.g, val, fr.w, o, r.cols[0].fmt); xAxisBand(fr.g, band, fr.h, o); }
    void f; void showLegend;
    return { fr, band, val, cols: groupColors(v, o, r) };
  }

  def("boxPlot", "Box & whisker", STAT, R.dist, { raw: ["values"], format: [["Show mean", "mean", "toggle", true], ["Show outliers", "outliers", "toggle", true], ["Horizontal", "horizontal", "toggle", false]], icon: '<path d="M6 4v4M6 16v4M3 4h6M3 20h6" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="3" y="8" width="6" height="8" opacity=".7"/><path d="M17 3v5M17 15v6M14 3h6M14 21h6" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="14" y="8" width="6" height="7" opacity=".5"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}, hz = !!f.horizontal;
      const { fr, band, val, cols } = distAxis(r, o, el, v, hz);
      r.groups.forEach((g, gi) => {
        if (!g.cols[0].length) return;
        const q = quart(g.cols[0]), c = cols[gi], b0 = band(g.name), bw = band.bandwidth(), mid = b0 + bw / 2;
        const gg = fr.g.append("g").attr("opacity", op(o, g.raw)).style("cursor", r.catField ? "pointer" : null).on("click", pick(o, r.catField ? g.raw : undefined));
        const P = (a, b) => (hz ? [val(b), a] : [a, val(b)]);
        const line = (a1, v1, a2, v2) => { const p1 = P(a1, v1), p2 = P(a2, v2); return gg.append("line").attr("x1", p1[0]).attr("y1", p1[1]).attr("x2", p2[0]).attr("y2", p2[1]).attr("stroke", c).attr("stroke-width", 1.5); };
        line(mid, q.wl, mid, q.q1); line(mid, q.q3, mid, q.wh); line(b0 + bw * 0.3, q.wl, b0 + bw * 0.7, q.wl); line(b0 + bw * 0.3, q.wh, b0 + bw * 0.7, q.wh);
        const pA = P(b0, q.q3), pB = P(b0 + bw, q.q1);
        const box = gg.append("rect").attr("x", Math.min(pA[0], pB[0])).attr("y", Math.min(pA[1], pB[1])).attr("width", Math.abs(pB[0] - pA[0])).attr("height", Math.abs(pB[1] - pA[1]))
          .attr("fill", c).attr("fill-opacity", 0.35).attr("stroke", c).attr("stroke-width", 1.5).attr("rx", 3);
        line(b0, q.med, b0 + bw, q.med).attr("stroke-width", 2.5);
        if (f.mean !== false) { const pm = P(mid, q.mean); gg.append("path").attr("d", d3.symbol(d3.symbolDiamond, 40)()).attr("transform", "translate(" + pm + ")").attr("fill", o.theme.card).attr("stroke", c).attr("stroke-width", 1.5); }
        if (f.outliers !== false) q.out.slice(0, 400).forEach((x) => { const p = P(mid + (Math.random() - 0.5) * bw * 0.3, x); gg.append("circle").attr("cx", p[0]).attr("cy", p[1]).attr("r", 2.2).attr("fill", "none").attr("stroke", c).attr("opacity", 0.8); });
        const fm = r.cols[0].fmt;
        tip(box, () => [[g.name, "", c], ["Max (whisker)", full(q.wh, fm)], ["Q3", full(q.q3, fm)], ["Median", full(q.med, fm)], ["Mean", full(q.mean, fm)], ["Q1", full(q.q1, fm)], ["Min (whisker)", full(q.wl, fm)], ["Outliers", full(q.out.length)], ["Count", full(q.n)]]);
      });
      sampleNote(fr.svg, r, o);
    } });

  function violinShape(g, q, vals, bw, val, mid, half, hz, c, side) {
    const lo = val.domain()[0], hi = val.domain()[1];
    const xs = d3.range(0, 61).map((i) => q.min + (q.max - q.min) * i / 60);
    const dens = kde(vals, xs, bandwidth(vals));
    const mx = d3.max(dens, (d) => d[1]) || 1;
    const w = d3.scaleLinear().domain([0, mx]).range([0, half]);
    const area = hz
      ? d3.area().x((d) => val(d[0])).y0((d) => (side === "right" ? mid : mid - w(d[1]))).y1((d) => (side === "left" ? mid : mid + w(d[1]))).curve(d3.curveBasis)
      : d3.area().y((d) => val(d[0])).x0((d) => (side === "right" ? mid : mid - w(d[1]))).x1((d) => (side === "left" ? mid : mid + w(d[1]))).curve(d3.curveBasis);
    void lo; void hi; void bw;
    return g.append("path").attr("d", area(dens)).attr("fill", c).attr("fill-opacity", 0.45).attr("stroke", c).attr("stroke-width", 1.2);
  }

  def("violin", "Violin plot", STAT, R.dist, { raw: ["values"], format: [["Show inner box", "box", "toggle", true], ["Horizontal", "horizontal", "toggle", false]], icon: '<path d="M8 3c-2 4-3 6 0 9s2 6 0 9c-2-3-3-6 0-9S6 7 8 3z" opacity=".7"/><path d="M16 3c3 4 4 6 0 9s-3 6 0 9c2-3 3-6 0-9s-2-5 0-9z" opacity=".45"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}, hz = !!f.horizontal;
      const { fr, band, val, cols } = distAxis(r, o, el, v, hz);
      r.groups.forEach((g, gi) => {
        if (g.cols[0].length < 2) return;
        const q = quart(g.cols[0]), c = cols[gi], mid = band(g.name) + band.bandwidth() / 2;
        const gg = fr.g.append("g").attr("opacity", op(o, g.raw)).style("cursor", r.catField ? "pointer" : null).on("click", pick(o, r.catField ? g.raw : undefined));
        const shape = violinShape(gg, q, g.cols[0], 0, val, mid, band.bandwidth() / 2, hz, c);
        if (f.box !== false) {
          const bw = Math.max(4, band.bandwidth() * 0.08);
          if (hz) { gg.append("line").attr("x1", val(q.wl)).attr("x2", val(q.wh)).attr("y1", mid).attr("y2", mid).attr("stroke", o.theme.text).attr("stroke-width", 1); gg.append("rect").attr("x", val(q.q1)).attr("width", val(q.q3) - val(q.q1)).attr("y", mid - bw / 2).attr("height", bw).attr("fill", o.theme.text); gg.append("circle").attr("cx", val(q.med)).attr("cy", mid).attr("r", 2.6).attr("fill", o.theme.card); }
          else { gg.append("line").attr("y1", val(q.wl)).attr("y2", val(q.wh)).attr("x1", mid).attr("x2", mid).attr("stroke", o.theme.text).attr("stroke-width", 1); gg.append("rect").attr("y", val(q.q3)).attr("height", val(q.q1) - val(q.q3)).attr("x", mid - bw / 2).attr("width", bw).attr("fill", o.theme.text); gg.append("circle").attr("cy", val(q.med)).attr("cx", mid).attr("r", 2.6).attr("fill", o.theme.card); }
        }
        const fm = r.cols[0].fmt;
        tip(shape, () => [[g.name, "", c], ["Median", full(q.med, fm)], ["Q1 – Q3", nf(q.q1, fm) + " – " + nf(q.q3, fm)], ["Mean", full(q.mean, fm)], ["Count", full(q.n)]]);
      });
      sampleNote(fr.svg, r, o);
    } });

  def("raincloud", "Raincloud plot", STAT, R.dist, { raw: ["values"], format: [], icon: '<path d="M3 9c3-6 6-6 9-2s5 4 9 2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="12" width="12" height="3" opacity=".7"/><circle cx="6" cy="19" r="1.2"/><circle cx="10" cy="20" r="1.2"/><circle cx="13" cy="18.5" r="1.2"/><circle cx="17" cy="20" r="1.2"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const { fr, band, val, cols } = distAxis(r, o, el, v, true);
      r.groups.forEach((g, gi) => {
        if (g.cols[0].length < 2) return;
        const q = quart(g.cols[0]), c = cols[gi], b0 = band(g.name), bw = band.bandwidth();
        const gg = fr.g.append("g").attr("opacity", op(o, g.raw)).style("cursor", r.catField ? "pointer" : null).on("click", pick(o, r.catField ? g.raw : undefined));
        const cloud = violinShape(gg, q, g.cols[0], 0, val, b0 + bw * 0.45, bw * 0.45, true, c, "left");
        const by = b0 + bw * 0.52, bh = Math.max(3, bw * 0.12);
        gg.append("line").attr("x1", val(q.wl)).attr("x2", val(q.wh)).attr("y1", by + bh / 2).attr("y2", by + bh / 2).attr("stroke", c);
        gg.append("rect").attr("x", val(q.q1)).attr("width", Math.max(1, val(q.q3) - val(q.q1))).attr("y", by).attr("height", bh).attr("fill", c).attr("fill-opacity", 0.6).attr("stroke", c);
        gg.append("line").attr("x1", val(q.med)).attr("x2", val(q.med)).attr("y1", by).attr("y2", by + bh).attr("stroke", o.theme.card).attr("stroke-width", 2);
        const pts = g.cols[0].length > 500 ? g.cols[0].filter((_, i) => i % Math.ceil(g.cols[0].length / 500) === 0) : g.cols[0];
        pts.forEach((x) => gg.append("circle").attr("cx", val(x)).attr("cy", b0 + bw * 0.72 + Math.random() * bw * 0.25).attr("r", 1.6).attr("fill", c).attr("opacity", 0.55));
        tip(cloud, () => [[g.name, "", c], ["Median", full(q.med, r.cols[0].fmt)], ["Mean", full(q.mean, r.cols[0].fmt)], ["Count", full(q.n)]]);
      });
      sampleNote(fr.svg, r, o);
    } });

  def("density", "Density curve (KDE)", STAT, R.dist, { raw: ["values"], format: [["Fill area", "fill", "toggle", true], ["Show mean lines", "meanLines", "toggle", true], F.legend], icon: '<path d="M2 20C6 20 7 5 11 5s5 15 11 15" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 20C6 20 7 5 11 5s5 15 11 15Z" opacity=".25"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}, cols = groupColors(v, o, r), multi = r.groups.length > 1 && f.legend !== false;
      const fr = frame(el, o, { l: 46, r: 10, t: multi ? 26 : 8, b: 26 });
      if (multi) legendTop(fr.svg, r.groups.map((g) => g.name), cols, o);
      const ext = d3.extent(r.cols[0].values), pad = (ext[1] - ext[0]) * 0.08 || 1;
      const x = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([0, fr.w]);
      const xs = d3.range(0, 121).map((i) => x.domain()[0] + (x.domain()[1] - x.domain()[0]) * i / 120);
      const curves = r.groups.map((g) => (g.cols[0].length > 1 ? kde(g.cols[0], xs, bandwidth(r.cols[0].values)) : []));
      const y = d3.scaleLinear().domain([0, d3.max(curves.flat(), (d) => d[1]) || 1]).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, { type: "decimal", decimals: 4 }, 4); xAxisLin(fr.g, x, fr.h, o, r.cols[0].fmt);
      curves.forEach((cv, gi) => {
        if (!cv.length) return; const c = cols[gi], g = r.groups[gi];
        const gg = fr.g.append("g").attr("opacity", op(o, g.raw));
        if (f.fill !== false) gg.append("path").attr("d", d3.area().x((d) => x(d[0])).y0(fr.h).y1((d) => y(d[1])).curve(d3.curveBasis)(cv)).attr("fill", c).attr("fill-opacity", 0.18);
        const p = gg.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveBasis)(cv)).attr("fill", "none").attr("stroke", c).attr("stroke-width", 2).style("cursor", r.catField ? "pointer" : null).on("click", pick(o, r.catField ? g.raw : undefined));
        const m = d3.mean(g.cols[0]);
        if (f.meanLines !== false) gg.append("line").attr("x1", x(m)).attr("x2", x(m)).attr("y1", 0).attr("y2", fr.h).attr("stroke", c).attr("stroke-dasharray", "4,3");
        tip(p, () => [[g.name, "", c], ["Mean", full(m, r.cols[0].fmt)], ["Median", full(d3.median(g.cols[0]), r.cols[0].fmt)], ["Count", full(g.cols[0].length)]]);
      });
      sampleNote(fr.svg, r, o);
    } });

  def("ridgeline", "Ridgeline (joy plot)", STAT, [["category", "Rows (groups)", 1, "dim"], ["values", "Value (numeric column)", 1, "raw"]], { raw: ["values"], format: [["Overlap", "overlap", "number", 1.6]], icon: '<path d="M2 9c4 0 4-5 7-5s4 5 13 5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 15c5 0 6-6 9-6s3 6 11 6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 21c3 0 5-5 8-5s5 5 12 5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}, cols = groupColors(v, o, r);
      const fr = frame(el, o, { l: 90, r: 12, t: 14, b: 26 });
      const ext = d3.extent(r.cols[0].values), pad = (ext[1] - ext[0]) * 0.05 || 1;
      const x = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([0, fr.w]);
      const xs = d3.range(0, 101).map((i) => x.domain()[0] + (x.domain()[1] - x.domain()[0]) * i / 100);
      const bwAll = bandwidth(r.cols[0].values);
      const curves = r.groups.map((g) => (g.cols[0].length > 1 ? kde(g.cols[0], xs, bwAll) : xs.map((xx) => [xx, 0])));
      const band = d3.scalePoint().domain(r.groups.map((g) => g.name)).range([0, fr.h]).padding(0.5);
      const step = r.groups.length > 1 ? band.step() : fr.h * 0.6;
      const y = d3.scaleLinear().domain([0, d3.max(curves.flat(), (d) => d[1]) || 1]).range([0, step * (f.overlap || 1.6)]);
      xAxisLin(fr.g, x, fr.h, o, r.cols[0].fmt);
      r.groups.forEach((g, gi) => {
        const base = band(g.name) + step / 2, c = cols[gi % cols.length];
        const gg = fr.g.append("g").attr("opacity", op(o, g.raw)).style("cursor", "pointer").on("click", pick(o, g.raw));
        const p = gg.append("path").attr("d", d3.area().x((d) => x(d[0])).y0(base).y1((d) => base - y(d[1])).curve(d3.curveBasis)(curves[gi])).attr("fill", c).attr("fill-opacity", 0.75).attr("stroke", o.theme.card).attr("stroke-width", 1.2);
        label(fr.g, -8, base - 2, V.truncate(g.name, 14), o, { anchor: "end", size: 11 });
        tip(p, () => [[g.name, "", c], ["Median", full(d3.median(g.cols[0]), r.cols[0].fmt)], ["Mean", full(d3.mean(g.cols[0]), r.cols[0].fmt)], ["Count", full(g.cols[0].length)]]);
      });
      sampleNote(fr.svg, r, o);
    } });

  function swarmLayout(vals, scale, r, maxN) {
    const pts = vals.length > maxN ? vals.filter((_, i) => i % Math.ceil(vals.length / maxN) === 0) : vals.slice();
    pts.sort((a, b) => a - b);
    const placed = []; const out = [];
    for (const v of pts) {
      const x = scale(v); let y = 0, k = 0;
      // try offsets 0, +d, -d, +2d ...
      while (k < 400) {
        const cand = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * r * 2 * 0.9;
        if (!placed.some((p) => Math.abs(p.x - x) < r * 2 && Math.abs(p.y - cand) < r * 2)) { y = cand; break; }
        k++;
      }
      const p = { x, y, v }; placed.push(p); out.push(p);
      if (placed.length > 60) placed.shift();
    }
    return out;
  }
  def("beeswarm", "Beeswarm", STAT, R.dist, { raw: ["values"], format: [["Dot size", "dotSize", "number", 3.2]], icon: '<circle cx="5" cy="12" r="1.8"/><circle cx="9" cy="9" r="1.8"/><circle cx="9" cy="15" r="1.8"/><circle cx="13" cy="12" r="1.8"/><circle cx="13" cy="7" r="1.8"/><circle cx="13" cy="17" r="1.8"/><circle cx="17" cy="10" r="1.8"/><circle cx="17" cy="14" r="1.8"/><circle cx="21" cy="12" r="1.8"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}, rad = f.dotSize || 3.2;
      const { fr, band, val, cols } = distAxis(r, o, el, v, true);
      r.groups.forEach((g, gi) => {
        const mid = band(g.name) + band.bandwidth() / 2, c = cols[gi];
        const pts = swarmLayout(g.cols[0], val, rad, 700);
        const lim = band.bandwidth() / 2 - rad;
        const gg = fr.g.append("g").attr("opacity", op(o, g.raw));
        const dots = gg.selectAll("circle").data(pts).join("circle").attr("cx", (d) => d.x).attr("cy", (d) => mid + Math.max(-lim, Math.min(lim, d.y))).attr("r", rad).attr("fill", c).attr("fill-opacity", 0.75).attr("stroke", o.theme.card).attr("stroke-width", 0.6)
          .style("cursor", r.catField ? "pointer" : null).on("click", pick(o, r.catField ? g.raw : undefined));
        tip(dots, (d) => [[g.name, "", c], [r.cols[0].label, full(d.v, r.cols[0].fmt)]]);
      });
      sampleNote(fr.svg, r, o);
    } });

  def("stripPlot", "Strip / jitter plot", STAT, R.dist, { raw: ["values"], format: [["Show median", "median", "toggle", true]], icon: '<g opacity=".8"><circle cx="5" cy="5" r="1.3"/><circle cx="7" cy="9" r="1.3"/><circle cx="4" cy="14" r="1.3"/><circle cx="6" cy="18" r="1.3"/><circle cx="14" cy="6" r="1.3"/><circle cx="16" cy="11" r="1.3"/><circle cx="13" cy="13" r="1.3"/><circle cx="15" cy="19" r="1.3"/></g>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {};
      const { fr, band, val, cols } = distAxis(r, o, el, v, false);
      r.groups.forEach((g, gi) => {
        const b0 = band(g.name), bw = band.bandwidth(), c = cols[gi];
        const pts = g.cols[0].length > 1500 ? g.cols[0].filter((_, i) => i % Math.ceil(g.cols[0].length / 1500) === 0) : g.cols[0];
        const gg = fr.g.append("g").attr("opacity", op(o, g.raw));
        const dots = gg.selectAll("circle").data(pts).join("circle").attr("cx", () => b0 + bw * 0.15 + Math.random() * bw * 0.7).attr("cy", (d) => val(d)).attr("r", 2).attr("fill", c).attr("opacity", 0.5)
          .style("cursor", r.catField ? "pointer" : null).on("click", pick(o, r.catField ? g.raw : undefined));
        tip(dots, (d) => [[g.name, "", c], [r.cols[0].label, full(d, r.cols[0].fmt)]]);
        if (f.median !== false && g.cols[0].length) { const m = d3.median(g.cols[0]); gg.append("line").attr("x1", b0).attr("x2", b0 + bw).attr("y1", val(m)).attr("y2", val(m)).attr("stroke", o.theme.text).attr("stroke-width", 2.5); }
      });
      sampleNote(fr.svg, r, o);
    } });

  def("ecdf", "ECDF (cumulative distribution)", STAT, R.dist, { raw: ["values"], format: [F.legend], icon: '<path d="M3 20h3v-3h3v-4h3v-4h3v-3h3v-2h3" fill="none" stroke="currentColor" stroke-width="2"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}, cols = groupColors(v, o, r), multi = r.groups.length > 1 && f.legend !== false;
      const fr = frame(el, o, { l: 46, r: 12, t: multi ? 26 : 8, b: 26 });
      if (multi) legendTop(fr.svg, r.groups.map((g) => g.name), cols, o);
      const x = d3.scaleLinear().domain(d3.extent(r.cols[0].values)).nice().range([0, fr.w]);
      const y = d3.scaleLinear().domain([0, 1]).range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, { type: "percent", decimals: 0 }); xAxisLin(fr.g, x, fr.h, o, r.cols[0].fmt);
      r.groups.forEach((g, gi) => {
        const s = Array.from(sortNum(g.cols[0])); if (!s.length) return;
        const pts = s.length > 2000 ? s.filter((_, i) => i % Math.ceil(s.length / 2000) === 0) : s;
        const data = pts.map((x, i) => [x, (i + 1) / pts.length]);
        const p = fr.g.append("path").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveStepAfter)(data)).attr("fill", "none").attr("stroke", cols[gi]).attr("stroke-width", 2).attr("opacity", op(o, g.raw));
        tip(p, () => [[g.name, "", cols[gi]], ["25% below", full(d3.quantileSorted(s, 0.25), r.cols[0].fmt)], ["50% below", full(d3.quantileSorted(s, 0.5), r.cols[0].fmt)], ["90% below", full(d3.quantileSorted(s, 0.9), r.cols[0].fmt)]]);
      });
      sampleNote(fr.svg, r, o);
    } });

  def("qqPlot", "Q-Q plot (normality)", STAT, R.dist, { raw: ["values"], maxGroups: 1, format: [], icon: '<path d="M3 21L21 3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/><circle cx="5" cy="18" r="1.5"/><circle cx="8" cy="16" r="1.5"/><circle cx="11" cy="12" r="1.5"/><circle cx="14" cy="10" r="1.5"/><circle cx="17" cy="5" r="1.5"/><circle cx="19" cy="2.8" r="1.5"/>',
    render(el, v, r, o) {
      if (r.n < 3) return empty(el, "Need at least 3 numbers");
      const s = Array.from(sortNum(r.cols[0].values)); const n = s.length;
      const pts = (n > 1500 ? s.filter((_, i) => i % Math.ceil(n / 1500) === 0) : s).map((x, i, a) => [normInv((i + 0.5) / a.length), x]);
      const mu = d3.mean(s), sd = d3.deviation(s) || 1;
      const fr = frame(el, o, { l: 50, r: 12, t: 22, b: 30 });
      const x = d3.scaleLinear().domain(d3.extent(pts, (d) => d[0])).nice().range([0, fr.w]);
      const y = d3.scaleLinear().domain(d3.extent(pts, (d) => d[1])).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, r.cols[0].fmt); xAxisLin(fr.g, x, fr.h, o, { type: "decimal", decimals: 1 });
      fr.g.append("line").attr("x1", x(x.domain()[0])).attr("y1", y(mu + sd * x.domain()[0])).attr("x2", x(x.domain()[1])).attr("y2", y(mu + sd * x.domain()[1])).attr("stroke", o.theme.palette[2]).attr("stroke-width", 1.6).attr("stroke-dasharray", "5,4");
      const dots = fr.g.selectAll("circle").data(pts).join("circle").attr("cx", (d) => x(d[0])).attr("cy", (d) => y(d[1])).attr("r", 2.4).attr("fill", pal(v, o, 1)[0]).attr("opacity", 0.7);
      tip(dots, (d) => [["Theoretical (z)", d[0].toFixed(2)], [r.cols[0].label, full(d[1], r.cols[0].fmt)]]);
      label(fr.svg, o.width / 2, 12, "Points on the dashed line = normally distributed · skew " + d3.format(".2f")(d3.mean(s, (x) => ((x - mu) / sd) ** 3)), o, { size: 10 });
      label(fr.g, fr.w / 2, fr.h + 26, "Theoretical quantiles", o, { size: 10 });
    } });

  def("dotDistribution", "Dot histogram", STAT, R.dist, { raw: ["values"], maxGroups: 1, format: [F.bins], icon: '<g><circle cx="5" cy="20" r="1.6"/><circle cx="9" cy="20" r="1.6"/><circle cx="9" cy="16" r="1.6"/><circle cx="13" cy="20" r="1.6"/><circle cx="13" cy="16" r="1.6"/><circle cx="13" cy="12" r="1.6"/><circle cx="13" cy="8" r="1.6"/><circle cx="17" cy="20" r="1.6"/><circle cx="17" cy="16" r="1.6"/><circle cx="21" cy="20" r="1.6"/></g>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}, vals = r.cols[0].values;
      const fr = frame(el, o, { l: 12, r: 12, t: 8, b: 26 });
      const ext = d3.extent(vals); if (ext[0] === ext[1]) { ext[0] -= 0.5; ext[1] += 0.5; }
      const nb = f.bins > 0 ? f.bins : Math.max(10, Math.min(40, Math.floor(fr.w / 14)));
      const bins = d3.bin().domain(ext).thresholds(d3.ticks(ext[0], ext[1], nb))(vals);
      const x = d3.scaleLinear().domain([bins[0].x0, bins[bins.length - 1].x1]).range([0, fr.w]);
      xAxisLin(fr.g, x, fr.h, o, r.cols[0].fmt).selectAll(".tick line").remove();
      const maxc = d3.max(bins, (b) => b.length) || 1;
      const binW = fr.w / bins.length; const dotR = Math.max(1.5, Math.min(binW / 2 - 1, 9));
      const per = Math.max(1, Math.ceil(maxc / Math.max(1, Math.floor(fr.h / (dotR * 2 + 1)))));
      const c = pal(v, o, 1)[0];
      bins.forEach((b) => {
        const dots = Math.ceil(b.length / per); const cx = x(b.x0) + (x(b.x1) - x(b.x0)) / 2;
        for (let k = 0; k < dots; k++) {
          const ci = fr.g.append("circle").attr("cx", cx).attr("cy", fr.h - dotR - 1 - k * (dotR * 2 + 1)).attr("r", dotR).attr("fill", c).attr("opacity", 0.85);
          tip(ci, () => [["Range", nf(b.x0, r.cols[0].fmt) + " – " + nf(b.x1, r.cols[0].fmt)], ["Count", full(b.length)], ["Each dot", full(per) + " rows"]]);
        }
      });
      sampleNote(fr.svg, r, o);
    } });

  def("correlation", "Correlation matrix", STAT, [["values", "Numeric columns (2–8)", 8, "raw"]], { raw: ["values"], minRaw: 2, format: [["Show values", "dataLabels", "toggle", true]], icon: '<rect x="3" y="3" width="5" height="5"/><rect x="9.5" y="3" width="5" height="5" opacity=".45"/><rect x="16" y="3" width="5" height="5" opacity=".2"/><rect x="3" y="9.5" width="5" height="5" opacity=".45"/><rect x="9.5" y="9.5" width="5" height="5"/><rect x="16" y="9.5" width="5" height="5" opacity=".6"/><rect x="3" y="16" width="5" height="5" opacity=".2"/><rect x="9.5" y="16" width="5" height="5" opacity=".6"/><rect x="16" y="16" width="5" height="5"/>',
    render(el, v, r, o) {
      if (r.n < 3) return empty(el, "Need at least 3 rows");
      const f = v.format || {}, k = r.cols.length, names = r.cols.map((c) => c.label);
      const fr = frame(el, o, { l: 90, r: 50, t: 8, b: 70 });
      const size = Math.min(fr.w, fr.h); const cell = size / k;
      const color = d3.scaleDiverging(d3.interpolateRdBu).domain([1, 0, -1]);
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
        const rho = i === j ? 1 : pearson(r.cols[i].values, r.cols[j].values);
        const rect = fr.g.append("rect").attr("x", j * cell + 1).attr("y", i * cell + 1).attr("width", cell - 2).attr("height", cell - 2).attr("rx", 3).attr("fill", isFinite(rho) ? color(rho) : o.theme.grid);
        tip(rect, () => [[names[i] + " × " + names[j], ""], ["Pearson r", isFinite(rho) ? rho.toFixed(3) : "n/a"], ["Strength", !isFinite(rho) ? "" : Math.abs(rho) > 0.7 ? "strong" : Math.abs(rho) > 0.4 ? "moderate" : Math.abs(rho) > 0.2 ? "weak" : "none"]]);
        if (f.dataLabels !== false && cell > 26 && isFinite(rho)) label(fr.g, j * cell + cell / 2, i * cell + cell / 2, rho.toFixed(2), o, { size: Math.min(12, cell / 3.5), color: Math.abs(rho) > 0.55 ? "#fff" : "#252423", baseline: "middle" });
      }
      names.forEach((n, i) => {
        label(fr.g, -6, i * cell + cell / 2, V.truncate(n, 14), o, { anchor: "end", size: 10, baseline: "middle" });
        fr.g.append("text").attr("transform", "translate(" + (i * cell + cell / 2) + "," + (size + 6) + ") rotate(-40)").attr("text-anchor", "end").attr("font-size", 10).attr("fill", o.theme.sub).text(V.truncate(n, 14));
      });
      const lg = fr.g.append("g").attr("transform", "translate(" + (size + 14) + ",0)");
      d3.range(0, 41).forEach((i) => lg.append("rect").attr("y", (i / 40) * size).attr("width", 10).attr("height", size / 40 + 0.5).attr("fill", color(1 - i / 20)));
      label(lg, 14, 8, "+1", o, { anchor: "start", size: 9 }); label(lg, 14, size / 2, "0", o, { anchor: "start", size: 9 }); label(lg, 14, size, "−1", o, { anchor: "start", size: 9 });
      sampleNote(fr.svg, r, o);
    } });

  const XY = [["x", "X (numeric column)", 1, "raw"], ["y", "Y (numeric column)", 1, "raw"], ["category", "Color by (optional)", 1, "dim"]];
  def("hexbin", "Hexbin density", STAT, XY.slice(0, 2), { raw: ["x", "y"], minRaw: 2, maxRows: 120000, format: [["Hexagon size", "hexSize", "number", 12]], icon: '<path d="M7 3l4 2.3v4.6L7 12.2 3 9.9V5.3z"/><path d="M15 3l4 2.3v4.6l-4 2.3-4-2.3V5.3z" opacity=".5"/><path d="M11 10l4 2.3v4.6l-4 2.3-4-2.3v-4.6z" opacity=".75"/><path d="M19 10l4 2.3v4.6l-4 2.3-4-2.3v-4.6z" opacity=".3"/>',
    render(el, v, r, o) {
      if (!r.n) return empty(el, "No numbers to plot");
      const f = v.format || {}; const X = r.cols[0], Y = r.cols[1];
      const fr = frame(el, o, { l: 50, r: 12, t: 8, b: 30 });
      const x = d3.scaleLinear().domain(d3.extent(X.values)).nice().range([0, fr.w]);
      const y = d3.scaleLinear().domain(d3.extent(Y.values)).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, Y.fmt); xAxisLin(fr.g, x, fr.h, o, X.fmt);
      const s = Math.max(4, f.hexSize || 12), dx = s * Math.sqrt(3), dy = s * 1.5;
      const bins = new Map();
      for (let i = 0; i < X.values.length; i++) {
        const px = x(X.values[i]), py = y(Y.values[i]);
        let row = Math.round(py / dy), col = Math.round((px - (row & 1 ? dx / 2 : 0)) / dx);
        // check neighbours for the nearest centre
        let best = null, bd = Infinity;
        for (const rr of [row - 1, row, row + 1]) for (const cc of [col - 1, col, col + 1]) {
          const cx = cc * dx + (rr & 1 ? dx / 2 : 0), cy = rr * dy, d = (px - cx) ** 2 + (py - cy) ** 2;
          if (d < bd) { bd = d; best = [rr, cc, cx, cy]; }
        }
        const key = best[0] + ":" + best[1]; let b = bins.get(key); if (!b) { b = { cx: best[2], cy: best[3], n: 0 }; bins.set(key, b); } b.n++;
      }
      const arr = Array.from(bins.values()); const mx = d3.max(arr, (b) => b.n) || 1;
      const color = seqScale(o, [0, Math.log(mx + 1)]);
      const hex = d3.range(6).map((k) => { const a = Math.PI / 3 * k + Math.PI / 6; return [s * Math.cos(a), s * Math.sin(a)]; });
      const hp = "M" + hex.map((p) => p.join(",")).join("L") + "Z";
      const clip = "hexclip" + Math.random().toString(36).slice(2, 8);
      fr.g.append("clipPath").attr("id", clip).append("rect").attr("width", fr.w).attr("height", fr.h);
      const cells = fr.g.append("g").attr("clip-path", "url(#" + clip + ")").selectAll("path").data(arr).join("path").attr("d", hp).attr("transform", (b) => "translate(" + b.cx + "," + b.cy + ")").attr("fill", (b) => color(Math.log(b.n + 1))).attr("stroke", o.theme.card).attr("stroke-width", 0.5);
      tip(cells, (b) => [[X.label, "≈ " + nf(x.invert(b.cx), X.fmt)], [Y.label, "≈ " + nf(y.invert(b.cy), Y.fmt)], ["Rows", full(b.n)]]);
      sampleNote(fr.svg, r, o);
    } });

  def("contour", "2D density contours", STAT, XY.slice(0, 2), { raw: ["x", "y"], minRaw: 2, maxRows: 20000, format: [["Show points", "points", "toggle", true], ["Bandwidth", "bw", "number", 20]], icon: '<ellipse cx="12" cy="12" rx="9" ry="6" fill="none" stroke="currentColor" stroke-width="1.4"/><ellipse cx="12" cy="12" rx="6" ry="4" fill="none" stroke="currentColor" stroke-width="1.4"/><ellipse cx="12" cy="12" rx="3" ry="2"/>',
    render(el, v, r, o) {
      if (r.n < 5) return empty(el, "Need at least 5 rows");
      const f = v.format || {}; const X = r.cols[0], Y = r.cols[1];
      const fr = frame(el, o, { l: 50, r: 12, t: 8, b: 30 });
      const x = d3.scaleLinear().domain(d3.extent(X.values)).nice().range([0, fr.w]);
      const y = d3.scaleLinear().domain(d3.extent(Y.values)).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, Y.fmt); xAxisLin(fr.g, x, fr.h, o, X.fmt);
      const pts = X.values.map((xv, i) => [x(xv), y(Y.values[i])]);
      const dens = d3.contourDensity().x((d) => d[0]).y((d) => d[1]).size([fr.w, fr.h]).bandwidth(f.bw || 20).thresholds(12)(pts);
      const color = seqScale(o, [0, d3.max(dens, (d) => d.value) || 1]);
      if (f.points !== false) fr.g.append("g").selectAll("circle").data(pts.length > 3000 ? pts.filter((_, i) => i % Math.ceil(pts.length / 3000) === 0) : pts).join("circle").attr("cx", (d) => d[0]).attr("cy", (d) => d[1]).attr("r", 1.3).attr("fill", o.theme.sub).attr("opacity", 0.35);
      const paths = fr.g.append("g").selectAll("path").data(dens).join("path").attr("d", d3.geoPath()).attr("fill", (d) => color(d.value)).attr("fill-opacity", 0.35).attr("stroke", (d) => d3.color(color(d.value)).darker(0.6)).attr("stroke-width", 1);
      tip(paths, (d) => [["Density level", d3.format(".2s")(d.value)]]);
      sampleNote(fr.svg, r, o);
    } });

  def("regression", "Scatter + trend line", STAT, XY, { raw: ["x", "y"], minRaw: 2, maxRows: 20000, format: [["Show equation & R²", "equation", "toggle", true], ["Confidence band", "band", "toggle", true], F.legend], icon: '<circle cx="5" cy="17" r="1.5"/><circle cx="8" cy="14" r="1.5"/><circle cx="11" cy="15" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="17" cy="9" r="1.5"/><circle cx="19" cy="5" r="1.5"/><path d="M3 19L21 4" stroke="currentColor" stroke-width="1.8"/>',
    render(el, v, r, o) {
      if (r.n < 3) return empty(el, "Need at least 3 rows");
      const f = v.format || {}; const X = r.cols[0], Y = r.cols[1]; const cols = groupColors(v, o, r);
      const multi = r.groups.length > 1 && f.legend !== false;
      const fr = frame(el, o, { l: 50, r: 12, t: multi ? 26 : 22, b: 30 });
      if (multi) legendTop(fr.svg, r.groups.map((g) => g.name), cols, o);
      const x = d3.scaleLinear().domain(d3.extent(X.values)).nice().range([0, fr.w]);
      const y = d3.scaleLinear().domain(d3.extent(Y.values)).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, Y.fmt); xAxisLin(fr.g, x, fr.h, o, X.fmt);
      r.groups.forEach((g, gi) => {
        const xs = g.cols[0], ys = g.cols[1]; const step = Math.max(1, Math.ceil(xs.length / 2500));
        const gg = fr.g.append("g").attr("opacity", op(o, g.raw));
        const idx = d3.range(0, xs.length, step);
        const dots = gg.selectAll("circle").data(idx).join("circle").attr("cx", (i) => x(xs[i])).attr("cy", (i) => y(ys[i])).attr("r", 2.4).attr("fill", cols[gi]).attr("opacity", 0.55).style("cursor", r.catField ? "pointer" : null).on("click", pick(o, r.catField ? g.raw : undefined));
        tip(dots, (i) => [[g.name, "", cols[gi]], [X.label, full(xs[i], X.fmt)], [Y.label, full(ys[i], Y.fmt)]]);
      });
      const fit = linreg(X.values, Y.values); const xd = x.domain();
      if (f.band !== false) {
        const n = X.values.length, mx = d3.mean(X.values); let sse = 0, sxx = 0;
        for (let i = 0; i < n; i++) { sse += (Y.values[i] - (fit.icpt + fit.slope * X.values[i])) ** 2; sxx += (X.values[i] - mx) ** 2; }
        const se = Math.sqrt(sse / Math.max(1, n - 2));
        const band = d3.range(0, 41).map((k) => { const xx = xd[0] + (xd[1] - xd[0]) * k / 40; const yy = fit.icpt + fit.slope * xx; const h = 1.96 * se * Math.sqrt(1 / n + (xx - mx) ** 2 / (sxx || 1)); return [xx, yy - h, yy + h]; });
        fr.g.append("path").attr("d", d3.area().x((d) => x(d[0])).y0((d) => y(d[1])).y1((d) => y(d[2]))(band)).attr("fill", o.theme.text).attr("opacity", 0.1);
      }
      fr.g.append("line").attr("x1", x(xd[0])).attr("x2", x(xd[1])).attr("y1", y(fit.icpt + fit.slope * xd[0])).attr("y2", y(fit.icpt + fit.slope * xd[1])).attr("stroke", o.theme.text).attr("stroke-width", 2);
      if (f.equation !== false) label(fr.svg, o.width - 10, multi ? o.height - 34 : 14, "y = " + d3.format(".3~s")(fit.slope) + "x " + (fit.icpt < 0 ? "− " : "+ ") + d3.format(".3~s")(Math.abs(fit.icpt)) + "   R² = " + fit.r2.toFixed(3), o, { anchor: "end", size: 11, weight: 600, color: o.theme.text });
      sampleNote(fr.svg, r, o);
    } });

  // =================================================================== 2. COMPARISON & RANKING
  const CMP = "Comparison & ranking";
  const catGuard = (el, r) => { if (!r.categories || !r.categories.length) { empty(el, "No data for the current filters"); return true; } return false; };
  const fmt0 = (r, k) => (r.series[k || 0] || {}).fmt;

  def("lollipop", "Lollipop chart", CMP, R.cat, { query: "cat", format: [F.labels, F.sort, F.topN, ["Horizontal", "horizontal", "toggle", true]], icon: '<path d="M5 20V10M11 20V5M17 20V13" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="9" r="2.4"/><circle cx="11" cy="4.5" r="2.4"/><circle cx="17" cy="12" r="2.4"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, hz = f.horizontal !== false, rows = catRows(r), fm = fmt0(r), c = pal(v, o, 1)[0];
      const fr = frame(el, o, hz ? { l: 96, r: 40, t: 6, b: 24 } : { l: 46, r: 10, t: 14, b: 44 });
      const ext = [Math.min(0, d3.min(rows, (d) => n0(d.vals[0]))), Math.max(0, d3.max(rows, (d) => n0(d.vals[0])))];
      const band = d3.scaleBand().domain(rows.map((d) => d.name)).range(hz ? [0, fr.h] : [0, fr.w]).padding(0.3);
      const val = d3.scaleLinear().domain(ext).nice().range(hz ? [0, fr.w] : [fr.h, 0]);
      if (hz) { xAxisLin(fr.g, val, fr.h, o, fm); yAxisBand(fr.g, band, o); } else { yAxis(fr.g, val, fr.w, o, fm); xAxisBand(fr.g, band, fr.h, o); }
      rows.forEach((d) => {
        const m = band(d.name) + band.bandwidth() / 2, x0 = val(0), x1 = val(n0(d.vals[0]));
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        if (hz) gg.append("line").attr("x1", x0).attr("x2", x1).attr("y1", m).attr("y2", m).attr("stroke", c).attr("stroke-width", 2);
        else gg.append("line").attr("y1", x0).attr("y2", x1).attr("x1", m).attr("x2", m).attr("stroke", c).attr("stroke-width", 2);
        const dot = gg.append("circle").attr("cx", hz ? x1 : m).attr("cy", hz ? m : x1).attr("r", Math.min(8, band.bandwidth() / 2 + 2)).attr("fill", c).attr("stroke", o.theme.card).attr("stroke-width", 2);
        if (f.dataLabels !== false) label(gg, hz ? x1 + 12 : m, hz ? m + 4 : x1 - 12, nf(d.vals[0], fm), o, { anchor: hz ? "start" : "middle" });
        tip(dot, () => [[d.name, full(d.vals[0], fm), c]]);
      });
    } });

  function twoValueChart(kind) {
    return function (el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), fm = fmt0(r), cols = pal(v, o, 2), names = r.roleNames || r.series.map((s) => s.name);
      const fr = frame(el, o, { l: 96, r: 58, t: 26, b: 24 });
      legendTop(fr.svg, [names[0] || "Start", names[1] || "End"], cols, o, 96);
      const all = rows.flatMap((d) => [n0(d.vals[0]), n0(d.vals[1])]);
      const x = d3.scaleLinear().domain(d3.extent(all.concat(kind === "dumbbell" ? [] : [0]))).nice().range([0, fr.w]);
      const y = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, fr.h]).padding(0.35);
      xAxisLin(fr.g, x, fr.h, o, fm); yAxisBand(fr.g, y, o);
      rows.forEach((d) => {
        const m = y(d.name) + y.bandwidth() / 2, a = n0(d.vals[0]), b = n0(d.vals[1]);
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        gg.append("line").attr("x1", x(a)).attr("x2", x(b)).attr("y1", m).attr("y2", m).attr("stroke", o.theme.grid).attr("stroke-width", 4).attr("stroke-linecap", "round");
        [a, b].forEach((val, k) => { const ci = gg.append("circle").attr("cx", x(val)).attr("cy", m).attr("r", 6).attr("fill", cols[k]).attr("stroke", o.theme.card).attr("stroke-width", 1.5); tip(ci, () => [[d.name, ""], [names[0] || "Start", full(a, fm), cols[0]], [names[1] || "End", full(b, fm), cols[1]], ["Change", (b - a >= 0 ? "+" : "") + full(b - a, fm)]]); });
        if (f.dataLabels !== false) label(gg, x(Math.max(a, b)) + 10, m + 4, (b - a >= 0 ? "+" : "") + nf(b - a, fm), o, { anchor: "start", color: b >= a ? "#1AAB40" : "#D64550", weight: 600 });
      });
    };
  }
  const TWO = (a, b) => [["category", "Category", 1, "dim"], ["start", a, 1, "value"], ["end", b, 1, "value"]];
  def("dumbbell", "Dumbbell (before → after)", CMP, TWO("Start / before", "End / after"), { query: "cat", vals: ["start", "end"], format: [F.labels, F.sort, F.topN], icon: '<path d="M6 6h11M9 12h9M4 18h9" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="6" r="2.2"/><circle cx="17" cy="6" r="2.2" opacity=".6"/><circle cx="9" cy="12" r="2.2"/><circle cx="18" cy="12" r="2.2" opacity=".6"/><circle cx="4" cy="18" r="2.2"/><circle cx="13" cy="18" r="2.2" opacity=".6"/>', render: twoValueChart("dumbbell") });

  def("slope", "Slope chart", CMP, TWO("Left (before)", "Right (after)"), { query: "cat", vals: ["start", "end"], format: [F.labels, F.topN], icon: '<path d="M5 6L19 10M5 12L19 5M5 18L19 16" stroke="currentColor" stroke-width="1.8"/><path d="M5 3v18M19 3v18" stroke="currentColor" stroke-width=".8" opacity=".5"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), fm = fmt0(r), names = r.roleNames || ["Before", "After"];
      const cols = pal(v, o, rows.length);
      const fr = frame(el, o, { l: 110, r: 110, t: 24, b: 10 });
      const all = rows.flatMap((d) => [n0(d.vals[0]), n0(d.vals[1])]);
      const y = d3.scaleLinear().domain(d3.extent(all)).nice().range([fr.h, 0]);
      [0, fr.w].forEach((xx, k) => { fr.g.append("line").attr("x1", xx).attr("x2", xx).attr("y1", 0).attr("y2", fr.h).attr("stroke", o.theme.grid).attr("stroke-width", 2); label(fr.g, xx, -10, names[k] || (k ? "After" : "Before"), o, { size: 11, weight: 600, color: o.theme.text }); });
      const ly = [0, 1].map((k) => dodge(rows.map((d) => y(n0(d.vals[k]))), 12, 0, fr.h));
      rows.forEach((d, i) => {
        const a = n0(d.vals[0]), b = n0(d.vals[1]), c = cols[i];
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        const ln = gg.append("line").attr("x1", 0).attr("x2", fr.w).attr("y1", y(a)).attr("y2", y(b)).attr("stroke", c).attr("stroke-width", 2.5);
        gg.append("circle").attr("cx", 0).attr("cy", y(a)).attr("r", 4).attr("fill", c); gg.append("circle").attr("cx", fr.w).attr("cy", y(b)).attr("r", 4).attr("fill", c);
        if (f.dataLabels !== false) { label(gg, -8, ly[0][i] + 4, V.truncate(d.name, 12) + "  " + nf(a, fm), o, { anchor: "end", size: 10 }); label(gg, fr.w + 8, ly[1][i] + 4, nf(b, fm) + "  " + V.truncate(d.name, 12), o, { anchor: "start", size: 10 }); }
        tip(ln, () => [[d.name, "", c], [names[0] || "Before", full(a, fm)], [names[1] || "After", full(b, fm)], ["Change", (a ? d3.format("+.1%")((b - a) / Math.abs(a)) : "")]]);
      });
    } });

  def("bullet", "Bullet chart", CMP, [["category", "Category", 1, "dim"], ["values", "Actual", 1, "value"], ["target", "Target", 1, "value"]], { query: "cat", vals: ["values", "target"], format: [F.labels, F.topN], icon: '<rect x="3" y="5" width="18" height="5" opacity=".2"/><rect x="3" y="5" width="13" height="5" opacity=".35"/><rect x="3" y="6.5" width="10" height="2"/><path d="M15 4v7" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="18" height="5" opacity=".2"/><rect x="3" y="15.5" width="15" height="2"/><path d="M12 13v7" stroke="currentColor" stroke-width="2"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), fm = fmt0(r), c = pal(v, o, 1)[0];
      const fr = frame(el, o, { l: 96, r: 56, t: 6, b: 24 });
      const mx = d3.max(rows, (d) => Math.max(n0(d.vals[0]), n0(d.vals[1]) * 1.2)) || 1;
      const x = d3.scaleLinear().domain([0, mx]).nice().range([0, fr.w]);
      const y = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, fr.h]).padding(0.3);
      xAxisLin(fr.g, x, fr.h, o, fm); yAxisBand(fr.g, y, o);
      rows.forEach((d) => {
        const a = n0(d.vals[0]), t = n0(d.vals[1]), y0 = y(d.name), bh = y.bandwidth();
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        [[1.2, 0.12], [1.0, 0.2], [0.75, 0.3]].forEach(([k, a2]) => gg.append("rect").attr("x", 0).attr("y", y0).attr("height", bh).attr("width", x(Math.min(mx, t * k || mx))).attr("fill", o.theme.sub).attr("opacity", a2));
        const bar = gg.append("rect").attr("x", 0).attr("y", y0 + bh * 0.3).attr("height", bh * 0.4).attr("width", x(a)).attr("fill", c).attr("rx", 2);
        if (t) gg.append("line").attr("x1", x(t)).attr("x2", x(t)).attr("y1", y0 + 2).attr("y2", y0 + bh - 2).attr("stroke", o.theme.text).attr("stroke-width", 3);
        if (f.dataLabels !== false) label(gg, fr.w + 6, y0 + bh / 2 + 4, t ? d3.format(".0%")(a / t) : nf(a, fm), o, { anchor: "start", weight: 600, color: !t ? o.theme.sub : a >= t ? "#1AAB40" : "#D64550" });
        tip(bar, () => [[d.name, ""], [(r.roleNames || [])[0] || "Actual", full(a, fm), c], [(r.roleNames || [])[1] || "Target", full(t, fm)], ["Achieved", t ? d3.format(".1%")(a / t) : "n/a"]]);
      });
    } });

  def("dotPlot", "Cleveland dot plot", CMP, R.catMulti, { query: "cat", format: [F.legend, F.sort, F.topN], icon: '<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width=".8" opacity=".4"/><circle cx="8" cy="6" r="2.2"/><circle cx="15" cy="6" r="2.2" opacity=".55"/><circle cx="11" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2" opacity=".55"/><circle cx="5" cy="18" r="2.2"/><circle cx="13" cy="18" r="2.2" opacity=".55"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), cols = pal(v, o, r.series.length), fm = fmt0(r);
      const lg = r.series.length > 1 && f.legend !== false;
      const fr = frame(el, o, { l: 96, r: 16, t: lg ? 26 : 6, b: 24 });
      if (lg) legendTop(fr.svg, r.series.map((s) => s.name), cols, o, 96);
      const x = d3.scaleLinear().domain(d3.extent(rows.flatMap((d) => d.vals.map(n0)).concat([0]))).nice().range([0, fr.w]);
      const y = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, fr.h]).padding(0.2);
      xAxisLin(fr.g, x, fr.h, o, fm); yAxisBand(fr.g, y, o);
      rows.forEach((d) => {
        const m = y(d.name) + y.bandwidth() / 2;
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        gg.append("line").attr("x1", 0).attr("x2", fr.w).attr("y1", m).attr("y2", m).attr("stroke", o.theme.grid).attr("stroke-dasharray", "1,3");
        const vs = d.vals.map(n0); gg.append("line").attr("x1", x(d3.min(vs))).attr("x2", x(d3.max(vs))).attr("y1", m).attr("y2", m).attr("stroke", o.theme.sub).attr("stroke-width", 1.5);
        d.vals.forEach((val, k) => { const ci = gg.append("circle").attr("cx", x(n0(val))).attr("cy", m).attr("r", 5.5).attr("fill", cols[k]).attr("stroke", o.theme.card).attr("stroke-width", 1.2); tip(ci, () => [[d.name, ""]].concat(r.series.map((s, j) => [s.name, full(d.vals[j], s.fmt), cols[j]]))); });
      });
    } });

  def("divergingBar", "Diverging bar (+/−)", CMP, R.cat, { query: "cat", format: [F.labels, F.sort, F.topN, ["Positive colour", "posColor", "color", "#1AAB40"], ["Negative colour", "negColor", "color", "#D64550"]], icon: '<path d="M12 3v18" stroke="currentColor" stroke-width="1.2"/><rect x="12" y="4" width="8" height="3"/><rect x="6" y="9" width="6" height="3" opacity=".55"/><rect x="12" y="14" width="5" height="3"/><rect x="4" y="18.5" width="8" height="2.5" opacity=".55"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), fm = fmt0(r);
      const pos = f.posColor || "#1AAB40", neg = f.negColor || "#D64550";
      const fr = frame(el, o, { l: 12, r: 12, t: 6, b: 24 });
      const mx = d3.max(rows, (d) => Math.abs(n0(d.vals[0]))) || 1;
      const x = d3.scaleLinear().domain([-mx, mx]).nice().range([0, fr.w]);
      const y = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, fr.h]).padding(0.2);
      xAxisLin(fr.g, x, fr.h, o, fm);
      fr.g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", fr.h).attr("stroke", o.theme.sub);
      rows.forEach((d) => {
        const val = n0(d.vals[0]), up = val >= 0;
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        const bar = gg.append("rect").attr("x", Math.min(x(0), x(val))).attr("width", Math.abs(x(val) - x(0))).attr("y", y(d.name)).attr("height", y.bandwidth()).attr("fill", up ? pos : neg).attr("rx", 2);
        label(gg, up ? x(0) - 6 : x(0) + 6, y(d.name) + y.bandwidth() / 2 + 4, V.truncate(d.name, 16), o, { anchor: up ? "end" : "start", size: 10, color: o.theme.text });
        if (f.dataLabels !== false) label(gg, up ? x(val) + 4 : x(val) - 4, y(d.name) + y.bandwidth() / 2 + 4, nf(val, fm), o, { anchor: up ? "start" : "end", size: 10 });
        tip(bar, () => [[d.name, full(val, fm), up ? pos : neg]]);
      });
    } });

  def("butterfly", "Butterfly / tornado", CMP, TWO("Left side", "Right side"), { query: "cat", vals: ["start", "end"], format: [F.labels, F.sort, F.topN], icon: '<path d="M12 3v18" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="4" width="8" height="3" opacity=".6"/><rect x="12" y="4" width="6" height="3"/><rect x="6" y="9" width="6" height="3" opacity=".6"/><rect x="12" y="9" width="8" height="3"/><rect x="7" y="14" width="5" height="3" opacity=".6"/><rect x="12" y="14" width="4" height="3"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), fm = fmt0(r), cols = pal(v, o, 2), names = r.roleNames || ["Left", "Right"];
      const lw = 84;
      const fr = frame(el, o, { l: 10, r: 10, t: 22, b: 8 });
      const half = (fr.w - lw) / 2;
      const mx = d3.max(rows, (d) => Math.max(n0(d.vals[0]), n0(d.vals[1]))) || 1;
      const x = d3.scaleLinear().domain([0, mx]).range([0, Math.max(10, half - (f.dataLabels !== false ? 46 : 4))]);
      const y = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, fr.h]).padding(0.18);
      label(fr.g, half / 2, -8, names[0] || "Left", o, { weight: 600, color: cols[0], size: 11 }); label(fr.g, half + lw + half / 2, -8, names[1] || "Right", o, { weight: 600, color: cols[1], size: 11 });
      rows.forEach((d) => {
        const a = n0(d.vals[0]), b = n0(d.vals[1]), yy = y(d.name), bh = y.bandwidth();
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        const L = gg.append("rect").attr("x", half - x(a)).attr("width", x(a)).attr("y", yy).attr("height", bh).attr("fill", cols[0]).attr("rx", 2);
        const Rr = gg.append("rect").attr("x", half + lw).attr("width", x(b)).attr("y", yy).attr("height", bh).attr("fill", cols[1]).attr("rx", 2);
        label(gg, half + lw / 2, yy + bh / 2 + 4, V.truncate(d.name, 12), o, { size: 10, color: o.theme.text });
        if (f.dataLabels !== false && bh > 9) { label(gg, half - x(a) - 4, yy + bh / 2 + 4, nf(a, fm), o, { anchor: "end", size: 9 }); label(gg, half + lw + x(b) + 4, yy + bh / 2 + 4, nf(b, fm), o, { anchor: "start", size: 9 }); }
        tip(L.merge(Rr), () => [[d.name, ""], [names[0] || "Left", full(a, fm), cols[0]], [names[1] || "Right", full(b, fm), cols[1]]]);
      });
    } });

  def("bump", "Bump chart (rank over time)", CMP, R.time, { query: "cat", ordinal: true, format: [["Top N series (0 = all)", "maxSeries", "number", 10]], icon: '<path d="M3 6C8 6 8 16 12 16s4-10 9-10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16C8 16 8 6 12 6s4 6 9 6" fill="none" stroke="currentColor" stroke-width="2" opacity=".5"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      if (r.series.length < 2) return empty(el, "Add a Legend field (the things to rank) for a bump chart");
      const f = v.format || {};
      let series = r.series.slice();
      const totals = series.map((s) => d3.sum(s.values, n0));
      if (f.maxSeries > 0) series = series.map((s, i) => [s, totals[i]]).sort((a, b) => b[1] - a[1]).slice(0, f.maxSeries).map((x) => x[0]);
      const cats = r.categories, cols = pal(v, o, series.length);
      const ranks = cats.map((_, i) => { const ord = series.map((s, k) => [k, n0(s.values[i])]).sort((a, b) => b[1] - a[1]); const rk = []; ord.forEach(([k], j) => (rk[k] = j + 1)); return rk; });
      const fr = frame(el, o, { l: 26, r: 96, t: 10, b: 30 });
      const x = d3.scalePoint().domain(cats.map(catName)).range([0, fr.w]).padding(0.3);
      const y = d3.scaleLinear().domain([1, series.length]).range([0, fr.h]);
      xAxisBand(fr.g, x, fr.h, o);
      d3.range(1, series.length + 1).forEach((k) => label(fr.g, -10, y(k) + 4, "#" + k, o, { anchor: "end", size: 9 }));
      series.forEach((s, k) => {
        const pts = cats.map((c, i) => [x(catName(c)), y(ranks[i][k])]);
        const gg = fr.g.append("g").attr("opacity", op(o, s.raw));
        const p = gg.append("path").attr("d", d3.line().curve(d3.curveBumpX)(pts)).attr("fill", "none").attr("stroke", cols[k]).attr("stroke-width", 3).attr("stroke-linecap", "round");
        pts.forEach((pt, i) => { const ci = gg.append("circle").attr("cx", pt[0]).attr("cy", pt[1]).attr("r", 5).attr("fill", cols[k]).attr("stroke", o.theme.card).attr("stroke-width", 1.5); tip(ci, () => [[s.name, "", cols[k]], [catName(cats[i]), "#" + ranks[i][k]], ["Value", full(s.values[i], s.fmt)]]); });
        label(gg, fr.w + 8, pts[pts.length - 1][1] + 4, V.truncate(s.name, 13), o, { anchor: "start", size: 10, color: cols[k], weight: 600 });
        tip(p, () => [[s.name, "", cols[k]], ["Latest rank", "#" + ranks[cats.length - 1][k]]]);
      });
    } });

  def("pareto", "Pareto (80/20)", CMP, R.cat, { query: "cat", sort: "value-desc", format: [["80% line", "line80", "toggle", true], F.topN, F.labelsOff], icon: '<rect x="3" y="6" width="4" height="14"/><rect x="8" y="10" width="4" height="10"/><rect x="13" y="14" width="3" height="6"/><rect x="17" y="17" width="3" height="3"/><path d="M5 12L10 6L15 4L20 3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r).sort((a, b) => n0(b.vals[0]) - n0(a.vals[0])), fm = fmt0(r), cols = pal(v, o, 3);
      const tot = d3.sum(rows, (d) => Math.max(0, n0(d.vals[0]))) || 1; let acc = 0;
      rows.forEach((d) => { acc += Math.max(0, n0(d.vals[0])); d.cum = acc / tot; });
      const fr = frame(el, o, { l: 46, r: 40, t: 10, b: 44 });
      const x = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, fr.w]).padding(0.15);
      const y = d3.scaleLinear().domain([0, d3.max(rows, (d) => n0(d.vals[0])) || 1]).nice().range([fr.h, 0]);
      const y2 = d3.scaleLinear().domain([0, 1]).range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, fm); xAxisBand(fr.g, x, fr.h, o);
      const ax = fr.g.append("g").attr("transform", "translate(" + fr.w + ",0)").call(d3.axisRight(y2).ticks(5).tickFormat(d3.format(".0%"))); V.axisStyle(ax, o.theme);
      rows.forEach((d) => {
        const b = fr.g.append("rect").attr("x", x(d.name)).attr("width", x.bandwidth()).attr("y", y(Math.max(0, n0(d.vals[0])))).attr("height", fr.h - y(Math.max(0, n0(d.vals[0])))).attr("fill", d.cum <= 0.8 + 1e-9 ? cols[0] : d3.color(cols[0]).copy({ opacity: 0.45 })).attr("rx", 2)
          .attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        tip(b, () => [[d.name, full(d.vals[0], fm), cols[0]], ["Cumulative", d3.format(".1%")(d.cum)], ["Share", d3.format(".1%")(n0(d.vals[0]) / tot)]]);
        if (f.dataLabels) label(fr.g, x(d.name) + x.bandwidth() / 2, y(n0(d.vals[0])) - 4, nf(d.vals[0], fm), o, { size: 9 });
      });
      const line = d3.line().x((d) => x(d.name) + x.bandwidth() / 2).y((d) => y2(d.cum));
      fr.g.append("path").attr("d", line(rows)).attr("fill", "none").attr("stroke", cols[2]).attr("stroke-width", 2.2);
      fr.g.selectAll(".pd").data(rows).join("circle").attr("cx", (d) => x(d.name) + x.bandwidth() / 2).attr("cy", (d) => y2(d.cum)).attr("r", 3).attr("fill", cols[2]);
      if (f.line80 !== false) { fr.g.append("line").attr("x1", 0).attr("x2", fr.w).attr("y1", y2(0.8)).attr("y2", y2(0.8)).attr("stroke", cols[2]).attr("stroke-dasharray", "5,4"); label(fr.g, 4, y2(0.8) - 4, "80%", o, { anchor: "start", color: cols[2], weight: 600 }); }
    } });

  def("marimekko", "Marimekko (mosaic)", CMP, R.catLegend, { query: "cat", format: [F.labels, F.legend], icon: '<rect x="3" y="3" width="8" height="10"/><rect x="3" y="13" width="8" height="8" opacity=".5"/><rect x="12" y="3" width="5" height="6" opacity=".5"/><rect x="12" y="9" width="5" height="12"/><rect x="18" y="3" width="3" height="13"/><rect x="18" y="16" width="3" height="5" opacity=".5"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), cols = pal(v, o, r.series.length), lg = f.legend !== false && r.series.length > 1;
      const fr = frame(el, o, { l: 40, r: 8, t: lg ? 26 : 8, b: 34 });
      if (lg) legendTop(fr.svg, r.series.map((s) => s.name), cols, o, 40);
      const totals = rows.map((d) => d3.sum(d.vals, (x) => Math.max(0, n0(x)))); const grand = d3.sum(totals) || 1;
      const y = d3.scaleLinear().domain([0, 1]).range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, { type: "percent", decimals: 0 }, 4);
      let x0 = 0;
      rows.forEach((d, i) => {
        const w = (totals[i] / grand) * fr.w; let acc = 0;
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        d.vals.forEach((val, k) => {
          const share = totals[i] ? Math.max(0, n0(val)) / totals[i] : 0; if (!share) return;
          const rect = gg.append("rect").attr("x", x0 + 0.5).attr("width", Math.max(0, w - 1)).attr("y", y(acc + share)).attr("height", y(acc) - y(acc + share)).attr("fill", cols[k]).attr("stroke", o.theme.card);
          if (f.dataLabels !== false && w > 34 && y(acc) - y(acc + share) > 14) label(gg, x0 + w / 2, y(acc + share / 2) + 4, d3.format(".0%")(share), o, { size: 9, color: contrast(cols[k]) });
          tip(rect, () => [[d.name + " · " + r.series[k].name, full(val, r.series[k].fmt), cols[k]], ["Share of " + d.name, d3.format(".1%")(share)], [d.name + " share of total", d3.format(".1%")(totals[i] / grand)]]);
          acc += share;
        });
        if (w > 24) label(fr.g, x0 + w / 2, fr.h + 14, V.truncate(d.name, Math.max(3, Math.floor(w / 6))), o, { size: 10 });
        x0 += w;
      });
    } });

  def("radar", "Radar / spider", CMP, R.catMulti, { query: "cat", sort: "category-asc", format: [F.legend, ["Fill", "fill", "toggle", true], ["Rings", "rings", "number", 4]], icon: '<path d="M12 3l8 6-3 10H7L4 9z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12 7l5 3-2 6H9.5L7 10z" opacity=".6"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      if (r.categories.length < 3) return empty(el, "A radar needs at least 3 categories (its spokes)");
      const f = v.format || {}, cols = pal(v, o, r.series.length), lg = f.legend !== false && r.series.length > 1;
      const fr = frame(el, o, { l: 10, r: 10, t: lg ? 26 : 8, b: 8 });
      if (lg) legendTop(fr.svg, r.series.map((s) => s.name), cols, o);
      const R0 = Math.min(fr.w, fr.h) / 2 - 26, cx = fr.w / 2, cy = fr.h / 2, n = r.categories.length;
      const mx = d3.max(r.series.flatMap((s) => s.values.map(n0))) || 1;
      const rad = d3.scaleLinear().domain([0, mx]).nice().range([0, R0]);
      const ang = (i) => (i / n) * 2 * Math.PI - Math.PI / 2;
      const g = fr.g.append("g").attr("transform", "translate(" + cx + "," + cy + ")");
      const rings = f.rings || 4;
      d3.range(1, rings + 1).forEach((k) => { const rr = (R0 * k) / rings; g.append("path").attr("d", d3.lineRadial().angle((_, i) => ang(i) + Math.PI / 2).radius(rr).curve(d3.curveLinearClosed)(d3.range(n))).attr("fill", "none").attr("stroke", o.theme.grid); label(g, 3, -rr - 2, nf(rad.invert(rr), fmt0(r)), o, { anchor: "start", size: 8 }); });
      r.categories.forEach((c, i) => {
        const a = ang(i); g.append("line").attr("x2", Math.cos(a) * R0).attr("y2", Math.sin(a) * R0).attr("stroke", o.theme.grid);
        label(g, Math.cos(a) * (R0 + 14), Math.sin(a) * (R0 + 14) + 4, V.truncate(catName(c), 14), o, { anchor: Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end", size: 10, color: o.theme.text })
          .style("cursor", "pointer").on("click", pick(o, c)).attr("opacity", op(o, c));
      });
      r.series.forEach((s, k) => {
        const pts = s.values.map((val, i) => [Math.cos(ang(i)) * rad(n0(val)), Math.sin(ang(i)) * rad(n0(val))]);
        const p = g.append("path").attr("d", d3.line().curve(d3.curveLinearClosed)(pts)).attr("fill", f.fill !== false ? cols[k] : "none").attr("fill-opacity", 0.18).attr("stroke", cols[k]).attr("stroke-width", 2);
        pts.forEach((pt, i) => { const ci = g.append("circle").attr("cx", pt[0]).attr("cy", pt[1]).attr("r", 3.5).attr("fill", cols[k]); tip(ci, () => [[catName(r.categories[i]), ""], [s.name, full(s.values[i], s.fmt), cols[k]]]); });
        tip(p, () => [[s.name, "", cols[k]]]);
      });
    } });

  def("smallMultiples", "Small multiples", CMP, R.time, { query: "cat", ordinal: true, format: [["Shared Y axis", "sharedY", "toggle", true], ["Area fill", "fill", "toggle", true], ["Max panels", "maxPanels", "number", 12]], icon: '<rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="13" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="3" y="13" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="13" y="13" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><path d="M4 9l2-3 2 2 2-3M14 9l2-1 2 1 2-4M4 19l2-2 2 1 2-4M14 19l2-4 2 2 2-1" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, series = r.series.slice(0, f.maxPanels || 12), cols = pal(v, o, series.length);
      const n = series.length, ncol = Math.ceil(Math.sqrt(n * o.width / Math.max(1, o.height))), nrow = Math.ceil(n / ncol);
      const svg = V.makeSvg(el, o.width, o.height); svg.on("click", () => o.onSelect && o.onSelect(null));
      const pw = o.width / ncol, ph = o.height / nrow;
      const globalMax = d3.max(series.flatMap((s) => s.values.map(n0))) || 1;
      series.forEach((s, k) => {
        const g = svg.append("g").attr("transform", "translate(" + ((k % ncol) * pw) + "," + (Math.floor(k / ncol) * ph) + ")").attr("opacity", op(o, s.raw));
        const iw = pw - 16, ih = ph - 30;
        const x = d3.scaleLinear().domain([0, Math.max(1, s.values.length - 1)]).range([8, 8 + iw]);
        const y = d3.scaleLinear().domain([0, f.sharedY === false ? d3.max(s.values, n0) || 1 : globalMax]).range([ph - 8, 22]);
        g.append("rect").attr("x", 4).attr("y", 4).attr("width", pw - 8).attr("height", ph - 8).attr("rx", 4).attr("fill", "none").attr("stroke", o.theme.grid);
        label(g, 10, 17, V.truncate(s.name, Math.floor(pw / 7)), o, { anchor: "start", size: 10, weight: 600, color: o.theme.text });
        label(g, pw - 10, 17, nf(s.values[s.values.length - 1], s.fmt), o, { anchor: "end", size: 10, color: cols[k], weight: 600 });
        const pts = s.values.map((val, i) => [x(i), y(n0(val))]);
        if (f.fill !== false) g.append("path").attr("d", d3.area().x((d) => d[0]).y0(ph - 8).y1((d) => d[1])(pts)).attr("fill", cols[k]).attr("opacity", 0.15);
        const p = g.append("path").attr("d", d3.line()(pts)).attr("fill", "none").attr("stroke", cols[k]).attr("stroke-width", 1.8);
        tip(p, () => [[s.name, "", cols[k]], ["Total", full(d3.sum(s.values, n0), s.fmt)], ["Peak", full(d3.max(s.values, n0), s.fmt)], ["From", catName(r.categories[0]) + " → " + catName(r.categories[r.categories.length - 1])]]);
      });
    } });

  // =================================================================== 3. CIRCULAR & RADIAL
  const RAD = "Circular & radial";

  def("radialBar", "Radial bar", RAD, R.cat, { query: "cat", format: [F.labels, F.topN], icon: '<path d="M12 3a9 9 0 1 1-9 9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7a5 5 0 1 1-5 5" fill="none" stroke="currentColor" stroke-width="2.2" opacity=".6"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r).slice(0, 12), cols = pal(v, o, rows.length), fm = fmt0(r);
      const fr = frame(el, o, { l: 8, r: 8, t: 8, b: 8 });
      const R0 = Math.min(fr.w, fr.h) / 2, inner = R0 * 0.25, g = fr.g.append("g").attr("transform", "translate(" + fr.w / 2 + "," + fr.h / 2 + ")");
      const band = (R0 - inner) / rows.length;
      const mx = d3.max(rows, (d) => n0(d.vals[0])) || 1;
      rows.forEach((d, i) => {
        const r1 = R0 - i * band, r0 = r1 - band * 0.72, a = (n0(d.vals[0]) / mx) * 1.5 * Math.PI;
        g.append("path").attr("d", d3.arc().innerRadius(r0).outerRadius(r1).startAngle(0).endAngle(1.5 * Math.PI).cornerRadius(band)()).attr("fill", o.theme.grid).attr("opacity", 0.5);
        const p = g.append("path").attr("d", d3.arc().innerRadius(r0).outerRadius(r1).startAngle(0).endAngle(Math.max(0.01, a)).cornerRadius(band)()).attr("fill", cols[i]).attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        if (f.dataLabels !== false && band > 9) label(g, -6, -(r0 + r1) / 2 + 4, V.truncate(d.name, 14) + "  " + nf(d.vals[0], fm), o, { anchor: "end", size: Math.min(11, band * 0.6) });
        tip(p, () => [[d.name, full(d.vals[0], fm), cols[i]]]);
      });
    } });

  def("circularBar", "Circular barplot", RAD, R.cat, { query: "cat", format: [F.labels, F.sort, F.topN], icon: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12 9V2M15 12h6M12 15v4M9 12H5M14 10l4-4M14 14l3 3M10 14l-3 3M10 10L6 6" stroke="currentColor" stroke-width="2"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), fm = fmt0(r), c = pal(v, o, 1)[0];
      const fr = frame(el, o, { l: 8, r: 8, t: 8, b: 8 });
      const R0 = Math.min(fr.w, fr.h) / 2 - 30, inner = R0 * 0.3;
      const g = fr.g.append("g").attr("transform", "translate(" + fr.w / 2 + "," + fr.h / 2 + ")");
      const x = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, 2 * Math.PI]).align(0);
      const y = d3.scaleRadial().domain([0, d3.max(rows, (d) => n0(d.vals[0])) || 1]).range([inner, R0]);
      rows.forEach((d, i) => {
        const p = g.append("path").attr("d", d3.arc().innerRadius(inner).outerRadius(y(Math.max(0, n0(d.vals[0])))).startAngle(x(d.name)).endAngle(x(d.name) + x.bandwidth()).padAngle(0.02).padRadius(inner)())
          .attr("fill", (v.format || {}).colors ? pal(v, o, rows.length)[i] : c).attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        const a = x(d.name) + x.bandwidth() / 2, rr = y(Math.max(0, n0(d.vals[0]))) + 6;
        if (f.dataLabels !== false && rows.length <= 60) g.append("text").attr("text-anchor", (a + Math.PI) % (2 * Math.PI) < Math.PI ? "end" : "start")
          .attr("transform", "rotate(" + ((a * 180) / Math.PI - 90) + ")translate(" + rr + ",0)" + ((a + Math.PI) % (2 * Math.PI) < Math.PI ? "rotate(180)" : ""))
          .attr("font-size", 9).attr("fill", o.theme.sub).attr("dominant-baseline", "middle").text(V.truncate(d.name, 12));
        tip(p, () => [[d.name, full(d.vals[0], fm), c]]);
      });
      label(g, 0, 4, nf(d3.sum(rows, (d) => n0(d.vals[0])), fm), o, { size: 13, weight: 700, color: o.theme.text });
    } });

  def("rose", "Nightingale rose", RAD, R.catLegend, { query: "cat", sort: "category-asc", format: [F.legend, F.labels], icon: '<path d="M12 12L12 2A10 10 0 0 1 20 8Z"/><path d="M12 12L20 8A6 6 0 0 1 17 16Z" opacity=".7"/><path d="M12 12L17 16A8 8 0 0 1 6 18Z" opacity=".5"/><path d="M12 12L6 18A4 4 0 0 1 9 9Z" opacity=".35"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r), cols = pal(v, o, Math.max(r.series.length, r.series.length > 1 ? r.series.length : rows.length));
      const lg = f.legend !== false && r.series.length > 1;
      const fr = frame(el, o, { l: 8, r: 8, t: lg ? 26 : 8, b: 8 });
      if (lg) legendTop(fr.svg, r.series.map((s) => s.name), cols, o);
      const R0 = Math.min(fr.w, fr.h) / 2 - 20, g = fr.g.append("g").attr("transform", "translate(" + fr.w / 2 + "," + fr.h / 2 + ")");
      const totals = rows.map((d) => d3.sum(d.vals, (x) => Math.max(0, n0(x))));
      const y = d3.scaleRadial().domain([0, d3.max(totals) || 1]).range([0, R0]);
      const step = (2 * Math.PI) / rows.length;
      rows.forEach((d, i) => {
        let acc = 0; const a0 = i * step, a1 = a0 + step;
        d.vals.forEach((val, k) => {
          const vv = Math.max(0, n0(val)); if (!vv) return;
          const color = r.series.length > 1 ? cols[k] : cols[i % cols.length];
          const p = g.append("path").attr("d", d3.arc().innerRadius(y(acc)).outerRadius(y(acc + vv)).startAngle(a0).endAngle(a1).padAngle(0.012)()).attr("fill", color).attr("stroke", o.theme.card).attr("stroke-width", 0.8)
            .attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
          tip(p, () => [[d.name, ""], [r.series[k].name, full(val, r.series[k].fmt), color]]);
          acc += vv;
        });
        const a = a0 + step / 2;
        if (f.dataLabels !== false) label(g, Math.sin(a) * (y(totals[i]) + 10), -Math.cos(a) * (y(totals[i]) + 10) + 4, V.truncate(d.name, 10), o, { size: 9, anchor: Math.sin(a) > 0.1 ? "start" : Math.sin(a) < -0.1 ? "end" : "middle" });
      });
    } });

  def("parliament", "Parliament (seats)", RAD, R.cat, { query: "cat", format: [["Seats", "seats", "number", 0], F.legend], icon: '<g><circle cx="3.5" cy="19" r="1.5"/><circle cx="5" cy="14" r="1.5"/><circle cx="8" cy="10" r="1.5"/><circle cx="12" cy="8.5" r="1.5" opacity=".6"/><circle cx="16" cy="10" r="1.5" opacity=".6"/><circle cx="19" cy="14" r="1.5" opacity=".4"/><circle cx="20.5" cy="19" r="1.5" opacity=".4"/><circle cx="8" cy="18" r="1.5"/><circle cx="10" cy="14" r="1.5"/><circle cx="14" cy="14" r="1.5" opacity=".6"/><circle cx="16" cy="18" r="1.5" opacity=".4"/></g>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r).filter((d) => n0(d.vals[0]) > 0), cols = pal(v, o, rows.length), fm = fmt0(r);
      const tot = d3.sum(rows, (d) => n0(d.vals[0])) || 1;
      const seats = f.seats > 0 ? Math.min(800, f.seats) : Math.max(20, Math.min(300, Math.round(tot) <= 300 && Number.isInteger(tot) ? tot : 150));
      // largest remainder allocation
      const exact = rows.map((d) => (n0(d.vals[0]) / tot) * seats); const alloc = exact.map(Math.floor);
      let left = seats - d3.sum(alloc); exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { alloc[i]++; left--; } });
      const lg = f.legend !== false;
      const fr = frame(el, o, { l: 8, r: 8, t: lg ? 26 : 8, b: 8 });
      if (lg) legendTop(fr.svg, rows.map((d, i) => d.name + " (" + alloc[i] + ")"), cols, o);
      const R0 = Math.min(fr.w / 2, fr.h - 10), inner = R0 * 0.38;
      const nrows = Math.max(2, Math.round(Math.sqrt(seats / 2.2)));
      const ringR = d3.range(nrows).map((k) => inner + ((R0 - inner) * (k + 0.5)) / nrows);
      const perRing = ringR.map((rr) => rr); const totR = d3.sum(perRing);
      const counts = perRing.map((rr) => Math.round((seats * rr) / totR)); counts[counts.length - 1] += seats - d3.sum(counts);
      const spots = [];
      ringR.forEach((rr, k) => { for (let j = 0; j < counts[k]; j++) { const a = Math.PI * (counts[k] > 1 ? j / (counts[k] - 1) : 0.5); spots.push({ a, x: -Math.cos(a) * rr, y: -Math.sin(a) * rr }); } });
      spots.sort((a, b) => a.a - b.a);
      const dotR = Math.max(1.5, Math.min(((R0 - inner) / nrows) * 0.42, (Math.PI * inner) / (counts[0] || 1) * 0.42));
      const g = fr.g.append("g").attr("transform", "translate(" + fr.w / 2 + "," + (fr.h - 4) + ")");
      let si = 0;
      rows.forEach((d, i) => {
        for (let k = 0; k < alloc[i] && si < spots.length; k++, si++) {
          const s = spots[si];
          const ci = g.append("circle").attr("cx", s.x).attr("cy", s.y).attr("r", dotR).attr("fill", cols[i]).attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
          tip(ci, () => [[d.name, alloc[i] + " seats", cols[i]], ["Value", full(d.vals[0], fm)], ["Share", d3.format(".1%")(n0(d.vals[0]) / tot)]]);
        }
      });
      label(g, 0, -6, seats + " seats", o, { size: 12, weight: 700, color: o.theme.text });
    } });

  // =================================================================== 4. PART-TO-WHOLE
  const PART = "Part-to-whole";

  def("waffle", "Waffle chart", PART, R.cat, { query: "cat", format: [F.legend, ["Grid size", "grid", "number", 10]], icon: '<g><rect x="3" y="3" width="4" height="4"/><rect x="8" y="3" width="4" height="4"/><rect x="13" y="3" width="4" height="4"/><rect x="18" y="3" width="3" height="4" opacity=".5"/><rect x="3" y="8" width="4" height="4"/><rect x="8" y="8" width="4" height="4" opacity=".5"/><rect x="13" y="8" width="4" height="4" opacity=".5"/><rect x="18" y="8" width="3" height="4" opacity=".3"/><rect x="3" y="13" width="4" height="4" opacity=".5"/><rect x="8" y="13" width="4" height="4" opacity=".3"/><rect x="13" y="13" width="4" height="4" opacity=".3"/><rect x="18" y="13" width="3" height="4" opacity=".3"/></g>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r).filter((d) => n0(d.vals[0]) > 0), cols = pal(v, o, rows.length), fm = fmt0(r);
      const G = Math.max(5, Math.min(30, f.grid || 10)), N = G * G;
      const tot = d3.sum(rows, (d) => n0(d.vals[0])) || 1;
      const exact = rows.map((d) => (n0(d.vals[0]) / tot) * N), alloc = exact.map(Math.floor);
      let left = N - d3.sum(alloc); exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { alloc[i]++; left--; } });
      const lg = f.legend !== false;
      const svg = V.makeSvg(el, o.width, o.height); svg.on("click", () => o.onSelect && o.onSelect(null));
      const lw = lg ? Math.min(170, o.width * 0.4) : 0;
      const size = Math.min(o.width - lw - 16, o.height - 8), cell = size / G;
      const g = svg.append("g").attr("transform", "translate(8," + (o.height - size) / 2 + ")");
      let k = 0;
      rows.forEach((d, i) => { for (let j = 0; j < alloc[i]; j++, k++) { const rr = Math.floor(k / G), cc = k % G; const sq = g.append("rect").attr("x", cc * cell + 1).attr("y", (G - 1 - rr) * cell + 1).attr("width", cell - 2).attr("height", cell - 2).attr("rx", Math.min(3, cell / 5)).attr("fill", cols[i]).attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c)); tip(sq, () => [[d.name, d3.format(".1%")(n0(d.vals[0]) / tot), cols[i]], ["Value", full(d.vals[0], fm)], ["Each square", "1 / " + N]]); } });
      if (lg) rows.forEach((d, i) => { const y0 = (o.height - size) / 2 + 10 + i * 20; if (y0 > o.height - 6) return; svg.append("rect").attr("x", size + 22).attr("y", y0 - 9).attr("width", 11).attr("height", 11).attr("rx", 2).attr("fill", cols[i]); label(svg, size + 38, y0, V.truncate(d.name, 16) + "  " + d3.format(".0%")(n0(d.vals[0]) / tot), o, { anchor: "start", size: 11, color: o.theme.text }); });
    } });

  const PICTO = {
    person: "M12 2a3.2 3.2 0 1 1 0 6.4A3.2 3.2 0 0 1 12 2zm-4 8h8a2 2 0 0 1 2 2v5h-2.5v5h-7v-5H6v-5a2 2 0 0 1 2-2z",
    circle: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z",
    square: "M4 4h16v16H4z",
    star: "M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.5 5.7 21l1.5-7L2 9.3l7-.8z",
    heart: "M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11z",
  };
  def("pictogram", "Pictogram (icon array)", PART, R.cat, { query: "cat", format: [["Icon", "icon", "select", "person", Object.keys(PICTO)], ["Units per icon (0 = auto)", "unit", "number", 0], F.labels], icon: '<path d="M6 3a1.8 1.8 0 1 1 0 3.6A1.8 1.8 0 0 1 6 3zM4 8h4v5H7v6H5v-6H4z"/><path d="M12 3a1.8 1.8 0 1 1 0 3.6A1.8 1.8 0 0 1 12 3zm-2 5h4v5h-1v6h-2v-6h-1z"/><path d="M18 3a1.8 1.8 0 1 1 0 3.6A1.8 1.8 0 0 1 18 3zm-2 5h4v5h-1v6h-2v-6h-1z" opacity=".35"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r).slice(0, 10), cols = pal(v, o, rows.length), fm = fmt0(r);
      const mx = d3.max(rows, (d) => n0(d.vals[0])) || 1;
      const fr = frame(el, o, { l: 96, r: 54, t: 6, b: 6 });
      const rowH = fr.h / rows.length, icon = Math.max(6, Math.min(rowH * 0.85, 26)), perRow = Math.max(1, Math.floor(fr.w / (icon * 1.15)));
      const unit = f.unit > 0 ? f.unit : (() => { const raw = mx / perRow; const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 5, 10].map((m) => m * p).find((u) => u >= raw) || raw; })();
      const path = PICTO[f.icon] || PICTO.person;
      rows.forEach((d, i) => {
        const val = n0(d.vals[0]), cnt = val / unit, y0 = i * rowH + (rowH - icon) / 2;
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        label(gg, -8, y0 + icon / 2 + 4, V.truncate(d.name, 14), o, { anchor: "end", size: 11, color: o.theme.text });
        for (let k = 0; k < Math.ceil(cnt) && k < perRow; k++) {
          const partial = Math.min(1, cnt - k), clipId = "pc" + Math.random().toString(36).slice(2, 9);
          const ig = gg.append("g").attr("transform", "translate(" + (k * icon * 1.15) + "," + y0 + ") scale(" + icon / 24 + ")");
          ig.append("path").attr("d", path).attr("fill", o.theme.grid);
          if (partial < 1) ig.append("clipPath").attr("id", clipId).append("rect").attr("width", 24 * partial).attr("height", 24);
          const fg = ig.append("path").attr("d", path).attr("fill", cols[i]);
          if (partial < 1) fg.attr("clip-path", "url(#" + clipId + ")");
          tip(fg, () => [[d.name, full(val, fm), cols[i]], ["Each icon", full(unit, fm)]]);
        }
        if (f.dataLabels !== false) label(gg, Math.min(Math.ceil(cnt), perRow) * icon * 1.15 + 4, y0 + icon / 2 + 4, nf(val, fm), o, { anchor: "start", size: 10, weight: 600 });
      });
      label(fr.svg, o.width - 4, o.height - 2, "1 icon = " + nf(unit, fm), o, { anchor: "end", size: 9 });
    } });

  // ----- hierarchy helpers (rows query: category = levels, values = size)
  function hierRoot(r) {
    const root = { name: "All", children: [], _m: new Map() };
    for (const rec of r.recs) {
      const path = rec.category || []; const val = Math.max(0, n0((rec.values || [])[0]));
      if (!val) continue;
      let node = root;
      path.forEach((p, depth) => {
        const key = E.isBlank(p) ? "(Blank)" : p;
        let ch = node._m.get(key);
        if (!ch) { ch = { name: catName(p), raw: p, depth: depth + 1, children: [], _m: new Map() }; node._m.set(key, ch); node.children.push(ch); }
        node = ch;
      });
      node.value = (node.value || 0) + val;
    }
    const clean = (n) => { delete n._m; if (!n.children.length) delete n.children; else { n.children.forEach(clean); } return n; };
    return d3.hierarchy(clean(root)).sum((d) => (d.children ? 0 : d.value || 0)).sort((a, b) => b.value - a.value);
  }
  function hierColor(v, o, root) { const tops = (root.children || []).map((c) => c.data.name); const cols = pal(v, o, tops.length); const m = new Map(tops.map((t, i) => [t, cols[i]])); return (d) => { let n = d; while (n.depth > 1) n = n.parent; return m.get(n.data.name) || o.theme.palette[0]; }; }
  function hierTip(d, r) { const names = d.ancestors().reverse().slice(1).map((a) => a.data.name); const fm = (r.fmts || {}).values; return [[names.join(" › "), full(d.value, fm)], ["Share of total", d3.format(".1%")(d.value / (d.ancestors().pop().value || 1))]].concat(d.parent && d.parent.depth ? [["Share of " + d.parent.data.name, d3.format(".1%")(d.value / (d.parent.value || 1))]] : []); }
  const hierPick = (o, d) => (d.depth === 1 ? pick(o, d.data.raw) : (ev) => ev.stopPropagation());
  const hierRows = (need) => ({ query: "rows", rows: ["category", "values"], need: need || ["category", "values"] });

  def("circlePacking", "Circle packing", PART, R.hier, Object.assign(hierRows(), { format: [F.labels], icon: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="9" cy="10" r="4.5" opacity=".7"/><circle cx="16" cy="13" r="3.2" opacity=".5"/><circle cx="11" cy="17" r="2.2" opacity=".35"/>',
    render(el, v, r, o) {
      const root = hierRoot(r); if (!root.value) return empty(el, "No data for the current filters");
      const f = v.format || {}, color = hierColor(v, o, root);
      const fr = frame(el, o, { l: 4, r: 4, t: 4, b: 4 });
      d3.pack().size([fr.w, fr.h]).padding(3)(root);
      const nodes = fr.g.selectAll("g").data(root.descendants().slice(1)).join("g").attr("transform", (d) => "translate(" + d.x + "," + d.y + ")");
      const ci = nodes.append("circle").attr("r", (d) => d.r).attr("fill", (d) => (d.children ? d3.color(color(d)).copy({ opacity: 0.12 }) : color(d))).attr("stroke", (d) => (d.children ? color(d) : o.theme.card)).attr("stroke-width", (d) => (d.children ? 1.2 : 0.8))
        .attr("opacity", (d) => (d.depth === 1 ? op(o, d.data.raw) : 1)).style("cursor", (d) => (d.depth === 1 ? "pointer" : null)).on("click", (ev, d) => hierPick(o, d)(ev));
      tip(ci, (d) => hierTip(d, r));
      if (f.dataLabels !== false) nodes.filter((d) => !d.children && d.r > 14).append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("font-size", (d) => Math.min(12, d.r / 3)).attr("fill", (d) => contrast(color(d))).text((d) => V.truncate(d.data.name, Math.floor(d.r / 3.5)));
      nodes.filter((d) => d.children && d.r > 30).append("text").attr("text-anchor", "middle").attr("y", (d) => -d.r + 12).attr("font-size", 10).attr("font-weight", 600).attr("fill", (d) => color(d)).text((d) => V.truncate(d.data.name, Math.floor(d.r / 4)));
    } }));

  def("icicle", "Icicle / partition", PART, R.hier, Object.assign(hierRows(), { format: [F.labels, ["Vertical", "vertical", "toggle", false]], icon: '<rect x="3" y="3" width="5" height="18"/><rect x="9" y="3" width="5" height="10" opacity=".7"/><rect x="9" y="14" width="5" height="7" opacity=".5"/><rect x="15" y="3" width="6" height="5" opacity=".5"/><rect x="15" y="9" width="6" height="4" opacity=".35"/><rect x="15" y="14" width="6" height="7" opacity=".35"/>',
    render(el, v, r, o) {
      const root = hierRoot(r); if (!root.value) return empty(el, "No data for the current filters");
      const f = v.format || {}, vert = !!f.vertical, color = hierColor(v, o, root);
      const fr = frame(el, o, { l: 2, r: 2, t: 2, b: 2 });
      d3.partition().size(vert ? [fr.w, fr.h] : [fr.h, fr.w]).padding(1.5)(root);
      const nodes = root.descendants().slice(1);
      const depth = root.height; const lvl = (vert ? fr.h : fr.w) / (depth + 1);
      const R2 = (d) => (vert ? { x: d.x0, y: d.y0 - lvl, w: d.x1 - d.x0, h: d.y1 - d.y0 } : { x: d.y0 - lvl, y: d.x0, w: d.y1 - d.y0, h: d.x1 - d.x0 });
      const sc = (vert ? fr.h : fr.w) / (vert ? fr.h - lvl : fr.w - lvl);
      const g = fr.g.selectAll("g").data(nodes).join("g").attr("transform", (d) => { const b = R2(d); return "translate(" + (vert ? b.x : b.x * sc) + "," + (vert ? b.y * sc : b.y) + ")"; });
      const rect = g.append("rect").attr("width", (d) => Math.max(0, R2(d).w * (vert ? 1 : sc))).attr("height", (d) => Math.max(0, R2(d).h * (vert ? sc : 1))).attr("rx", 2)
        .attr("fill", (d) => d3.color(color(d)).brighter((d.depth - 1) * 0.35)).attr("opacity", (d) => (d.depth === 1 ? op(o, d.data.raw) : 1)).style("cursor", (d) => (d.depth === 1 ? "pointer" : null)).on("click", (ev, d) => hierPick(o, d)(ev));
      tip(rect, (d) => hierTip(d, r));
      if (f.dataLabels !== false) g.filter((d) => R2(d).h * (vert ? sc : 1) > 13 && R2(d).w * (vert ? 1 : sc) > 34).append("text").attr("x", 5).attr("y", 13).attr("font-size", 10.5).attr("fill", (d) => contrast(d3.color(color(d)).brighter((d.depth - 1) * 0.35).formatHex()))
        .text((d) => V.truncate(d.data.name, Math.floor((R2(d).w * (vert ? 1 : sc)) / 6.5)) + "  " + nf(d.value, (r.fmts || {}).values));
    } }));

  def("nestedTreemap", "Nested treemap", PART, R.hier, Object.assign(hierRows(), { format: [F.labels], icon: '<rect x="2.5" y="2.5" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="5" width="9" height="15" opacity=".7"/><rect x="14" y="5" width="6" height="7" opacity=".5"/><rect x="14" y="13" width="6" height="7" opacity=".35"/>',
    render(el, v, r, o) {
      const root = hierRoot(r); if (!root.value) return empty(el, "No data for the current filters");
      const f = v.format || {}, color = hierColor(v, o, root);
      const fr = frame(el, o, { l: 2, r: 2, t: 2, b: 2 });
      d3.treemap().size([fr.w, fr.h]).paddingOuter(3).paddingTop((d) => (d.depth >= 1 && d.children ? 16 : 0)).paddingInner(1.5).round(true)(root);
      const nodes = fr.g.selectAll("g").data(root.descendants().slice(1)).join("g").attr("transform", (d) => "translate(" + d.x0 + "," + d.y0 + ")");
      const rect = nodes.append("rect").attr("width", (d) => Math.max(0, d.x1 - d.x0)).attr("height", (d) => Math.max(0, d.y1 - d.y0)).attr("rx", 2)
        .attr("fill", (d) => (d.children ? d3.color(color(d)).darker(0.3).formatHex() : d3.color(color(d)).brighter(0.25 * (d.depth - 1)).formatHex())).attr("stroke", o.theme.card).attr("stroke-width", 0.6)
        .attr("opacity", (d) => (d.depth === 1 ? op(o, d.data.raw) : 1)).style("cursor", (d) => (d.depth === 1 ? "pointer" : null)).on("click", (ev, d) => hierPick(o, d)(ev));
      tip(rect, (d) => hierTip(d, r));
      nodes.filter((d) => d.children && d.x1 - d.x0 > 40).append("text").attr("x", 4).attr("y", 12).attr("font-size", 10.5).attr("font-weight", 600).attr("fill", "#fff").text((d) => V.truncate(d.data.name, Math.floor((d.x1 - d.x0) / 6.5)));
      if (f.dataLabels !== false) nodes.filter((d) => !d.children && d.x1 - d.x0 > 44 && d.y1 - d.y0 > 26).append("text").attr("x", 4).attr("y", 13).attr("font-size", 10).attr("fill", (d) => contrast(d3.color(color(d)).brighter(0.25 * (d.depth - 1)).formatHex()))
        .call((t) => { t.append("tspan").text((d) => V.truncate(d.data.name, Math.floor((d.x1 - d.x0) / 6))); t.append("tspan").attr("x", 4).attr("dy", 12).attr("opacity", 0.85).text((d) => nf(d.value, (r.fmts || {}).values)); });
    } }));

  def("bubbleCloud", "Packed bubbles", PART, R.cat, { query: "cat", format: [F.labels, F.topN], icon: '<circle cx="8" cy="9" r="5"/><circle cx="16.5" cy="8" r="3.5" opacity=".6"/><circle cx="15" cy="16" r="4.5" opacity=".8"/><circle cx="7" cy="18" r="2.5" opacity=".45"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r).filter((d) => n0(d.vals[0]) > 0), cols = pal(v, o, rows.length), fm = fmt0(r);
      const fr = frame(el, o, { l: 2, r: 2, t: 2, b: 2 });
      const root = d3.hierarchy({ children: rows }).sum((d) => (d.vals ? n0(d.vals[0]) : 0));
      d3.pack().size([fr.w, fr.h]).padding(3)(root);
      const nodes = fr.g.selectAll("g").data(root.leaves()).join("g").attr("transform", (d) => "translate(" + d.x + "," + d.y + ")");
      const ci = nodes.append("circle").attr("r", (d) => d.r).attr("fill", (d) => cols[rows.indexOf(d.data)]).attr("opacity", (d) => op(o, d.data.c)).style("cursor", "pointer").on("click", (ev, d) => pick(o, d.data.c)(ev));
      tip(ci, (d) => [[d.data.name, full(d.data.vals[0], fm), cols[rows.indexOf(d.data)]], ["Share", d3.format(".1%")(d.value / root.value)]]);
      if (f.dataLabels !== false) nodes.filter((d) => d.r > 16).append("text").attr("text-anchor", "middle").attr("font-size", (d) => Math.min(14, d.r / 3)).attr("fill", (d) => contrast(cols[rows.indexOf(d.data)]))
        .call((t) => { t.append("tspan").attr("x", 0).attr("dy", "-0.1em").text((d) => V.truncate(d.data.name, Math.floor(d.r / 3.6))); t.append("tspan").attr("x", 0).attr("dy", "1.2em").attr("font-weight", 600).text((d) => nf(d.data.vals[0], fm)); });
    } });

  def("sunburst", "Sunburst", RAD, R.hier, Object.assign(hierRows(), { format: [F.labels], icon: '<circle cx="12" cy="12" r="4"/><path d="M12 6.5a5.5 5.5 0 0 1 5.5 5.5H21A9 9 0 0 0 12 3z" opacity=".7"/><path d="M17.5 12A5.5 5.5 0 0 1 9 16.6l-2 2.9A9 9 0 0 0 21 12z" opacity=".5"/><path d="M9 16.6A5.5 5.5 0 0 1 12 6.5V3a9 9 0 0 0-5 16.5z" opacity=".35"/>',
    render(el, v, r, o) {
      const root = hierRoot(r); if (!root.value) return empty(el, "No data for the current filters");
      const f = v.format || {}, color = hierColor(v, o, root);
      const fr = frame(el, o, { l: 4, r: 4, t: 4, b: 4 });
      const R0 = Math.min(fr.w, fr.h) / 2;
      d3.partition().size([2 * Math.PI, R0])(root);
      const inner = R0 / (root.height + 1) * 0.55;
      const sc = d3.scaleLinear().domain([R0 / (root.height + 1), R0]).range([inner, R0]);
      const g = fr.g.append("g").attr("transform", "translate(" + fr.w / 2 + "," + fr.h / 2 + ")");
      const arc = d3.arc().startAngle((d) => d.x0).endAngle((d) => d.x1).padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.006)).innerRadius((d) => sc(d.y0)).outerRadius((d) => sc(d.y1) - 1);
      const nodes = root.descendants().slice(1);
      const p = g.selectAll("path").data(nodes).join("path").attr("d", arc).attr("fill", (d) => d3.color(color(d)).brighter((d.depth - 1) * 0.4).formatHex()).attr("stroke", o.theme.card).attr("stroke-width", 0.8)
        .attr("opacity", (d) => (d.depth === 1 ? op(o, d.data.raw) : 1)).style("cursor", (d) => (d.depth === 1 ? "pointer" : null)).on("click", (ev, d) => hierPick(o, d)(ev));
      tip(p, (d) => hierTip(d, r));
      if (f.dataLabels !== false) g.selectAll("text.l").data(nodes.filter((d) => (d.x1 - d.x0) * (sc(d.y0) + sc(d.y1)) / 2 > 30 && sc(d.y1) - sc(d.y0) > 26)).join("text")
        .attr("transform", (d) => { const a = ((d.x0 + d.x1) / 2) * 180 / Math.PI, rr = (sc(d.y0) + sc(d.y1)) / 2; return "rotate(" + (a - 90) + ") translate(" + rr + ",0) rotate(" + (a < 180 ? 0 : 180) + ")"; })
        .attr("text-anchor", "middle").attr("dy", "0.35em").attr("font-size", 9.5).attr("fill", (d) => contrast(d3.color(color(d)).brighter((d.depth - 1) * 0.4).formatHex())).text((d) => V.truncate(d.data.name, Math.floor((sc(d.y1) - sc(d.y0)) / 6)));
      label(g, 0, 0, nf(root.value, (r.fmts || {}).values), o, { size: 14, weight: 700, color: o.theme.text, baseline: "middle" });
    } }));

  // ----- pairs (rows query: category = from, series = to, values = weight)
  const pairRows = { query: "rows", rows: ["category", "series", "values"], need: ["category", "series", "values"] };
  function pairs(r) { return r.recs.map((x) => ({ s: x.category[0], t: x.series[0], v: Math.max(0, n0(x.values[0])) })).filter((p) => p.v > 0 && !E.isBlank(p.s) && !E.isBlank(p.t)); }

  def("chord", "Chord diagram", RAD, R.pair, Object.assign({}, pairRows, { format: [F.labels, ["Max groups", "maxGroups", "number", 20]], icon: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 8c4 3 10 3 14 0M6 17c3-5 9-7 12-4" fill="none" stroke="currentColor" stroke-width="2" opacity=".6"/>',
    render(el, v, r, o) {
      const ps = pairs(r); if (!ps.length) return empty(el, "No connections for the current filters");
      const f = v.format || {};
      const tot = new Map(); ps.forEach((p) => { tot.set(p.s, (tot.get(p.s) || 0) + p.v); tot.set(p.t, (tot.get(p.t) || 0) + p.v); });
      const names = Array.from(tot.keys()).sort((a, b) => tot.get(b) - tot.get(a)).slice(0, f.maxGroups || 20); const idx = new Map(names.map((n, i) => [n, i]));
      const M = names.map(() => names.map(() => 0)); ps.forEach((p) => { if (idx.has(p.s) && idx.has(p.t)) M[idx.get(p.s)][idx.get(p.t)] += p.v; });
      const cols = pal(v, o, names.length), fm = (r.fmts || {}).values;
      const fr = frame(el, o, { l: 4, r: 4, t: 4, b: 4 });
      const R0 = Math.min(fr.w, fr.h) / 2 - 40, g = fr.g.append("g").attr("transform", "translate(" + fr.w / 2 + "," + fr.h / 2 + ")");
      const ch = d3.chordDirected().padAngle(0.04).sortSubgroups(d3.descending)(M);
      const grp = g.selectAll("g.gr").data(ch.groups).join("g");
      const ga = grp.append("path").attr("d", d3.arc().innerRadius(R0).outerRadius(R0 + 10)).attr("fill", (d) => cols[d.index]).attr("opacity", (d) => op(o, names[d.index])).style("cursor", "pointer").on("click", (ev, d) => pick(o, names[d.index])(ev));
      tip(ga, (d) => [[catName(names[d.index]), full(d.value, fm), cols[d.index]]]);
      if (f.dataLabels !== false) grp.filter((d) => d.endAngle - d.startAngle > 0.08).append("text").each((d) => { d.a = (d.startAngle + d.endAngle) / 2; })
        .attr("transform", (d) => "rotate(" + (d.a * 180 / Math.PI - 90) + ") translate(" + (R0 + 14) + ")" + (d.a > Math.PI ? " rotate(180)" : "")).attr("text-anchor", (d) => (d.a > Math.PI ? "end" : null)).attr("dy", "0.35em").attr("font-size", 10).attr("fill", o.theme.text).text((d) => V.truncate(catName(names[d.index]), 14));
      const rib = g.append("g").attr("fill-opacity", 0.68).selectAll("path").data(ch).join("path").attr("d", d3.ribbonArrow().radius(R0 - 1).padAngle(1 / R0)).attr("fill", (d) => cols[d.source.index]).attr("stroke", o.theme.card).attr("stroke-width", 0.4)
        .attr("opacity", (d) => op(o, names[d.source.index]));
      tip(rib, (d) => [[catName(names[d.source.index]) + " → " + catName(names[d.target.index]), full(d.source.value, fm), cols[d.source.index]]]);
    } }));

  // =================================================================== 5. FLOW & NETWORK
  const FLOW = "Flow & network";

  function sankeyLayout(levels, links, W, H, pad) {
    // levels: [[name,...], ...]  links: {s:"l:i", t:"l:j", v}
    const nodes = new Map();
    levels.forEach((names, l) => names.forEach((n) => nodes.set(l + "\u0001" + n, { id: l + "\u0001" + n, name: n, level: l, inV: 0, outV: 0, ins: [], outs: [] })));
    links.forEach((k) => { const s = nodes.get(k.s), t = nodes.get(k.t); if (!s || !t) return; k.source = s; k.target = t; s.outV += k.v; t.inV += k.v; s.outs.push(k); t.ins.push(k); });
    const nw = 14, L = levels.length, xs = (l) => (L === 1 ? 0 : (l * (W - nw)) / (L - 1));
    const byLevel = levels.map((names, l) => names.map((n) => nodes.get(l + "\u0001" + n)).filter((n) => Math.max(n.inV, n.outV) > 0));
    const ky = d3.min(byLevel, (col) => (H - pad * Math.max(0, col.length - 1)) / (d3.sum(col, (n) => Math.max(n.inV, n.outV)) || 1));
    byLevel.forEach((col, l) => {
      col.sort((a, b) => Math.max(b.inV, b.outV) - Math.max(a.inV, a.outV));
      let y = 0; const used = d3.sum(col, (n) => Math.max(n.inV, n.outV)) * ky + pad * Math.max(0, col.length - 1); y = (H - used) / 2;
      col.forEach((n) => { n.x0 = xs(l); n.x1 = n.x0 + nw; n.y0 = y; n.y1 = y + Math.max(1, Math.max(n.inV, n.outV) * ky); y = n.y1 + pad; });
    });
    byLevel.flat().forEach((n) => {
      n.outs.sort((a, b) => a.target.y0 - b.target.y0); n.ins.sort((a, b) => a.source.y0 - b.source.y0);
      let sy = n.y0; n.outs.forEach((k) => { k.y0 = sy + (k.v * ky) / 2; sy += k.v * ky; k.w = k.v * ky; });
      let ty = n.y0; n.ins.forEach((k) => { k.y1 = ty + (k.v * ky) / 2; ty += k.v * ky; });
    });
    return { nodes: byLevel.flat(), links: links.filter((k) => k.source && k.target && k.source.y0 != null && k.target.y0 != null) };
  }
  def("sankey", "Sankey (flow)", FLOW, [["category", "Stages (2–4, left → right)", 4, "dim"], ["values", "Flow size", 1, "value"]], Object.assign(hierRows(), { format: [F.labels, ["Max nodes per stage", "maxNodes", "number", 15]], icon: '<rect x="2" y="3" width="3" height="8"/><rect x="2" y="13" width="3" height="8" opacity=".6"/><rect x="19" y="3" width="3" height="5"/><rect x="19" y="10" width="3" height="11" opacity=".6"/><path d="M5 7C12 7 12 5 19 5M5 9C12 9 12 15 19 15M5 17C12 17 12 18 19 18" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".45"/>',
    render(el, v, r, o) {
      const depth = d3.max(r.recs, (x) => (x.category || []).length) || 0;
      if (depth < 2) return empty(el, "Add at least two Stage fields (for example Region and Category)");
      const f = v.format || {}, maxN = f.maxNodes || 15, fm = (r.fmts || {}).values;
      const levels = d3.range(depth).map(() => new Map());
      r.recs.forEach((x) => { const val = Math.max(0, n0((x.values || [])[0])); x.category.forEach((c, l) => levels[l].set(catName(c), (levels[l].get(catName(c)) || 0) + val)); });
      const keep = levels.map((m) => new Set(Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, maxN).map((e) => e[0])));
      const name = (l, c) => (keep[l].has(catName(c)) ? catName(c) : "Other");
      const linkMap = new Map();
      r.recs.forEach((x) => { const val = Math.max(0, n0((x.values || [])[0])); if (!val) return; for (let l = 0; l < depth - 1; l++) { const s = l + "\u0001" + name(l, x.category[l]), t = l + 1 + "\u0001" + name(l + 1, x.category[l + 1]); const k = s + "\u0002" + t; const e = linkMap.get(k) || { s, t, v: 0 }; e.v += val; linkMap.set(k, e); } });
      const lvNames = levels.map((m, l) => Array.from(new Set(Array.from(m.keys()).map((c) => (keep[l].has(c) ? c : "Other")))));
      const fr = frame(el, o, { l: 6, r: 6, t: 18, b: 6 });
      const lay = sankeyLayout(lvNames, Array.from(linkMap.values()), fr.w, fr.h, 6);
      const topNames = lvNames[0]; const cols = pal(v, o, Math.max(1, topNames.length)); const cmap = new Map(topNames.map((n, i) => [n, cols[i]]));
      const nodeColor = (n) => (n.level === 0 ? cmap.get(n.name) : o.theme.sub);
      const origin = (k) => { let s = k.source; while (s.level > 0 && s.ins.length) s = s.ins.slice().sort((a, b) => b.v - a.v)[0].source; return s; };
      const linkPath = (k) => { const x0 = k.source.x1, x1 = k.target.x0, xm = (x0 + x1) / 2; return "M" + x0 + "," + k.y0 + "C" + xm + "," + k.y0 + " " + xm + "," + k.y1 + " " + x1 + "," + k.y1; };
      const lp = fr.g.append("g").attr("fill", "none").selectAll("path").data(lay.links).join("path").attr("d", linkPath).attr("stroke", (k) => cmap.get(origin(k).name) || o.theme.palette[0]).attr("stroke-opacity", 0.38).attr("stroke-width", (k) => Math.max(1, k.w))
        .attr("opacity", (k) => op(o, (r.recs.find((x) => catName(x.category[0]) === origin(k).name) || { category: [] }).category[0]));
      lp.on("mouseenter", function () { d3.select(this).attr("stroke-opacity", 0.7); }).on("mouseleave", function () { d3.select(this).attr("stroke-opacity", 0.38); V.hideTip(); }).on("mousemove", (ev, k) => V.showTip(ev, [[k.source.name + " → " + k.target.name, full(k.v, fm)], ["Share of " + k.source.name, d3.format(".1%")(k.v / (k.source.outV || 1))]]));
      const nd = fr.g.append("g").selectAll("rect").data(lay.nodes).join("rect").attr("x", (n) => n.x0).attr("y", (n) => n.y0).attr("width", (n) => n.x1 - n.x0).attr("height", (n) => n.y1 - n.y0).attr("fill", nodeColor).attr("rx", 2)
        .style("cursor", (n) => (n.level === 0 ? "pointer" : null)).on("click", (ev, n) => { if (n.level === 0) { const rec = r.recs.find((x) => catName(x.category[0]) === n.name); if (rec) pick(o, rec.category[0])(ev); } else ev.stopPropagation(); });
      tip(nd, (n) => [[n.name, full(Math.max(n.inV, n.outV), fm), nodeColor(n)], ["Stage", (r.labels.category || [])[n.level] || ""]]);
      const labNodes = lay.nodes.filter((n) => n.y1 - n.y0 > 4);
      d3.groups(labNodes, (n) => n.level).forEach(([, ns]) => { const ys = dodge(ns.map((n) => (n.y0 + n.y1) / 2), 12, 6, fr.h - 4); ns.forEach((n, i) => (n.ly = ys[i])); });
      if (f.dataLabels !== false) fr.g.append("g").selectAll("text").data(labNodes).join("text").attr("x", (n) => (n.x0 < fr.w / 2 ? n.x1 + 5 : n.x0 - 5)).attr("y", (n) => n.ly).attr("dy", "0.35em").attr("text-anchor", (n) => (n.x0 < fr.w / 2 ? "start" : "end"))
        .attr("font-size", 10.5).attr("fill", o.theme.text).text((n) => { const room = (depth > 2 ? fr.w / (depth - 1) / 2 : fr.w / 2) - 26, txt = n.name + "  " + nf(Math.max(n.inV, n.outV), fm); return V.measureText(txt, 10.5) <= room ? txt : V.truncate(n.name, Math.max(4, Math.floor(room / 6.2))); });
      (r.labels.category || []).forEach((lab, l) => label(fr.svg, 6 + (depth === 1 ? 0 : (l * (fr.w - 14)) / (depth - 1)) + 7, 12, lab, o, { size: 10, weight: 600, anchor: l === 0 ? "start" : l === depth - 1 ? "end" : "middle" }));
    } }));

  def("arcDiagram", "Arc diagram", FLOW, R.pair, Object.assign({}, pairRows, { format: [F.labels, ["Max nodes", "maxNodes", "number", 30]], icon: '<circle cx="3" cy="18" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="14" cy="18" r="1.6"/><circle cx="21" cy="18" r="1.6"/><path d="M3 18A6 6 0 0 1 14 18M9 18A6 6 0 0 1 21 18M3 18A9 9 0 0 1 21 18" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".7"/>',
    render(el, v, r, o) {
      const ps = pairs(r); if (!ps.length) return empty(el, "No connections for the current filters");
      const f = v.format || {}, fm = (r.fmts || {}).values;
      const deg = new Map(); ps.forEach((p) => { deg.set(p.s, (deg.get(p.s) || 0) + p.v); deg.set(p.t, (deg.get(p.t) || 0) + p.v); });
      const names = Array.from(deg.keys()).sort((a, b) => deg.get(b) - deg.get(a)).slice(0, f.maxNodes || 30);
      const set = new Set(names); const cols = pal(v, o, names.length); const ci = new Map(names.map((n, i) => [n, i]));
      const fr = frame(el, o, { l: 10, r: 10, t: 10, b: 56 });
      const x = d3.scalePoint().domain(names.map(catName)).range([10, fr.w - 10]);
      const mv = d3.max(ps, (p) => p.v) || 1; const wsc = d3.scaleSqrt().domain([0, mv]).range([0.6, 7]);
      const arcs = fr.g.append("g").attr("fill", "none").selectAll("path").data(ps.filter((p) => set.has(p.s) && set.has(p.t) && p.s !== p.t)).join("path")
        .attr("d", (p) => { const a = x(catName(p.s)), b = x(catName(p.t)), rr = Math.abs(b - a) / 2; return "M" + a + "," + fr.h + "A" + rr + "," + Math.min(rr, fr.h) + " 0 0," + (a < b ? 1 : 0) + " " + b + "," + fr.h; })
        .attr("stroke", (p) => cols[ci.get(p.s)]).attr("stroke-opacity", 0.55).attr("stroke-width", (p) => wsc(p.v)).attr("opacity", (p) => op(o, p.s));
      tip(arcs, (p) => [[catName(p.s) + " → " + catName(p.t), full(p.v, fm), cols[ci.get(p.s)]]]);
      const nd = fr.g.selectAll("circle").data(names).join("circle").attr("cx", (n) => x(catName(n))).attr("cy", fr.h).attr("r", (n) => 3 + 5 * Math.sqrt(deg.get(n) / (d3.max(names, (m) => deg.get(m)) || 1))).attr("fill", (n, i) => cols[i]).attr("stroke", o.theme.card)
        .attr("opacity", (n) => op(o, n)).style("cursor", "pointer").on("click", (ev, n) => pick(o, n)(ev));
      tip(nd, (n) => [[catName(n), full(deg.get(n), fm)]]);
      if (f.dataLabels !== false) fr.g.selectAll("text.n").data(names).join("text").attr("transform", (n) => "translate(" + x(catName(n)) + "," + (fr.h + 12) + ") rotate(-50)").attr("text-anchor", "end").attr("font-size", 9.5).attr("fill", o.theme.sub).text((n) => V.truncate(catName(n), 14));
    } }));

  def("network", "Network graph", FLOW, R.pair, Object.assign({}, pairRows, { format: [F.labels, ["Max nodes", "maxNodes", "number", 60]], icon: '<path d="M6 6L12 12L18 7M12 12L8 19M12 12L19 17" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="2.4"/><circle cx="12" cy="12" r="3"/><circle cx="18" cy="7" r="2"/><circle cx="8" cy="19" r="2"/><circle cx="19" cy="17" r="2.2"/>',
    render(el, v, r, o) {
      const ps = pairs(r); if (!ps.length) return empty(el, "No connections for the current filters");
      const f = v.format || {}, fm = (r.fmts || {}).values;
      const deg = new Map(), side = new Map(); ps.forEach((p) => { deg.set(p.s, (deg.get(p.s) || 0) + p.v); deg.set(p.t, (deg.get(p.t) || 0) + p.v); if (!side.has(p.s)) side.set(p.s, 0); if (!side.has(p.t)) side.set(p.t, 1); });
      const names = Array.from(deg.keys()).sort((a, b) => deg.get(b) - deg.get(a)).slice(0, f.maxNodes || 60); const set = new Set(names);
      const nodes = names.map((n) => ({ id: n, deg: deg.get(n), side: side.get(n) }));
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const links = ps.filter((p) => set.has(p.s) && set.has(p.t) && p.s !== p.t).map((p) => ({ source: byId.get(p.s), target: byId.get(p.t), v: p.v }));
      const fr = frame(el, o, { l: 4, r: 4, t: 26, b: 4 });
      const rs = d3.scaleSqrt().domain([0, d3.max(nodes, (n) => n.deg) || 1]).range([3, Math.max(6, Math.min(fr.w, fr.h) / 14)]);
      const ws = d3.scaleSqrt().domain([0, d3.max(links, (k) => k.v) || 1]).range([0.5, 5]);
      const sim = d3.forceSimulation(nodes).force("link", d3.forceLink(links).distance(Math.min(fr.w, fr.h) / 5).strength(0.4)).force("charge", d3.forceManyBody().strength(-Math.min(fr.w, fr.h) / 3)).force("center", d3.forceCenter(fr.w / 2, fr.h / 2))
        .force("collide", d3.forceCollide((n) => rs(n.deg) + 3)).force("x", d3.forceX(fr.w / 2).strength(0.05)).force("y", d3.forceY(fr.h / 2).strength(0.08)).stop();
      for (let i = 0; i < 260; i++) sim.tick();
      // fit the settled layout to the visual so the graph uses all the space it has
      const pad = rs(d3.max(nodes, (n) => n.deg) || 1) + 12, ex = d3.extent(nodes, (n) => n.x), ey = d3.extent(nodes, (n) => n.y);
      const sx = (fr.w - 2 * pad) / Math.max(1, ex[1] - ex[0]), sy = (fr.h - 2 * pad) / Math.max(1, ey[1] - ey[0]);
      nodes.forEach((n) => { n.x = pad + (n.x - ex[0]) * sx; n.y = pad + (n.y - ey[0]) * sy; if (nodes.length === 1) { n.x = fr.w / 2; n.y = fr.h / 2; } });
      const cols = pal(v, o, 2);
      const lk = fr.g.append("g").selectAll("line").data(links).join("line").attr("x1", (k) => k.source.x).attr("y1", (k) => k.source.y).attr("x2", (k) => k.target.x).attr("y2", (k) => k.target.y).attr("stroke", o.theme.sub).attr("stroke-opacity", 0.35).attr("stroke-width", (k) => ws(k.v));
      tip(lk, (k) => [[catName(k.source.id) + " → " + catName(k.target.id), full(k.v, fm)]]);
      const nd = fr.g.append("g").selectAll("circle").data(nodes).join("circle").attr("cx", (n) => n.x).attr("cy", (n) => n.y).attr("r", (n) => rs(n.deg)).attr("fill", (n) => cols[n.side]).attr("stroke", o.theme.card).attr("stroke-width", 1.5)
        .attr("opacity", (n) => op(o, n.id)).style("cursor", "pointer").on("click", (ev, n) => pick(o, n.id)(ev));
      tip(nd, (n) => [[catName(n.id), full(n.deg, fm), cols[n.side]], ["Type", (n.side ? (r.labels.series || [""])[0] : (r.labels.category || [""])[0])], ["Connections", full(links.filter((k) => k.source === n || k.target === n).length)]]);
      if (f.dataLabels !== false) fr.g.append("g").selectAll("text").data(nodes.filter((n) => rs(n.deg) > 7 || nodes.length < 25)).join("text").attr("x", (n) => n.x).attr("y", (n) => n.y - rs(n.deg) - 3).attr("text-anchor", "middle").attr("font-size", 9.5).attr("fill", o.theme.text).text((n) => V.truncate(catName(n.id), 14));
      legendTop(fr.svg, [(r.labels.category || ["From"])[0], (r.labels.series || ["To"])[0]], cols, o);
    } }));

  def("heatmap", "Heatmap", FLOW, [["category", "Rows", 1, "dim"], ["series", "Columns", 1, "dim"], ["values", "Value", 1, "value"]], Object.assign({}, pairRows, { format: [F.labels, ["Diverging colours", "diverging", "toggle", false]], icon: '<rect x="3" y="3" width="5" height="5" opacity=".9"/><rect x="9.5" y="3" width="5" height="5" opacity=".4"/><rect x="16" y="3" width="5" height="5" opacity=".7"/><rect x="3" y="9.5" width="5" height="5" opacity=".3"/><rect x="9.5" y="9.5" width="5" height="5" opacity=".95"/><rect x="16" y="9.5" width="5" height="5" opacity=".5"/><rect x="3" y="16" width="5" height="5" opacity=".6"/><rect x="9.5" y="16" width="5" height="5" opacity=".2"/><rect x="16" y="16" width="5" height="5" opacity=".8"/>',
    render(el, v, r, o) {
      const recs = r.recs.filter((x) => x.values && x.values[0] != null); if (!recs.length) return empty(el, "No data for the current filters");
      const f = v.format || {}, fm = (r.fmts || {}).values;
      const sortv = (arr) => arr.slice().sort(E.compareValues);
      const rowsK = sortv(Array.from(new Set(recs.map((x) => x.category[0])))).slice(0, 60), colsK = sortv(Array.from(new Set(recs.map((x) => x.series[0])))).slice(0, 60);
      const M = new Map(recs.map((x) => [catName(x.category[0]) + "\u0001" + catName(x.series[0]), n0(x.values[0])]));
      const fr = frame(el, o, { l: 96, r: 10, t: 8, b: 48 });
      const x = d3.scaleBand().domain(colsK.map(catName)).range([0, fr.w]).padding(0.04), y = d3.scaleBand().domain(rowsK.map(catName)).range([0, fr.h]).padding(0.04);
      const ext = d3.extent(Array.from(M.values()));
      const color = f.diverging ? d3.scaleDiverging(d3.interpolateRdYlGn).domain([ext[0], (ext[0] + ext[1]) / 2, ext[1]]) : seqScale(o, ext);
      xAxisBand(fr.g, x, fr.h, o); yAxisBand(fr.g, y, o);
      rowsK.forEach((rk) => colsK.forEach((ck) => {
        const key = catName(rk) + "\u0001" + catName(ck); if (!M.has(key)) return; const val = M.get(key);
        const cell = fr.g.append("rect").attr("x", x(catName(ck))).attr("y", y(catName(rk))).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("rx", 2).attr("fill", color(val))
          .attr("opacity", op(o, rk)).style("cursor", "pointer").on("click", pick(o, rk));
        tip(cell, () => [[catName(rk) + " · " + catName(ck), full(val, fm), color(val)]]);
        if (f.dataLabels !== false && x.bandwidth() > 30 && y.bandwidth() > 14) label(fr.g, x(catName(ck)) + x.bandwidth() / 2, y(catName(rk)) + y.bandwidth() / 2, nf(val, fm), o, { size: 9.5, baseline: "middle", color: contrast(d3.color(color(val)).formatHex()) });
      }));
    } }));

  def("punchCard", "Punch card", FLOW, [["category", "Rows", 1, "dim"], ["series", "Columns", 1, "dim"], ["values", "Value", 1, "value"]], Object.assign({}, pairRows, { format: [], icon: '<circle cx="5" cy="6" r="1.2"/><circle cx="12" cy="6" r="2.5"/><circle cx="19" cy="6" r="1.8"/><circle cx="5" cy="12" r="2.8"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="2.4"/><circle cx="5" cy="18" r="1.8"/><circle cx="12" cy="18" r="2.9"/><circle cx="19" cy="18" r="1"/>',
    render(el, v, r, o) {
      const recs = r.recs.filter((x) => x.values && x.values[0] != null); if (!recs.length) return empty(el, "No data for the current filters");
      const fm = (r.fmts || {}).values; const sortv = (arr) => arr.slice().sort(E.compareValues);
      const rowsK = sortv(Array.from(new Set(recs.map((x) => x.category[0])))).slice(0, 40), colsK = sortv(Array.from(new Set(recs.map((x) => x.series[0])))).slice(0, 60);
      const fr = frame(el, o, { l: 96, r: 10, t: 8, b: 44 });
      const x = d3.scaleBand().domain(colsK.map(catName)).range([0, fr.w]), y = d3.scaleBand().domain(rowsK.map(catName)).range([0, fr.h]);
      xAxisBand(fr.g, x, fr.h, o); yAxisBand(fr.g, y, o);
      const mx = d3.max(recs, (x2) => Math.abs(n0(x2.values[0]))) || 1; const rs = d3.scaleSqrt().domain([0, mx]).range([0, Math.min(x.bandwidth(), y.bandwidth()) / 2 - 1]);
      const cols = pal(v, o, rowsK.length); const ri = new Map(rowsK.map((k, i) => [catName(k), i]));
      recs.forEach((rec) => {
        const rk = rec.category[0], ck = rec.series[0]; if (!ri.has(catName(rk)) || x(catName(ck)) == null) return;
        const c = cols[ri.get(catName(rk))];
        const ci = fr.g.append("circle").attr("cx", x(catName(ck)) + x.bandwidth() / 2).attr("cy", y(catName(rk)) + y.bandwidth() / 2).attr("r", rs(Math.abs(n0(rec.values[0])))).attr("fill", c).attr("opacity", op(o, rk) * 0.85).style("cursor", "pointer").on("click", pick(o, rk));
        tip(ci, () => [[catName(rk) + " · " + catName(ck), full(rec.values[0], fm), c]]);
      });
    } }));

  // =================================================================== 6. TIME & FINANCE
  const TIME = "Time & finance";

  def("calendarHeatmap", "Calendar heatmap", TIME, [["category", "Date (day level)", 1, "dim"], ["values", "Value", 1, "value"]], { query: "cat", ordinal: true, dayLevel: true, format: [["Week starts Monday", "monday", "toggle", true]], icon: '<g><rect x="3" y="4" width="3" height="3"/><rect x="7" y="4" width="3" height="3" opacity=".4"/><rect x="11" y="4" width="3" height="3" opacity=".7"/><rect x="15" y="4" width="3" height="3"/><rect x="3" y="8" width="3" height="3" opacity=".3"/><rect x="7" y="8" width="3" height="3"/><rect x="11" y="8" width="3" height="3" opacity=".5"/><rect x="15" y="8" width="3" height="3" opacity=".2"/><rect x="3" y="12" width="3" height="3" opacity=".8"/><rect x="7" y="12" width="3" height="3" opacity=".6"/><rect x="11" y="12" width="3" height="3"/><rect x="15" y="12" width="3" height="3" opacity=".4"/><rect x="3" y="16" width="3" height="3" opacity=".5"/><rect x="7" y="16" width="3" height="3" opacity=".9"/><rect x="11" y="16" width="3" height="3" opacity=".3"/></g>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, fm = fmt0(r);
      const days = r.categories.map((c, i) => ({ c, d: E.parseDate(c), v: n0(r.series[0].values[i]) })).filter((x) => x.d && !isNaN(x.d));
      if (!days.length) return empty(el, "Use a date column (not a year or month) for the Date well");
      const years = Array.from(new Set(days.map((x) => x.d.getFullYear()))).sort();
      const fr = frame(el, o, { l: 34, r: 6, t: 14, b: 4 });
      const yearH = fr.h / years.length; const cell = Math.max(2, Math.min(fr.w / 54, (yearH - 6) / 7));
      const color = seqScale(o, [0, d3.max(days, (x) => x.v) || 1]);
      const mon = f.monday !== false; const dow = (d) => (mon ? (d.getDay() + 6) % 7 : d.getDay());
      const weekOf = (d) => { const start = new Date(d.getFullYear(), 0, 1); return Math.floor((((d - start) / 864e5) + dow(start)) / 7); };
      years.forEach((yr, yi) => {
        const g = fr.g.append("g").attr("transform", "translate(0," + yi * yearH + ")");
        label(g, -6, cell * 3.5, String(yr), o, { anchor: "end", size: 10, weight: 600, color: o.theme.text, baseline: "middle" }).attr("transform", "rotate(-90," + (-10) + "," + cell * 3.5 + ")");
        days.filter((x) => x.d.getFullYear() === yr).forEach((x) => {
          const rc = g.append("rect").attr("x", weekOf(x.d) * cell).attr("y", dow(x.d) * cell).attr("width", cell - 1).attr("height", cell - 1).attr("rx", Math.min(2, cell / 4)).attr("fill", color(x.v))
            .attr("opacity", op(o, x.c)).style("cursor", "pointer").on("click", pick(o, x.c));
          tip(rc, () => [[d3.timeFormat("%a %d %b %Y")(x.d), full(x.v, fm), color(x.v)]]);
        });
        d3.range(12).forEach((m) => { const d = new Date(yr, m, 1); if (yi === 0 && cell > 6) label(g, weekOf(d) * cell, -3, d3.timeFormat("%b")(d), o, { anchor: "start", size: 9 }); });
      });
    } });

  def("streamgraph", "Streamgraph", TIME, R.time, { query: "cat", ordinal: true, format: [F.legend, ["Centered (wiggle)", "wiggle", "toggle", true]], icon: '<path d="M2 12C6 8 9 9 12 11s6 1 10-2v4c-4 3-7 4-10 2s-6-2-10 1z" opacity=".8"/><path d="M2 16c4-3 7-2 10 0s6 0 10-3v3c-4 4-7 5-10 3s-6-1-10 1z" opacity=".45"/><path d="M2 8c4-4 7-3 10-1s6 0 10-3v5c-4 3-7 2-10 0S6 6 2 9z" opacity=".3"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, cols = pal(v, o, r.series.length), lg = f.legend !== false && r.series.length > 1;
      const fr = frame(el, o, { l: 10, r: 10, t: lg ? 26 : 8, b: 30 });
      if (lg) legendTop(fr.svg, r.series.map((s) => s.name), cols, o);
      const data = r.categories.map((_, i) => { const row = {}; r.series.forEach((s, k) => (row[k] = Math.max(0, n0(s.values[i])))); return row; });
      const stack = d3.stack().keys(d3.range(r.series.length)).offset(f.wiggle !== false ? d3.stackOffsetWiggle : d3.stackOffsetNone).order(f.wiggle !== false ? d3.stackOrderInsideOut : d3.stackOrderNone)(data);
      const x = d3.scalePoint().domain(r.categories.map(catName)).range([0, fr.w]);
      const y = d3.scaleLinear().domain([d3.min(stack, (l) => d3.min(l, (d) => d[0])), d3.max(stack, (l) => d3.max(l, (d) => d[1]))]).range([fr.h, 0]);
      xAxisBand(fr.g, x, fr.h, o);
      const p = fr.g.selectAll("path.s").data(stack).join("path").attr("d", d3.area().x((d, i) => x(catName(r.categories[i]))).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis))
        .attr("fill", (l) => cols[l.key]).attr("opacity", (l) => op(o, r.series[l.key].raw) * 0.9).attr("stroke", o.theme.card).attr("stroke-width", 0.5);
      p.on("mousemove", (ev, l) => { const [mx] = d3.pointer(ev, fr.g.node()); const i = Math.max(0, Math.min(r.categories.length - 1, Math.round(mx / (fr.w / Math.max(1, r.categories.length - 1))))); V.showTip(ev, [[r.series[l.key].name, "", cols[l.key]], [catName(r.categories[i]), full(r.series[l.key].values[i], r.series[l.key].fmt)]]); }).on("mouseleave", V.hideTip);
    } });

  def("horizon", "Horizon chart", TIME, R.time, { query: "cat", ordinal: true, format: [["Bands", "bands", "number", 3]], icon: '<path d="M2 8l4-3 4 2 4-4 4 3 4-2v5H2z" opacity=".35"/><path d="M2 8l4-1 4 1 4-2 4 1 4-1v2H2z"/><path d="M2 19l4-2 4 1 4-4 4 3 4-3v5H2z" opacity=".35"/><path d="M2 19l4-1 4 1 4-1 4 1 4 0v1H2z"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, bands = Math.max(1, Math.min(6, f.bands || 3)), series = r.series.slice(0, 20), cols = pal(v, o, series.length);
      const svg = V.makeSvg(el, o.width, o.height); svg.on("click", () => o.onSelect && o.onSelect(null));
      const lw = 90, rowH = (o.height - 22) / series.length, w = o.width - lw - 8;
      const x = d3.scaleLinear().domain([0, Math.max(1, r.categories.length - 1)]).range([0, w]);
      const mx = d3.max(series.flatMap((s) => s.values.map((val) => Math.abs(n0(val))))) || 1;
      series.forEach((s, k) => {
        const g = svg.append("g").attr("transform", "translate(" + lw + "," + k * rowH + ")").attr("opacity", op(o, s.raw));
        const clip = "hz" + Math.random().toString(36).slice(2, 9);
        g.append("clipPath").attr("id", clip).append("rect").attr("width", w).attr("height", rowH - 1);
        const gg = g.append("g").attr("clip-path", "url(#" + clip + ")");
        const y = d3.scaleLinear().domain([0, mx / bands]).range([rowH - 1, 0]);
        const base = d3.color(cols[k]);
        for (let b = 0; b < bands; b++) {
          const pts = s.values.map((val, i) => [x(i), Math.max(0, n0(val)) - (mx / bands) * b]);
          gg.append("path").attr("d", d3.area().x((d) => d[0]).y0(rowH - 1).y1((d) => y(d[1])).curve(d3.curveMonotoneX)(pts)).attr("fill", base.copy({ opacity: 0.25 + (0.75 * (b + 1)) / bands }).formatRgb());
          const neg = s.values.map((val, i) => [x(i), Math.max(0, -n0(val)) - (mx / bands) * b]);
          if (neg.some((d) => d[1] > 0)) gg.append("path").attr("d", d3.area().x((d) => d[0]).y0(rowH - 1).y1((d) => y(d[1])).curve(d3.curveMonotoneX)(neg)).attr("fill", d3.color("#D64550").copy({ opacity: 0.25 + (0.75 * (b + 1)) / bands }).formatRgb());
        }
        const hit = g.append("rect").attr("width", w).attr("height", rowH).attr("fill", "transparent");
        hit.on("mousemove", (ev) => { const [mx2] = d3.pointer(ev, g.node()); const i = Math.max(0, Math.min(s.values.length - 1, Math.round(x.invert(mx2)))); V.showTip(ev, [[s.name, "", cols[k]], [catName(r.categories[i]), full(s.values[i], s.fmt)]]); }).on("mouseleave", V.hideTip);
        label(svg, lw - 6, k * rowH + rowH / 2, V.truncate(s.name, 13), o, { anchor: "end", size: 10, baseline: "middle", color: o.theme.text });
      });
      const xa = svg.append("g").attr("transform", "translate(" + lw + "," + (o.height - 20) + ")").call(d3.axisBottom(d3.scalePoint().domain(r.categories.map(catName)).range([0, w])).tickSize(0).tickPadding(4).tickValues(r.categories.map(catName).filter((_, i, a) => i % Math.ceil(a.length / 8) === 0)));
      V.axisStyle(xa, o.theme);
    } });

  def("candlestick", "Candlestick (OHLC)", TIME, [["category", "Date / period", 1, "dim"], ["open", "Open", 1, "value"], ["high", "High", 1, "value"], ["low", "Low", 1, "value"], ["close", "Close", 1, "value"]], { query: "cat", ordinal: true, vals: ["open", "high", "low", "close"], format: [["Up colour", "upColor", "color", "#1AAB40"], ["Down colour", "downColor", "color", "#D64550"]], icon: '<path d="M6 3v18M12 6v14M18 2v15" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="7" width="4" height="9"/><rect x="10" y="9" width="4" height="6" opacity=".55"/><rect x="16" y="4" width="4" height="8"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      if (r.series.length < 4) return empty(el, "Add Open, High, Low and Close values");
      const f = v.format || {}, up = f.upColor || "#1AAB40", dn = f.downColor || "#D64550", fm = fmt0(r);
      const rows = catRows(r).map((d) => ({ c: d.c, name: d.name, O: n0(d.vals[0]), H: n0(d.vals[1]), L: n0(d.vals[2]), C: n0(d.vals[3]) }));
      const fr = frame(el, o, { l: 50, r: 10, t: 8, b: 40 });
      const x = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, fr.w]).padding(0.3);
      const y = d3.scaleLinear().domain([d3.min(rows, (d) => d.L), d3.max(rows, (d) => d.H)]).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, fm); xAxisBand(fr.g, x, fr.h, o);
      rows.forEach((d) => {
        const c = d.C >= d.O ? up : dn, m = x(d.name) + x.bandwidth() / 2;
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        gg.append("line").attr("x1", m).attr("x2", m).attr("y1", y(d.H)).attr("y2", y(d.L)).attr("stroke", c).attr("stroke-width", 1.2);
        const b = gg.append("rect").attr("x", x(d.name)).attr("width", x.bandwidth()).attr("y", y(Math.max(d.O, d.C))).attr("height", Math.max(1, Math.abs(y(d.O) - y(d.C)))).attr("fill", c);
        tip(gg, () => [[d.name, d.C >= d.O ? "▲" : "▼", c], ["Open", full(d.O, fm)], ["High", full(d.H, fm)], ["Low", full(d.L, fm)], ["Close", full(d.C, fm)], ["Change", d.O ? d3.format("+.2%")((d.C - d.O) / d.O) : ""]]);
        void b;
      });
    } });

  def("gantt", "Gantt / timeline bars", TIME, [["category", "Task", 1, "dim"], ["start", "Start date", 1, "any"], ["end", "End date", 1, "any"], ["series", "Color by (optional)", 1, "dim"]], { query: "rows", rows: ["category", "start", "end", "series"], need: ["category", "start", "end"], format: [["Show today line", "today", "toggle", true], F.labels], icon: '<rect x="3" y="4" width="8" height="3"/><rect x="7" y="9" width="10" height="3" opacity=".7"/><rect x="12" y="14" width="9" height="3" opacity=".5"/><path d="M15 2v20" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>',
    render(el, v, r, o) {
      const items = r.recs.map((x) => ({ c: x.category[0], name: catName(x.category[0]), s: E.parseDate(x.start[0]), e: E.parseDate(x.end[0]), g: x.series ? x.series[0] : null })).filter((x) => x.s && x.e && !isNaN(x.s) && !isNaN(x.e));
      if (!items.length) return empty(el, "Add a Task with Start and End dates");
      const merged = new Map(); items.forEach((x) => { const m = merged.get(x.name); if (!m) merged.set(x.name, Object.assign({}, x)); else { if (x.s < m.s) m.s = x.s; if (x.e > m.e) m.e = x.e; } });
      const rows = Array.from(merged.values()).sort((a, b) => a.s - b.s).slice(0, 60);
      const f = v.format || {}; const groups = Array.from(new Set(rows.map((x) => catName(x.g)))); const cols = pal(v, o, groups.length);
      const fr = frame(el, o, { l: 110, r: 14, t: 8, b: 26 });
      const x = d3.scaleTime().domain([d3.min(rows, (d) => d.s), d3.max(rows, (d) => d.e)]).nice().range([0, fr.w]);
      const y = d3.scaleBand().domain(rows.map((d) => d.name)).range([0, fr.h]).padding(0.25);
      const ax = fr.g.append("g").attr("transform", "translate(0," + fr.h + ")").call(d3.axisBottom(x).ticks(6).tickSize(-fr.h)); V.axisStyle(ax, o.theme); ax.select(".domain").remove(); ax.selectAll(".tick line").attr("stroke-dasharray", "2,3");
      yAxisBand(fr.g, y, o);
      rows.forEach((d) => {
        const c = cols[groups.indexOf(catName(d.g))];
        const bar = fr.g.append("rect").attr("x", x(d.s)).attr("width", Math.max(2, x(d.e) - x(d.s))).attr("y", y(d.name)).attr("height", y.bandwidth()).attr("rx", Math.min(4, y.bandwidth() / 2)).attr("fill", c)
          .attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        const days = Math.round((d.e - d.s) / 864e5);
        if (f.dataLabels !== false && x(d.e) - x(d.s) > 40 && y.bandwidth() > 11) label(fr.g, x(d.s) + 5, y(d.name) + y.bandwidth() / 2 + 3.5, days + "d", o, { anchor: "start", size: 9.5, color: contrast(c) });
        tip(bar, () => [[d.name, "", c], ["Start", d3.timeFormat("%d %b %Y")(d.s)], ["End", d3.timeFormat("%d %b %Y")(d.e)], ["Duration", days + " days"]]);
      });
      const now = new Date();
      if (f.today !== false && now >= x.domain()[0] && now <= x.domain()[1]) { fr.g.append("line").attr("x1", x(now)).attr("x2", x(now)).attr("y1", 0).attr("y2", fr.h).attr("stroke", "#D64550").attr("stroke-width", 1.5).attr("stroke-dasharray", "4,3"); label(fr.g, x(now), -1, "Today", o, { size: 9, color: "#D64550" }); }
    } });

  def("stepLine", "Step line", TIME, R.time, { query: "cat", ordinal: true, format: [F.legend, ["Step position", "step", "select", "after", [["after", "After"], ["before", "Before"], ["mid", "Middle"]]], ["Area fill", "fill", "toggle", false]], icon: '<path d="M2 18h5v-6h5v-5h4v3h6" fill="none" stroke="currentColor" stroke-width="2"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, cols = pal(v, o, r.series.length), lg = f.legend !== false && r.series.length > 1;
      const fr = frame(el, o, { l: 46, r: 10, t: lg ? 26 : 8, b: 30 });
      if (lg) legendTop(fr.svg, r.series.map((s) => s.name), cols, o);
      const x = d3.scalePoint().domain(r.categories.map(catName)).range([0, fr.w]);
      const y = d3.scaleLinear().domain([Math.min(0, d3.min(r.series.flatMap((s) => s.values.map(n0)))), d3.max(r.series.flatMap((s) => s.values.map(n0))) || 1]).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, fmt0(r)); xAxisBand(fr.g, x, fr.h, o);
      const curve = f.step === "before" ? d3.curveStepBefore : f.step === "mid" ? d3.curveStep : d3.curveStepAfter;
      r.series.forEach((s, k) => {
        const pts = s.values.map((val, i) => [x(catName(r.categories[i])), y(n0(val))]);
        if (f.fill) fr.g.append("path").attr("d", d3.area().x((d) => d[0]).y0(y(0)).y1((d) => d[1]).curve(curve)(pts)).attr("fill", cols[k]).attr("opacity", 0.15);
        fr.g.append("path").attr("d", d3.line().curve(curve)(pts)).attr("fill", "none").attr("stroke", cols[k]).attr("stroke-width", 2).attr("opacity", op(o, s.raw));
        const dots = fr.g.selectAll(null).data(pts).join("circle").attr("cx", (d) => d[0]).attr("cy", (d) => d[1]).attr("r", 3).attr("fill", cols[k]);
        tip(dots, (d) => { const i = pts.indexOf(d); return [[catName(r.categories[i]), ""], [s.name, full(s.values[i], s.fmt), cols[k]]]; });
      });
    } });

  def("rangeBand", "Range band (low–high)", TIME, [["category", "Date / time axis", 1, "dim"], ["low", "Low", 1, "value"], ["mid", "Middle / actual (optional)", 1, "value"], ["high", "High", 1, "value"]], { query: "cat", ordinal: true, vals: ["low", "mid", "high"], format: [], icon: '<path d="M2 9C7 4 12 8 22 4v10C12 18 7 13 2 18z" opacity=".3"/><path d="M2 13C7 9 12 12 22 9" fill="none" stroke="currentColor" stroke-width="2"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const names = r.roleNames || [];
      const idx = { low: 0, mid: names[1] ? 1 : -1, high: names[1] ? 2 : 1 };
      if (r.series.length < 2) return empty(el, "Add Low and High values");
      const c = pal(v, o, 1)[0], fm = fmt0(r);
      const rows = catRows(r).map((d) => ({ c: d.c, name: d.name, lo: n0(d.vals[idx.low]), hi: n0(d.vals[idx.high]), mid: idx.mid >= 0 ? d.vals[idx.mid] : null }));
      const fr = frame(el, o, { l: 46, r: 10, t: 8, b: 30 });
      const x = d3.scalePoint().domain(rows.map((d) => d.name)).range([0, fr.w]);
      const y = d3.scaleLinear().domain([d3.min(rows, (d) => Math.min(d.lo, d.hi, n0(d.mid))), d3.max(rows, (d) => Math.max(d.lo, d.hi, n0(d.mid)))]).nice().range([fr.h, 0]);
      yAxis(fr.g, y, fr.w, o, fm); xAxisBand(fr.g, x, fr.h, o);
      fr.g.append("path").attr("d", d3.area().x((d) => x(d.name)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(d3.curveMonotoneX)(rows)).attr("fill", c).attr("opacity", 0.22);
      [["lo", 0.6], ["hi", 0.6]].forEach(([k, a]) => fr.g.append("path").attr("d", d3.line().x((d) => x(d.name)).y((d) => y(d[k])).curve(d3.curveMonotoneX)(rows)).attr("fill", "none").attr("stroke", c).attr("stroke-opacity", a).attr("stroke-dasharray", "3,3"));
      if (idx.mid >= 0) fr.g.append("path").attr("d", d3.line().x((d) => x(d.name)).y((d) => y(n0(d.mid))).curve(d3.curveMonotoneX)(rows)).attr("fill", "none").attr("stroke", c).attr("stroke-width", 2.2);
      const hit = fr.g.selectAll(null).data(rows).join("rect").attr("x", (d) => x(d.name) - fr.w / rows.length / 2).attr("width", fr.w / rows.length).attr("y", 0).attr("height", fr.h).attr("fill", "transparent");
      tip(hit, (d) => [[d.name, ""], [names[2] || names[1] || "High", full(d.hi, fm)]].concat(idx.mid >= 0 ? [[names[1], full(d.mid, fm), c]] : []).concat([[names[0] || "Low", full(d.lo, fm)]]));
    } });

  def("sparkTable", "Sparkline table", TIME, [["category", "Rows", 1, "dim"], ["time", "Trend axis (date)", 1, "dim"], ["values", "Value", 1, "value"]], { query: "rows", rows: ["category", "time", "values"], need: ["category", "time", "values"], format: [["Sort by", "sortSpark", "select", "total", [["total", "Total ↓"], ["change", "Change ↓"], ["name", "Name A→Z"]]]], icon: '<path d="M3 5h18M3 12h18M3 19h18" stroke="currentColor" stroke-width=".6" opacity=".5"/><path d="M11 4l2 1 2-2 2 2 2-1M11 11l2-1 2 2 2-2 2 1M11 18l2 1 2 1 2-3 2 1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3" y="3" width="5" height="2.4"/><rect x="3" y="10" width="5" height="2.4"/><rect x="3" y="17" width="5" height="2.4"/>',
    render(el, v, r, o) {
      const f = v.format || {}, fm = (r.fmts || {}).values;
      const byRow = new Map();
      r.recs.forEach((x) => { const k = x.category[0]; if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push([x.time[0], n0(x.values[0])]); });
      if (!byRow.size) return empty(el, "No data for the current filters");
      const allT = Array.from(new Set(r.recs.map((x) => x.time[0]))).sort(E.compareValues);
      let rows = Array.from(byRow.entries()).map(([k, pts]) => { const m = new Map(pts.map((p) => [String(p[0]), p[1]])); const series = allT.map((t) => m.get(String(t)) ?? 0); return { c: k, name: catName(k), series, total: d3.sum(series), change: series.length > 1 && series[0] ? (series[series.length - 1] - series[0]) / Math.abs(series[0]) : 0 }; });
      rows.sort((a, b) => (f.sortSpark === "name" ? E.compareValues(a.name, b.name) : f.sortSpark === "change" ? b.change - a.change : b.total - a.total));
      const svg = V.makeSvg(el, o.width, o.height); svg.on("click", () => o.onSelect && o.onSelect(null));
      const rowH = 26, head = 22, maxRows = Math.max(1, Math.floor((o.height - head) / rowH)); rows = rows.slice(0, maxRows);
      const cw = [Math.max(80, o.width * 0.3), 0, 76, 64]; cw[1] = Math.max(40, o.width - cw[0] - cw[2] - cw[3] - 8);
      const xs = [4, 4 + cw[0], 4 + cw[0] + cw[1] + 6, 4 + cw[0] + cw[1] + cw[2]];
      const c = pal(v, o, 1)[0];
      [(r.labels.category || [""])[0], "Trend", (r.labels.values || ["Total"])[0], "Change"].forEach((h, i) => label(svg, i >= 2 ? xs[i] + cw[i] - 6 : xs[i], 15, h, o, { anchor: i >= 2 ? "end" : "start", size: 10.5, weight: 600, color: o.theme.text }));
      svg.append("line").attr("x1", 0).attr("x2", o.width).attr("y1", head).attr("y2", head).attr("stroke", o.theme.grid);
      rows.forEach((row, i) => {
        const y0 = head + i * rowH; const g = svg.append("g").attr("transform", "translate(0," + y0 + ")").attr("opacity", op(o, row.c)).style("cursor", "pointer").on("click", pick(o, row.c));
        if (i % 2) g.append("rect").attr("width", o.width).attr("height", rowH).attr("fill", o.theme.grid).attr("opacity", 0.35);
        label(g, xs[0], rowH / 2 + 4, V.truncate(row.name, Math.floor(cw[0] / 6.5)), o, { anchor: "start", size: 11, color: o.theme.text });
        const sx = d3.scaleLinear().domain([0, Math.max(1, row.series.length - 1)]).range([xs[1], xs[1] + cw[1]]), sy = d3.scaleLinear().domain(d3.extent(row.series)).range([rowH - 5, 5]);
        if (sy.domain()[0] === sy.domain()[1]) sy.domain([sy.domain()[0] - 1, sy.domain()[1] + 1]);
        g.append("path").attr("d", d3.area().x((_, j) => sx(j)).y0(rowH - 3).y1((d) => sy(d)).curve(d3.curveMonotoneX)(row.series)).attr("fill", c).attr("opacity", 0.12);
        g.append("path").attr("d", d3.line().x((_, j) => sx(j)).y((d) => sy(d)).curve(d3.curveMonotoneX)(row.series)).attr("fill", "none").attr("stroke", c).attr("stroke-width", 1.6);
        const last = row.series.length - 1; g.append("circle").attr("cx", sx(last)).attr("cy", sy(row.series[last])).attr("r", 2.6).attr("fill", c);
        const mxi = row.series.indexOf(d3.max(row.series)); g.append("circle").attr("cx", sx(mxi)).attr("cy", sy(row.series[mxi])).attr("r", 2).attr("fill", "none").attr("stroke", c);
        label(g, xs[2] + cw[2] - 6, rowH / 2 + 4, nf(row.total, fm), o, { anchor: "end", size: 11, color: o.theme.text, weight: 600 });
        label(g, xs[3] + cw[3] - 6, rowH / 2 + 4, (row.change >= 0 ? "▲ " : "▼ ") + d3.format(".0%")(Math.abs(row.change)), o, { anchor: "end", size: 10.5, color: row.change >= 0 ? "#1AAB40" : "#D64550", weight: 600 });
        const hit = g.append("rect").attr("x", xs[1]).attr("width", cw[1]).attr("height", rowH).attr("fill", "transparent");
        hit.on("mousemove", (ev) => { const [mx] = d3.pointer(ev, g.node()); const j = Math.max(0, Math.min(last, Math.round(sx.invert(mx)))); V.showTip(ev, [[row.name, "", c], [catName(allT[j]), full(row.series[j], fm)]]); }).on("mouseleave", V.hideTip);
      });
    } });

  def("timeline", "Event timeline", TIME, [["category", "Event", 1, "dim"], ["date", "Date", 1, "any"], ["values", "Size (optional)", 1, "value"]], { query: "rows", rows: ["category", "date", "values"], need: ["category", "date"], format: [["Max events", "maxEvents", "number", 30]], icon: '<path d="M2 12h20" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="12" r="2"/><circle cx="11" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><path d="M5 10V5M11 14v5M18 10V6" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="3" width="6" height="2.5" rx="1"/><rect x="8" y="18.5" width="7" height="2.5" rx="1"/><rect x="15" y="4" width="6" height="2.5" rx="1"/>',
    render(el, v, r, o) {
      const f = v.format || {};
      let ev = r.recs.map((x) => ({ c: x.category[0], name: catName(x.category[0]), d: E.parseDate(x.date[0]), v: x.values ? n0(x.values[0]) : 0 })).filter((x) => x.d && !isNaN(x.d));
      if (!ev.length) return empty(el, "Add an Event and a Date");
      const merged = new Map(); ev.forEach((x) => { const m = merged.get(x.name); if (!m || x.d < m.d) merged.set(x.name, Object.assign({}, x, { v: (m ? m.v : 0) + x.v })); else m.v += x.v; });
      ev = Array.from(merged.values()).sort((a, b) => a.d - b.d).slice(0, f.maxEvents || 30);
      const cols = pal(v, o, ev.length);
      const fr = frame(el, o, { l: 30, r: 30, t: 10, b: 10 });
      const x = d3.scaleTime().domain(d3.extent(ev, (d) => d.d)).range([0, fr.w]); if (ev.length === 1) x.domain([new Date(+ev[0].d - 864e5 * 30), new Date(+ev[0].d + 864e5 * 30)]);
      const mid = fr.h / 2;
      fr.g.append("line").attr("x1", 0).attr("x2", fr.w).attr("y1", mid).attr("y2", mid).attr("stroke", o.theme.sub).attr("stroke-width", 2);
      const ax = fr.g.append("g").attr("transform", "translate(0," + mid + ")").call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(fr.w / 110))).tickSize(4)); V.axisStyle(ax, o.theme); ax.select(".domain").remove();
      const rs = d3.scaleSqrt().domain([0, d3.max(ev, (d) => d.v) || 1]).range([4, 10]);
      const perSide = Math.max(1, Math.floor((fr.h / 2 - 16) / 28)), slots = [];
      for (let k = 0; k < perSide; k++) slots.push({ up: true, k, end: -1e9 }, { up: false, k, end: -1e9 });
      ev.forEach((d, i) => {
        const xx = x(d.d), name = V.truncate(d.name, 18), wlab = Math.max(V.measureText(name, 10) + 4, 62);
        const slot = slots.find((sl) => sl.end < xx - wlab / 2 - 4 && xx - wlab / 2 > -26 && xx + wlab / 2 < fr.w + 26) || slots.find((sl) => sl.end < xx - wlab / 2 - 4);
        const gg = fr.g.append("g").attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        let t = null;
        if (slot) {
          slot.end = xx + wlab / 2;
          const yy = slot.up ? mid - 18 - slot.k * 28 : mid + 30 + slot.k * 28;
          gg.append("line").attr("x1", xx).attr("x2", xx).attr("y1", mid).attr("y2", slot.up ? yy + 2 : yy - 10).attr("stroke", cols[i]).attr("stroke-width", 1);
          t = label(gg, xx, yy, name, o, { size: 10, color: o.theme.text, weight: 600 });
          label(gg, xx, yy - 11, d3.timeFormat("%d %b %Y")(d.d), o, { size: 8.5 });
        }
        const dot = gg.append("circle").attr("cx", xx).attr("cy", mid).attr("r", d.v ? rs(d.v) : 5).attr("fill", cols[i]).attr("stroke", o.theme.card).attr("stroke-width", 1.5);
        tip(t ? dot.merge(t) : dot, () => [[d.name, "", cols[i]], ["Date", d3.timeFormat("%a %d %b %Y")(d.d)]].concat(d.v ? [[(r.labels.values || ["Value"])[0], full(d.v, (r.fmts || {}).values)]] : []));
      });
    } });

  // =================================================================== 7. KPI & TEXT
  const KPI = "KPI & text";

  def("liquidGauge", "Liquid fill gauge", KPI, [["values", "Value", 1, "value"], ["target", "Target (100%)", 1, "value"], ["max", "Maximum (optional)", 1, "value"]], { query: "gauge", format: [["Colour", "color", "color", null], ["Show wave", "wave", "toggle", true]], icon: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 13c2-1.5 4-1.5 6 0s4 1.5 6 0 3-1 4 0v1a8 8 0 0 1-16 0z"/>',
    render(el, v, r, o) {
      if (r.value == null) return empty(el, "Add a Value");
      const f = v.format || {}, c = f.color || pal(v, o, 1)[0];
      const denom = r.target || r.max || 1; const pct = Math.max(0, Math.min(1.2, n0(r.value) / denom));
      const svg = V.makeSvg(el, o.width, o.height);
      const R0 = Math.min(o.width, o.height) / 2 - 6, cx = o.width / 2, cy = o.height / 2;
      const g = svg.append("g").attr("transform", "translate(" + cx + "," + cy + ")");
      g.append("circle").attr("r", R0).attr("fill", "none").attr("stroke", c).attr("stroke-width", Math.max(2, R0 * 0.05));
      const ri = R0 * 0.88, clip = "lq" + Math.random().toString(36).slice(2, 9);
      g.append("clipPath").attr("id", clip).append("circle").attr("r", ri);
      const level = ri - 2 * ri * Math.min(1, pct);
      const amp = f.wave === false ? 0 : ri * 0.06, wl = ri * 1.2;
      const wave = d3.range(-2 * ri, 2 * ri + 1, 4).map((xx) => [xx, level + amp * Math.sin((xx / wl) * 2 * Math.PI)]);
      const area = d3.area().x((d) => d[0]).y0(ri + 2).y1((d) => d[1]);
      const lq = g.append("g").attr("clip-path", "url(#" + clip + ")");
      lq.append("path").attr("d", area(wave.map((d) => [d[0], d[1] + amp * 0.6]))).attr("fill", c).attr("opacity", 0.35);
      lq.append("path").attr("d", area(wave)).attr("fill", c);
      const txt = d3.format(".0%")(n0(r.value) / denom), fs = Math.max(12, R0 * 0.42);
      g.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("font-size", fs).attr("font-weight", 700).attr("fill", o.theme.text).text(txt);
      g.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("font-size", fs).attr("font-weight", 700).attr("fill", contrast(c)).attr("clip-path", "url(#" + clip + ")").text(txt)
        .attr("style", "clip-path:url(#" + clip + ")");
      g.select("text:last-child");
      const subY = fs * 0.75;
      label(g, 0, subY, nf(r.value, r.fmt) + (r.target ? " of " + nf(r.target, r.fmt) : ""), o, { size: Math.max(9, R0 * 0.11), color: subY > level ? contrast(c) : o.theme.sub });
      tip(g, () => [[r.label, full(r.value, r.fmt), c]].concat(r.target ? [[r.targetLabel || "Target", full(r.target, r.fmt)], ["Achieved", d3.format(".1%")(n0(r.value) / r.target)]] : []));
      // the text inside the liquid uses the contrast colour above the fill line only where the liquid is
      const lc = lq.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("font-size", fs).attr("font-weight", 700).attr("fill", contrast(c)).text(txt);
      lc.lower(); lc.raise();
    } });

  def("progressRings", "Progress rings", KPI, [["category", "Goals", 1, "dim"], ["values", "Actual", 1, "value"], ["target", "Target", 1, "value"]], { query: "cat", vals: ["values", "target"], format: [F.labels], icon: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity=".25"/><path d="M12 3a9 9 0 1 1-8.5 12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="2" opacity=".25"/><path d="M12 6.5a5.5 5.5 0 1 1-5.4 4.4" fill="none" stroke="currentColor" stroke-width="2"/>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r).slice(0, 6), cols = pal(v, o, rows.length), fm = fmt0(r);
      const svg = V.makeSvg(el, o.width, o.height); svg.on("click", () => o.onSelect && o.onSelect(null));
      const lw = f.dataLabels !== false ? Math.min(180, o.width * 0.45) : 0;
      const R0 = Math.min(o.width - lw, o.height) / 2 - 4, cx = R0 + 4, cy = o.height / 2;
      const th = Math.max(4, Math.min(R0 * 0.8 / rows.length, 22)), gap = th * 0.25;
      const g = svg.append("g").attr("transform", "translate(" + cx + "," + cy + ")");
      rows.forEach((d, i) => {
        const ro = R0 - i * (th + gap), ri = ro - th, a = n0(d.vals[0]), t = n0(d.vals[1]), pct = t ? a / t : 0;
        g.append("path").attr("d", d3.arc().innerRadius(ri).outerRadius(ro).startAngle(0).endAngle(2 * Math.PI)()).attr("fill", cols[i]).attr("opacity", 0.16);
        const p = g.append("path").attr("d", d3.arc().innerRadius(ri).outerRadius(ro).startAngle(0).endAngle(Math.max(0.02, Math.min(1, pct) * 2 * Math.PI)).cornerRadius(th / 2)()).attr("fill", cols[i])
          .attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
        if (pct > 1) g.append("path").attr("d", d3.arc().innerRadius(ri).outerRadius(ro).startAngle(0).endAngle(Math.min(1, pct - 1) * 2 * Math.PI).cornerRadius(th / 2)()).attr("fill", d3.color(cols[i]).darker(0.6)).attr("opacity", 0.9);
        tip(p, () => [[d.name, d3.format(".0%")(pct), cols[i]], [(r.roleNames || [])[0] || "Actual", full(a, fm)], [(r.roleNames || [])[1] || "Target", full(t, fm)]]);
        if (lw) { const ly = cy - (rows.length * 34) / 2 + i * 34 + 14; svg.append("circle").attr("cx", 2 * R0 + 20).attr("cy", ly - 4).attr("r", 5).attr("fill", cols[i]); label(svg, 2 * R0 + 30, ly, V.truncate(d.name, 18), o, { anchor: "start", size: 11, color: o.theme.text, weight: 600 }); label(svg, 2 * R0 + 30, ly + 13, nf(a, fm) + " / " + nf(t, fm) + "  ·  " + d3.format(".0%")(pct), o, { anchor: "start", size: 10, color: cols[i] }); }
      });
    } });

  def("wordCloud", "Word cloud", KPI, R.cat, { query: "cat", format: [["Max words", "maxWords", "number", 80], ["Allow vertical words", "vertical", "toggle", true]], icon: '<text x="2" y="10" font-size="9" font-weight="800">Aa</text><text x="13" y="8" font-size="5">bc</text><text x="11" y="17" font-size="7" font-weight="700">Dd</text><text x="3" y="20" font-size="5">ef</text>',
    render(el, v, r, o) {
      if (catGuard(el, r)) return;
      const f = v.format || {}, rows = catRows(r).filter((d) => n0(d.vals[0]) > 0).sort((a, b) => n0(b.vals[0]) - n0(a.vals[0])).slice(0, f.maxWords || 80), cols = pal(v, o, Math.min(10, rows.length)), fm = fmt0(r);
      const svg = V.makeSvg(el, o.width, o.height); svg.on("click", () => o.onSelect && o.onSelect(null));
      const W = o.width, H = o.height, mx = n0(rows[0] && rows[0].vals[0]) || 1;
      const fsz = d3.scaleSqrt().domain([0, mx]).range([9, Math.max(14, Math.min(W, H) / 6)]);
      const placed = [];
      const hit = (b) => b.x < 2 || b.y < 2 || b.x + b.w > W - 2 || b.y + b.h > H - 2 || placed.some((p) => !(b.x + b.w < p.x || p.x + p.w < b.x || b.y + b.h < p.y || p.y + p.h < b.y));
      const g = svg.append("g");
      rows.forEach((d, i) => {
        const size = fsz(n0(d.vals[0])), text = V.truncate(d.name, 24), tw = V.measureText(text, size) * 1.02, th = size * 0.9;
        const vert = f.vertical !== false && i % 4 === 3 && i > 2;
        const bw = vert ? th : tw, bh = vert ? tw : th;
        for (let t = 0; t < 2400; t++) {
          const a = t * 0.35, rad = 2.2 * a;
          const x = W / 2 + rad * Math.cos(a) * (W / H) * 0.9 - bw / 2, y = H / 2 + rad * Math.sin(a) - bh / 2;
          const b = { x, y, w: bw, h: bh };
          if (!hit(b)) {
            placed.push(b);
            const tx = g.append("text").attr("font-size", size).attr("font-weight", i < 5 ? 700 : 500).attr("fill", cols[i % cols.length]).attr("text-anchor", "middle").attr("dominant-baseline", "central")
              .attr("transform", "translate(" + (x + bw / 2) + "," + (y + bh / 2) + ")" + (vert ? " rotate(-90)" : "")).text(text)
              .attr("opacity", op(o, d.c)).style("cursor", "pointer").on("click", pick(o, d.c));
            tip(tx, () => [[d.name, full(d.vals[0], fm), cols[i % cols.length]]]);
            break;
          }
        }
      });
    } });

  // =================================================================== register everything with PyBI
  const QUERIES = { cat: catQuery, rows: rowsQuery, gauge: gaugeQuery };
  Object.entries(DEFS).forEach(([id, d]) => {
    let query;
    if (d.raw) query = rawQuery(d);
    else if (d.dayLevel) { const q = catQuery(d); query = (model, v, filters, report) => q(model, Object.assign({}, v, { fields: Object.assign({}, v.fields, { category: (v.fields.category || []).map((c) => Object.assign({}, c, { level: undefined })) }) }), filters, report); }
    else query = QUERIES[d.query] ? QUERIES[d.query](d) : catQuery(d);
    V.TYPES[id] = { label: d.label, roles: d.roles, group: d.group, plus: true, render: d.render, query, format: d.format || [] };
    V.ICONS[id] = d.icon || "";
  });
  V.PLUS_GROUPS = [STAT, CMP, RAD, PART, FLOW, TIME, KPI];

  global.PyBIVisualsPlus = { DEFS, def, R, F, helpers: { frame, empty, pal, tip, pick, op, yAxis, xAxisLin, xAxisBand, yAxisBand, legendTop, label, catRows, n0, contrast, seqScale, nf, full, catName, quart, kde, bandwidth } , catQuery, rowsQuery, rawQuery, gaugeQuery };
})(typeof window !== "undefined" ? window : globalThis);
