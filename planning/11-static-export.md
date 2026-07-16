# 11 — Static Export

## Goal

Generate a fully self-contained static HTML export of dashboards that can be hosted on any static file server (GitHub Pages, S3, Netlify, etc.) or shared as standalone files. This bridges the gap between "live server-rendered dashboards" and "shareable reports."

## Usage

```bash
# Export all dashboards
npx orrery build --output ./dist

# Export a specific dashboard
npx orrery build --dashboard sales --output ./dist

# Export with a specific data snapshot timestamp
npx orrery build --output ./dist --snapshot-label "Q1 2026 Report"
```

## How It Works

1. Parse all `.board` files
2. Execute all queries with default parameter values (requires database access at build time)
3. For each parameter combination that has a default, execute queries
4. Bundle query results as JSON embedded in the HTML
5. Render complete HTML pages with charts, tables, and all assets inlined
6. Output to the specified directory

## Output Structure

```
dist/
  index.html              # Dashboard index listing all dashboards
  d/
    sales/
      index.html          # Sales dashboard with embedded data
    ops/
      index.html          # Ops dashboard with embedded data
  assets/
    orrery.css         # Styles
    orrery.js          # Client-side JS (interactivity for parameter filtering)
```

## Static Interactivity

Even in static mode, some interactivity works:

- **Parameter filtering on pre-fetched data:** If the dataset is small enough, all parameter combinations are pre-computed and embedded. Client-side JS filters locally.
- **Table sorting and filtering:** Operates on the embedded data
- **Chart tooltips:** Work normally (client-side chart library)
- **Cross-component navigation:** Links between dashboards work

What does NOT work in static mode:
- Live data refresh
- Query-driven select options (options are pre-fetched at build time)
- Very large datasets (embedded JSON has size limits)

## Data Embedding Strategy

### Small datasets (< 1MB total per dashboard)

Embed directly as JSON in a `<script>` tag:

```html
<script>
  window.__ORRERY_DATA__ = {
    "revenue_chart": { columns: [...], rows: [...] },
    "orders_table": { columns: [...], rows: [...] }
  }
</script>
```

### Larger datasets

Split into separate JSON files loaded asynchronously:

```
dist/d/sales/
  index.html
  data/
    revenue_chart.json
    orders_table.json
```

Threshold: configurable, default 500KB per component before splitting to external file.

## Build-Time Parameter Resolution

For parameterized dashboards in static mode:

- Parameters with `default` values are used for the build
- If a dashboard has parameters, the static export shows the default view
- Client-side filtering works for parameters where the full dataset is embedded
- For large parameterized datasets, only the default parameter values are exported

## Snapshot Metadata

Each static export includes metadata:

```html
<meta name="orrery:built-at" content="2026-03-28T14:30:00Z">
<meta name="orrery:snapshot-label" content="Q1 2026 Report">
<meta name="orrery:version" content="0.1.0">
```

Displayed in the dashboard footer: "Data snapshot: Q1 2026 Report — Built Mar 28, 2026 2:30 PM"

## Self-Contained Mode

```bash
npx orrery build --output ./dist --self-contained
```

Produces a single HTML file per dashboard with all CSS, JS, and data inlined. Can be emailed, downloaded, or opened directly in a browser. No server needed.

## PDF Export (Post-MVP)

```bash
npx orrery build --format pdf --output ./reports
```

Uses Playwright to render dashboards and export as PDF. Useful for email reports, executive summaries, and compliance.

## Acceptance Criteria

- [x] `orrery build` produces working static HTML from `.board` files
- [x] Static dashboards render all components (charts, tables, metrics, text)
- [x] Table sorting/filtering works in static mode
- [x] Chart tooltips work in static mode
- [x] Dashboard index page generated
- [x] Large datasets split into external JSON files
- [x] Snapshot metadata embedded in HTML
- [x] `--self-contained` flag produces single-file HTML per dashboard
- [x] `--dashboard` flag exports a single dashboard
- [x] Builds work in CI (headless, no browser needed for HTML output)
- [x] Output directory is clean (no stale files from previous builds)
- [x] `orrery build` works in headless mode with env var credentials (deferred from phase 10)
