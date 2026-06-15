// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

// Orrery project integration — after the sink commits a fresh DuckDB
// file, we (1) ensure a `connections/<name>.yaml` exists pointing at it
// and (2) optionally write a `datasets/<table>.yaml` metadata file so
// dashboards can discover the table.
//
// Orrery exports a *reader* for connection files
// (`@orrery/connections/loader#parseConnectionFile`) but no writer.
// We use the `yaml` package directly (already an Orrery dep) and
// match the on-disk shape of the existing example projects.
//
// All writes are idempotent: we parse the existing file, compare, and
// only rewrite when something actually changed. This keeps git history
// clean for users who check their Orrery project in.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';

import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

import type { ColumnPlan } from './arrow_types.js';

export interface OrreryProjectWriteParams {
  projectDir: string;
  connectionName: string;
  databaseFile: string; // absolute path to the committed .duckdb file
  tableName: string;
  plan: ColumnPlan[];
  writeDatasetMetadata: boolean;
  snapshotLabel: string | null;
  pipelineName?: string | null;
  nodeName?: string | null;
}

export interface OrreryProjectWriteResult {
  connectionFile: string;
  connectionWritten: boolean; // false if existing file already matched
  datasetFile: string | null;
  datasetWritten: boolean;
}

/**
 * Materialize the connection (and optionally dataset metadata) for an
 * Orrery project so dashboards can discover the freshly-written DuckDB
 * file. Caller is expected to invoke this *after* the atomic rename so we
 * never advertise a half-written file.
 */
export function writeOrreryProjectFiles(
  params: OrreryProjectWriteParams,
): OrreryProjectWriteResult {
  if (!params.projectDir) {
    throw new Error('orrery project directory is empty');
  }
  mkdirSync(params.projectDir, { recursive: true });

  const connectionFile = join(
    params.projectDir,
    'connections',
    `${params.connectionName}.yaml`,
  );
  const connectionWritten = writeConnectionFile(
    connectionFile,
    params.connectionName,
    params.projectDir,
    params.databaseFile,
  );

  let datasetFile: string | null = null;
  let datasetWritten = false;
  if (params.writeDatasetMetadata) {
    datasetFile = join(params.projectDir, 'datasets', `${params.tableName}.yaml`);
    datasetWritten = writeDatasetMetadata(datasetFile, params);
  }

  return { connectionFile, connectionWritten, datasetFile, datasetWritten };
}

// ---------- connection file ----------

interface ConnectionDoc {
  name: string;
  type: 'duckdb';
  path: string;
}

function writeConnectionFile(
  filePath: string,
  connectionName: string,
  projectDir: string,
  databaseFile: string,
): boolean {
  const desired: ConnectionDoc = {
    name: connectionName,
    type: 'duckdb',
    path: relativeToProject(projectDir, databaseFile),
  };

  if (existsSync(filePath)) {
    let existing: unknown;
    try {
      existing = yamlParse(readFileSync(filePath, 'utf8'));
    } catch (e) {
      throw new Error(
        `failed to parse existing connection file ${filePath}: ${(e as Error).message}`,
      );
    }
    if (connectionEquals(existing, desired)) {
      return false;
    }
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, yamlStringify(desired), 'utf8');
  return true;
}

function connectionEquals(existing: unknown, desired: ConnectionDoc): boolean {
  if (!existing || typeof existing !== 'object') return false;
  const e = existing as Record<string, unknown>;
  return (
    e.name === desired.name &&
    e.type === desired.type &&
    e.path === desired.path
  );
}

// ---------- dataset metadata ----------

interface DatasetDoc {
  name: string;
  connection: string;
  table: string;
  schema: Array<{ name: string; type: string }>;
  last_updated: string;
  snapshot_label?: string;
  source: {
    type: 'armillary';
    pipeline?: string;
    node?: string;
  };
}

function writeDatasetMetadata(
  filePath: string,
  params: OrreryProjectWriteParams,
): boolean {
  const desired: DatasetDoc = {
    name: params.tableName,
    connection: params.connectionName,
    table: params.tableName,
    schema: params.plan.map((c) => ({ name: c.name, type: c.sqlType })),
    last_updated: new Date().toISOString(),
    source: { type: 'armillary' },
  };
  if (params.pipelineName) desired.source.pipeline = params.pipelineName;
  if (params.nodeName) desired.source.node = params.nodeName;
  if (params.snapshotLabel) desired.snapshot_label = params.snapshotLabel;

  // Idempotency: compare ignoring `last_updated` so we don't rewrite the
  // file (and dirty git) on every run when the schema hasn't changed.
  if (existsSync(filePath)) {
    let existing: unknown;
    try {
      existing = yamlParse(readFileSync(filePath, 'utf8'));
    } catch {
      existing = null;
    }
    if (datasetEquals(existing, desired)) {
      return false;
    }
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, yamlStringify(desired), 'utf8');
  return true;
}

function datasetEquals(existing: unknown, desired: DatasetDoc): boolean {
  if (!existing || typeof existing !== 'object') return false;
  const e = existing as Record<string, unknown>;
  if (e.name !== desired.name) return false;
  if (e.connection !== desired.connection) return false;
  if (e.table !== desired.table) return false;
  if (e.snapshot_label !== desired.snapshot_label) return false;
  const eSchema = e.schema as Array<{ name: string; type: string }> | undefined;
  if (!Array.isArray(eSchema) || eSchema.length !== desired.schema.length) return false;
  for (let i = 0; i < eSchema.length; i++) {
    if (eSchema[i]?.name !== desired.schema[i].name) return false;
    if (eSchema[i]?.type !== desired.schema[i].type) return false;
  }
  const eSource = e.source as Record<string, unknown> | undefined;
  if (!eSource || eSource.type !== 'armillary') return false;
  if ((eSource.pipeline ?? undefined) !== (desired.source.pipeline ?? undefined)) return false;
  if ((eSource.node ?? undefined) !== (desired.source.node ?? undefined)) return false;
  return true;
}

// ---------- path helpers ----------

function relativeToProject(projectDir: string, databaseFile: string): string {
  const abs = isAbsolute(databaseFile) ? databaseFile : join(projectDir, databaseFile);
  const rel = relative(projectDir, abs);
  // If the database file lives outside the project, fall back to the
  // absolute path so Orrery can still find it.
  if (rel.startsWith('..')) return abs;
  return rel;
}
