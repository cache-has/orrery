<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# From Postgres to Dashboard with Flux + OpenBoard

This tutorial walks the full Horizon Analytic stack end-to-end:

1. A PostgreSQL database (the **Pagila** sample — a DVD rental store).
2. A **Horizon Flux** pipeline that reads from Postgres, joins and aggregates the rental data, and publishes the result.
3. The **OpenBoard sink plugin** for Flux, which writes that result into a DuckDB file inside an OpenBoard project.
4. An **OpenBoard** dashboard that queries the DuckDB table and renders it.

By the end, every time you re-run the flux pipeline, your OpenBoard dashboard updates — without leaving the Horizon Analytic toolchain.

> **You will need:** Docker (or a local Postgres on a free port), Node.js ≥ 18, the `horizon-flux` CLI on your `PATH`, and the openboard repo checked out.

> **Note:** every command in this tutorial has been run end-to-end against the actual `horizon-flux` CLI and the bundled openboard plugin. The numbers in the example output below are real values from the Pagila dataset (`payment_p2022_01` partition).

---

## 1. Start Postgres with Pagila loaded

The easiest path is the official `postgres` Docker image plus the Pagila SQL files. (If you already have a Pagila database, skip to step 2 and adjust `PAGILA_CONNECTION` accordingly.)

```bash
# Start a throwaway Postgres on a non-default port so it doesn't collide
# with anything you may already have running on 5432.
docker run --name flux-pagila \
  -e POSTGRES_PASSWORD=pagila \
  -e POSTGRES_DB=pagila \
  -p 5455:5432 \
  -d postgres:16

# Wait a couple seconds for the container to come up, then load Pagila.
sleep 4
git clone --depth 1 https://github.com/devrimgunduz/pagila.git /tmp/pagila
docker exec -i flux-pagila psql -U postgres -d pagila < /tmp/pagila/pagila-schema.sql
docker exec -i flux-pagila psql -U postgres -d pagila < /tmp/pagila/pagila-data.sql

# Sanity check — should print 16049
docker exec flux-pagila psql -U postgres -d pagila -c "SELECT COUNT(*) FROM payment"
```

---

## 2. Build and install the OpenBoard plugin

The OpenBoard plugin lives in the openboard repo at `plugins/flux/`. `npm run bundle` produces a self-contained `dist/plugin/` directory (with its own `node_modules` for runtime deps) that you drop into Flux's plugin search path.

```bash
cd /path/to/openboard/plugins/flux
npm install
npm run bundle    # tsup build + assemble dist/plugin/

# Ask flux where its plugin search paths are. The first one is the
# user-level directory we'll install into.
PLUGIN_DIR="$(horizon-flux plugin path | head -1)"
mkdir -p "$PLUGIN_DIR"
cp -R dist/plugin "$PLUGIN_DIR/openboard"

# Verify
horizon-flux plugin list
# -> openboard  v0.1.0  [ok]
#      sink: openboard_duckdb — OpenBoard (DuckDB)

horizon-flux plugin check openboard
# -> ok plugin `openboard` v0.1.0 (protocol 1)
```

If `horizon-flux plugin check` complains that `node` is missing, install Node ≥ 18 and make sure it's on `PATH` for the user running flux.

---

## 3. Create an OpenBoard project to publish into

A fresh, empty directory is all you need — the plugin will populate it with `connections/`, `datasets/`, and `data/` on the first run.

```bash
export OPENBOARD_PROJECT=/tmp/flux-tutorial-openboard
mkdir -p "$OPENBOARD_PROJECT"
```

(The flux pipeline JSON references this path via `{{ env:OPENBOARD_PROJECT }}` in the next step.)

---

## 4. Import the flux pipeline

Set the Postgres connection string and import the tutorial pipeline JSON shipped with this docs directory.

```bash
export PAGILA_CONNECTION="postgresql://postgres:pagila@localhost:5455/pagila"

horizon-flux import /path/to/openboard/docs/tutorials/assets/pagila-revenue-to-openboard.json
# -> Imported `Pagila: Revenue to OpenBoard` (id: ...)

horizon-flux list | grep "Pagila: Revenue to OpenBoard"
# -> Pagila: Revenue to OpenBoard      10     9   never  0
```

The pipeline:

- Reads `rental`, `payment_p2022_01`, `inventory`, `film_category`, and `category` from Postgres.
- Joins them with SQL transforms.
- Aggregates revenue per film category.
- Writes the result to the **`openboard_duckdb`** sink, which is provided by the plugin you installed in step 2.

The sink node looks like this:

```json
{
  "id": "publish_to_openboard",
  "type": "sink",
  "connector": "openboard_duckdb",
  "config": {
    "openboard_project": "{{ env:OPENBOARD_PROJECT }}",
    "connection_name": "flux_pipelines",
    "database_file": "data/flux.duckdb",
    "table_name": "revenue_by_category",
    "write_mode": "replace",
    "write_dataset_metadata": true
  }
}
```

> **Why the explicit `CAST(... AS DECIMAL(9,2))` in the aggregate SQL?** Pagila's `payment.amount` is `numeric(5,2)`, but DataFusion promotes `SUM(decimal)` and `AVG(decimal)` to `Float64` by default. Casting back to `DECIMAL(9,2)` keeps the totals as exact two-decimal-place currency values end-to-end. The plugin maps `Decimal128` losslessly to DuckDB `DECIMAL(p,s)` (verified by the round-trip test in `test/sink.test.ts`); the cast is upstream, in DataFusion, not a workaround for the plugin.

