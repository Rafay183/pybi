# Contributing to PyBI

Thank you for helping build an open-source alternative to Power BI! Every contribution counts — bug reports, connectors tested against real accounts, new visuals, DAX functions, docs and translations.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

| You have… | Do this |
|---|---|
| 10 minutes | Try `pybi demo`, report anything confusing as an issue |
| A real database or SaaS account | Test a connector and report whether it works ([connector issue form](https://github.com/rafay183/pybi/issues/new/choose)) |
| An afternoon | Pick an issue labelled **good first issue** |
| Python skills | Add a connector, a query-editor step or an export format |
| JavaScript / d3 skills | Add a visual, improve the editor or the DAX engine |
| Writing skills | Improve the README, write tutorials, add examples |

## 1. Set up your development environment

```bash
# 1. Fork https://github.com/rafay183/pybi on GitHub, then:
git clone https://github.com/<your-username>/pybi.git
cd pybi
git remote add upstream https://github.com/rafay183/pybi.git

# 2. Create a virtual environment
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate

# 3. Install PyBI in editable mode with dev tools
pip install -e ".[dev]"

# 4. Check everything works
pytest -q
ruff check src tests
pybi demo
```

Editable mode means your code changes are live: restart `pybi demo` after Python changes; for JavaScript/CSS changes just refresh the browser.

## 2. Project structure

```
src/pybi/
├── cli.py              # `pybi run | demo | export | version`
├── server.py           # Flask server: API, sharing, exports, connector endpoints
├── project.py          # .pybi project file: sources, query steps, report JSON
├── transform.py        # Query editor (Power Query style) steps, pandas-based
├── exporters.py        # Interactive HTML, PowerPoint, PDF
├── sample.py           # Demo dataset + demo report
├── connectors/
│   ├── base.py         # Param / Connector specs, templating, optional imports
│   ├── engines.py      # Generic engines: rest, graphql, sql, file, storage, mongo, …
│   ├── files.py        # File format readers (CSV, Excel, PDF tables, ZIP, folder…)
│   └── catalog.py      # The connector catalog (one small spec per connector)
└── static/             # The browser app (no build step, plain JS)
    ├── engine.js       # Data model, relationships, filter context, DAX-style language
    ├── visuals.js      # d3 renderers for every visual + PNG export
    ├── runtime.js      # Page rendering, slicers, cross-filtering (shared by editor & viewer)
    ├── app.js          # The studio (editor) UI
    ├── viewer.js       # Read-only viewer & exported HTML
    └── app.css
```

**Key design rule:** the analytics engine and visuals run in the browser, so the studio, the network `/view` link and exported HTML files behave identically. Python handles data loading, transformation, persistence and exports.

## 3. Common contributions

### Add a connector (usually 5–15 lines)

Open `src/pybi/connectors/catalog.py` and add a spec. Example for a REST API:

```python
saas("acme", "Acme CRM", CRM,
     [res({"Customers": 0, "Orders": 0}), token("API key")],
     {"base": "https://api.acme.com/v2",
      "resources": {"Customers": {"endpoint": "/customers"}, "Orders": {"endpoint": "/orders"}},
      "auth": {"type": "bearer", "token": "{token}"},
      "records": "data",                                   # dot path to the list of rows
      "paginate": {"type": "cursor", "param": "cursor", "path": "meta.next_cursor"}},
     "Customers and orders from Acme.")
```

* Auth types: `bearer`, `basic`, `header`, `query`.
* Pagination types: `page`, `offset`, `cursor`, `next_url`, `link`, `last_id`, `graphql`.
* Post-processors (`"post": "fields"` etc.) live in `engines.py` → `POST`.
* SQL databases: use `sqldb(...)` with a SQLAlchemy URL template and the driver package.
* Mark passwords/tokens with `secret=True` — they are stored only in `~/.pybi/credentials.json`.
* If you tested it against a **real account**, say so in the PR — that is extremely valuable.

### Add a query-editor step

Add a branch in `transform.py → apply_step()`, a label in `STEP_LABELS`, a button in `app.js → openQueryEditor() → tools`, and a test in `tests/test_pybi.py`.

### Add a DAX function

Add a `case` in `engine.js → Model._fn()` (or `_timeFilter()` for time intelligence) and list it in `app.js → FN_GROUPS`. You can quickly test the engine in Node:

```bash
node -e "require('./src/pybi/static/engine.js'); const E=globalThis.PyBIEngine; console.log(new E.Model({tables:{}}).evalExpr('ROUND(DIVIDE(10,3),2)'))"
```

### Add a visual

1. Add the type with its field wells to `TYPES` in `visuals.js` and an icon in `ICONS`.
2. Write a `renderX(el, visual, result, opts)` function and add it to `render()`.
3. If it needs a new query shape, extend `query()` in `engine.js`.
4. Add format options in `app.js → formatSpec()`.

## 4. Coding guidelines

* **Python:** 3.9+ compatible, formatted for `ruff` (run `ruff check src tests --fix`). Prefer small, pure functions; raise `ConnectorError` for user-facing connector problems.
* **JavaScript:** plain ES2020, no build tools or frameworks; keep `engine.js` free of DOM code.
* **Dependencies:** core dependencies must stay small. Optional drivers go into `[project.optional-dependencies]` and are imported with `need("module", "pip-name")`.
* **Security:** never log or save secrets; never let network (non-localhost) users reach editing endpoints.
* **Credit:** keep the author credit "Muhammad Rafay Shaikh, from Pakistan" in the app and exports.

## 5. Tests

```bash
pytest -q                      # all tests
pytest tests/test_connectors.py -k rest    # a subset
```

Connector tests use a local mock API (`tests/test_connectors.py`) — please add cases there rather than calling real services in CI.

## 6. Submit a pull request

```bash
git checkout -b feature/my-change
# …make changes…
pytest -q && ruff check src tests
git add .
git commit -m "Add Acme CRM connector"
git push origin feature/my-change
```

Then open a PR on GitHub. Keep PRs focused (one feature or fix), fill in the template, add screenshots for UI changes, and add a line to `CHANGELOG.md` under **Unreleased**. CI runs the tests automatically; a maintainer will review.

To keep your fork up to date:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

## 7. Releases (maintainers)

See [docs/PUBLISHING.md](docs/PUBLISHING.md).
