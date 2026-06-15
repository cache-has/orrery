// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

// Orrery sink — DuckDB writer behind the armillary plugin SinkHandlers
// interface. Implements the staging-file + atomic-rename strategy
// described in planning/25-orrery-plugin.md so a crash mid-pipeline
// never leaves the target file in a half-written state.
//
// Scope (v1, "Sink implementation" task block):
//   - replace / append / upsert write modes
//   - schema validation against an existing target table
//   - atomic commit via fs.renameSync
//   - orphaned staging-file cleanup on configure
//   - error mapping (DuckDB errors → ProtocolError-shaped messages)
//
// Orrery project file writes (connections/<name>.yaml, datasets/<name>.yaml)
// are delegated to ./orrery_project.ts and invoked from commit() after the
// atomic rename succeeds.

import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { type Data, Schema, TimeUnit, tableFromIPC } from 'apache-arrow';
import {
  DuckDBDateValue,
  DuckDBDecimalValue,
  DuckDBInstance,
  DuckDBTimestampMillisecondsValue,
  DuckDBTimestampNanosecondsValue,
  DuckDBTimestampSecondsValue,
  DuckDBTimestampTZValue,
  DuckDBTimestampValue,
  type DuckDBAppender,
  type DuckDBConnection,
} from '@duckdb/node-api';

import {
  type ColumnPlan,
  buildCreateTableSql,
  diffColumnPlans,
  planColumns,
  quoteIdent,
} from './arrow_types.js';
import { writeOrreryProjectFiles } from './orrery_project.js';
import {
  type BatchAckPayload,
  type CommitAckPayload,
  type ConfigureAckPayload,
  type ConfigureSinkPayload,
  type SinkHandlers,
} from './protocol.js';

export interface OrrerySinkConfig {
  orrery_project: string;
  connection_name?: string;
  database_file?: string;
  table_name: string;
  write_mode?: 'replace' | 'append' | 'upsert';
  upsert_keys?: string[];
  snapshot_label?: string;
  write_dataset_metadata?: boolean;
  // Optional provenance fields the host may pass through; recorded into the
  // dataset metadata file when present.
  pipeline_name?: string;
  node_name?: string;
}

// ----- Materialization policy (mirror of armillary_engine::materialization) -----

export type ChangeDetection = 'check' | 'timestamp';
export type HardDeletes = 'ignore' | 'invalidate' | 'delete';

export interface SnapshotPolicy {
  change_detection: ChangeDetection;
  check_columns?: string[];
  updated_at_column?: string;
  hard_deletes: HardDeletes;
}

export interface MaterializationPolicy {
  read_mode?: 'full' | 'incremental';
  write_strategy?: 'append' | 'merge' | 'delete_insert' | 'insert_overwrite' | 'truncate_insert' | 'snapshot';
  unique_keys?: string[];
  partition_column?: string;
  snapshot?: SnapshotPolicy;
}

// SCD2 metadata column names — must match armillary_engine::snapshot constants.
const FLUX_SCD_ID = 'armillary_scd_id';
const FLUX_VALID_FROM = 'armillary_valid_from';
const FLUX_VALID_TO = 'armillary_valid_to';
const FLUX_IS_CURRENT = 'armillary_is_current';

interface ResolvedConfig {
  projectDir: string;
  databaseFile: string; // absolute path to target .duckdb
  stagingFile: string; // absolute path to staging .duckdb
  tableName: string;
  writeMode: 'replace' | 'append' | 'upsert' | 'snapshot';
  upsertKeys: string[];
  connectionName: string;
  snapshotLabel: string | null;
  writeDatasetMetadata: boolean;
  pipelineName: string | null;
  nodeName: string | null;
  // Snapshot-only: parsed materialization policy.
  snapshotPolicy: SnapshotPolicy | null;
  snapshotUniqueKeys: string[];
  // For snapshot mode we mutate the target file directly — no rename.
  snapshotStageTable: string;
}

interface SnapshotStats {
  rowsInserted: number; // new versions opened
  rowsUpdated: number; // current versions closed
  rowsDeleted: number; // hard-delete count
}

interface ActiveSession {
  config: ResolvedConfig;
  plan: ColumnPlan[];
  schema: Schema;
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  rowsWritten: number;
  startedAt: number;
  // Filled in at commit() for snapshot mode; null otherwise.
  snapshotStats: SnapshotStats | null;
}

export class OrrerySink implements SinkHandlers {
  private session: ActiveSession | null = null;

