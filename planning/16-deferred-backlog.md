# 16 — Deferred Backlog

## Purpose

Features, ideas, and improvements that are explicitly out of scope for MVP but worth tracking for future development. These are not forgotten — they're intentionally deferred.

## Post-MVP Features

### Cross-Filtering (Priority: High)
Click a segment in one chart to filter all other components. Requires `emits` / `listens` DSL syntax and a client-side event bus. Design is documented in `09-interactivity.md`.

### Custom Components API (Priority: High)
Allow users to write custom components in JS/TS that register with Orrery:
```typescript
orrery.registerComponent('custom-map', {
  render(container, data, config) { ... },
  update(container, data, config) { ... }
})
```
Referenced in `.board` files as `custom "My Map" (type: custom-map) { ... }`.

### Multi-Page Dashboards (Priority: Medium)
A single `.board` file defines multiple pages/tabs:
```board
dashboard "Analytics" {
  page "Overview" { ... }
  page "Details" { ... }
  page "Raw Data" { ... }
}
```
Or a directory convention: `dashboards/analytics/overview.board`, `dashboards/analytics/details.board`.

### Column Layout Blocks (Priority: Low)
Support `column` blocks as an alternative to `row` for vertical stacking within a grid cell. Currently, `row` with `span: 12` achieves vertical stacking, so this is syntactic sugar. Revisit if users find row-only layout too limiting.

### SQL Dialect Hints (Priority: Low)
Per-connection `dialect: postgres` property to enable dialect-aware SQL validation in the parser/validator. Currently the connection `type` implicitly determines the dialect, which is sufficient for query execution. Explicit hints would only help with ahead-of-time syntax validation.

### Embedding SDK (Priority: Medium)
Embed individual dashboards or components in external applications:
```html
<iframe src="https://dashboards.example.com/d/sales?embed=true"></iframe>
<!-- or -->
<orrery-embed dashboard="sales" params='{"region": "North"}'></orrery-embed>
```
Web component or iframe-based.

### Scheduled Email Reports (Priority: Medium)
Render dashboards as PDF/HTML and email them on a schedule. Could be implemented as a GitHub Action that runs on cron and sends via SendGrid/SES.

### Additional Chart Types (Priority: Medium)
- Area chart
- Scatter plot
- Pie / Donut
- Heatmap
- Treemap
- Funnel
- Sparklines (inline in metric cards)
- Geographic map (Mapbox/MapLibre)
- Sankey diagram

### Additional Database Drivers (Priority: Medium)
- ClickHouse
- BigQuery
- Snowflake
- Redshift
- MS SQL Server
- Trino/Presto
- MongoDB (aggregation pipeline)
- Elasticsearch
- CSV/Parquet via DuckDB

### Real-Time Streaming (Priority: Low)
WebSocket-based data push for live dashboards. Requires a fundamentally different query model (subscribe vs. poll). May be better served by Grafana — evaluate if there's demand.

### Semantic Layer (Priority: Low)
Define metrics, dimensions, and relationships in a separate config. Queries reference metric names instead of raw SQL. Similar to dbt metrics or Cube.js. Significant complexity increase — only pursue if users ask for it.

### Visual Editor (Priority: Low)
A web-based GUI that generates `.board` files. For users who want to visually compose dashboards but still get code output. WYSIWYG → code, not code → WYSIWYG. This is a large project on its own.

### Authentication & Multi-Tenancy (Priority: Low)
User login, role-based access, per-dashboard permissions. Required for team server deployments but not for the code-defined, git-based workflow. Consider as a separate "Orrery Server" product.

### Alerting (Priority: Low)
Define thresholds in `.board` files and get notifications when metrics cross them:
```board
alert "Revenue Drop" {
  query: "SELECT SUM(amount) FROM orders WHERE date = CURRENT_DATE"
  condition: value < 10000
  notify: slack("#alerts")
}
```

### Version History / Audit Log (Priority: Low)
Track who changed which dashboard when (git handles this, but a built-in viewer would be nice for non-git users).

### HttpSource for Remote Dashboards/Connections (Priority: Medium)
Fetch `.board` and connection YAML files from any HTTP/HTTPS endpoint. `list()` requires an index file (JSON array of filenames) since HTTP has no native directory listing. Individual files fetched directly. Polling via ETag/Last-Modified headers. Useful for GitHub raw URLs, internal file servers, etc. See `planning/17-remote-sources.md` Phase 4.

### GitSource for Git-Hosted Dashboards (Priority: Low)
Clone/pull a git repo to a temp directory and use LocalSource on it. Useful for GitHub-hosted dashboards without CI publishing. Requires git as a system dependency or `isomorphic-git`, plus temp directory lifecycle management, auth handling (SSH keys, tokens), and branch selection. Lower ROI than other sources — HttpSource covers most use cases. See `planning/17-remote-sources.md` Phase 4.

