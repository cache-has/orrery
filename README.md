# Orrery

Open-source, code-defined BI dashboards. Dashboards as code, not clicks.

Orrery lets engineers and PMs define interactive dashboards in a lightweight DSL, connect to any SQL database, and serve them with a single command. Everything lives in git. No drag-and-drop builder, no vendor lock-in.

## Quick Start

```bash
# Start the dev server
npx tsx src/cli/dev.ts dev --project examples/pagila

# Validate dashboard files
npx tsx src/cli/validate.ts dashboards/*.board

# Build static HTML export
npx tsx src/cli/build.ts build --output ./dist
```

## How It Works

**1. Define dashboards in `.board` files:**

```
dashboard "Sales Overview" {
  description: "Revenue and order metrics"
  connection: "my_database"

  param region = select(default: "All", options: ["All", "US", "EU", "APAC"])

  row {
    metric "Total Revenue" (span: 4) {
      query: "SELECT SUM(amount) as value FROM orders WHERE ({{region}} = 'All' OR region = {{region}})"
      format: currency
      prefix: "$"
    }
    metric "Total Orders" (span: 4) {
      query: "SELECT COUNT(*) as value FROM orders"
      format: number
    }
    chart "Revenue by Month" (span: 4, type: bar) {
      query: """
        SELECT TO_CHAR(created_at, 'YYYY-MM') as month, SUM(amount) as revenue
        FROM orders
        GROUP BY month ORDER BY month
      """
      x: month
      y: revenue
    }
  }

  row {
    table "Recent Orders" (span: 12) {
      query: "SELECT id, customer, amount, status FROM orders ORDER BY id DESC LIMIT 50"
      sortable: true
      page_size: 25
    }
  }
}
```

**2. Configure database connections in YAML:**

```yaml
# connections/production.yaml
name: my_database
type: postgres
host: localhost
port: 5432
database: analytics
username: ${DB_USER}
password: ${DB_PASSWORD}
```

**3. Run the server:**

```bash
npx tsx src/cli/dev.ts dev
```

Open `http://localhost:3000` and your dashboards are live with interactive filters, tooltips, sorting, and zoom.

## Features

- **Dashboard DSL** -- Purpose-built syntax for layout, queries, and parameters. Readable by non-engineers.
- **SQL queries** -- Write SQL directly in your dashboards. Queries are parameterized and cached.
- **Interactive filters** -- `select`, `multiselect`, `daterange`, `text`, `number`, and `toggle` parameter types. Changing a filter re-queries only affected components.
- **Charts** -- Line, bar, and area charts with tooltips, zoom/pan, and multi-series support. Powered by ECharts.
- **Tables** -- Sortable columns, pagination, and row counts.
- **KPI metrics** -- Formatted numbers with currency, percentage, and compact notation.
- **Text blocks** -- Markdown content rendered inline.
- **CSS Grid layout** -- 12-column responsive grid. Components specify `span` for width.
- **Hot reload** -- Edit a `.board` file and the browser updates instantly.
- **Static export** -- `orrery build` generates self-contained HTML dashboards.
- **Multiple databases** -- PostgreSQL, MySQL, SQLite, and DuckDB. Each dashboard specifies its connection.
- **Folder organization** -- Dashboards in subdirectories are grouped on the index page.
- **GitHub Actions** -- Shipped CI/CD workflows for validation, preview, and deployment.
- **Custom palettes** -- Set `palette: ["#e63946", "#457b9d", ...]` per dashboard or globally in `theme.yaml`.

## Project Structure

```
your-project/
  dashboards/          # .board files (subdirectories supported)
  connections/         # YAML database connection configs
  orrery.config.yaml  # Optional project config
```

## DSL Reference

### Dashboard

```
dashboard "Title" {
  description: "Optional description"
  connection: "connection_name"
  refresh: 300                          # Auto-refresh interval in seconds
  palette: ["#3b82f6", "#10b981"]       # Custom chart color palette
}
```

### Parameters

```
param date_range = daterange(default: "last 30 days")
param region = select(default: "US", options: ["US", "EU", "APAC"])
param category = select(default: "All", options: ["All", "A", "B"], multiple: true)
param search = text(placeholder: "Search...", debounce: 300)
param limit = number(default: 100, min: 1, max: 1000)
param active = toggle(default: true)
```

Reference parameters in SQL with `{{param_name}}`. Date ranges expose `{{date_range.start}}` and `{{date_range.end}}`.

### Components

```
row {
  metric "Title" (span: 4) {
    query: "SELECT value FROM ..."
    format: currency          # number, currency, percent, compact
    prefix: "$"
  }

  chart "Title" (span: 8, type: line) {
    query: "SELECT x_col, y_col, series_col FROM ..."
    x: x_col
    y: y_col
    series: series_col        # Optional — enables multi-series
  }

  table "Title" (span: 12) {
    query: "SELECT * FROM ..."
    sortable: true
    page_size: 25
  }

  text "Title" (span: 6) {
    > Markdown content goes here.
    > Supports **bold**, *italic*, and [links](https://example.com).
  }
}
```