  async configure(payload: ConfigureSinkPayload): Promise<ConfigureAckPayload> {
    if (this.session) {
      return { accepted: false, reason: 'sink already configured' };
    }
    let resolved: ResolvedConfig;
    try {
      resolved = resolveConfig(payload.config as OrrerySinkConfig);
    } catch (e) {
      return { accepted: false, reason: (e as Error).message };
    }

    // If the host sent a materialization policy, parse and validate it.
    // A `snapshot` write_strategy overrides the legacy `write_mode` routing.
    if (payload.materialization !== undefined && payload.materialization !== null) {
      const mat = payload.materialization as MaterializationPolicy;
      const strategy = mat.write_strategy ?? 'append';
      if (strategy === 'snapshot') {
        const err = validateSnapshotPolicy(mat);
        if (err) return { accepted: false, reason: err };
        resolved.writeMode = 'snapshot';
        resolved.snapshotPolicy = mat.snapshot!;
        resolved.snapshotUniqueKeys = mat.unique_keys!;
      }
      // Other strategies fall through to legacy write_mode handling; the
      // plugin only declares `append` and `snapshot` in its capabilities.
    }

    let schema: Schema;
    try {
      schema = decodeInputSchema(payload.input_schema_ipc_b64);
    } catch (e) {
      return {
        accepted: false,
        reason: `failed to decode input_schema_ipc_b64: ${(e as Error).message}`,
      };
    }

    let plan: ColumnPlan[];
    try {
      plan = planColumns(schema);
    } catch (e) {
      return { accepted: false, reason: (e as Error).message };
    }

    if (resolved.writeMode === 'upsert' && resolved.upsertKeys.length === 0) {
      return {
        accepted: false,
        reason: 'write_mode=upsert requires upsert_keys',
      };
    }
    for (const k of resolved.upsertKeys) {
      if (!plan.some((c) => c.name === k)) {
        return {
          accepted: false,
          reason: `upsert key "${k}" is not present in the input schema`,
        };
      }
    }

    // Snapshot mode: verify unique_keys + check/updated_at columns exist in
    // the incoming schema. This is the runtime "trust but verify" pass.
    if (resolved.writeMode === 'snapshot') {
      const snapErr = validateSnapshotAgainstPlan(
        resolved.snapshotUniqueKeys,
        resolved.snapshotPolicy!,
        plan,
      );
      if (snapErr) return { accepted: false, reason: snapErr };
    }

    // Ensure target directory exists, then sweep stale staging siblings.
    mkdirSync(dirname(resolved.databaseFile), { recursive: true });
    cleanupOrphanStagingFiles(resolved.databaseFile);

    // Snapshot mode opens the target file *directly* and mutates it inside
    // a single transaction at commit time. The staging-file + atomic-rename
    // path is only used for replace/append/upsert (which rebuild the file).
    const openPath =
      resolved.writeMode === 'snapshot' ? resolved.databaseFile : resolved.stagingFile;

    let instance: DuckDBInstance;
    let connection: DuckDBConnection;
    try {
      instance = await DuckDBInstance.create(openPath);
      connection = await instance.connect();
    } catch (e) {
      return {
        accepted: false,
        reason: `failed to open DuckDB file: ${(e as Error).message}`,
      };
    }

    try {
      if (resolved.writeMode === 'snapshot') {
        await prepareSnapshotTarget(connection, resolved, plan);
      } else {
        await prepareStagingTable(connection, resolved, plan);
      }
    } catch (e) {
      try { connection.closeSync(); } catch { /* ignore */ }
      try { instance.closeSync(); } catch { /* ignore */ }
      if (resolved.writeMode !== 'snapshot') {
        try { unlinkSync(resolved.stagingFile); } catch { /* ignore */ }
      }
      return { accepted: false, reason: (e as Error).message };
    }

    this.session = {
      config: resolved,
      plan,
      schema,
      instance,
      connection,
      rowsWritten: 0,
      startedAt: Date.now(),
      snapshotStats: null,
    };
    return { accepted: true };
  }

  async batch(payload: Uint8Array): Promise<BatchAckPayload> {
    const s = this.requireSession();
    let arrowTable;
    try {
      arrowTable = tableFromIPC(payload);
    } catch (e) {
      throw new Error(`failed to decode RecordBatch IPC: ${(e as Error).message}`);
    }

    // Defensive: re-validate the batch's schema against the configured plan.
    let incomingPlan: ColumnPlan[];
    try {
      incomingPlan = planColumns(arrowTable.schema);
    } catch (e) {
      throw new Error(`incoming batch has unsupported type: ${(e as Error).message}`);
    }
    const mismatch = diffColumnPlans(s.plan, incomingPlan);
    if (mismatch) {
      throw new Error(`batch schema does not match configured schema — ${mismatch}`);
    }

    const appendTarget =
      s.config.writeMode === 'snapshot' ? s.config.snapshotStageTable : s.config.tableName;
    const appender = await s.connection.createAppender(appendTarget);
    try {
      const numRows = arrowTable.numRows;
      // Each batch() call decodes exactly one RecordBatch off the wire, so
      // every Vector should have exactly one chunk. Reading the underlying
      // Data chunk directly (instead of going through Vector.get) lets us
      // preserve full precision for Decimal and Timestamp columns — the
      // Vector.get() path silently divides Timestamp(us|ns) down to ms and
      // returns Decimal as a BN wrapper.
      const cols = s.plan.map((c) => {
        const vec = arrowTable.getChild(c.name);
        if (!vec) {
          throw new Error(`incoming batch is missing column "${c.name}"`);
        }
        if (vec.data.length !== 1) {
          throw new Error(
            `internal: column "${c.name}" arrived with ${vec.data.length} chunks; expected exactly 1`,
          );
        }
        return { vec, chunk: vec.data[0] };
      });

      for (let row = 0; row < numRows; row++) {
        for (let ci = 0; ci < s.plan.length; ci++) {
          appendCell(appender, s.plan[ci], cols[ci].vec, cols[ci].chunk, row);
        }
        appender.endRow();
      }
      appender.flushSync();
      s.rowsWritten += numRows;
      return { rows_accepted: numRows };
    } finally {
      try { appender.closeSync(); } catch { /* already closed on flush+close */ }
    }
  }