---

## 5. Run the pipeline

```bash
horizon-flux run "Pagila: Revenue to OpenBoard"
```

Real output from this run:

```
Running `Pagila: Revenue to OpenBoard`...
  ▶ category
  ✓ category — 16 rows (143ms)
  ▶ rental
  ✓ rental — 16044 rows (137ms)
  ▶ payment
  ✓ payment — 723 rows (107ms)
  ...
  ▶ aggregate
  ✓ aggregate — 16 rows (5ms)
  ▶ publish_to_openboard
  ✓ publish_to_openboard — 16 rows (141ms)
Finished: success (740ms)
```

Look at what landed in the OpenBoard project:

```bash
find "$OPENBOARD_PROJECT" -type f
# /tmp/flux-tutorial-openboard/connections/flux_pipelines.yaml
# /tmp/flux-tutorial-openboard/data/flux.duckdb
# /tmp/flux-tutorial-openboard/datasets/revenue_by_category.yaml
```

```bash
cat "$OPENBOARD_PROJECT/connections/flux_pipelines.yaml"
```

```yaml
name: flux_pipelines
type: duckdb
path: data/flux.duckdb
```

```bash
cat "$OPENBOARD_PROJECT/datasets/revenue_by_category.yaml"
```

```yaml
name: revenue_by_category
connection: flux_pipelines
table: revenue_by_category
schema:
  - name: category_name
    type: VARCHAR
  - name: total_rentals
    type: BIGINT
  - name: total_revenue
    type: DECIMAL(9,2)
  - name: avg_rental_price
    type: DECIMAL(9,2)
last_updated: 2026-04-08T...
source:
  type: horizon_flux
  pipeline: Pagila: Revenue to OpenBoard
  node: publish_to_openboard
```

And the table itself (output is the actual top 5 from this run):

```bash
duckdb "$OPENBOARD_PROJECT/data/flux.duckdb" \
  "SELECT category_name, total_revenue FROM revenue_by_category ORDER BY total_revenue DESC LIMIT 5"
```

```
┌──────────────┬───────────────┐
│ category_name│ total_revenue │
│    VARCHAR   │  DECIMAL(9,2) │
├──────────────┼───────────────┤
│ Documentary  │        531.70 │
│ Sports       │        509.74 │
│ Drama        │        498.85 │
│ New          │        497.80 │
│ Sci-Fi       │        475.89 │
└──────────────┴───────────────┘
```

Note the trailing zeros — `531.70`, not `531.7`. Decimal precision is preserved end-to-end from `numeric(5,2)` in Postgres through Arrow `Decimal128(9,2)` to DuckDB `DECIMAL(9,2)`.

---

## 6. Render it in OpenBoard

Start the OpenBoard dev server against the same project:

```bash
cd /path/to/openboard
npx tsx src/cli/dev.ts dev --project "$OPENBOARD_PROJECT"
# OpenBoard listening on http://localhost:3000
```

Open `http://localhost:3000`. The `flux_pipelines` connection is picked up automatically. From any dashboard query editor, you can run:

```sql
SELECT category_name, total_revenue
FROM flux_pipelines.revenue_by_category
ORDER BY total_revenue DESC
```

Add a new tile (or a new `.board` file) backed by this query and you have a dashboard powered end-to-end by your flux pipeline. Re-run `horizon-flux run "Pagila: Revenue to OpenBoard"` and refresh the dashboard — the numbers update.

---

## What just happened

```
Postgres (pagila)
   │
   │  postgresql source connector
   ▼
Horizon Flux pipeline
   │
   │  SQL joins + aggregation (DataFusion)
   ▼
openboard_duckdb sink (plugin subprocess)
   │
   │  Arrow IPC over flux plugin protocol v1
   │  → staging .duckdb file
   │  → atomic rename on commit
   │  → connections/flux_pipelines.yaml
   │  → datasets/revenue_by_category.yaml
   ▼
OpenBoard project
   │
   │  duckdb connection
   ▼
OpenBoard dashboard
```

The plugin runs as a Node.js subprocess that flux spawns on demand. Flux speaks the plugin wire protocol described in the openboard plugin's `src/protocol.ts` and the flux host's `flux-plugin-host` crate — neither side knows or cares what language the other is in. That's the whole point of the flux plugin system, and the openboard plugin is its flagship reference implementation.

---

## Clean up

```bash
# Stop and remove the throwaway Postgres
docker rm -f flux-pagila

# Remove the tutorial OpenBoard project
rm -rf /tmp/flux-tutorial-openboard

# (Optional) remove the imported pipeline from flux's metadata store
horizon-flux import --help     # there's no `flux delete pipeline` yet — list/show only
```

---

## Where to go next

- **Plugin reference & config:** [`plugins/flux/README.md`](../../plugins/flux/README.md) — full config schema, write modes, supported Arrow types, troubleshooting.
- **Build your own flux plugin:** the openboard plugin source under `plugins/flux/src/` is the canonical example. Read `protocol.ts` for the wire format and `sink.ts` for the staging/commit pattern.
- **Use other write modes:** change `write_mode` to `append` for incremental loads, or `upsert` (with `upsert_keys`) for idempotent re-runs.
