// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse as yamlParse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeOrreryProjectFiles } from '../src/orrery_project.js';
import type { ColumnPlan } from '../src/arrow_types.js';

const PLAN: ColumnPlan[] = [
  { name: 'order_id', sqlType: 'INTEGER', arrowTypeId: 0 as never, bigInt: false },
  { name: 'amount', sqlType: 'DOUBLE', arrowTypeId: 0 as never, bigInt: false },
];

describe('writeOrreryProjectFiles', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'armillary-ob-proj-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function call(overrides: Partial<Parameters<typeof writeOrreryProjectFiles>[0]> = {}) {
    return writeOrreryProjectFiles({
      projectDir: dir,
      connectionName: 'armillary_pipelines',
      databaseFile: join(dir, 'data', 'armillary.duckdb'),
      tableName: 'orders',
      plan: PLAN,
      writeDatasetMetadata: true,
      snapshotLabel: null,
      pipelineName: 'sales_rollup',
      nodeName: 'publish_orders',
      ...overrides,
    });
  }

  it('creates connection and dataset files on first run', () => {
    const r = call();
    expect(r.connectionWritten).toBe(true);
    expect(r.datasetWritten).toBe(true);

    const conn = yamlParse(readFileSync(r.connectionFile, 'utf8'));
    expect(conn).toEqual({
      name: 'armillary_pipelines',
      type: 'duckdb',
      path: join('data', 'armillary.duckdb'),
    });

    const ds = yamlParse(readFileSync(r.datasetFile!, 'utf8'));
    expect(ds.name).toBe('orders');
    expect(ds.connection).toBe('armillary_pipelines');
    expect(ds.table).toBe('orders');
    expect(ds.schema).toEqual([
      { name: 'order_id', type: 'INTEGER' },
      { name: 'amount', type: 'DOUBLE' },
    ]);
    expect(ds.source).toEqual({
      type: 'armillary',
      pipeline: 'sales_rollup',
      node: 'publish_orders',
    });
    expect(typeof ds.last_updated).toBe('string');
    expect(ds.snapshot_label).toBeUndefined();
  });

  it('is idempotent — does not rewrite unchanged files', async () => {
    const r1 = call();
    const connMtime = statSync(r1.connectionFile).mtimeMs;
    const dsMtime = statSync(r1.datasetFile!).mtimeMs;
    // Sleep to ensure mtime would change if a write happened.
    await new Promise((res) => setTimeout(res, 20));
    const r2 = call();
    expect(r2.connectionWritten).toBe(false);
    expect(r2.datasetWritten).toBe(false);
    expect(statSync(r1.connectionFile).mtimeMs).toBe(connMtime);
    expect(statSync(r1.datasetFile!).mtimeMs).toBe(dsMtime);
  });

  it('rewrites the connection file when the database path changes', () => {
    call();
    const r2 = call({ databaseFile: join(dir, 'data', 'other.duckdb') });
    expect(r2.connectionWritten).toBe(true);
    const conn = yamlParse(readFileSync(r2.connectionFile, 'utf8'));
    expect(conn.path).toBe(join('data', 'other.duckdb'));
  });

  it('rewrites the dataset file when schema changes', () => {
    call();
    const newPlan: ColumnPlan[] = [
      ...PLAN,
      { name: 'currency', sqlType: 'VARCHAR', arrowTypeId: 0 as never, bigInt: false },
    ];
    const r2 = call({ plan: newPlan });
    expect(r2.datasetWritten).toBe(true);
    const ds = yamlParse(readFileSync(r2.datasetFile!, 'utf8'));
    expect(ds.schema).toHaveLength(3);
  });

  it('records snapshot_label when provided and is idempotent across runs', () => {
    const r1 = call({ snapshotLabel: 'Q1-2026' });
    const ds1 = yamlParse(readFileSync(r1.datasetFile!, 'utf8'));
    expect(ds1.snapshot_label).toBe('Q1-2026');
    const r2 = call({ snapshotLabel: 'Q1-2026' });
    expect(r2.datasetWritten).toBe(false);
    const r3 = call({ snapshotLabel: 'Q2-2026' });
    expect(r3.datasetWritten).toBe(true);
  });

  it('skips dataset metadata when write_dataset_metadata is false', () => {
    const r = call({ writeDatasetMetadata: false });
    expect(r.datasetFile).toBeNull();
    expect(r.datasetWritten).toBe(false);
    expect(r.connectionWritten).toBe(true);
  });

  it('preserves an existing connection file that already matches', () => {
    const connFile = join(dir, 'connections', 'armillary_pipelines.yaml');
    mkdirSync(join(dir, 'connections'), { recursive: true });
    writeFileSync(
      connFile,
      'name: armillary_pipelines\ntype: duckdb\npath: data/armillary.duckdb\n',
      'utf8',
    );
    const r = call();
    expect(r.connectionWritten).toBe(false);
  });

  it('falls back to absolute path when database lives outside the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'armillary-outside-'));
    try {
      const r = call({ databaseFile: join(outside, 'armillary.duckdb') });
      const conn = yamlParse(readFileSync(r.connectionFile, 'utf8'));
      expect(conn.path).toBe(join(outside, 'armillary.duckdb'));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