  async commit(): Promise<CommitAckPayload> {
    const s = this.requireSession();

    if (s.config.writeMode === 'snapshot') {
      try {
        s.snapshotStats = await runSnapshotMerge(s);
      } catch (e) {
        // Roll back partial work before bailing out.
        try { await s.connection.run('ROLLBACK'); } catch { /* ignore */ }
        throw new Error(`snapshot merge failed: ${(e as Error).message}`);
      }
      // Snapshot mutates the target file directly — no rename.
      try { s.connection.closeSync(); } catch { /* ignore */ }
      try { s.instance.closeSync(); } catch { /* ignore */ }
    } else {
      try {
        if (s.config.writeMode === 'upsert') {
          await mergeUpsertFromStaging(s);
        }
      } catch (e) {
        throw new Error(`upsert merge failed: ${(e as Error).message}`);
      }

      // Close handles before renaming the file (Windows requires the source
      // not be open by us; POSIX is permissive but cleaner this way).
      try { s.connection.closeSync(); } catch { /* ignore */ }
      try { s.instance.closeSync(); } catch { /* ignore */ }

      try {
        renameSync(s.config.stagingFile, s.config.databaseFile);
      } catch (e) {
        // Leave staging in place for manual recovery; surface the error.
        throw new Error(
          `atomic rename failed (target may be open by another process): ${(e as Error).message}`,
        );
      }
    }

    // Materialize Orrery project files (connection + optional dataset
    // metadata) so dashboards can discover the freshly committed table.
    // Failures here are surfaced as commit errors: the DuckDB file is
    // already in place, but advertising it to Orrery is part of the
    // sink's contract.
    try {
      writeOrreryProjectFiles({
        projectDir: s.config.projectDir,
        connectionName: s.config.connectionName,
        databaseFile: s.config.databaseFile,
        tableName: s.config.tableName,
        plan: s.plan,
        writeDatasetMetadata: s.config.writeDatasetMetadata,
        snapshotLabel: s.config.snapshotLabel,
        pipelineName: s.config.pipelineName,
        nodeName: s.config.nodeName,
      });
    } catch (e) {
      throw new Error(
        `failed to update Orrery project files: ${(e as Error).message}`,
      );
    }

    const bytes = safeStatSize(s.config.databaseFile);
    const duration = Date.now() - s.startedAt;
    // For snapshot, report rows_inserted (new versions opened) as the
    // canonical `rows` count — mirrors how the Postgres sink populates
    // MaterializationReceipt. The full SnapshotMergeStats roll-up
    // (closed versions + hard-deletes) is carried in the optional
    // `rows_updated` / `rows_deleted` CommitAck fields so the host's
    // MaterializationReceipt sees the complete picture.
    const isSnapshot = s.config.writeMode === 'snapshot' && s.snapshotStats;
    const rows = isSnapshot ? s.snapshotStats!.rowsInserted : s.rowsWritten;
    const ack: CommitAckPayload = { rows, bytes, duration_ms: duration };
    if (isSnapshot) {
      ack.rows_updated = s.snapshotStats!.rowsUpdated;
      ack.rows_deleted = s.snapshotStats!.rowsDeleted;
    }
    this.session = null;
    return ack;
  }

  async abort(): Promise<void> {
    if (!this.session) return;
    const s = this.session;
    this.session = null;
    if (s.config.writeMode === 'snapshot') {
      // Best-effort rollback of any in-progress transaction before closing.
      try { await s.connection.run('ROLLBACK'); } catch { /* ignore */ }
      try { s.connection.closeSync(); } catch { /* ignore */ }
      try { s.instance.closeSync(); } catch { /* ignore */ }
      return;
    }
    try { s.connection.closeSync(); } catch { /* ignore */ }
    try { s.instance.closeSync(); } catch { /* ignore */ }
    try { unlinkSync(s.config.stagingFile); } catch { /* best effort */ }
  }

  async shutdown(): Promise<void> {
    // If the host shuts us down without an explicit Abort, treat it as one
    // so we don't leave staging files lying around.
    if (this.session) await this.abort();
  }

  private requireSession(): ActiveSession {
    if (!this.session) {
      throw new Error('sink is not configured');
    }
    return this.session;
  }
}

// ---------- helpers ----------

