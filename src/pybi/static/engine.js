/* PyBI analytics engine: columnar model, relationships, filter context and a DAX-style formula language.
 * Runs in the browser so the editor and exported HTML dashboards behave identically.
 * Author: Muhammad Rafay Shaikh, from Pakistan. MIT License. */
(function (global) {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // ------------------------------------------------------------------ helpers
  const isBlank = (v) => v === null || v === undefined || (typeof v === "number" && isNaN(v));
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  function parseDate(v) {
    if (v instanceof Date) return v;
    if (typeof v !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(v);
    if (!m) { const d = new Date(v); return isNaN(d) ? null : d; }
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  }
  function isoDate(d) {
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  }
  function addPeriod(d, n, unit) {
    const r = new Date(d.getTime());
    unit = (unit || "DAY").toUpperCase();
    if (unit === "YEAR") r.setUTCFullYear(r.getUTCFullYear() + n);
    else if (unit === "QUARTER") r.setUTCMonth(r.getUTCMonth() + 3 * n);
    else if (unit === "MONTH") r.setUTCMonth(r.getUTCMonth() + n);
    else r.setUTCDate(r.getUTCDate() + n);
    return r;
  }

  const LEVELS = {
    year: (d) => d.getUTCFullYear(),
    quarter: (d) => "Qtr " + (Math.floor(d.getUTCMonth() / 3) + 1),
    month: (d) => MONTHS[d.getUTCMonth()],
    yearMonth: (d) => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1),
    yearQuarter: (d) => d.getUTCFullYear() + " Q" + (Math.floor(d.getUTCMonth() / 3) + 1),
    weekday: (d) => DAYS[d.getUTCDay()],
    day: (d) => isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))),
  };
  function applyLevel(v, level) {
    if (!level || isBlank(v)) return v;
    const d = parseDate(v);
    return d ? LEVELS[level](d) : v;
  }

  function compareValues(a, b) {
    if (isBlank(a)) return isBlank(b) ? 0 : 1;
    if (isBlank(b)) return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    const ma = MONTHS.indexOf(a), mb = MONTHS.indexOf(b);
    if (ma >= 0 && mb >= 0) return ma - mb;
    const la = MONTHS_LONG.indexOf(a), lb = MONTHS_LONG.indexOf(b);
    if (la >= 0 && lb >= 0) return la - lb;
    const da = DAYS.indexOf(a), db = DAYS.indexOf(b);
    if (da >= 0 && db >= 0) return da - db;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  // ------------------------------------------------------------------ formatting
  function fmtValue(v, fmt, compact) {
    if (isBlank(v)) return "(Blank)";
    if (typeof v === "boolean") return v ? "True" : "False";
    if (typeof v !== "number") {
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00$/.test(v)) return v.slice(0, 10);
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.replace("T", " ");
      return String(v);
    }
    if (fmt === undefined && Number.isInteger(v)) return String(v);
    fmt = fmt || {};
    const type = fmt.type || "auto";
    let dec = fmt.decimals;
    if (type === "percent") {
      return (v * 100).toLocaleString(undefined, { minimumFractionDigits: dec ?? 1, maximumFractionDigits: dec ?? 1 }) + "%";
    }
    let prefix = type === "currency" ? (fmt.symbol ?? "$") : "";
    let suffix = "";
    let n = v;
    if (compact || fmt.units) {
      const a = Math.abs(v);
      const unit = fmt.units && fmt.units !== "auto" ? fmt.units : (a >= 1e9 ? "bn" : a >= 1e6 ? "M" : a >= 1e3 ? "K" : "");
      if (unit === "bn") { n = v / 1e9; suffix = "bn"; }
      else if (unit === "M") { n = v / 1e6; suffix = "M"; }
      else if (unit === "K") { n = v / 1e3; suffix = "K"; }
      if (suffix && dec === undefined) dec = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
    }
    if (dec === undefined) dec = type === "whole" ? 0 : (Number.isInteger(n) ? 0 : (Math.abs(n) >= 1000 ? 0 : 2));
    const sign = n < 0 ? "-" : "";
    return sign + prefix + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
  }

  // ------------------------------------------------------------------ DAX tokenizer & parser
  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (ch === "-" && src[i + 1] === "-") { while (i < n && src[i] !== "\n") i++; continue; }
      if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
        let j = i; while (j < n && /[0-9.eE]/.test(src[j])) j++;
        toks.push({ t: "num", v: parseFloat(src.slice(i, j)) }); i = j; continue;
      }
      if (ch === '"') {
        let j = i + 1, s = "";
        while (j < n) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
        toks.push({ t: "str", v: s }); i = j + 1; continue;
      }
      if (ch === "'" || /[A-Za-z_]/.test(ch)) {
        let name, j;
        if (ch === "'") { j = src.indexOf("'", i + 1); if (j < 0) throw new Error("Unclosed quote"); name = src.slice(i + 1, j); j++; }
        else { j = i; while (j < n && /[A-Za-z0-9_.]/.test(src[j])) j++; name = src.slice(i, j); }
        let k = j; while (k < n && src[k] === " ") k++;
        if (src[k] === "[") {
          const e = src.indexOf("]", k); if (e < 0) throw new Error("Unclosed [");
          toks.push({ t: "col", table: name, column: src.slice(k + 1, e) }); i = e + 1; continue;
        }
        toks.push({ t: ch === "'" ? "tbl" : "id", v: name }); i = j; continue;
      }
      if (ch === "[") { const e = src.indexOf("]", i); if (e < 0) throw new Error("Unclosed ["); toks.push({ t: "mref", v: src.slice(i + 1, e) }); i = e + 1; continue; }
      const two = src.slice(i, i + 2);
      if (["<>", "<=", ">=", "&&", "||", "=="].includes(two)) { toks.push({ t: "op", v: two === "==" ? "=" : two }); i += 2; continue; }
      if ("+-*/^&=<>(),{}".includes(ch)) { toks.push({ t: "op", v: ch }); i++; continue; }
      throw new Error("Unexpected character '" + ch + "'");
    }
    return toks;
  }

  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && toks[p].t === "op" && toks[p].v === v;
    const isKw = (v) => toks[p] && toks[p].t === "id" && toks[p].v.toUpperCase() === v;
    const expect = (v) => { if (!isOp(v)) throw new Error("Expected '" + v + "'" + (peek() ? " near '" + (peek().v ?? peek().column) + "'" : " at end")); p++; };

    function expr() {
      if (isKw("VAR")) {
        const vars = [];
        while (isKw("VAR")) {
          p++;
          const name = toks[p++];
          if (!name || name.t !== "id") throw new Error("Expected variable name after VAR");
          expect("=");
          vars.push([name.v, expr()]);
        }
        if (!isKw("RETURN")) throw new Error("Expected RETURN");
        p++;
        return { k: "let", vars, body: expr() };
      }
      return or();
    }
    function or() { let l = and(); while (isOp("||")) { p++; l = { k: "bin", op: "||", l, r: and() }; } return l; }
    function and() { let l = cmp(); while (isOp("&&")) { p++; l = { k: "bin", op: "&&", l, r: cmp() }; } return l; }
    function cmp() {
      let l = concat();
      const t = peek();
      if (t && t.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.v)) { p++; return { k: "bin", op: t.v, l, r: concat() }; }
      if (isKw("IN")) { p++; return { k: "in", l, r: primary() }; }
      return l;
    }
    function concat() { let l = add(); while (isOp("&")) { p++; l = { k: "bin", op: "&", l, r: add() }; } return l; }
    function add() { let l = mul(); while (isOp("+") || isOp("-")) { const op = toks[p++].v; l = { k: "bin", op, l, r: mul() }; } return l; }
    function mul() { let l = pow(); while (isOp("*") || isOp("/")) { const op = toks[p++].v; l = { k: "bin", op, l, r: pow() }; } return l; }
    function pow() { let l = unary(); while (isOp("^")) { p++; l = { k: "bin", op: "^", l, r: unary() }; } return l; }
    function unary() {
      if (isOp("-")) { p++; return { k: "neg", e: unary() }; }
      if (isOp("+")) { p++; return unary(); }
      return primary();
    }
    function primary() {
      const t = toks[p];
      if (!t) throw new Error("Unexpected end of formula");
      if (t.t === "num") { p++; return { k: "num", v: t.v }; }
      if (t.t === "str") { p++; return { k: "str", v: t.v }; }
      if (t.t === "col") { p++; return { k: "col", t: t.table, c: t.column }; }
      if (t.t === "mref") { p++; return { k: "mref", n: t.v }; }
      if (t.t === "tbl") { p++; return { k: "table", n: t.v }; }
      if (isOp("(")) { p++; const e = expr(); expect(")"); return e; }
      if (isOp("{")) {
        p++; const items = [];
        if (!isOp("}")) { items.push(expr()); while (isOp(",")) { p++; items.push(expr()); } }
        expect("}"); return { k: "list", items };
      }
      if (t.t === "id") {
        p++;
        if (isOp("(")) {
          p++; const args = [];
          if (!isOp(")")) { args.push(isOp(",") ? { k: "blank" } : expr()); while (isOp(",")) { p++; args.push(isOp(")") ? { k: "blank" } : expr()); } }
          expect(")");
          return { k: "fn", n: t.v.toUpperCase(), args };
        }
        const up = t.v.toUpperCase();
        if (up === "TRUE") return { k: "bool", v: true };
        if (up === "FALSE") return { k: "bool", v: false };
        if (["YEAR", "MONTH", "DAY", "QUARTER"].includes(up)) return { k: "str", v: up };
        return { k: "name", n: t.v };
      }
      throw new Error("Unexpected '" + (t.v ?? "") + "'");
    }
    const ast = expr();
    if (p < toks.length) throw new Error("Unexpected '" + (toks[p].v ?? toks[p].column) + "' after end of formula");
    return ast;
  }

  // ------------------------------------------------------------------ filter objects
  let FID = 0;
  function colKey(t, c, level) { return t + "[" + c + "]" + (level ? "." + level : ""); }
  function inFilter(t, c, values, level, extra) {
    const set = values instanceof Set ? values : new Set(values);
    const key = "in:" + colKey(t, c, level) + "=" + JSON.stringify(Array.from(set).slice(0, 2000));
    return Object.assign({ t, c, level: level || null, kind: "in", values: set, key }, extra || {});
  }
  function predFilter(t, c, fn, level, label) {
    return { t, c, level: level || null, kind: "pred", pred: fn, key: "pred:" + (label ? colKey(t, c, level) + label : ++FID) };
  }

  // ------------------------------------------------------------------ the model
  class Model {
    constructor(spec) {
      this.tables = {};
      this.relationships = (spec.relationships || []).filter((r) => r.active !== false);
      this.measures = {};
      this.measureList = spec.measures || [];
      this.columnProps = spec.columnProps || {};
      this.errors = {};
      for (const [name, t] of Object.entries(spec.tables || {})) {
        this.tables[name] = { name, columns: t.columns.map((c) => Object.assign({}, c)), data: Object.assign({}, t.data), rows: t.rows };
      }
      this._idx = {};
      this._paths = {};
      this._derived = {};
      this._rowsCache = new Map();
      this._calcCols = spec.calcColumns || [];
      for (const cc of this._calcCols) this._addCalcColumn(cc);
      for (const m of this.measureList) {
        try { this.measures[m.name] = Object.assign({}, m, { ast: parse(m.expression) }); }
        catch (e) { this.errors["measure:" + m.name] = e.message; this.measures[m.name] = Object.assign({}, m, { ast: null, error: e.message }); }
      }
    }

    _addCalcColumn(cc) {
      const T = this.tables[cc.table];
      if (!T) { this.errors["column:" + cc.table + "[" + cc.name + "]"] = "Table not found"; return; }
      let ast;
      try { ast = parse(cc.expression); } catch (e) { this.errors["column:" + cc.table + "[" + cc.name + "]"] = e.message; return; }
      const out = new Array(T.rows);
      let err = null;
      for (let i = 0; i < T.rows; i++) {
        try { out[i] = this.eval(ast, { filters: [], row: { table: cc.table, i }, vars: {} }); }
        catch (e) { err = e.message; out[i] = null; if (i > 5) break; }
      }
      if (err) this.errors["column:" + cc.table + "[" + cc.name + "]"] = err;
      let type = "text";
      const sample = out.find((v) => !isBlank(v));
      if (typeof sample === "number") type = "number";
      else if (typeof sample === "boolean") type = "bool";
      else if (typeof sample === "string" && /^\d{4}-\d{2}-\d{2}T/.test(sample)) type = "date";
      T.data[cc.name] = out;
      const existing = T.columns.find((c) => c.name === cc.name);
      if (existing) Object.assign(existing, { type, calc: true });
      else T.columns.push({ name: cc.name, type, calc: true, expression: cc.expression });
      this._rowsCache.clear(); this._derived = {};
    }

    column(t, c) {
      const T = this.tables[t];
      if (!T) throw new Error("Unknown table '" + t + "'");
      const d = T.data[c];
      if (!d) throw new Error("Column '" + c + "' not found in table '" + t + "'");
      return d;
    }
    colType(t, c) { const T = this.tables[t]; const col = T && T.columns.find((x) => x.name === c); return col ? col.type : "text"; }
    derived(t, c, level) {
      if (!level) return this.column(t, c);
      const k = colKey(t, c, level);
      if (!this._derived[k]) this._derived[k] = this.column(t, c).map((v) => applyLevel(v, level));
      return this._derived[k];
    }

    // index on the "one" side of a relationship
    index(t, c) {
      const k = t + "[" + c + "]";
      if (!this._idx[k]) {
        const m = new Map(); const col = this.column(t, c);
        for (let i = 0; i < col.length; i++) if (!m.has(col[i])) m.set(col[i], i);
        this._idx[k] = m;
      }
      return this._idx[k];
    }

    /** row map from table `from` to table `to` following many-to-one relationships. Returns Int32Array or null. */
    path(from, to) {
      if (from === to) return null;
      const k = from + "->" + to;
      if (k in this._paths) return this._paths[k];
      const queue = [[from, []]]; const seen = new Set([from]); let found = null;
      while (queue.length && !found) {
        const [cur, hops] = queue.shift();
        for (const r of this.relationships) {
          if (r.fromTable === cur && !seen.has(r.toTable)) {
            const h = hops.concat([r]);
            if (r.toTable === to) { found = h; break; }
            seen.add(r.toTable); queue.push([r.toTable, h]);
          }
        }
      }
      let map = null;
      if (found) {
        const n = this.tables[from].rows; map = new Int32Array(n);
        for (let i = 0; i < n; i++) map[i] = i;
        let curT = from;
        for (const r of found) {
          const key = this.column(curT, r.fromColumn); const idx = this.index(r.toTable, r.toColumn);
          for (let i = 0; i < n; i++) { const ri = map[i]; if (ri < 0) continue; const j = idx.get(key[ri]); map[i] = j === undefined ? -1 : j; }
          curT = r.toTable;
        }
        map.hops = found;
      }
      this._paths[k] = map;
      return map;
    }

    /** value getter for column ref (t,c,level) evaluated on rows of table T. */
    getter(T, t, c, level) {
      const vals = this.derived(t, c, level);
      if (T === t) return (i) => vals[i];
      const map = this.path(T, t);
      if (!map) return null;
      return (i) => (map[i] < 0 ? null : vals[map[i]]);
    }

    _testFilter(T, f) {
      // returns predicate on row index of T, or null if the filter does not reach T
      const ok = f.kind === "in" ? (v) => f.values.has(v) : f.kind === "pred" ? f.pred : null;
      if (f.kind === "rows") {
        if (f.t === T) return (i) => f.rows.has(i);
        const map = this.path(T, f.t);
        if (map) return (i) => map[i] >= 0 && f.rows.has(map[i]);
        return this._bothDirection(T, f);
      }
      if (f.t === T) { const vals = this.derived(f.t, f.c, f.level); return (i) => ok(vals[i]); }
      const g = this.getter(T, f.t, f.c, f.level);
      if (g) return (i) => ok(g(i));
      return this._bothDirection(T, f);
    }

    _bothDirection(T, f) {
      // filter on a many-side table reaching a one-side table T through bi-directional relationships
      const map = this.path(f.t, T);
      if (!map || !map.hops.every((r) => r.crossFilter === "both")) return null;
      const rows = this.rowsFor(f.t, [f]);
      const allowed = new Set();
      for (const r of rows) if (map[r] >= 0) allowed.add(map[r]);
      return (i) => allowed.has(i);
    }

    rowsFor(T, filters) {
      const key = T + "|" + filters.map((f) => f.key).join(";");
      const hit = this._rowsCache.get(key);
      if (hit) return hit;
      let rows;
      if (!filters.length) {
        const n = this.tables[T].rows; rows = new Int32Array(n); for (let i = 0; i < n; i++) rows[i] = i;
      } else {
        const prev = this.rowsFor(T, filters.slice(0, -1));
        const test = this._testFilter(T, filters[filters.length - 1]);
        if (!test) rows = prev;
        else { const out = []; for (let k = 0; k < prev.length; k++) if (test(prev[k])) out.push(prev[k]); rows = Int32Array.from(out); }
      }
      if (this._rowsCache.size > 6000) this._rowsCache.clear();
      this._rowsCache.set(key, rows);
      return rows;
    }

    distinct(t, c, level, filters) {
      const rows = this.rowsFor(t, filters || []);
      const vals = this.derived(t, c, level); const s = new Set();
      for (const i of rows) s.add(vals[i]);
      return Array.from(s);
    }

    sortValues(t, c, level, values) {
      const props = this.columnProps[t + "[" + c + "]"] || {};
      if (props.sortBy && !level && this.tables[t].data[props.sortBy]) {
        const src = this.column(t, c), by = this.column(t, props.sortBy); const m = new Map();
        for (let i = 0; i < src.length; i++) if (!m.has(src[i])) m.set(src[i], by[i]);
        return values.slice().sort((a, b) => compareValues(m.get(a), m.get(b)));
      }
      return values.slice().sort(compareValues);
    }

    // -------------------------------------------------------------- evaluation
    measureValue(name, filters) {
      const m = this.measures[name];
      if (!m) throw new Error("Unknown measure [" + name + "]");
      if (!m.ast) throw new Error(m.error || "Invalid measure");
      return this.eval(m.ast, { filters, row: null, vars: {} });
    }

    evalExpr(src, filters) { return this.eval(typeof src === "string" ? parse(src) : src, { filters: filters || [], row: null, vars: {} }); }

    eval(n, ctx) {
      switch (n.k) {
        case "num": case "str": case "bool": return n.v;
        case "blank": return null;
        case "neg": { const v = this.eval(n.e, ctx); return isBlank(v) ? null : -v; }
        case "list": return n.items.map((x) => this.eval(x, ctx));
        case "let": {
          const vars = Object.assign({}, ctx.vars);
          const c2 = Object.assign({}, ctx, { vars });
          for (const [name, e] of n.vars) vars[name] = { value: this.eval(e, c2), ast: e };
          return this.eval(n.body, c2);
        }
        case "name": {
          if (ctx.vars && n.n in ctx.vars) return ctx.vars[n.n].value;
          throw new Error("Unknown name '" + n.n + "'");
        }
        case "in": {
          const v = this.eval(n.l, ctx); const list = this.eval(n.r, ctx);
          return Array.isArray(list) && list.some((x) => x === v || String(x) === String(v));
        }
        case "col": return this._colValue(n.t, n.c, ctx);
        case "mref": {
          if (this.measures[n.n]) {
            const filters = ctx.row ? this._contextTransition(ctx) : ctx.filters;
            return this.measureValue(n.n, filters);
          }
          if (ctx.row && this.tables[ctx.row.table].data[n.n]) return this.tables[ctx.row.table].data[n.n][ctx.row.i];
          if (ctx.colRow) { for (const k in ctx.colRow) if (k.endsWith("[" + n.n + "]")) return ctx.colRow[k]; }
          throw new Error("Unknown measure or column [" + n.n + "]");
        }
        case "bin": return this._bin(n, ctx);
        case "fn": return this._fn(n, ctx);
        case "table": throw new Error("Table '" + n.n + "' used where a value was expected");
      }
      throw new Error("Cannot evaluate node " + n.k);
    }

    _contextTransition(ctx) {
      // row context -> filter context (used when a measure is referenced inside an iterator / calc column)
      if (!ctx.row) return ctx.filters;
      if (ctx.row.colFilters) return ctx.filters.filter((f) => !ctx.row.colFilters.some((g) => g.t === f.t && g.c === f.c)).concat(ctx.row.colFilters);
      return ctx.filters.concat([{ t: ctx.row.table, kind: "rows", rows: new Set([ctx.row.i]), key: "row:" + ctx.row.table + ":" + ctx.row.i }]);
    }

    _colValue(t, c, ctx) {
      if (ctx.colRow && (t + "[" + c + "]") in ctx.colRow) return ctx.colRow[t + "[" + c + "]"];
      if (!ctx.row) throw new Error("Column " + t + "[" + c + "] needs an aggregation (e.g. SUM) in a measure");
      if (ctx.row.table === t) return this.column(t, c)[ctx.row.i];
      const g = this.getter(ctx.row.table, t, c);
      if (g) return g(ctx.row.i);
      throw new Error("No relationship from '" + ctx.row.table + "' to '" + t + "'");
    }

    _bin(n, ctx) {
      if (n.op === "&&") return !!this.eval(n.l, ctx) && !!this.eval(n.r, ctx);
      if (n.op === "||") return !!this.eval(n.l, ctx) || !!this.eval(n.r, ctx);
      const a = this.eval(n.l, ctx), b = this.eval(n.r, ctx);
      switch (n.op) {
        case "&": return (isBlank(a) ? "" : String(a)) + (isBlank(b) ? "" : String(b));
        case "+": return isBlank(a) && isBlank(b) ? null : (a || 0) + (b || 0);
        case "-": return isBlank(a) && isBlank(b) ? null : (a || 0) - (b || 0);
        case "*": return isBlank(a) || isBlank(b) ? null : a * b;
        case "/": if (isBlank(a)) return null; if (!b) throw new Error("Division by zero (use DIVIDE)"); return a / b;
        case "^": return isBlank(a) ? null : Math.pow(a, b || 0);
        case "=": return (isBlank(a) && isBlank(b)) || a === b || (!isBlank(a) && !isBlank(b) && String(a) === String(b));
        case "<>": return !((isBlank(a) && isBlank(b)) || a === b || String(a) === String(b));
        case "<": return compareValues(a ?? 0, b ?? 0) < 0;
        case ">": return compareValues(a ?? 0, b ?? 0) > 0;
        case "<=": return compareValues(a ?? 0, b ?? 0) <= 0;
        case ">=": return compareValues(a ?? 0, b ?? 0) >= 0;
      }
      throw new Error("Unknown operator " + n.op);
    }

    // ---- table expressions: returns {t, rows, cols?} or column-table {t, c, values}
    evalTable(n, ctx) {
      if (n.k === "table" || n.k === "name") {
        if (n.k === "name" && ctx.vars && n.n in ctx.vars && ctx.vars[n.n].value && ctx.vars[n.n].value.__table) return ctx.vars[n.n].value;
        if (!this.tables[n.n]) throw new Error("Unknown table '" + n.n + "'");
        return { __table: true, t: n.n, rows: Array.from(this.rowsFor(n.n, ctx.filters)) };
      }
      if (n.k === "fn") {
        const a = n.args;
        switch (n.n) {
          case "ALL": case "REMOVEFILTERS": case "ALLNOBLANKROW":
            if (a[0].k === "col") return { __table: true, t: a[0].t, c: a[0].c, values: this.distinct(a[0].t, a[0].c, null, []) };
            return { __table: true, t: this._tname(a[0]), rows: Array.from(this.rowsFor(this._tname(a[0]), [])) };
          case "ALLSELECTED":
            if (a[0] && a[0].k === "col") return { __table: true, t: a[0].t, c: a[0].c, values: this.distinct(a[0].t, a[0].c, null, ctx.filters.filter((f) => !f.group)) };
            return { __table: true, t: this._tname(a[0]), rows: Array.from(this.rowsFor(this._tname(a[0]), ctx.filters.filter((f) => !f.group))) };
          case "VALUES": case "DISTINCT":
            if (a[0].k === "col") return { __table: true, t: a[0].t, c: a[0].c, values: this.distinct(a[0].t, a[0].c, null, ctx.filters).filter((v) => n.n === "VALUES" || !isBlank(v)) };
            return this.evalTable(a[0], ctx);
          case "FILTER": {
            const base = this.evalTable(a[0], ctx);
            if (base.c) return Object.assign({}, base, { values: base.values.filter((v) => this.eval(a[1], Object.assign({}, ctx, { colRow: { [base.t + "[" + base.c + "]"]: v }, row: null, colRowFilter: inFilter(base.t, base.c, [v]) }))) });
            return Object.assign({}, base, { rows: base.rows.filter((i) => this.eval(a[1], Object.assign({}, ctx, { row: { table: base.t, i } }))) });
          }
          case "TOPN": {
            const k = this.eval(a[0], ctx); const base = this.evalTable(a[1], ctx);
            const order = a[3] ? String(this.eval(a[3], ctx)).toUpperCase() : "DESC";
            const score = (item) => this.eval(a[2], this._iterCtx(base, item, ctx));
            const items = (base.c ? base.values : base.rows).map((it) => [it, score(it)]);
            items.sort((x, y) => (order === "ASC" || order === "0" ? 1 : -1) * compareValues(x[1], y[1]));
            const kept = items.slice(0, k).map((x) => x[0]);
            return base.c ? Object.assign({}, base, { values: kept }) : Object.assign({}, base, { rows: kept });
          }
          case "CALCULATETABLE": {
            const c2 = this._applyCalcFilters(a.slice(1), ctx);
            return this.evalTable(a[0], c2);
          }
          case "RELATEDTABLE": {
            const t = this._tname(a[0]);
            return { __table: true, t, rows: Array.from(this.rowsFor(t, this._contextTransition(ctx))) };
          }
        }
      }
      if (n.k === "col") return { __table: true, t: n.t, c: n.c, values: this.distinct(n.t, n.c, null, ctx.filters) };
      throw new Error("Expected a table expression");
    }
    _tname(n) { if (n.k === "table" || n.k === "name") return n.n; if (n.k === "col") return n.t; if (n.k === "fn" && n.args[0]) return this._tname(n.args[0]); throw new Error("Expected a table name"); }

    _iterCtx(base, item, ctx) {
      if (base.c) {
        const f = inFilter(base.t, base.c, [item]);
        return Object.assign({}, ctx, { row: { table: base.t, i: -1, colFilters: [f] }, colRow: { [base.t + "[" + base.c + "]"]: item } });
      }
      return Object.assign({}, ctx, { row: { table: base.t, i: item } });
    }

    _iterate(tableAst, exprAst, ctx) {
      const base = this.evalTable(tableAst, ctx);
      const items = base.c ? base.values : base.rows;
      const out = [];
      for (const it of items) out.push(this.eval(exprAst, this._iterCtx(base, it, ctx)));
      return out;
    }

    _colAgg(arg, ctx) {
      // values of a column under the current filter context
      if (arg.k !== "col") {
        // allow aggregating a table variable column or expression list
        const v = this.eval(arg, ctx); return Array.isArray(v) ? v : [v];
      }
      const rows = this.rowsFor(arg.t, ctx.filters);
      const col = this.column(arg.t, arg.c); const out = new Array(rows.length);
      for (let k = 0; k < rows.length; k++) out[k] = col[rows[k]];
      return out;
    }

    _removeFilters(filters, n, keepGroup) {
      // ALL / REMOVEFILTERS semantics inside CALCULATE
      if (!n) return [];
      if (n.k === "col") return filters.filter((f) => !(f.t === n.t && f.c === n.c));
      const t = this._tname(n);
      const reach = new Set([t]);
      for (const name in this.tables) if (this.path(t, name)) reach.add(name);
      return filters.filter((f) => !reach.has(f.t) || (keepGroup && !f.group));
    }

    _dateFilter(dateArg, ctx, fn) {
      if (dateArg.k !== "col") throw new Error("Time intelligence needs a date column, e.g. 'Calendar'[Date]");
      const t = dateArg.t, c = dateArg.c;
      const visible = this.distinct(t, c, null, ctx.filters).filter((v) => !isBlank(v)).map(parseDate).filter(Boolean).sort((a, b) => a - b);
      const all = this.distinct(t, c, null, []).filter((v) => !isBlank(v)).map(parseDate).filter(Boolean).sort((a, b) => a - b);
      const newDates = fn(visible, all).map(isoDate);
      const isDim = this.relationships.some((r) => r.toTable === t);
      const derivedCols = new Set(this._calcCols.filter((cc) => cc.table === t && cc.expression.includes("[" + c + "]")).map((cc) => cc.name));
      const filters = ctx.filters.filter((f) => !(f.t === t && (isDim || f.c === c || derivedCols.has(f.c))));
      return filters.concat([inFilter(t, c, newDates)]);
    }

    _timeFilter(n, ctx) {
      const a = n.args;
      const sameRange = (vis, delta, unit) => vis.map((d) => addPeriod(d, delta, unit));
      switch (n.n) {
        case "SAMEPERIODLASTYEAR": return this._dateFilter(a[0], ctx, (vis) => sameRange(vis, -1, "YEAR"));
        case "DATEADD": return this._dateFilter(a[0], ctx, (vis) => sameRange(vis, this.eval(a[1], ctx), this.eval(a[2], ctx)));
        case "PARALLELPERIOD": return this._dateFilter(a[0], ctx, (vis, all) => {
          if (!vis.length) return []; const unit = String(this.eval(a[2], ctx)).toUpperCase(); const shift = this.eval(a[1], ctx);
          const s = addPeriod(vis[0], shift, unit), e = addPeriod(vis[vis.length - 1], shift, unit);
          const start = unit === "YEAR" ? Date.UTC(s.getUTCFullYear(), 0, 1) : unit === "QUARTER" ? Date.UTC(s.getUTCFullYear(), Math.floor(s.getUTCMonth() / 3) * 3, 1) : Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
          const end = unit === "YEAR" ? Date.UTC(e.getUTCFullYear() + 1, 0, 1) : unit === "QUARTER" ? Date.UTC(e.getUTCFullYear(), Math.floor(e.getUTCMonth() / 3) * 3 + 3, 1) : Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1);
          return all.filter((d) => d >= start && d < end);
        });
        case "DATESYTD": case "DATESQTD": case "DATESMTD": return this._dateFilter(a[0], ctx, (vis, all) => {
          if (!vis.length) return []; const last = vis[vis.length - 1];
          const y = last.getUTCFullYear(), m = last.getUTCMonth();
          const start = n.n === "DATESYTD" ? Date.UTC(y, 0, 1) : n.n === "DATESQTD" ? Date.UTC(y, Math.floor(m / 3) * 3, 1) : Date.UTC(y, m, 1);
          return all.filter((d) => d >= start && d <= last);
        });
        case "PREVIOUSMONTH": case "PREVIOUSYEAR": case "PREVIOUSQUARTER": case "NEXTMONTH": case "NEXTYEAR": return this._dateFilter(a[0], ctx, (vis, all) => {
          if (!vis.length) return []; const ref = n.n.startsWith("NEXT") ? vis[vis.length - 1] : vis[0];
          const unit = n.n.replace("PREVIOUS", "").replace("NEXT", ""); const dir = n.n.startsWith("NEXT") ? 1 : -1;
          const s = addPeriod(ref, dir, unit);
          return all.filter((d) => (unit === "YEAR" ? d.getUTCFullYear() === s.getUTCFullYear() : unit === "QUARTER" ? d.getUTCFullYear() === s.getUTCFullYear() && Math.floor(d.getUTCMonth() / 3) === Math.floor(s.getUTCMonth() / 3) : d.getUTCFullYear() === s.getUTCFullYear() && d.getUTCMonth() === s.getUTCMonth()));
        });
        case "DATESBETWEEN": return this._dateFilter(a[0], ctx, (vis, all) => { const s = parseDate(this.eval(a[1], ctx)), e = parseDate(this.eval(a[2], ctx)); return all.filter((d) => (!s || d >= s) && (!e || d <= e)); });
        case "DATESINPERIOD": return this._dateFilter(a[0], ctx, (vis, all) => {
          const s = parseDate(this.eval(a[1], ctx)); const e = addPeriod(s, this.eval(a[2], ctx), this.eval(a[3], ctx));
          const lo = Math.min(s, e), hi = Math.max(s, e); return all.filter((d) => d > lo && d <= hi || d.getTime() === s.getTime());
        });
      }
      return null;
    }

    _applyCalcFilters(args, ctx) {
      let filters = ctx.row ? this._contextTransition(ctx) : ctx.filters.slice();
      const adds = [];
      for (const a of args) {
        if (a.k === "fn" && ["ALL", "REMOVEFILTERS"].includes(a.n)) { filters = a.args.length ? a.args.reduce((fs, x) => this._removeFilters(fs, x), filters) : []; continue; }
        if (a.k === "fn" && a.n === "ALLSELECTED") { filters = filters.filter((f) => !f.group || (a.args[0] && a.args[0].k === "col" && !(f.t === a.args[0].t && f.c === a.args[0].c))); continue; }
        if (a.k === "fn" && a.n === "ALLEXCEPT") {
          const t = this._tname(a.args[0]); const keep = a.args.slice(1).map((x) => x.t + "[" + x.c + "]");
          const reach = new Set([t]); for (const name in this.tables) if (this.path(t, name)) reach.add(name);
          filters = filters.filter((f) => !reach.has(f.t) || keep.includes(f.t + "[" + f.c + "]")); continue;
        }
        if (a.k === "fn" && a.n === "KEEPFILTERS") { adds.push(...this._filterArg(a.args[0], Object.assign({}, ctx, { filters }), true)); continue; }
        if (a.k === "fn" && a.n === "USERELATIONSHIP") continue;
        const time = a.k === "fn" ? this._timeFilter(a, Object.assign({}, ctx, { filters })) : null;
        if (time) { filters = time; continue; }
        const fs = this._filterArg(a, Object.assign({}, ctx, { filters }), false);
        for (const f of fs) { if (f.replace) filters = filters.filter((g) => !(g.t === f.t && g.c === f.c)); adds.push(f); }
      }
      return Object.assign({}, ctx, { filters: filters.concat(adds), row: null, colRow: null });
    }

    _filterArg(a, ctx, keep) {
      // boolean expression on a single column: Table[Col] op value
      const cols = [];
      const walk = (x) => { if (!x) return; if (x.k === "col") cols.push(x); for (const k of ["l", "r", "e"]) if (x[k]) walk(x[k]); if (x.args) x.args.forEach(walk); };
      if (a.k === "fn" && ["FILTER", "VALUES", "DISTINCT", "TOPN", "CALCULATETABLE"].includes(a.n) || a.k === "table") {
        const tab = this.evalTable(a, ctx);
        if (tab.c) return [Object.assign(inFilter(tab.t, tab.c, tab.values), { replace: !keep && a.k === "fn" && a.args[0] && a.args[0].k === "fn" && ["ALL", "REMOVEFILTERS"].includes(a.args[0].n) })];
        return [{ t: tab.t, kind: "rows", rows: new Set(tab.rows), key: "rows:" + (++FID) }];
      }
      walk(a);
      const uniq = Array.from(new Set(cols.map((c) => c.t + "[" + c.c + "]")));
      if (uniq.length !== 1) throw new Error("CALCULATE filter must reference exactly one column (got " + uniq.length + ")");
      const { t, c } = cols[0];
      const self = this;
      const outer = ctx;
      const values = this.distinct(t, c, null, []);
      const kept = values.filter((v) => self.eval(a, Object.assign({}, outer, { row: null, colRow: { [t + "[" + c + "]"]: v } })));
      return [Object.assign(inFilter(t, c, kept), { replace: !keep })];
    }

    _fn(n, ctx) {
      const a = n.args; const E = (i, c) => this.eval(a[i], c || ctx);
      const nums = (arr) => arr.filter((v) => typeof v === "number" && !isNaN(v));
      switch (n.n) {
        // ---- aggregations
        case "SUM": { const v = nums(this._colAgg(a[0], ctx)); return v.length ? v.reduce((s, x) => s + x, 0) : null; }
        case "AVERAGE": { const v = nums(this._colAgg(a[0], ctx)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
        case "MEDIAN": { const v = nums(this._colAgg(a[0], ctx)).sort((x, y) => x - y); if (!v.length) return null; const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; }
        case "MIN": case "MAX": {
          if (a.length === 2) { const x = E(0), y = E(1); if (isBlank(x)) return y; if (isBlank(y)) return x; return (n.n === "MIN" ? compareValues(x, y) <= 0 : compareValues(x, y) >= 0) ? x : y; }
          const v = this._colAgg(a[0], ctx).filter((x) => !isBlank(x)); if (!v.length) return null;
          return v.reduce((m, x) => (n.n === "MIN" ? (compareValues(x, m) < 0 ? x : m) : (compareValues(x, m) > 0 ? x : m)));
        }
        case "COUNT": { const v = this._colAgg(a[0], ctx).filter((x) => !isBlank(x) && x !== ""); return v.length || null; }
        case "COUNTA": { const v = this._colAgg(a[0], ctx).filter((x) => !isBlank(x)); return v.length || null; }
        case "COUNTBLANK": { const v = this._colAgg(a[0], ctx).filter((x) => isBlank(x) || x === ""); return v.length || null; }
        case "DISTINCTCOUNT": { const s = new Set(this._colAgg(a[0], ctx)); return s.size || null; }
        case "DISTINCTCOUNTNOBLANK": { const s = new Set(this._colAgg(a[0], ctx).filter((x) => !isBlank(x))); return s.size || null; }
        case "COUNTROWS": {
          if (!a.length) throw new Error("COUNTROWS needs a table");
          const tab = this.evalTable(a[0], ctx); const k = tab.c ? tab.values.length : tab.rows.length; return k || null;
        }
        case "STDEV.S": case "STDEV.P": case "VAR.S": case "VAR.P": {
          const v = nums(this._colAgg(a[0], ctx)); const m = v.reduce((s, x) => s + x, 0) / v.length;
          const d = v.length - (n.n.endsWith(".S") ? 1 : 0); if (d <= 0) return null;
          const variance = v.reduce((s, x) => s + (x - m) ** 2, 0) / d; return n.n.startsWith("VAR") ? variance : Math.sqrt(variance);
        }
        case "SUMX": case "AVERAGEX": case "MINX": case "MAXX": case "COUNTX": case "MEDIANX": case "CONCATENATEX": {
          const vals = this._iterate(a[0], a[1], ctx);
          if (n.n === "CONCATENATEX") return vals.filter((v) => !isBlank(v)).join(a[2] ? E(2) : "");
          const v = nums(vals); if (!v.length) return null;
          if (n.n === "SUMX") return v.reduce((s, x) => s + x, 0);
          if (n.n === "AVERAGEX") return v.reduce((s, x) => s + x, 0) / v.length;
          if (n.n === "MINX") return Math.min(...v);
          if (n.n === "MAXX") return Math.max(...v);
          if (n.n === "COUNTX") return v.length;
          v.sort((x, y) => x - y); const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
        }
        case "RANKX": {
          const base = this.evalTable(a[0], Object.assign({}, ctx, { row: null }));
          const items = base.c ? base.values : base.rows;
          const cur = this.eval(a[1], ctx);
          const order = a[3] ? String(this.eval(a[3], ctx)).toUpperCase() : "DESC";
          const outer = base.c ? ctx.filters.filter((f) => !(f.t === base.t && f.c === base.c)) : this._removeFilters(ctx.filters, { k: "table", n: base.t });
          const scores = items.map((it) => this.eval(a[1], this._iterCtx(base, it, Object.assign({}, ctx, { filters: outer }))));
          if (isBlank(cur)) return null;
          const better = scores.filter((s) => !isBlank(s) && (order === "ASC" || order === "0" ? s < cur : s > cur));
          return new Set(better).size + 1;
        }
        // ---- filter context
        case "CALCULATE": return this.eval(a[0], this._applyCalcFilters(a.slice(1), ctx));
        case "TOTALYTD": case "TOTALQTD": case "TOTALMTD": {
          const fn = { TOTALYTD: "DATESYTD", TOTALQTD: "DATESQTD", TOTALMTD: "DATESMTD" }[n.n];
          return this.eval(a[0], this._applyCalcFilters([{ k: "fn", n: fn, args: [a[1]] }].concat(a.slice(2)), ctx));
        }
        case "SELECTEDVALUE": {
          const vals = a[0].k === "col" ? this.distinct(a[0].t, a[0].c, null, ctx.row ? this._contextTransition(ctx) : ctx.filters) : [];
          return vals.length === 1 ? vals[0] : a[1] ? E(1) : null;
        }
        case "HASONEVALUE": return a[0].k === "col" && this.distinct(a[0].t, a[0].c, null, ctx.filters).length === 1;
        case "ISFILTERED": return ctx.filters.some((f) => (a[0].k === "col" ? f.t === a[0].t && f.c === a[0].c : f.t === this._tname(a[0])));
        case "ISINSCOPE": return ctx.filters.some((f) => f.group && a[0].k === "col" && f.t === a[0].t && f.c === a[0].c);
        case "RELATED": {
          if (!ctx.row || a[0].k !== "col") throw new Error("RELATED needs a row context and a column");
          return this._colValue(a[0].t, a[0].c, ctx);
        }
        case "LOOKUPVALUE": {
          const target = a[0]; const T = target.t; const col = this.column(T, target.c);
          const conds = []; for (let i = 1; i + 1 < a.length; i += 2) conds.push([this.column(a[i].t, a[i].c), E(i + 1)]);
          for (let i = 0; i < col.length; i++) if (conds.every(([cc, v]) => cc[i] === v || String(cc[i]) === String(v))) return col[i];
          return a.length % 2 === 0 ? E(a.length - 1) : null;
        }
        case "EARLIER": return this._colValue(a[0].t, a[0].c, ctx);
        // ---- logic
        case "IF": { const c = E(0); return c && !isBlank(c) ? E(1) : a[2] ? E(2) : null; }
        case "IFERROR": try { return E(0); } catch (e) { return E(1); }
        case "SWITCH": {
          const v = E(0);
          for (let i = 1; i + 1 < a.length; i += 2) { const w = E(i); if (v === w || (v === true && w === true) || String(v) === String(w)) return E(i + 1); }
          return a.length % 2 === 0 ? E(a.length - 1) : null;
        }
        case "AND": return !!E(0) && !!E(1);
        case "OR": return !!E(0) || !!E(1);
        case "NOT": return !E(0);
        case "TRUE": return true;
        case "FALSE": return false;
        case "BLANK": return null;
        case "ISBLANK": return isBlank(E(0));
        case "ISNUMBER": return typeof E(0) === "number";
        case "ISTEXT": return typeof E(0) === "string";
        case "COALESCE": { for (let i = 0; i < a.length; i++) { const v = E(i); if (!isBlank(v)) return v; } return null; }
        // ---- math
        case "DIVIDE": { const x = E(0), y = E(1); if (isBlank(x)) return null; if (!y) return a[2] ? E(2) : null; return x / y; }
        case "ABS": { const v = E(0); return isBlank(v) ? null : Math.abs(v); }
        case "ROUND": { const v = E(0); const d = a[1] ? E(1) : 0; return isBlank(v) ? null : Math.round(v * 10 ** d) / 10 ** d; }
        case "ROUNDUP": { const v = E(0), d = a[1] ? E(1) : 0; return isBlank(v) ? null : Math.ceil(v * 10 ** d) / 10 ** d; }
        case "ROUNDDOWN": case "TRUNC": { const v = E(0), d = a[1] ? E(1) : 0; return isBlank(v) ? null : Math.floor(v * 10 ** d) / 10 ** d; }
        case "INT": { const v = E(0); return isBlank(v) ? null : Math.floor(v); }
        case "SQRT": return Math.sqrt(E(0));
        case "POWER": return Math.pow(E(0), E(1));
        case "EXP": return Math.exp(E(0));
        case "LN": return Math.log(E(0));
        case "LOG10": return Math.log10(E(0));
        case "MOD": return E(0) % E(1);
        case "SIGN": return Math.sign(E(0));
        case "PI": return Math.PI;
        case "RAND": return Math.random();
        case "VALUE": return parseFloat(String(E(0)).replace(/,/g, ""));
        // ---- text
        case "CONCATENATE": return String(E(0) ?? "") + String(E(1) ?? "");
        case "UPPER": return String(E(0) ?? "").toUpperCase();
        case "LOWER": return String(E(0) ?? "").toLowerCase();
        case "LEN": return String(E(0) ?? "").length;
        case "LEFT": return String(E(0) ?? "").slice(0, a[1] ? E(1) : 1);
        case "RIGHT": { const s = String(E(0) ?? ""); const k = a[1] ? E(1) : 1; return s.slice(Math.max(0, s.length - k)); }
        case "MID": return String(E(0) ?? "").substr(E(1) - 1, E(2));
        case "TRIM": return String(E(0) ?? "").trim();
        case "SUBSTITUTE": return String(E(0) ?? "").split(String(E(1))).join(String(E(2)));
        case "SEARCH": case "FIND": { const s = String(E(1) ?? ""), f = String(E(0)); const i = n.n === "SEARCH" ? s.toLowerCase().indexOf(f.toLowerCase()) : s.indexOf(f); return i < 0 ? (a[3] ? E(3) : null) : i + 1; }
        case "CONTAINSSTRING": return String(E(0) ?? "").toLowerCase().includes(String(E(1)).toLowerCase());
        case "FORMAT": {
          const v = E(0), f = String(E(1) || "");
          if (isBlank(v)) return "";
          const d = parseDate(v);
          if (d && typeof v === "string") {
            return f.replace(/yyyy/g, d.getUTCFullYear()).replace(/MMMM/g, MONTHS_LONG[d.getUTCMonth()]).replace(/MMM/g, MONTHS[d.getUTCMonth()])
              .replace(/MM/g, pad(d.getUTCMonth() + 1)).replace(/dd/g, pad(d.getUTCDate())).replace(/yy/g, String(d.getUTCFullYear()).slice(2));
          }
          if (/%/.test(f)) return fmtValue(v, { type: "percent", decimals: (f.split(".")[1] || "").replace(/[^0]/g, "").length });
          if (/\$/.test(f)) return fmtValue(v, { type: "currency", decimals: (f.split(".")[1] || "").replace(/[^0]/g, "").length });
          return fmtValue(v, { decimals: (f.split(".")[1] || "").replace(/[^0#]/g, "").length });
        }
        // ---- dates
        case "TODAY": case "NOW": { const d = new Date(); return isoDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); }
        case "DATE": return isoDate(new Date(Date.UTC(E(0), E(1) - 1, E(2))));
        case "YEAR": { const d = parseDate(E(0)); return d ? d.getUTCFullYear() : null; }
        case "MONTH": { const d = parseDate(E(0)); return d ? d.getUTCMonth() + 1 : null; }
        case "DAY": { const d = parseDate(E(0)); return d ? d.getUTCDate() : null; }
        case "QUARTER": { const d = parseDate(E(0)); return d ? Math.floor(d.getUTCMonth() / 3) + 1 : null; }
        case "WEEKDAY": { const d = parseDate(E(0)); return d ? d.getUTCDay() + 1 : null; }
        case "WEEKNUM": { const d = parseDate(E(0)); if (!d) return null; const s = Date.UTC(d.getUTCFullYear(), 0, 1); return Math.floor((d - s) / 864e5 / 7) + 1; }
        case "EOMONTH": { const d = parseDate(E(0)); if (!d) return null; return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1 + (a[1] ? E(1) : 0), 0))); }
        case "EDATE": { const d = parseDate(E(0)); return d ? isoDate(addPeriod(d, E(1), "MONTH")) : null; }
        case "DATEDIFF": {
          const s = parseDate(E(0)), e = parseDate(E(1)); if (!s || !e) return null; const u = String(E(2)).toUpperCase();
          if (u === "YEAR") return e.getUTCFullYear() - s.getUTCFullYear();
          if (u === "MONTH") return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth();
          if (u === "QUARTER") return Math.floor(((e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth()) / 3);
          return Math.round((e - s) / 864e5);
        }
        case "FIRSTDATE": case "STARTOFYEAR": case "STARTOFMONTH": case "LASTDATE": case "ENDOFMONTH": case "ENDOFYEAR": {
          const vals = this._colAgg(a[0], ctx).filter((v) => !isBlank(v)).sort(compareValues); if (!vals.length) return null;
          const first = n.n.startsWith("FIRST") || n.n.startsWith("START"); const d = parseDate(first ? vals[0] : vals[vals.length - 1]);
          if (n.n === "STARTOFYEAR") return isoDate(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
          if (n.n === "STARTOFMONTH") return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
          if (n.n === "ENDOFMONTH") return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
          if (n.n === "ENDOFYEAR") return isoDate(new Date(Date.UTC(d.getUTCFullYear(), 11, 31)));
          return isoDate(d);
        }
      }
      const time = this._timeFilter(n, ctx);
      if (time) throw new Error(n.n + " must be used inside CALCULATE");
      throw new Error("Unsupported function " + n.n + "()");
    }
  }

  // ------------------------------------------------------------------ field references used by visuals
  // field: {table, column, level?, agg?} | {measure}
  function fieldLabel(f) {
    if (!f) return "";
    if (f.label) return f.label;
    if (f.measure) return f.measure;
    const aggName = { sum: "Sum of ", avg: "Average of ", min: "Min of ", max: "Max of ", count: "Count of ", distinct: "Count (Distinct) of ", median: "Median of " };
    const lv = f.level ? " (" + ({ year: "Year", quarter: "Quarter", month: "Month", yearMonth: "Year-Month", yearQuarter: "Year-Quarter", day: "Day", weekday: "Weekday" }[f.level]) + ")" : "";
    return (f.agg ? aggName[f.agg] || "" : "") + f.column + lv;
  }
  function fieldExpr(f) {
    if (f.measure) return { k: "mref", n: f.measure };
    const col = { k: "col", t: f.table, c: f.column };
    const fn = { sum: "SUM", avg: "AVERAGE", min: "MIN", max: "MAX", count: "COUNTA", distinct: "DISTINCTCOUNT", median: "MEDIAN" }[f.agg || "sum"];
    return { k: "fn", n: fn, args: [col] };
  }
  function isValueField(f) { return !!(f && (f.measure || f.agg)); }

  // ------------------------------------------------------------------ queries for visuals
  function fieldFormat(model, f, report) {
    if (f.format && f.format.type) return f.format;
    if (f.measure && model.measures[f.measure]) return model.measures[f.measure].format || {};
    if (f.table && report && report.columnProps) { const p = report.columnProps[f.table + "[" + f.column + "]"]; if (p && p.format) return p.format; }
    if (f.agg === "count" || f.agg === "distinct") return { type: "whole" };
    return {};
  }

  function safeEval(model, expr, filters) {
    try { return model.eval(expr, { filters, row: null, vars: {} }); }
    catch (e) { return { __error: e.message }; }
  }
  function numOrNull(v) { return v && v.__error ? null : v; }

  function groupFilter(f, v) { return inFilter(f.table, f.column, [v], f.level, { group: true }); }

  function categoryValues(model, f, filters, opts) {
    let vals = model.distinct(f.table, f.column, f.level, filters);
    if (!opts || !opts.showBlank) vals = vals.filter((v) => !isBlank(v));
    return model.sortValues(f.table, f.column, f.level, vals);
  }

  /** Run a visual definition and return chart-ready data. */
  function query(model, visual, filters, report) {
    const F = visual.fields || {};
    const fmt = visual.format || {};
    const errors = [];
    const ev = (expr, fs) => { const v = safeEval(model, expr, fs); if (v && v.__error) { errors.push(v.__error); return null; } return v; };
    const type = visual.type;
    const values = (F.values || []).filter(Boolean);

    if (["card", "multiCard", "kpi", "gauge"].includes(type)) {
      if (type === "multiCard") return { items: values.map((v) => ({ label: fieldLabel(v), value: ev(fieldExpr(v), filters), fmt: fieldFormat(model, v, report) })), errors };
      const v = values[0];
      if (!v) return { empty: true };
      const out = { label: fieldLabel(v), value: ev(fieldExpr(v), filters), fmt: fieldFormat(model, v, report), errors };
      const tgt = (F.target || [])[0];
      if (tgt) { out.target = ev(fieldExpr(tgt), filters); out.targetLabel = fieldLabel(tgt); }
      if (type === "gauge") { out.min = fmt.min ?? 0; out.max = fmt.max ?? (Math.max(out.value || 0, out.target || 0) * 1.25 || 1); if ((F.max || [])[0]) out.max = ev(fieldExpr(F.max[0]), filters); }
      const cat = (F.category || [])[0];
      if (type === "kpi" && cat) {
        const cats = categoryValues(model, cat, filters);
        out.trend = cats.map((c) => ({ c, v: ev(fieldExpr(v), filters.concat([groupFilter(cat, c)])) })).filter((d) => !isBlank(d.v));
        if (out.trend.length) { const last = out.trend[out.trend.length - 1]; out.value = last.v; out.period = last.c; if (tgt) out.target = ev(fieldExpr(tgt), filters.concat([groupFilter(cat, last.c)])); }
      }
      return out;
    }

    if (type === "slicer") {
      const cat = (F.category || [])[0];
      if (!cat) return { empty: true };
      const all = categoryValues(model, cat, visual._slicerFilters || [], { showBlank: false });
      const ctype = cat.level ? (cat.level === "year" ? "number" : "text") : model.colType(cat.table, cat.column);
      return { values: all, type: ctype, label: fieldLabel(cat), errors };
    }

    if (type === "table") {
      const cols = (F.columns || F.values || []).filter(Boolean);
      if (!cols.length) return { empty: true };
      const dims = cols.filter((c) => !isValueField(c)); const meas = cols.filter(isValueField);
      let rows = [];
      if (dims.length) {
        // combinations of dimension values present in the filtered data (from the most granular table)
        const base = dims.reduce((best, d) => (model.tables[d.table].rows > model.tables[best].rows ? d.table : best), dims[0].table);
        const baseRows = model.rowsFor(base, filters);
        const getters = dims.map((d) => model.getter(base, d.table, d.column, d.level) || (() => null));
        const seen = new Map();
        for (const i of baseRows) {
          const key = getters.map((g) => g(i)); const ks = JSON.stringify(key);
          if (!seen.has(ks)) seen.set(ks, key);
          if (seen.size > 20000) break;
        }
        rows = Array.from(seen.values()).map((key) => {
          const gf = filters.concat(dims.map((d, j) => groupFilter(d, key[j])));
          const m = meas.map((mm) => ev(fieldExpr(mm), gf));
          return { key, m };
        }).filter((r) => !meas.length || r.m.some((v) => !isBlank(v)));
        rows = rows.map((r) => { const out = []; let di = 0, mi = 0; for (const c of cols) out.push(isValueField(c) ? r.m[mi++] : r.key[di++]); return out; });
      } else {
        rows = [cols.map((c) => ev(fieldExpr(c), filters))];
      }
      const sortIdx = fmt.sortBy != null ? fmt.sortBy : (meas.length ? cols.indexOf(meas[0]) : 0);
      const dir = fmt.sortDir || (meas.length && sortIdx === cols.indexOf(meas[0]) ? "desc" : "asc");
      rows.sort((a, b) => (dir === "desc" ? -1 : 1) * compareValues(a[sortIdx], b[sortIdx]));
      if (fmt.topN) rows = rows.slice(0, fmt.topN);
      const total = fmt.totals === false ? null : cols.map((c, j) => (isValueField(c) ? ev(fieldExpr(c), filters) : j === 0 ? "Total" : ""));
      return { columns: cols.map((c) => ({ label: fieldLabel(c), fmt: isValueField(c) ? fieldFormat(model, c, report) : {}, isMeasure: isValueField(c) })), rows, total, errors };
    }

    if (type === "matrix") {
      const rf = (F.rows || []).filter(Boolean), cf = (F.columns || [])[0], vf = values;
      if (!rf.length && !cf && !vf.length) return { empty: true };
      const r0 = rf[0], r1 = rf[1];
      const rowVals = r0 ? categoryValues(model, r0, filters) : [null];
      const colVals = cf ? categoryValues(model, cf, filters) : [null];
      const cell = (fs) => vf.map((v) => ev(fieldExpr(v), fs));
      const withRow = (fs, f, v) => (f ? fs.concat([groupFilter(f, v)]) : fs);
      const out = { rowLabel: rf.map(fieldLabel).join(" / ") || "", colField: cf ? fieldLabel(cf) : null, colVals, measures: vf.map((v) => ({ label: fieldLabel(v), fmt: fieldFormat(model, v, report) })), rows: [], errors };
      for (const rv of rowVals) {
        const fs = withRow(filters, r0, rv);
        const row = { label: rv, level: 0, cells: colVals.map((cv) => cell(withRow(fs, cf, cv))), total: cell(fs), children: [] };
        if (r1) {
          for (const sv of categoryValues(model, r1, fs)) {
            const fs2 = withRow(fs, r1, sv);
            const ch = { label: sv, level: 1, cells: colVals.map((cv) => cell(withRow(fs2, cf, cv))), total: cell(fs2) };
            if (ch.total.some((v) => !isBlank(v))) row.children.push(ch);
          }
        }
        if (row.total.some((v) => !isBlank(v)) || !vf.length) out.rows.push(row);
      }
      out.grand = { cells: colVals.map((cv) => cell(withRow(filters, cf, cv))), total: cell(filters) };
      return out;
    }

    if (type === "scatter") {
      const cat = (F.category || [])[0], xf = (F.x || [])[0], yf = (F.y || [])[0], sf = (F.size || [])[0], lf = (F.series || [])[0];
      if (!xf || !yf) return { empty: true };
      const cats = cat ? categoryValues(model, cat, filters) : [null];
      const points = cats.map((c) => {
        const fs = cat ? filters.concat([groupFilter(cat, c)]) : filters;
        const p = { label: c, x: ev(fieldExpr(xf), fs), y: ev(fieldExpr(yf), fs) };
        if (sf) p.size = ev(fieldExpr(sf), fs);
        if (lf) { const sv = model.distinct(lf.table, lf.column, lf.level, fs); p.series = sv.length === 1 ? sv[0] : "(Multiple)"; }
        return p;
      }).filter((p) => !isBlank(p.x) && !isBlank(p.y));
      return { points, xLabel: fieldLabel(xf), yLabel: fieldLabel(yf), sizeLabel: sf ? fieldLabel(sf) : null, catField: cat || null, catLabel: cat ? fieldLabel(cat) : "", xFmt: fieldFormat(model, xf, report), yFmt: fieldFormat(model, yf, report), errors };
    }

    // category charts (bar/column/line/area/pie/donut/treemap/funnel/waterfall/combo/ribbon)
    const cat = (F.category || [])[0];
    const legend = (F.series || [])[0];
    const lineVals = (F.lineValues || []).filter(Boolean);
    if (!values.length && !lineVals.length) return { empty: true };
    let cats = cat ? categoryValues(model, cat, filters) : [fieldLabel(values[0])];
    const series = [];
    const catFilters = (c) => (cat ? filters.concat([groupFilter(cat, c)]) : filters);
    if (legend && values.length) {
      const lvals = categoryValues(model, legend, filters);
      for (const lv of lvals.slice(0, 60)) {
        const vals = cats.map((c) => ev(fieldExpr(values[0]), catFilters(c).concat([groupFilter(legend, lv)])));
        if (vals.some((v) => !isBlank(v))) series.push({ name: fmtValue(lv), raw: lv, values: vals, fmt: fieldFormat(model, values[0], report) });
      }
    } else {
      for (const v of values) series.push({ name: fieldLabel(v), values: cats.map((c) => ev(fieldExpr(v), catFilters(c))), fmt: fieldFormat(model, v, report) });
    }
    const lines = lineVals.map((v) => ({ name: fieldLabel(v), values: cats.map((c) => ev(fieldExpr(v), catFilters(c))), fmt: fieldFormat(model, v, report), line: true }));
    // drop categories where every series is blank
    const keep = cats.map((_, i) => series.concat(lines).some((s) => !isBlank(s.values[i])));
    const pick = (arr) => arr.filter((_, i) => keep[i]);
    cats = pick(cats); series.forEach((s) => (s.values = pick(s.values))); lines.forEach((s) => (s.values = pick(s.values)));
    // sorting
    const isOrdinal = cat && (cat.level || ["date", "number"].includes(model.colType(cat.table, cat.column)) || (report && report.columnProps && (report.columnProps[cat.table + "[" + cat.column + "]"] || {}).sortBy));
    const sortMode = fmt.sort || (["line", "area", "stackedArea", "lineColumn", "lineStackedColumn", "waterfall", "ribbon"].includes(type) || isOrdinal ? "category-asc" : "value-desc");
    let order = cats.map((_, i) => i);
    const tot = (i) => series.reduce((s, x) => s + (x.values[i] || 0), 0);
    if (sortMode === "value-desc") order.sort((a, b) => tot(b) - tot(a));
    else if (sortMode === "value-asc") order.sort((a, b) => tot(a) - tot(b));
    else if (sortMode === "category-desc") order.reverse();
    if (fmt.topN && fmt.topN > 0) order = order.slice(0, fmt.topN);
    const reorder = (arr) => order.map((i) => arr[i]);
    cats = reorder(cats); series.forEach((s) => (s.values = reorder(s.values))); lines.forEach((s) => (s.values = reorder(s.values)));
    return { categories: cats, series, lines, catField: cat || null, legendField: legend || null, catLabel: cat ? fieldLabel(cat) : "", errors };
  }

  // ------------------------------------------------------------------ build filters from report state
  function filterFromSpec(spec) {
    // spec: {field:{table,column,level}, mode:'basic'|'advanced'|'topn', values:[], op, value, op2, value2, join, invert}
    const f = spec.field; if (!f || !f.table) return null;
    if (spec.mode === "advanced") {
      const test = (op, val) => (v) => {
        const num = typeof v === "number" ? parseFloat(val) : val;
        switch (op) {
          case "=": return v === num || String(v) === String(val);
          case "!=": return String(v) !== String(val);
          case ">": return compareValues(v, num) > 0; case ">=": return compareValues(v, num) >= 0;
          case "<": return compareValues(v, num) < 0; case "<=": return compareValues(v, num) <= 0;
          case "contains": return String(v ?? "").toLowerCase().includes(String(val).toLowerCase());
          case "not contains": return !String(v ?? "").toLowerCase().includes(String(val).toLowerCase());
          case "starts with": return String(v ?? "").toLowerCase().startsWith(String(val).toLowerCase());
          case "is blank": return isBlank(v) || v === "";
          case "is not blank": return !(isBlank(v) || v === "");
        }
        return true;
      };
      if (!spec.op) return null;
      const t1 = test(spec.op, spec.value); const t2 = spec.op2 ? test(spec.op2, spec.value2) : null;
      const pred = t2 ? (spec.join === "or" ? (v) => t1(v) || t2(v) : (v) => t1(v) && t2(v)) : t1;
      return predFilter(f.table, f.column, pred, f.level, JSON.stringify([spec.op, spec.value, spec.op2, spec.value2, spec.join]));
    }
    if (spec.mode === "range") {
      const lo = spec.min, hi = spec.max;
      if ((lo === undefined || lo === null || lo === "") && (hi === undefined || hi === null || hi === "")) return null;
      return predFilter(f.table, f.column, (v) => !isBlank(v) && (lo === "" || lo == null || compareValues(v, typeof v === "number" ? +lo : lo) >= 0) && (hi === "" || hi == null || compareValues(v, typeof v === "number" ? +hi : hi) <= 0), f.level, "range" + lo + "|" + hi);
    }
    if (!spec.values || !spec.values.length) return null;
    if (spec.invert) { const s = new Set(spec.values); return predFilter(f.table, f.column, (v) => !s.has(v), f.level, "not" + JSON.stringify(spec.values)); }
    return inFilter(f.table, f.column, spec.values, f.level);
  }

  global.PyBIEngine = { Model, parse, tokenize, query, fmtValue, fieldLabel, fieldExpr, fieldFormat, isValueField, filterFromSpec, inFilter, predFilter, compareValues, isBlank, parseDate, applyLevel, MONTHS };
})(typeof window !== "undefined" ? window : globalThis);
