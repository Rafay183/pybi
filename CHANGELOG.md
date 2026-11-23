# Changelog

All notable changes to PyBI are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Open Power BI files (`.pbix`, `.pbit`) from **Open**, **Get data → Power BI file**, drag and drop, `pybi run report.pbix` or the new `pybi convert` command. PyBI imports pages, visuals with their positions, fields and formatting, report/page/visual filters, slicer selections, theme colours, images and shapes, and the data model (tables with data, relationships, DAX measures with formats, calculated columns, hidden fields, sort-by columns). Both report formats are read (`Report/Layout` and the newer PBIR folder format). After the import, PyBI lists anything it could not carry over (maps, custom visuals, buttons, Top N filters, DAX functions the engine does not support yet).
- New optional extra `pybi-ray[pbix]` (installs `pbixray`, which reads the data inside a .pbix). The desktop apps include it.
- Image visual, and reports can carry their own colour theme (`customTheme`).

## [0.1.3] - 2026-11-17

### Added
- One-line installer for Chromebook, Ubuntu and Debian: `curl -fsSL https://rafay183.github.io/pybi/install.sh | bash` (picks Intel/AMD or ARM and verifies the download).
- Redesigned documentation site: sidebar, "On this page", search (Ctrl+K), dark mode, mobile menu.

### Changed
- Chromebook instructions use the Terminal, because ChromeOS 145 no longer installs `.deb` files from the Files app.
- The `.deb` app installs its own updates when `sudo` needs no password (the default on Chromebooks).

## [0.1.2] - 2026-11-17

### Added
- Desktop apps for macOS (Apple Silicon and Intel `.dmg`), Linux (`.AppImage` for any distro, `.deb` for Debian/Ubuntu) and ChromeOS (`.deb` in the Linux environment), each with its own Python, the ر icon and automatic updates.
- Documentation site with a 12-step business intelligence course, published on GitHub Pages at https://rafay183.github.io/pybi/.
- The launcher runs without a window when no display is available and stops PyBI cleanly on logout or shutdown.

## [0.1.1] - 2026-11-14

### Added
- Windows installer (`PyBI-Setup.exe`): Next → Next → Install, bundled Python and dependencies, no admin rights, ر app icon, desktop and Start-menu shortcuts.
- PyBI desktop launcher: starts the studio on localhost, opens the browser, single instance, logs, start/stop/restart.
- Automatic updates from GitHub Releases with SHA-256 verification and silent in-place upgrade; pre-release opt-in.
- `Windows installer` workflow: builds, smoke-tests and attaches the installer to each `v*` release.

## [0.1.0] - 2026-11-13

First public release.

### Added
- PyBI Studio: report canvas with drag, resize, snap guides, pages, themes, undo/redo.
- 25 visuals: column/bar (clustered, stacked, 100%), line, area, combo, waterfall, ribbon, scatter, pie, donut, treemap, funnel, gauge, card, multi-row card, KPI, table, matrix, slicers, text box, smart narrative.
- DAX-style measures and calculated columns: CALCULATE, FILTER, ALL/ALLEXCEPT/ALLSELECTED, iterators, RANKX, VAR/RETURN and time intelligence.
- Model view with relationships (single/both directions), autodetect and date tables.
- Power Query–style editor with 20 transformation steps.
- 214 data connectors (files, databases, NoSQL, cloud storage, SaaS, public data, REST/GraphQL/OData/Python) with preview, navigator and refresh.
- Cross-filtering, filters pane, focus mode, Ask-your-data Q&A, auto dashboard.
- Live read-only network sharing (`/view`).
- Exports: PNG, PowerPoint, PDF, interactive offline HTML, `.pybi` project files.

[Unreleased]: https://github.com/rafay183/pybi/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/rafay183/pybi/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/rafay183/pybi/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rafay183/pybi/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rafay183/pybi/releases/tag/v0.1.0