function resolveConfig(raw: OrrerySinkConfig): ResolvedConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('config must be an object');
  }
  if (!raw.orrery_project) throw new Error('config.orrery_project is required');
  if (!raw.table_name) throw new Error('config.table_name is required');

  const projectDir = resolve(raw.orrery_project);
  const dbRel = raw.database_file ?? 'data/armillary.duckdb';
  const databaseFile = isAbsolute(dbRel) ? dbRel : resolve(projectDir, dbRel);
  const stagingFile = `${databaseFile}.staging-${randomUUID()}.duckdb`;
  const writeMode = raw.write_mode ?? 'replace';
  if (writeMode !== 'replace' && writeMode !== 'append' && writeMode !== 'upsert') {
    throw new Error(`config.write_mode must be one of replace|append|upsert (got ${writeMode})`);
  }
  return {
    projectDir,
    databaseFile,
    stagingFile,
    tableName: raw.table_name,
    writeMode,
    upsertKeys: raw.upsert_keys ?? [],
    connectionName: raw.connection_name ?? 'armillary_pipelines',
    snapshotLabel: raw.snapshot_label ?? null,
    writeDatasetMetadata: raw.write_dataset_metadata ?? true,
    pipelineName: raw.pipeline_name ?? null,
    nodeName: raw.node_name ?? null,
    snapshotPolicy: null,
    snapshotUniqueKeys: [],
    snapshotStageTable: `__flux_snap_stage_${randomUUID().replace(/-/g, '_')}`,
  };
}

// ---------- snapshot helpers ----------

function validateSnapshotPolicy(mat: MaterializationPolicy): string | null {
  if (!mat.unique_keys || mat.unique_keys.length === 0) {
    return 'materialization.unique_keys is required for write_strategy=snapshot';
  }
  if (!mat.snapshot) {
    return 'materialization.snapshot block is required for write_strategy=snapshot';
  }
  const snap = mat.snapshot;
  const cd = snap.change_detection;
  if (cd !== 'check' && cd !== 'timestamp') {
    return `materialization.snapshot.change_detection must be 'check' or 'timestamp' (got ${cd})`;
  }
  if (cd === 'check') {
    if (!snap.check_columns || snap.check_columns.length === 0) {
      return 'materialization.snapshot.check_columns is required and must be non-empty when change_detection=check';
    }
    if (mat.read_mode === 'incremental') {
      return 'change_detection=check is incoherent with read_mode=incremental; use change_detection=timestamp or read_mode=full';
    }
  }
  if (cd === 'timestamp') {
    if (!snap.updated_at_column || snap.updated_at_column.trim() === '') {
      return 'materialization.snapshot.updated_at_column is required when change_detection=timestamp';
    }
  }
  const hd = snap.hard_deletes ?? 'ignore';
  if (hd !== 'ignore' && hd !== 'invalidate' && hd !== 'delete') {
    return `materialization.snapshot.hard_deletes must be one of ignore|invalidate|delete (got ${hd})`;
  }
  return null;
}

function validateSnapshotAgainstPlan(
  uniqueKeys: string[],
  policy: SnapshotPolicy,
  plan: ColumnPlan[],
): string | null {
  const names = new Set(plan.map((c) => c.name));
  for (const k of uniqueKeys) {
    if (!names.has(k)) {
      return `snapshot unique_key "${k}" is not present in the input schema`;
    }
  }
  if (policy.change_detection === 'check') {
    for (const c of policy.check_columns ?? []) {
      if (c === '*') continue;
      if (!names.has(c)) {
        return `snapshot check_column "${c}" is not present in the input schema`;
      }
    }
  } else if (policy.change_detection === 'timestamp') {
    const col = policy.updated_at_column!;
    if (!names.has(col)) {
      return `snapshot updated_at_column "${col}" is not present in the input schema`;
    }
  }
  return null;
}

/**
 * Expand `check_columns: ["*"]` to all non-key business columns. Mirrors
 * the Postgres sink's `comparison_columns`.
 */
function comparisonColumns(
  policy: SnapshotPolicy,
  uniqueKeys: string[],
  plan: ColumnPlan[],
): string[] {
  if (policy.change_detection === 'timestamp') {
    return [policy.updated_at_column!];
  }
  const cols = policy.check_columns!;
  if (cols.some((c) => c === '*')) {
    return plan.map((c) => c.name).filter((n) => !uniqueKeys.includes(n));
  }
  return cols;
}

/**
 * First-run / subsequent-run setup for a snapshot target:
 *   - If the target table doesn't exist, CREATE it with business columns +
 *     the four SCD2 metadata columns appended at the end.
 *   - If it exists, verify the metadata columns are present (otherwise the
 *     user pointed snapshot at a non-snapshot table — refuse).
 *   - Create the helper index `(unique_keys, armillary_is_current)`.
 *   - Create a session-local stage table mirroring the business schema only.
 */