Chart types: `line`, `bar`, `area`, `donut`.

### Connection Config

```yaml
name: my_db
type: postgres          # postgres, mysql, sqlite, duckdb
host: localhost
port: 5432
database: my_database
username: ${DB_USER}    # Environment variable reference
password: ${DB_PASSWORD}
pool_size: 5            # Queries run at once on this connection. Default: 5
timeout: 30000          # Per-query execution timeout in ms. Default: 30000
```

`pool_size` is how many of a dashboard's queries run concurrently; the rest wait
their turn, and waiting does not count toward `timeout`. Set it to what your
database can comfortably run at once, not to the number of components.

SQLite and DuckDB use `path` instead of host/port:

```yaml
name: local_db
type: sqlite
path: ./data/analytics.db
```

## Theming

Create a `theme.yaml` in your project root to customize branding, chart colors, and UI appearance:

```yaml
# theme.yaml
branding:
  title: My Company Analytics    # Replaces "Orrery" in headers
  logo: assets/logo.svg          # Logo image in the header
  favicon: assets/favicon.ico    # Browser tab icon

chart_palette:
  - "#2563eb"
  - "#16a34a"
  - "#d97706"
  - "#dc2626"
  - "#7c3aed"

colors:
  ob-bg: "#f8f9fa"          # Page background
  ob-surface: "#ffffff"     # Card/component background
  ob-border: "#e2e8f0"      # Border color
  ob-text: "#1a202c"        # Primary text
  ob-text-muted: "#718096"  # Secondary text
  ob-primary: "#2563eb"     # Accent color
  ob-radius: "8px"          # Border radius
```

You can also override an individual dashboard's palette in the `.board` file itself:

```
dashboard "Sales" {
  palette: ["#e63946", "#457b9d", "#2a9d8f", "#e9c46a"]
  ...
}
```

To pin a specific series/category name to a specific color (e.g. always
render `"bad"` red and `"good"` green), add `series_colors` to the chart
widget itself — not the dashboard, and not `theme.yaml`. Colors are scoped
to the one widget that declares them, since two widgets — even on the same
dashboard — often query entirely different sources with unrelated category
names. If another widget should visually match, repeat the same block on it:

```
chart "Status Breakdown" (type: donut) {
  query: "SELECT status, COUNT(*) as count FROM issues GROUP BY status"
  x: status
  y: count
  series_colors: {
    bad: "#ef4444"
    good: "#22c55e"
  }
}
```

On a grouped `bar`/`line`/`area`/`scatter` chart (one with a `series:`
column), the keys match against that column's values instead of the `x:`
labels — see `examples/pagila/dashboards/finance/revenue-overview.board`
for a worked example.

Alternatively, use a `theme.css` file for full CSS control over any Orrery class.

See `examples/pagila/theme.yaml` for a working example.

## Database Support

| Database   | Driver        | Notes |
|------------|---------------|-------|
| PostgreSQL | `pg`          | Full support including parameterized queries |
| MySQL      | `mysql2`      | MySQL 8+ and MariaDB |
| SQLite     | `better-sqlite3` | File-based or `:memory:` |
| DuckDB     | `@duckdb/node-api` | File-based or `:memory:`, great for analytics |

## CLI Commands

| Command | Description |
|---------|-------------|
| `orrery dev` | Start dev server with hot reload |
| `orrery build` | Generate static HTML export |
| `orrery validate` | Validate all `.board` and connection files |

### Dev Server Options

```bash
orrery dev --project ./path    # Project directory (default: .)
orrery dev --port 8080         # Custom port (default: 3000)
orrery dev --no-open           # Don't auto-open browser
```

### Build Options

```bash
orrery build --output ./dist           # Output directory
orrery build --dashboard sales         # Build a single dashboard
orrery build --self-contained          # Inline all assets into single HTML files
orrery build --snapshot-label "Q1 2026"  # Label for the data snapshot
```

## Configuration

Optional `orrery.config.yaml` in your project root:

```yaml
dashboards_dir: ./dashboards    # Default: ./dashboards
connections_dir: ./connections   # Default: ./connections
port: 3000                      # Dev server port
cache_ttl: 300                  # Query cache TTL in seconds (0 disables). Default: 300
cache_warm: false               # Keep default-parameter results cached. Default: false
slow_query_ms: 1000             # Log queries slower than this (0 disables). Default: 1000
render_deadline_ms: 300         # How long a page waits for queries before sending. Default: 300
```

**Caching.** Query results are cached in memory for `cache_ttl` seconds, keyed
by connection, SQL and parameter values. A dashboard with `refresh: N` caps its
own TTL at `N`. The refresh button on a component always bypasses the cache.
Set `cache_ttl` to how stale your data is allowed to be: if it loads hourly, an
hour is reasonable.

