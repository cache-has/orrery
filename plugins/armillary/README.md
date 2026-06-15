<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Orrery Sink Plugin for Armillary

Publish [Armillary](https://github.com/cache-has/armillary) pipeline outputs directly into an [Orrery](https://github.com/horizon-analytic/orrery) project as DuckDB tables. Run an Armillary pipeline, get a working Orrery dashboard — without leaving the Horizon Analytic toolchain.

This is the **flagship reference plugin** for the armillary plugin system. It is also intended as the canonical example for third-party plugin authors: the source under `src/` is laid out so it can be read top-to-bottom as a template for a new sink plugin.

- **Plugin name:** `orrery`
- **Sink type:** `orrery_duckdb`
- **Wire protocol:** armillary plugin protocol v1
- **Runtime:** Node.js (≥ 18), spawned by armillary as a subprocess
- **License:** MIT OR Apache-2.0

## What it does

Each `orrery_duckdb` sink node in an Armillary pipeline:

1. Receives `RecordBatch`es from the upstream node over the armillary plugin wire protocol (Arrow IPC framed inside length-prefixed messages).
2. Writes them to a **staging** DuckDB file (`<target>.staging-<uuid>.duckdb`).
3. On `Commit`, atomically renames the staging file over the target file so Orrery never observes a partially-written database.
4. Creates or updates `connections/<connection_name>.yaml` in the configured Orrery project so dashboards can query the new table immediately.
5. Optionally emits `datasets/<table_name>.yaml` with the table schema, source pipeline/node, and an optional snapshot label, for Orrery dataset discovery.

If the plugin is killed mid-stream, the target DuckDB file is left untouched and the orphaned staging file is swept on the next run (`.wal` sidecars included).

## Requirements

- **Node.js ≥ 18** on `PATH`. The plugin is a Node subprocess; armillary will surface a clear error if `node` is missing.
- An existing Orrery project directory (the one containing `dashboards/` and `connections/`). The plugin will create `connections/` and `datasets/` if they don't exist, but it does not scaffold a whole project.
- Armillary ≥ 0.1.0 with the plugin system enabled.

## Install

v1 install is intentionally manual. From the `orrery` repo:

```bash
cd plugins/armillary
npm install
npm run bundle     # tsup build + assemble self-contained dist/plugin/

# Drop the bundled directory into armillary's plugin search path. The exact
# location depends on the OS — ask armillary:
PLUGIN_DIR="$(armillary plugin path | head -1)"
mkdir -p "$PLUGIN_DIR"
cp -R dist/plugin "$PLUGIN_DIR/orrery"

# Verify
armillary plugin list
# -> orrery  v0.1.0  [ok]
#      sink: orrery_duckdb — Orrery (DuckDB)

armillary plugin check orrery
# -> ok plugin `orrery` v0.1.0 (protocol 1)
```

The bundled `dist/plugin/` directory is fully self-contained: it carries
its own `node_modules` (runtime deps only — `@duckdb/node-api`,
`apache-arrow`, `yaml`) and the executable entry point that
`plugin.toml` references (`dist/orrery-plugin.js`, with shebang +
`+x` set by the build).

For **plugin development**, you can skip the bundle step and symlink
the source tree directly so edits-and-rebuilds don't require copying:

```bash
ln -sfn "$(pwd)" "$PLUGIN_DIR/orrery"
npm run build         # rebuild after changes; armillary re-spawns on each run
```

## Configure

A node of type `orrery_duckdb` accepts the following config (full JSON Schema in [`config_schema.json`](./config_schema.json)):

| Field | Required | Default | Description |
|---|---|---|---|
| `orrery_project` | yes | — | Path to the Orrery project directory. |
| `connection_name` | no | `armillary_pipelines` | Name of the connection. Becomes `connections/<name>.yaml`. |
| `database_file` | no | `data/armillary.duckdb` | DuckDB file path, relative to the project directory. Multiple sinks can share one file. |
| `table_name` | yes | — | DuckDB table written by this sink. Becomes the queryable table in Orrery. |
| `write_mode` | no | `replace` | One of `replace`, `append`, `upsert`. |
| `upsert_keys` | when `write_mode=upsert` | — | Column names forming the upsert key. Last write wins. |
| `snapshot_label` | no | — | Label persisted on the dataset metadata file for versioned dashboards. |
| `write_dataset_metadata` | no | `true` | Emit `datasets/<table_name>.yaml`. |

### Write modes

- **`replace`** — fresh staging file, `CREATE TABLE` from the incoming Arrow schema, then atomic rename.
- **`append`** — clones the existing target into staging, validates the incoming schema against the existing table (rejecting at `ConfigureSink` with a clear column-level error if they differ), then appends.
- **`upsert`** — same clone-and-append strategy as `append`, plus a post-append dedup window keyed on `upsert_keys` (last write wins). `upsert_keys` is required and is checked against the input schema at configure time.

### Supported Arrow types

| Arrow type | DuckDB type | Notes |
|---|---|---|
| `Bool` | `BOOLEAN` | |
| `Int8`–`Int64` (signed) | `TINYINT` … `BIGINT` | |
| `UInt8`–`UInt64` | `UTINYINT` … `UBIGINT` | |
| `Float32` / `Float64` | `FLOAT` / `DOUBLE` | |
| `Utf8` / `LargeUtf8` | `VARCHAR` | |
| `Binary` / `LargeBinary` / `FixedSizeBinary` | `BLOB` | |
| `Dictionary<…, Utf8>` | `VARCHAR` | Decoded transparently. |
| `Date32` (DateDay) | `DATE` | |
| `Date64` (DateMillisecond) | `DATE` | Lossless: ms is required to be a whole-day multiple per Arrow spec. |
| `Timestamp(s)` | `TIMESTAMP_S` | |
| `Timestamp(ms)` | `TIMESTAMP_MS` | |
| `Timestamp(us)` | `TIMESTAMP` | |
| `Timestamp(ns)` | `TIMESTAMP_NS` | |
| `Timestamp(*, tz)` | `TIMESTAMPTZ` | DuckDB `TIMESTAMPTZ` is microsecond precision; nanosecond-with-timezone loses sub-microsecond precision. |
| `Decimal128(p, s)` | `DECIMAL(p, s)` | Up to 38 digits of precision. |

**Rejected at `ConfigureSink`** with an `UnsupportedTypeError` naming the column:

- `Time` (any unit) — rare in analytics workloads.
- `Decimal256` — DuckDB `DECIMAL` caps at 38 digits (≈ 128 bits).
- `List`, `Struct`, `Union`, `Map`, `Interval`, `Duration`, `FixedSizeList` — out of scope for v1.

## Example

```yaml
# In an Armillary pipeline definition
nodes:
  - id: publish_orders
    type: sink
    plugin: orrery
    sink_type: orrery_duckdb
    config:
      orrery_project: ../analytics-dashboards
      connection_name: armillary_pipelines
      database_file: data/armillary.duckdb
      table_name: orders_analytic
      write_mode: upsert
      upsert_keys: [order_id]
      snapshot_label: nightly
```

After a successful run, the Orrery project contains:

```
analytics-dashboards/
  data/armillary.duckdb               # atomic rename target
  connections/armillary_pipelines.yaml
  datasets/orders_analytic.yaml  # schema + source pipeline/node + snapshot_label
```

`orrery dev` (run separately — the plugin does not auto-start it) picks up the connection and dashboards can query `orders_analytic` immediately.

## Repository layout

```
plugins/armillary/
  plugin.toml             # armillary plugin manifest
  config_schema.json      # JSON Schema for sink config
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts              # entry point
    protocol.ts           # armillary plugin wire protocol (framing + session loop)
    sink.ts               # DuckDB write logic, staging + commit
    arrow_types.ts        # Arrow → DuckDB type mapping
    orrery_project.ts  # connection + dataset YAML writers (idempotent)
  test/
    protocol.test.ts
    sink.test.ts
    orrery_project.test.ts
    integration.test.ts   # spawns the bundled plugin as a real subprocess
```

Orrery internals are imported source-level via the `@orrery/*` tsconfig path mapping (`../../src/*`) and bundled by tsup at build time. The plugin does **not** declare `orrery` as an npm dependency.

## Development

```bash
npm install
npm run typecheck
npm test               # vitest: unit + integration
npm run build          # dist/orrery-plugin.js
npm run bundle         # dist/plugin/ (drop into ~/.armillary/plugins/)
```

The integration test under `test/integration.test.ts` spawns the bundled `dist/orrery-plugin.js` and drives `Hello → ConfigureSink → RecordBatch → Commit → Shutdown` over real stdin/stdout — run `npm run build` before `npm test` if you've changed `src/`.

## Troubleshooting

- **`node: command not found` when armillary loads the plugin** — install Node ≥ 18 and make sure it's on `PATH` for the user running armillary. `armillary plugin check orrery` will report it explicitly.
- **`DuckDB error: ... database is locked`** — the Orrery dev server (or another DuckDB client) has the target file open. Stop `orrery dev`, re-run the pipeline, then restart it. On Windows the atomic rename will fail in this state and the plugin will leave the staging file behind for inspection rather than risk corrupting the target.
- **`Schema mismatch in append mode: column 'X' ...`** — the upstream pipeline produced a schema that doesn't match the existing target table. Either run with `write_mode: replace`, drop the target table, or fix the upstream node so its output matches.
- **`UnsupportedTypeError: column 'foo' has Arrow type Time...`** — see the supported-types table above. `Time`, `Decimal256`, and the nested types (List/Struct/Union/Map/Interval/Duration/FixedSizeList) are not supported. Cast them to a supported type upstream (e.g. `CAST(foo AS VARCHAR)`) or restructure the pipeline.
- **Stale `*.staging-*.duckdb` files in the target directory** — these are swept automatically on the next configure. Safe to delete by hand if the plugin is not running.
- **`Permission denied` writing `connections/` or `datasets/`** — armillary runs the plugin as the same user that launched armillary. Make sure that user can write to the Orrery project directory.

## License

Dual-licensed under MIT OR Apache-2.0. See [`LICENSE`](./LICENSE).

Copyright © 2026 Horizon Analytic Studios, LLC.
