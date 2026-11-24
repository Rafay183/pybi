# Changelog

All notable changes to PyBI are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.8] - 2026-11-25

### Added
- **56 new visuals** in a searchable **✨ More visuals** gallery in the Visualizations pane, grouped the way analysts think:
  - *Statistics & distribution* — histogram, box & whisker, violin, raincloud, density (KDE), ridgeline, beeswarm, strip / jitter, ECDF, Q-Q plot, dot histogram, correlation matrix, hexbin, 2D density contours, scatter + trend line (with equation and R²). These work on row-level numbers, like R / ggplot2 and seaborn.
  - *Comparison & ranking* — lollipop, dumbbell, slope, bullet, Cleveland dot plot, diverging bar, butterfly / tornado, bump chart, Pareto (80/20), Marimekko, radar, small multiples.
  - *Circular & radial* — radial bar, circular barplot, Nightingale rose, parliament, sunburst, chord diagram.
  - *Part-to-whole* — waffle, pictogram, circle packing, icicle, nested treemap, packed bubbles.
  - *Flow & network* — Sankey, arc diagram, force-directed network, heatmap, punch card.
  - *Time & finance* — calendar heatmap, streamgraph, horizon chart, candlestick (OHLC), Gantt, step line, range band, sparkline table, event timeline.
  - *KPI & text* — liquid fill gauge, progress rings, word cloud.
- Every new visual cross-filters the report when clicked, has tooltips, follows the report theme, has its own Format options and colours, and works in the viewer, the network view and exported HTML / PNG / PowerPoint.

### Fixed
- Tables, matrices and visuals that combine fields from two lookup tables (for example Customers[Region] and Products[Category]) now show the combinations found in the fact table instead of an empty result.

## [0.1.7] - 2026-11-24

### Fixed
- "Check for updates" failed on some Windows PCs with `CERTIFICATE_VERIFY_FAILED ... unable to get issuer certificate`. PyBI now checks HTTPS certificates with the operating system (like the web browser), so updates, GitHub sign-in and web connectors also work when Windows hasn't downloaded a root certificate yet or antivirus / company networks inspect secure connections. If that is not possible, it falls back to a built-in certificate list.

## [0.1.6] - 2026-11-24

### Added
- **Sign in with GitHub** (title bar). Uses GitHub's device sign-in: PyBI shows a one-time code, you approve it on github.com, and PyBI never sees your password. People without a GitHub account get a step-by-step guide to create one. The access key stays on this computer (system keychain when `keyring` is installed, otherwise `~/.pybi`) and never goes into report files, exports or the network view. Sign out at any time.
- The GitHub connectors use your sign-in, so no personal access token is needed, private repositories included.
- **Save report to GitHub** / **Open report from GitHub**: keeps `.pybi` reports (and optionally the interactive HTML dashboard) in your own `pybi-reports` repository, private when you allowed private repositories, with GitHub's version history.
- **Publish dashboard as a web page** with GitHub Pages (public `pybi-dashboards` repository; PyBI asks you to confirm the data will be public).

### Security
- The studio's API rejects write requests coming from other websites (cross-site request forgery protection).

## [0.1.5] - 2026-11-23

### Fixed
- The **Sign in with GitHub** button, GitHub items in Share and Export, and the GitHub note in the connector form stay hidden until GitHub sign-in is set up in PyBI (0.1.4 showed a button that could only say "not set up").

## [0.1.4] - 2026-11-23

### Added
- **Power BI file (.pbix / .pbit)** connector in Get data (File category, and first in Popular).
- The PyBI version is shown in the studio title bar, the welcome screen and the network viewer.
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