**Cache warming.** With `cache_warm: true` the server re-runs every dashboard's
queries with their default parameters shortly before the cached results expire,
one query at a time, so the first visitor gets a cached page. Pair it with a
`cache_ttl` that matches how often your data changes; warming a slow dashboard
every five minutes is constant load on your database. Because `refresh: N` caps
a dashboard's TTL at `N`, a dashboard that refreshes more often than the warm
interval expires in between; drop or raise its `refresh` if its data does not
change that fast.

**Progressive loading.** A dashboard page is sent after at most
`render_deadline_ms`. Components whose queries have finished are rendered in the
page; the rest show a loading state and fill in as their queries complete. Set
`render_deadline_ms: 0` to always wait for every query.

**Slow queries** are logged with their dashboard and component, for example
`[orrery] slow query 15624ms rows=4 connection=warehouse sales/revenue_by_region`.
See [Diagnosing and Fixing Slow Dashboards](./docs/guides/query-performance.md).

The server reports at startup whether a config file was found, any keys it does
not recognize, and whether access control is on. A project still using the
pre-rename `openboard.config.yaml` is loaded with a deprecation warning; rename
the file to `orrery.config.yaml`.

### Advanced Features

**Conditional visibility** — show/hide components based on parameter values:

```
param show_costs = toggle(default: true, label: "Show cost metrics")

metric "Total Spend" (span: 3, visible: show_costs == true) {
  query: "SELECT SUM(spend) as value FROM ad_spend WHERE {{date_range}}"
  format: currency
  prefix: "$"
}
```

**External SQL files** — load queries from `.sql` files:

```
table "Inventory Summary" (span: 12) {
  query: file("queries/warehouse-inventory.sql")
  sortable: true
}
```

**Include directive** — compose dashboards from reusable sections:

```
dashboard "Monitoring" {
  connection: "iot_db"
  include "sections/environment.board"
  include "sections/alerts.board"
}
```

**Bar chart options** — horizontal orientation and sorting:

```
chart "Top Channels" (span: 6, type: bar) {
  query: "SELECT channel, SUM(spend) as spend FROM ad_spend GROUP BY channel"
  x: channel
  y: spend
  orientation: horizontal
  sort: desc
  y_format: currency
}
```

## Examples

The `examples/` directory contains dashboards across a range of domains:

| Example | Domain | Key Features |
|---------|--------|-------------|
| `pagila/` | DVD rental store | Complete project with multiple dashboards, subdirectories, and theme.yaml |
| `ecommerce-overview.board` | E-commerce | Date range, region filter, donut chart, table column formatting |
| `saas-metrics.board` | SaaS / subscriptions | MRR, churn, trend queries, area charts |
| `infrastructure-health.board` | DevOps / SRE | Percentile queries, error rates, text search filter |
| `marketing-analytics.board` | Marketing / ads | Toggle visibility, multi-select, horizontal bars, attribution, custom palette |
| `supply-chain.board` | Supply chain / logistics | `file()` SQL references, supplier toggles, inventory velocity |
| `financial-portfolio.board` | Finance / investing | Risk metrics toggles, benchmark comparison, compact format, sector exposure |
| `hr-people-analytics.board` | HR / workforce | All 5 param types, compensation toggle, engagement scores, employee directory |
| `iot-monitoring/` | IoT / sensors | `include` directive, 30s refresh, equipment health, raw data toggle |

See `examples/pagila/README.md` for a fully working setup with the Pagila PostgreSQL sample database.

## Requirements

- Node.js >= 22
- A supported SQL database

## Contributing

Contributions are welcome. Orrery is a public repository, and `main` is a
protected branch:

- All changes land through pull requests. Direct pushes to `main` are blocked.
- Every pull request requires review approval from a code owner (see
  [.github/CODEOWNERS](.github/CODEOWNERS)) before it can merge.
- The CI workflow (lint, typecheck, tests, build) must pass before merge.
- Conversations on a pull request must be resolved before merge.
- Force pushes and branch deletion on `main` are disabled.

For outside contributors, fork the repository and open a pull request from your
fork. CI runs with a read-only token and no access to repository secrets, so
forked pull requests cannot read credentials. A maintainer approval is required
before workflows run on a first-time contributor's pull request.

Dependencies and GitHub Actions versions are kept current by Dependabot, and
Dependabot security alerts are enabled.

## Security

Found a vulnerability? Please do not open a public issue. Report it privately
through the repository's "Security" tab ("Report a vulnerability") or by email to
[cache@horizonanalyticstudios.com](mailto:cache@horizonanalyticstudios.com). See
[SECURITY.md](SECURITY.md) for the full policy and what to include.

## License

MIT -- see [LICENSE](LICENSE).

## Author

Cache McClure -- [cache@horizonanalyticstudios.com](mailto:cache@horizonanalyticstudios.com)

Horizon Analytic Studios, LLC
