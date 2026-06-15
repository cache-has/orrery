# Pagila Example — Orrery

A demo project using the [Pagila](https://github.com/devrimgunduz/pagila) sample database (PostgreSQL port of MySQL's Sakila). Models a DVD rental store with customers, films, rentals, and payments.

## Prerequisites

- PostgreSQL installed and running locally
- Node.js >= 18

## Database Setup

1. Clone the Pagila repo:

```bash
git clone --depth 1 https://github.com/devrimgunduz/pagila.git /tmp/pagila
```

2. Create the database and load the schema + data:

```bash
createdb pagila
psql -d pagila -f /tmp/pagila/pagila-schema.sql
psql -d pagila -f /tmp/pagila/pagila-data.sql
```

3. Verify it loaded (should show ~16K payments):

```bash
psql -d pagila -c "SELECT COUNT(*) FROM payment"
```

## Connection Config

Edit `connections/pagila.yaml` if your PostgreSQL setup differs from the defaults:

```yaml
name: pagila
type: postgres
host: localhost
port: 5432
database: pagila
username: your_pg_user
```

If your PostgreSQL requires a password, add `password: your_password` or use an environment variable: `password: ${PG_PASSWORD}`.

## Run

From the orrery project root:

```bash
npx tsx src/cli/dev.ts dev --project examples/pagila
```

Then open http://localhost:3000.

## Dashboards

| Dashboard | Folder | Description |
|-----------|--------|-------------|
| Revenue Overview | finance/ | Total revenue, monthly trends, revenue by store, daily rentals |
| Film Catalog | (root) | Film inventory by rating and category, most/least rented films |
| Customer Insights | operations/ | Customer geography, lifetime value, spend distribution |

## Data Summary

| Table | Rows | Description |
|-------|------|-------------|
| payment | ~16K | Rental payment records (Jan–Jul 2022) |
| rental | ~16K | Individual rental transactions |
| film | 1,000 | Film titles with ratings, duration, categories |
| customer | 599 | Customer profiles with addresses |
| inventory | ~4.5K | Film copies across stores |
| actor | 200 | Actor names linked to films |
| category | 16 | Film genres (Action, Comedy, Drama, etc.) |
| store | 2 | Retail locations |