### PR Preview Command (Priority: Medium)
`orrery preview --output ./preview` generates preview artifacts for PR comments. Originally scoped in phase 10 (GitHub Actions), deferred to post-MVP. Would generate lightweight static previews suitable for embedding as PR comment images or links.

### PDF Export (Priority: Medium)
`orrery build --format pdf` renders dashboards as PDF using Playwright. Useful for email reports, executive summaries, and compliance. Requires Playwright as an optional dependency.

### AST Resolution: `include` and `file()` (Priority: High)
Resolve `include` directives and `file()` references at load time. Currently the parser produces AST nodes for these constructs but they are not resolved at runtime.
- `include "shared/header.board"` should read the referenced file, parse it, and merge its items into the parent dashboard AST.
- `file("queries/sales.sql")` should read the referenced `.sql` file and replace the `file_ref` AST node with a string value containing the file contents.
These are needed for larger projects that split dashboards and queries across files. Originally scoped in phase 08 (dev server), moved here because they require parser/resolver changes independent of the dev server.

### Playwright E2E Tests (Priority: Medium)
5+ browser-based end-to-end tests covering core user flows: dashboard loading, parameter changes, hot reload, static export, and responsive layout. Requires Playwright installed with browser binaries. Deferred from Phase 13 (Testing & QA) — unit and integration tests provide sufficient coverage for MVP.

Also deferred from Phase 21 (web editor frontend): create → edit → save → reload round-trip, dirty-flag `beforeunload` prompt, switcher unsaved-changes prompt, syntax-error inline diagnostics. Server-side round-trip tests and client-side unit tests (status state machine, HTML shell) cover the logic; browser-level flows are the gap this bullet closes.

Also deferred from Phase 22 (board language mode): autocomplete after `type: ` in a chart header surfaces chart-type suggestions; live lint markers appear on invalid DSL within ~500 ms of typing. Unit tests cover the completion source, the span→CM position mapper, and the lint source (with a fake fetch and abort behavior); these browser-level behaviors require a Playwright setup.

### PostgreSQL/MySQL Integration Tests in CI (Priority: Medium)
Database driver integration tests that run against real PostgreSQL and MySQL instances using Docker service containers in CI. SQLite and DuckDB drivers are tested locally via in-memory databases. Deferred from Phase 13 — requires CI service container configuration. The CI pipeline is prepared for this (just needs `services:` block added to ci.yml).

### "Securing the Editor" Docs Page (Priority: High — before editor GA)
Dedicated docs page with copy-pasteable proxy configs for the web editor (`20-web-editor-backend.md`): nginx + oauth2-proxy, AWS ALB + Cognito, Caddy + `forward_auth`, Cloudflare Access. Must gate `/edit/*`, `/api/save/*`, `/api/new`, `/api/validate`, `/api/connections`. Include the prominent "do not deploy without an auth proxy" warning. Deferred from doc 20 because docs are independent of the backend implementation.

### Editor-Without-Proxy Startup Warning (Priority: Medium)
When `--editor` is passed and we cannot detect an upstream proxy (best-effort — check common `X-Forwarded-*` headers on the first request or look for obvious signals in env), print a loud warning telling the operator to front the server with auth. Deferred from doc 20 — standalone UX polish, not blocking for editor functionality.

### Better STARTER_TEMPLATE for New Dashboards (Priority: Low)
`STARTER_TEMPLATE` in `src/server/routes/editor.ts` is currently a text-only stub. New users have no visible example of the actual widget DSL (`metric`, `chart`, `table`, `param`, `row`, `span`) and must copy/paste from another dashboard. Ship a template with a working scalar metric (`SELECT 42 AS value`) and a bar chart with inline data, plus commented-out hooks for `connection:`, `refresh:`, and `param`. Deferred from `issue-editor-create-flow.md` — nice-to-have UX polish, not a bug.

## Technical Debt / Improvements

### Performance
- Virtual scrolling for large tables (10K+ rows)
- Web Worker for client-side data processing
- Streaming query results for large datasets
- CDN-optimized static builds

### Developer Experience
- LSP (Language Server Protocol) for `.board` files — autocomplete, hover docs, error highlighting in VS Code
- VS Code extension with syntax highlighting and preview pane
- Playground: browser-based `.board` editor with live preview (no install needed)

### Ecosystem
- Plugin system for custom connections, components, and formatters
- Plugin registry / marketplace
- Official integrations: dbt, Airbyte, Dagster, Airflow

## Decision Log

Track key decisions and their rationale here as the project evolves:

| Date | Decision | Rationale | Revisit? |
|------|----------|-----------|----------|
| 2026-03-28 | DSL over markdown for layout | Markdown can't express grid layouts | After user feedback |
| 2026-03-28 | Server-rendered over static | Live data, interactivity, fresh results | Never (core design) |
| 2026-03-28 | SQL as query language | Universal, known by target audience | If non-SQL sources requested |
| 2026-03-28 | Preact for rendering | Small, familiar, good SSR | If performance is an issue |
| 2026-03-28 | ECharts for charts | Broadest type support, best interactivity | If bundle size is a problem |
