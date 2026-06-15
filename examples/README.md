# Orrery Examples

Example dashboards across several domains, backed by a shared PostgreSQL database with realistic seed data.

## Prerequisites

- PostgreSQL installed and running locally
- Node.js >= 18

## Database Setup

1. Create the database:

```bash
createdb orrery_examples
```

2. Run the seed script (from the orrery project root):

```bash
psql -d orrery_examples -f examples/seed.sql
```

This creates ~30 tables with sample data across all domains — e-commerce orders, SaaS subscriptions, API request logs, marketing campaigns, supply chain inventory, financial positions, HR employees, and IoT sensor readings.

3. Verify it loaded:

```bash
psql -d orrery_examples -c "SELECT COUNT(*) FROM orders"
```

You should see ~6,000 rows.

## Connection Config

The connection file at `connections/examples.yaml` points all dashboards to the `orrery_examples` database. Edit the `username` field if your PostgreSQL user differs:

```yaml
# connections/examples.yaml
connections:
  - name: warehouse
    type: postgres
    host: localhost
    port: 5432
    database: orrery_examples
    username: your_pg_user    # <-- change this
  # ... (all 8 connections use the same database)
```

If your PostgreSQL requires a password, add `password: your_password` to each connection entry.

## Run

From the orrery project root:

```bash
npx tsx src/cli/dev.ts dev --project examples
```

Then open http://localhost:3000 to see the dashboard index.

## Dashboards

| Dashboard | Domain | Description |
|-----------|--------|-------------|
| [ecommerce-overview](dashboards/ecommerce-overview.board) | E-commerce | Revenue, orders, and customer metrics with date range and region filters |
| [saas-metrics](dashboards/saas-metrics.board) | SaaS | MRR, churn rate, trial conversion, and subscription trends |
| [infrastructure-health](dashboards/infrastructure-health.board) | DevOps / SRE | API latency percentiles, error rates, and endpoint performance |
| [marketing-analytics](dashboards/marketing-analytics.board) | Marketing | Campaign spend, conversions, ROAS, and attribution analysis |
| [supply-chain](dashboards/supply-chain.board) | Logistics | Inventory levels, shipment tracking, carrier and supplier scorecards |
| [financial-portfolio](dashboards/financial-portfolio.board) | Finance | Portfolio value, benchmark comparison, risk metrics, and trade activity |
| [hr-people-analytics](dashboards/hr-people-analytics.board) | HR | Headcount, attrition, compensation, engagement, and employee directory |
| [iot-monitoring](dashboards/iot-monitoring/dashboard.board) | IoT | Facility sensors, environment trends, equipment health, and alerts |

## DSL Feature Coverage

These dashboards collectively exercise every DSL feature:

**Parameter types:** `daterange`, `select` (with `multiple`, `query`, `default_first`), `text` (with `debounce`), `number` (with `min`/`max`), `toggle` (with `label`)

**Component types:** `metric` (with `trend_query`, `prefix`, `suffix`), `chart` (line, bar, area, donut), `table` (with `sortable`, `filterable`, `page_size`, `columns`), `text` (markdown with parameter interpolation)

**Chart options:** `series` (multi-series), `color`, `sort` (asc/desc), `orientation` (horizontal/vertical), `y_format` (currency, compact, percent, number)

**Table column formatting:** `format` (currency, number, compact, percent, datetime, date, badge), `prefix`, `suffix`, `label`, `align`

**Advanced features:** `visible` (conditional component display), `palette` (custom chart colors), `refresh` (auto-refresh interval), `file()` (external SQL), `include` (composable sections)

> **Note:** `file()` and `include` are parsed by the DSL but not yet resolved at runtime (see `planning/16-deferred-backlog.md`). Dashboards that use them will serve but those specific queries won't execute until the feature is implemented.

## External SQL Files

The `queries/` directory contains `.sql` files referenced by `supply-chain.board` via `file()`:

- `warehouse-inventory.sql` — inventory summary with reorder analysis
- `shipment-performance.sql` — carrier on-time rates and costs
- `top-products-by-velocity.sql` — product ranking by sales velocity

## Seed Data Summary

| Domain | Tables | Approximate Rows |
|--------|--------|-----------------|
| E-commerce | customers, products, orders | 500 + 200 + 6,000 |
| SaaS | users, subscriptions | 2,000 + 2,000 |
| Infrastructure | request_logs | 50,000 |
| Marketing | campaigns, ad_spend, conversions, attribution_events | 120 + 10,000 + 800 + 800 |
| Supply chain | warehouses, carriers, suppliers, inventory, shipments, order_lines, purchase_orders | ~12,000 total |
| Finance | accounts, positions, prices, benchmarks, trades | 4 + 44 + 2,500 + 500 + 115 |
| HR | departments, employees, engagement_surveys, performance_reviews | 10 + 360 + 2,500 + 750 |
| IoT | zones, equipment, sensors, sensor_readings, sensor_alerts | 36 + 20 + 370 + 188,000 + 330 |

## Pagila Example

The `pagila/` directory is a separate, self-contained example using the [Pagila](https://github.com/devrimgunduz/pagila) PostgreSQL sample database (DVD rental store). It has its own database, connection config, and theme file. See [pagila/README.md](pagila/README.md) for setup.

```bash
npx tsx src/cli/dev.ts dev --project examples/pagila
```

## Project Structure

```
examples/
  seed.sql                             # Database seed script (run this first)
  connections/
    examples.yaml                      # Connection config for all dashboards
  dashboards/
    ecommerce-overview.board
    saas-metrics.board
    infrastructure-health.board
    marketing-analytics.board
    supply-chain.board
    financial-portfolio.board
    hr-people-analytics.board
    iot-monitoring/
      dashboard.board
      sections/
        environment.board
        alerts.board
  queries/
    warehouse-inventory.sql
    shipment-performance.sql
    top-products-by-velocity.sql
  pagila/                              # Separate example — see pagila/README.md
```
