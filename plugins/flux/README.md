<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# OpenBoard Sink Plugin for Horizon Flux

Publish [Horizon Flux](https://github.com/horizon-analytic/horizon-flux) pipeline outputs directly into an [OpenBoard](https://github.com/horizon-analytic/openboard) project as DuckDB tables. Run a flux pipeline, get a working OpenBoard dashboard — without leaving the Horizon Analytic toolchain.

This is the **flagship reference plugin** for the flux plugin system. It is also intended as the canonical example for third-party plugin authors: the source under `src/` is laid out so it can be read top-to-bottom as a template for a new sink plugin.

- **Plugin name:** `openboard`
- **Sink type:** `openboard_duckdb`
- **Wire protocol:** flux plugin protocol v1
- **Runtime:** Node.js (≥ 18), spawned by flux as a subprocess
- **License:** MIT OR Apache-2.0

## What it does

Each `openboard_duckdb` sink node in a flux pipeline:

1. Receives `RecordBatch`es from the upstream node over the flux plugin wire protocol (Arrow IPC framed inside length-prefixed messages).
2. Writes them to a **staging** DuckDB file (`<target>.staging-<uuid>.duckdb`).
3. On `Commit`, atomically renames the staging file over the target file so OpenBoard never observes a partially-written database.
4. Creates or updates `connections/<connection_name>.yaml` in the configured OpenBoard project so dashboards can query the new table immediately.
5. Optionally emits `datasets/<table_name>.yaml` with the table schema, source pipeline/node, and an optional snapshot label, for OpenBoard dataset discovery.

If the plugin is killed mid-stream, the target DuckDB file is left untouched and the orphaned staging file is swept on the next run (`.wal` sidecars included).

## Requirements

- **Node.js ≥ 18** on `PATH`. The plugin is a Node subprocess; flux will surface a clear error if `node` is missing.
- An existing OpenBoard project directory (the one containing `dashboards/` and `connections/`). The plugin will create `connections/` and `datasets/` if they don't exist, but it does not scaffold a whole project.
- Horizon Flux ≥ 0.1.0 with the plugin system enabled.

## Install

v1 install is intentionally manual. From the `openboard` repo:

```bash
cd plugins/flux
npm install
npm run bundle     # tsup build + assemble self-contained dist/plugin/

# Drop the bundled directory into flux's plugin search path. The exact
# location depends on the OS — ask flux:
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

The bundled `dist/plugin/` directory is fully self-contained: it carries
its own `node_modules` (runtime deps only — `@duckdb/node-api`,
`apache-arrow`, `yaml`) and the executable entry point that
`plugin.toml` references (`dist/openboard-plugin.js`, with shebang +
`+x` set by the build).

For **plugin development**, you can skip the bundle step and symlink
the source tree directly so edits-and-rebuilds don't require copying:

```bash
ln -sfn "$(pwd)" "$PLUGIN_DIR/openboard"
npm run build         # rebuild after changes; flux re-spawns on each run
```

## Configure

A node of type `openboard_duckdb` accepts the following config (full JSON Schema in [`config_schema.json`](./config_schema.json)):

| Field | Required | Default | Description |
|---|---|---|---|
| `openboard_project` | yes | — | Path to the OpenBoard project directory. |
| `connection_name` | no | `flux_pipelines` | Name of the connection. Becomes `connections/<name>.yaml`. |
| `database_file` | no | `data/flux.duckdb` | DuckDB file path, relative to the project directory. Multiple sinks can share one file. |
| `table_name` | yes | — | DuckDB table written by this sink. Becomes the queryable table in OpenBoard. |
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
# In a flux pipeline definition
nodes:
  - id: publish_orders
    type: sink
    plugin: openboard
    sink_type: openboard_duckdb
    config:
      openboard_project: ../analytics-dashboards
      connection_name: flux_pipelines
      database_file: data/flux.duckdb
      table_name: orders_analytic
      write_mode: upsert
      upsert_keys: [order_id]
      snapshot_label: nightly
```

After a successful run, the OpenBoard project contains:

```
analytics-dashboards/
  data/flux.duckdb               # atomic rename target
  connections/flux_pipelines.yaml
  datasets/orders_analytic.yaml  # schema + source pipeline/node + snapshot_label
```

`openboard dev` (run separately — the plugin does not auto-start it) picks up the connection and dashboards can query `orders_analytic` immediately.

## Repository layout

```
plugins/flux/
  plugin.toml             # flux plugin manifest
  config_schema.json      # JSON Schema for sink config
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts              # entry point
    protocol.ts           # flux plugin wire protocol (framing + session loop)
    sink.ts               # DuckDB write logic, staging + commit
    arrow_types.ts        # Arrow → DuckDB type mapping
    openboard_project.ts  # connection + dataset YAML writers (idempotent)
  test/
    protocol.test.ts
    sink.test.ts
    openboard_project.test.ts
    integration.test.ts   # spawns the bundled plugin as a real subprocess
```

OpenBoard internals are imported source-level via the `@openboard/*` tsconfig path mapping (`../../src/*`) and bundled by tsup at build time. The plugin does **not** declare `openboard` as an npm dependency.

## Development

```bash
npm install
npm run typecheck
npm test               # vitest: unit + integration
npm run build          # dist/openboard-plugin.js
npm run bundle         # dist/plugin/ (drop into ~/.horizon-flux/plugins/)
```

The integration test under `test/integration.test.ts` spawns the bundled `dist/openboard-plugin.js` and drives `Hello → ConfigureSink → RecordBatch → Commit → Shutdown` over real stdin/stdout — run `npm run build` before `npm test` if you've changed `src/`.

## Troubleshooting

- **`node: command not found` when flux loads the plugin** — install Node ≥ 18 and make sure it's on `PATH` for the user running flux. `horizon-flux plugin check openboard` will report it explicitly.
- **`DuckDB error: ... database is locked`** — the OpenBoard dev server (or another DuckDB client) has the target file open. Stop `openboard dev`, re-run the pipeline, then restart it. On Windows the atomic rename will fail in this state and the plugin will leave the staging file behind for inspection rather than risk corrupting the target.
- **`Schema mismatch in append mode: column 'X' ...`** — the upstream pipeline produced a schema that doesn't match the existing target table. Either run with `write_mode: replace`, drop the target table, or fix the upstream node so its output matches.
- **`UnsupportedTypeError: column 'foo' has Arrow type Time...`** — see the supported-types table above. `Time`, `Decimal256`, and the nested types (List/Struct/Union/Map/Interval/Duration/FixedSizeList) are not supported. Cast them to a supported type upstream (e.g. `CAST(foo AS VARCHAR)`) or restructure the pipeline.
- **Stale `*.staging-*.duckdb` files in the target directory** — these are swept automatically on the next configure. Safe to delete by hand if the plugin is not running.
- **`Permission denied` writing `connections/` or `datasets/`** — flux runs the plugin as the same user that launched flux. Make sure that user can write to the OpenBoard project directory.

## License

Dual-licensed under MIT OR Apache-2.0. See [`LICENSE`](./LICENSE).

Copyright © 2026 Horizon Analytic Studios, LLC.
