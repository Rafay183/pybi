# Changelog

All notable changes to PyBI are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/rafay183/pybi/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/rafay183/pybi/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rafay183/pybi/releases/tag/v0.1.0