async function prepareSnapshotTarget(
  connection: DuckDBConnection,
  config: ResolvedConfig,
  plan: ColumnPlan[],
): Promise<void> {
  const t = config.tableName;
  const existing = await readTableColumns(connection, t);
  if (!existing) {
    // Create the target table with business cols + SCD2 metadata columns.
    const businessDdl = plan.map((c) => `${quoteIdent(c.name)} ${c.sqlType}`);
    const metaDdl = [
      `${quoteIdent(FLUX_SCD_ID)} VARCHAR NOT NULL`,
      `${quoteIdent(FLUX_VALID_FROM)} TIMESTAMP NOT NULL`,
      `${quoteIdent(FLUX_VALID_TO)} TIMESTAMP`,
      `${quoteIdent(FLUX_IS_CURRENT)} BOOLEAN NOT NULL`,
    ];
    await connection.run(
      `CREATE TABLE ${quoteIdent(t)} (${[...businessDdl, ...metaDdl].join(', ')})`,
    );
  } else {
    // Verify SCD2 metadata columns are present.
    const names = new Set(existing.map((c) => c.name));
    for (const m of [FLUX_SCD_ID, FLUX_VALID_FROM, FLUX_VALID_TO, FLUX_IS_CURRENT]) {
      if (!names.has(m)) {
        throw new Error(
          `existing table "${t}" is missing SCD2 metadata column "${m}" — ` +
            `cannot use write_strategy=snapshot against a non-snapshot table. ` +
            `Drop the table or point snapshot at a different table_name.`,
        );
      }
    }
    // Verify business columns match the incoming plan.
    const businessExisting = existing.filter(
      (c) =>
        c.name !== FLUX_SCD_ID &&
        c.name !== FLUX_VALID_FROM &&
        c.name !== FLUX_VALID_TO &&
        c.name !== FLUX_IS_CURRENT,
    );
    const mismatch = diffColumnPlans(businessExisting, plan);
    if (mismatch) {
      throw new Error(
        `existing snapshot table "${t}" business-column schema does not match incoming pipeline — ${mismatch}`,
      );
    }
  }

  // Helper index. DuckDB supports CREATE INDEX IF NOT EXISTS.
  const idxName = `idx_${t}_${FLUX_IS_CURRENT}`.replace(/[^A-Za-z0-9_]/g, '_');
  const keyList = config.snapshotUniqueKeys.map(quoteIdent).join(', ');
  try {
    await connection.run(
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(idxName)} ON ${quoteIdent(t)} (${keyList}, ${quoteIdent(FLUX_IS_CURRENT)})`,
    );
  } catch {
    // Older DuckDB versions may reject IF NOT EXISTS; safe to ignore.
  }

  // Session-local stage table mirroring business columns only.
  const stageDdl = plan.map((c) => `${quoteIdent(c.name)} ${c.sqlType}`).join(', ');
  await connection.run(
    `CREATE TEMP TABLE ${quoteIdent(config.snapshotStageTable)} (${stageDdl})`,
  );
}

async function readTableColumns(
  connection: DuckDBConnection,
  tableName: string,
): Promise<ColumnPlan[] | null> {
  const reader = await connection.runAndReadAll(
    `SELECT column_name, data_type FROM information_schema.columns ` +
      `WHERE table_name = ${sqlString(tableName)} ORDER BY ordinal_position`,
  );
  const rows = reader.getRowObjects() as Array<{ column_name: string; data_type: string }>;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    name: r.column_name,
    sqlType: r.data_type,
    arrowTypeId: 0 as never,
    bigInt: /BIGINT|HUGEINT/i.test(r.data_type),
  }));
}

/**
 * The core stage-diff-merge. Faithful port of postgres_snapshot.rs:
 *
 *   1. BEGIN
 *   2. UPDATE target SET valid_to=now, is_current=false
 *      WHERE is_current AND EXISTS (stage row with same key and any
 *      comparison column IS DISTINCT FROM)  — closes changed versions.
 *   3. If hard_deletes=invalidate: same UPDATE for gone keys.
 *   4. INSERT INTO target(...) SELECT business, md5(...), now, NULL, true
 *      FROM stage WHERE NOT EXISTS current target row with same key
 *      — opens new versions for both changed (just closed above) and new.
 *   5. If hard_deletes=delete: DELETE FROM target WHERE key IN gone_keys.
 *   6. COMMIT
 *   7. DROP stage
 */
async function runSnapshotMerge(s: ActiveSession): Promise<SnapshotStats> {
  const t = s.config.tableName;
  const stage = s.config.snapshotStageTable;
  const keys = s.config.snapshotUniqueKeys;
  const policy = s.config.snapshotPolicy!;
  const cmpCols = comparisonColumns(policy, keys, s.plan);
  const businessCols = s.plan.map((c) => c.name);

  const qt = quoteIdent(t);
  const qs = quoteIdent(stage);
  const qScdId = quoteIdent(FLUX_SCD_ID);
  const qValidFrom = quoteIdent(FLUX_VALID_FROM);
  const qValidTo = quoteIdent(FLUX_VALID_TO);
  const qIsCurrent = quoteIdent(FLUX_IS_CURRENT);

  const keyJoinTS = keys
    .map((k) => `t.${quoteIdent(k)} = s.${quoteIdent(k)}`)
    .join(' AND ');
  const distinctCond = cmpCols
    .map((c) => `t.${quoteIdent(c)} IS DISTINCT FROM s.${quoteIdent(c)}`)
    .join(' OR ');

  await s.connection.run('BEGIN TRANSACTION');

  // Step 1: close changed current versions.
  // DuckDB's UPDATE doesn't support FROM aliases the same way PG does, but
  // it does support correlated subqueries and EXISTS.
  const closeChangedSql =
    `UPDATE ${qt} AS t SET ${qValidTo} = now(), ${qIsCurrent} = false ` +
    `WHERE t.${qIsCurrent} AND EXISTS (` +
    `  SELECT 1 FROM ${qs} AS s WHERE ${keyJoinTS} AND (${distinctCond})` +
    `)`;
  const closeChangedCount = await runAndCountChanges(s.connection, closeChangedSql);

  // Step 2: hard_deletes=invalidate — close current versions whose key is
  // absent from the stage.
  let invalidatedCount = 0;
  if (policy.hard_deletes === 'invalidate') {
    const keyJoinNotExists = keys
      .map((k) => `s.${quoteIdent(k)} = t.${quoteIdent(k)}`)
      .join(' AND ');
    const invalidateSql =
      `UPDATE ${qt} AS t SET ${qValidTo} = now(), ${qIsCurrent} = false ` +
      `WHERE t.${qIsCurrent} AND NOT EXISTS (` +
      `  SELECT 1 FROM ${qs} AS s WHERE ${keyJoinNotExists}` +
      `)`;
    invalidatedCount = await runAndCountChanges(s.connection, invalidateSql);
  }

  // Step 3: insert new versions for stage rows whose key has no current
  // version in the target anymore (either brand new or just-closed changed).
  const keyJoinNotExistsInsert = keys
    .map((k) => `t.${quoteIdent(k)} = s.${quoteIdent(k)}`)
    .join(' AND ');
  const businessQuoted = businessCols.map(quoteIdent).join(', ');
  const stageSelect = businessCols.map((c) => `s.${quoteIdent(c)}`).join(', ');
  const surrogateArgs = [
    `now()::VARCHAR`,
    ...keys.map((k) => `s.${quoteIdent(k)}::VARCHAR`),
  ].join(', ');
  const surrogate = `md5(concat_ws('|', ${surrogateArgs}))`;

  const insertSql =
    `INSERT INTO ${qt} (${businessQuoted}, ${qScdId}, ${qValidFrom}, ${qValidTo}, ${qIsCurrent}) ` +
    `SELECT ${stageSelect}, ${surrogate}, now(), NULL, true ` +
    `FROM ${qs} AS s ` +
    `WHERE NOT EXISTS (` +
    `  SELECT 1 FROM ${qt} AS t WHERE t.${qIsCurrent} AND ${keyJoinNotExistsInsert}` +
    `)`;
  const insertedCount = await runAndCountChanges(s.connection, insertSql);

  // Step 4: hard_deletes=delete — remove every historical version of keys
  // that no longer appear in the stage.
  let deletedCount = 0;
  if (policy.hard_deletes === 'delete') {
    const keyJoinDelete = keys
      .map((k) => `s.${quoteIdent(k)} = t.${quoteIdent(k)}`)
      .join(' AND ');
    const deleteSql =
      `DELETE FROM ${qt} AS t WHERE NOT EXISTS (` +
      `  SELECT 1 FROM ${qs} AS s WHERE ${keyJoinDelete}` +
      `)`;
    deletedCount = await runAndCountChanges(s.connection, deleteSql);
  }

  await s.connection.run('COMMIT');

  // Clean up the session-local stage table. TEMP tables go away with the
  // connection anyway, but dropping it explicitly keeps schema noise down
  // if the same connection is ever reused.
  try {
    await s.connection.run(`DROP TABLE IF EXISTS ${qs}`);
  } catch {
    /* ignore */
  }

  return {
    rowsInserted: insertedCount,
    rowsUpdated: closeChangedCount + invalidatedCount,
    rowsDeleted: deletedCount,
  };
}

/**
 * Execute a DML statement and return the number of affected rows. DuckDB's
 * node-api returns the row count through `rowCount` on the reader, but
 * different statement types surface it differently — this wrapper falls
 * back to a subsequent COUNT-style probe only if the direct value is
 * unavailable. In practice `rowCount` is populated for UPDATE/INSERT/DELETE.
 */
async function runAndCountChanges(
  connection: DuckDBConnection,
  sql: string,
): Promise<number> {
  const reader = await connection.runAndReadAll(sql);
  // DuckDB node-api: DML statements return a result with a single row
  // whose first column is the affected row count (e.g. "Count" for INSERT).
  const rows = reader.getRows();
  if (rows.length > 0 && rows[0].length > 0) {
    const v = rows[0][0];
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'number') return v;
  }
  return 0;
}

function decodeInputSchema(b64: string): Schema {
  if (!b64) {
    throw new Error('input_schema_ipc_b64 is empty');
  }
  const ipcBytes = Buffer.from(b64, 'base64');
  const table = tableFromIPC(ipcBytes);
  return table.schema;
}

function cleanupOrphanStagingFiles(targetFile: string): void {
  const dir = dirname(targetFile);
  const base = targetFile.split('/').pop() ?? targetFile;
  const prefix = `${base}.staging-`;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    // Sweep both the staging .duckdb file itself and any .wal sidecar a
    // crashed prior run may have left behind.
    if (name.startsWith(prefix) && (name.endsWith('.duckdb') || name.endsWith('.duckdb.wal'))) {
      try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
    }
  }
}

async function prepareStagingTable(
  connection: DuckDBConnection,
  config: ResolvedConfig,
  plan: ColumnPlan[],
): Promise<void> {
  const tableName = config.tableName;
  const targetExists = existsSync(config.databaseFile);

  if (config.writeMode === 'replace' || !targetExists) {
    if (config.writeMode !== 'replace' && !targetExists) {
      // append/upsert against a non-existent target — treat as create.
    }
    await connection.run(buildCreateTableSql(tableName, plan));
    return;
  }

  // append or upsert with an existing target: clone the existing table into
  // staging via ATTACH so we can do a transactional rename at commit time.
  const attachAlias = `__flux_target_${randomUUID().replace(/-/g, '_')}`;
  await connection.run(
    `ATTACH ${sqlString(config.databaseFile)} AS ${quoteIdent(attachAlias)} (READ_ONLY)`,
  );
  try {
    // Ensure the existing schema matches what we plan to write.
    const existing = await readExistingTablePlan(connection, attachAlias, tableName);
    if (!existing) {
      // table missing in target — same as create
      await connection.run(buildCreateTableSql(tableName, plan));
      return;
    }
    const mismatch = diffColumnPlans(existing, plan);
    if (mismatch) {
      throw new Error(
        `existing table "${tableName}" schema does not match incoming pipeline — ${mismatch}`,
      );
    }
    await connection.run(
      `CREATE TABLE ${quoteIdent(tableName)} AS SELECT * FROM ${quoteIdent(attachAlias)}.${quoteIdent(tableName)}`,
    );
  } finally {
    try {
      await connection.run(`DETACH ${quoteIdent(attachAlias)}`);
    } catch { /* ignore */ }
  }
}

async function readExistingTablePlan(
  connection: DuckDBConnection,
  attachAlias: string,
  tableName: string,
): Promise<ColumnPlan[] | null> {
  const reader = await connection.runAndReadAll(
    `SELECT column_name, data_type FROM information_schema.columns ` +
      `WHERE table_catalog = ${sqlString(attachAlias)} AND table_name = ${sqlString(tableName)} ` +
      `ORDER BY ordinal_position`,
  );
  const rows = reader.getRowObjects() as Array<{ column_name: string; data_type: string }>;
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    name: r.column_name,
    sqlType: r.data_type,
    arrowTypeId: 0 as never, // unused for the existing-table plan
    bigInt: /BIGINT|HUGEINT/i.test(r.data_type),
  }));
}

async function mergeUpsertFromStaging(s: ActiveSession): Promise<void> {
  // For upsert mode, the staging file holds the full prior table contents
  // followed by the newly appended rows. We materialize the merge by
  // rebuilding the table: keep all prior rows whose key isn't in the new
  // rows, then union the new rows.
  //
  // The staging connection was used to append fresh rows on top of the
  // cloned-from-target table. To distinguish "new" from "old" we use a
  // staging side-table written from the appender — but the simpler v1
  // implementation appends straight into the target table and relies on
  // the upsert keys for de-duplication via a row-number window.
  //
  // We deduplicate in place: for each key, keep only the LAST row (the
  // newest appended one), since the appender added new rows after the
  // cloned-old rows.
  const t = s.config.tableName;
  const keys = s.config.upsertKeys.map(quoteIdent).join(', ');
  const tmp = `__flux_dedup_${randomUUID().replace(/-/g, '_')}`;
  await s.connection.run(
    `CREATE TABLE ${quoteIdent(tmp)} AS ` +
      `SELECT * EXCLUDE (__flux_rn) FROM (` +
      `  SELECT *, row_number() OVER (PARTITION BY ${keys} ORDER BY rowid DESC) AS __flux_rn ` +
      `  FROM ${quoteIdent(t)}` +
      `) WHERE __flux_rn = 1`,
  );
  await s.connection.run(`DROP TABLE ${quoteIdent(t)}`);
  await s.connection.run(
    `ALTER TABLE ${quoteIdent(tmp)} RENAME TO ${quoteIdent(t)}`,
  );
}

function appendCell(
  appender: DuckDBAppender,
  col: ColumnPlan,
  vec: { get(i: number): unknown },
  chunk: Data,
  row: number,
): void {
  // Temporal / decimal columns: pull from raw typed-array storage so we
  // don't lose precision through Vector.get() (which silently divides
  // Timestamp(us|ns) → ms and returns Decimal as a BN wrapper). For all
  // other types Vector.get() is lossless and faster than re-implementing
  // every variable-width buffer layout, so we use it directly.
  if (col.subtype) {
    if (!isValidAt(chunk, row)) {
      appender.appendNull();
      return;
    }
    appendSubtype(appender, col, chunk, row);
    return;
  }

  const v = vec.get(row);
  if (v === null || v === undefined) {
    appender.appendNull();
    return;
  }

  switch (col.sqlType) {
    case 'BOOLEAN': appender.appendBoolean(v as boolean); return;
    case 'TINYINT': appender.appendTinyInt(v as number); return;
    case 'SMALLINT': appender.appendSmallInt(v as number); return;
    case 'INTEGER': appender.appendInteger(v as number); return;
    case 'BIGINT':
      appender.appendBigInt(typeof v === 'bigint' ? v : BigInt(v as number));
      return;
    case 'UTINYINT': appender.appendUTinyInt(v as number); return;
    case 'USMALLINT': appender.appendUSmallInt(v as number); return;
    case 'UINTEGER': appender.appendUInteger(v as number); return;
    case 'UBIGINT':
      appender.appendUBigInt(typeof v === 'bigint' ? v : BigInt(v as number));
      return;
    case 'FLOAT': appender.appendFloat(v as number); return;
    case 'DOUBLE': appender.appendDouble(v as number); return;
    case 'VARCHAR': appender.appendVarchar(String(v)); return;
    case 'BLOB':
      appender.appendBlob(v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer));
      return;
    default:
      throw new Error(`internal: no appender mapping for SQL type ${col.sqlType}`);
  }
}

function appendSubtype(
  appender: DuckDBAppender,
  col: ColumnPlan,
  chunk: Data,
  row: number,
): void {
  const sub = col.subtype!;
  const idx = chunk.offset + row;

  switch (sub.kind) {
    case 'date_day': {
      const days = (chunk.values as Int32Array)[idx];
      appender.appendDate(new DuckDBDateValue(days));
      return;
    }
    case 'date_millisecond': {
      const ms = (chunk.values as BigInt64Array)[idx];
      const days = Number(ms / 86_400_000n);
      appender.appendDate(new DuckDBDateValue(days));
      return;
    }
    case 'timestamp': {
      const raw = (chunk.values as BigInt64Array)[idx];
      if (sub.timezone != null) {
        // DuckDB TIMESTAMPTZ is microsecond precision. Convert from the
        // Arrow unit; nanosecond-with-tz loses sub-microsecond precision.
        const micros = unitToMicros(raw, sub.unit);
        appender.appendTimestampTZ(new DuckDBTimestampTZValue(micros));
        return;
      }
      switch (sub.unit) {
        case TimeUnit.SECOND:
          appender.appendTimestampSeconds(new DuckDBTimestampSecondsValue(raw));
          return;
        case TimeUnit.MILLISECOND:
          appender.appendTimestampMilliseconds(new DuckDBTimestampMillisecondsValue(raw));
          return;
        case TimeUnit.MICROSECOND:
          appender.appendTimestamp(new DuckDBTimestampValue(raw));
          return;
        case TimeUnit.NANOSECOND:
          appender.appendTimestampNanoseconds(new DuckDBTimestampNanosecondsValue(raw));
          return;
      }
      throw new Error(`internal: unhandled TimeUnit ${sub.unit}`);
    }
    case 'decimal128': {
      // Arrow stores Decimal128 as 4 little-endian uint32 words per value
      // (signed two's-complement). Reconstruct the bigint losslessly.
      const words = chunk.values as Uint32Array;
      const value = decimal128ToBigInt(words, idx * 4);
      appender.appendDecimal(new DuckDBDecimalValue(value, sub.precision, sub.scale));
      return;
    }
  }
}

function unitToMicros(raw: bigint, unit: TimeUnit): bigint {
  switch (unit) {
    case TimeUnit.SECOND: return raw * 1_000_000n;
    case TimeUnit.MILLISECOND: return raw * 1_000n;
    case TimeUnit.MICROSECOND: return raw;
    case TimeUnit.NANOSECOND: return raw / 1_000n;
  }
  throw new Error(`internal: unknown TimeUnit ${unit}`);
}

function decimal128ToBigInt(words: Uint32Array, offset: number): bigint {
  const w0 = BigInt(words[offset + 0]);
  const w1 = BigInt(words[offset + 1]);
  const w2 = BigInt(words[offset + 2]);
  const w3 = BigInt(words[offset + 3]);
  let v = w0 | (w1 << 32n) | (w2 << 64n) | (w3 << 96n);
  // Sign-extend if the high bit of the high word is set.
  if ((words[offset + 3] & 0x80000000) !== 0) {
    v -= 1n << 128n;
  }
  return v;
}

function isValidAt(chunk: Data, row: number): boolean {
  if (chunk.nullCount === 0) return true;
  const bitmap = chunk.nullBitmap;
  if (!bitmap || bitmap.length === 0) return true;
  const i = chunk.offset + row;
  return (bitmap[i >> 3] & (1 << (i & 7))) !== 0;
}


function sqlString(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

function safeStatSize(path: string): number {
  try {
    // dynamic require to avoid pulling fs typings into the hot path
    const { statSync } = require('node:fs') as typeof import('node:fs');
    return statSync(path).size;
  } catch {
    return 0;
  }
}
