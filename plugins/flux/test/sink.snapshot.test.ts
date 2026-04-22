// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Bool, Field, Float64, Int32, Schema, Table, Utf8,
  tableFromArrays, tableToIPC,
} from 'apache-arrow';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OpenBoardSink } from '../src/sink.js';

function schemaBytes(): Uint8Array {
  // Same shape as the core sink tests — order_id/customer/amount/refunded.
  const t = tableFromArrays({
    order_id: Int32Array.from([0]),
    customer: [''],
    amount: Float64Array.from([0]),
    refunded: [false],
  });
  return tableToIPC(t, 'stream');
}
// Keep a typed reference so TS doesn't complain about unused imports.
const _schemaTypes = [new Field('x', new Int32(), false), new Field('y', new Utf8(), false), new Field('z', new Float64(), true), new Field('r', new Bool(), true), new Schema([])];
void _schemaTypes;

function rowsToIPC(rows: Array<{
  order_id: number; customer: string; amount: number; refunded: boolean;
}>): Uint8Array {
  const t: Table = tableFromArrays({
    order_id: Int32Array.from(rows.map((r) => r.order_id)),
    customer: rows.map((r) => r.customer),
    amount: Float64Array.from(rows.map((r) => r.amount)),
    refunded: rows.map((r) => r.refunded),
  });
  return tableToIPC(t, 'stream');
}

async function runSnapshot(
  dir: string,
  rows: Array<{ order_id: number; customer: string; amount: number; refunded: boolean }>,
  hardDeletes: 'ignore' | 'invalidate' | 'delete' = 'invalidate',
): Promise<void> {
  const sink = new OpenBoardSink();
  const ack = await sink.configure({
    sink_type: 'openboard_duckdb',
    config: {
      openboard_project: dir,
      table_name: 'orders',
      database_file: 'data/flux.duckdb',
    },
    input_schema_ipc_b64: Buffer.from(schemaBytes()).toString('base64'),
    materialization: {
      read_mode: 'full',
      write_strategy: 'snapshot',
      unique_keys: ['order_id'],
      snapshot: {
        change_detection: 'check',
        check_columns: ['customer', 'amount', 'refunded'],
        hard_deletes: hardDeletes,
      },
    },
  });
  if (!ack.accepted) {
    throw new Error(`configure rejected: ${ack.reason}`);
  }
  await sink.batch(rowsToIPC(rows));
  await sink.commit();
}

interface TargetRow {
  order_id: number;
  customer: string;
  amount: number;
  refunded: boolean;
  flux_scd_id: string;
  flux_valid_from: unknown;
  flux_valid_to: unknown;
  flux_is_current: boolean;
}

async function readAll(dir: string): Promise<TargetRow[]> {
  const inst = await DuckDBInstance.create(join(dir, 'data/flux.duckdb'));
  const conn = await inst.connect();
  try {
    const reader = await conn.runAndReadAll(
      'SELECT order_id, customer, amount, refunded, flux_scd_id, ' +
        'flux_valid_from::VARCHAR AS flux_valid_from, ' +
        'flux_valid_to::VARCHAR AS flux_valid_to, ' +
        'flux_is_current FROM orders ORDER BY order_id, flux_valid_from',
    );
    return reader.getRowObjects() as unknown as TargetRow[];
  } finally {
    conn.closeSync();
    inst.closeSync();
  }
}

describe('OpenBoardSink — snapshot (SCD2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flux-openboard-snapshot-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs four stage-diff-merge cycles and maintains SCD2 invariants', async () => {
    // ---------- Run 1: insert 3 rows from scratch. ----------
    const baseRows = [
      { order_id: 1, customer: 'alice', amount: 10.0, refunded: false },
      { order_id: 2, customer: 'bob', amount: 20.0, refunded: false },
      { order_id: 3, customer: 'carol', amount: 30.0, refunded: false },
    ];
    await runSnapshot(dir, baseRows);

    let rows = await readAll(dir);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.flux_is_current).toBe(true);
      expect(r.flux_valid_to).toBeNull();
      expect(r.flux_valid_from).not.toBeNull();
      expect(typeof r.flux_scd_id).toBe('string');
      expect((r.flux_scd_id as string).length).toBe(32); // md5 hex
    }
    const firstRunScdIds = new Set(rows.map((r) => r.flux_scd_id));
    expect(firstRunScdIds.size).toBe(3);

    // ---------- Run 2: idempotent — same rows again, nothing should change. ----------
    await runSnapshot(dir, baseRows);
    rows = await readAll(dir);
    expect(rows).toHaveLength(3);
    // Same scd_ids, same is_current / valid_to.
    for (const r of rows) {
      expect(r.flux_is_current).toBe(true);
      expect(r.flux_valid_to).toBeNull();
      expect(firstRunScdIds.has(r.flux_scd_id)).toBe(true);
    }

    // ---------- Run 3: row 2's tracked column changes → close + open new version. ----------
    const changedRows = [
      { order_id: 1, customer: 'alice', amount: 10.0, refunded: false },
      { order_id: 2, customer: 'bob', amount: 99.0, refunded: false }, // amount changed
      { order_id: 3, customer: 'carol', amount: 30.0, refunded: false },
    ];
    await runSnapshot(dir, changedRows);
    rows = await readAll(dir);
    expect(rows).toHaveLength(4);
    const order2 = rows.filter((r) => r.order_id === 2);
    expect(order2).toHaveLength(2);
    const closed = order2.find((r) => r.flux_is_current === false);
    const current = order2.find((r) => r.flux_is_current === true);
    expect(closed).toBeDefined();
    expect(current).toBeDefined();
    expect(closed!.flux_valid_to).not.toBeNull();
    expect(current!.flux_valid_to).toBeNull();
    expect(current!.amount).toBe(99.0);
    expect(closed!.amount).toBe(20.0);
    expect(current!.flux_scd_id).not.toBe(closed!.flux_scd_id);
    // Rows 1 and 3 untouched — still exactly one current version each.
    expect(rows.filter((r) => r.order_id === 1)).toHaveLength(1);
    expect(rows.filter((r) => r.order_id === 3)).toHaveLength(1);

    // ---------- Run 4: row 1 vanishes, hard_deletes=invalidate → close its current. ----------
    const missingRow1 = [
      { order_id: 2, customer: 'bob', amount: 99.0, refunded: false },
      { order_id: 3, customer: 'carol', amount: 30.0, refunded: false },
    ];
    await runSnapshot(dir, missingRow1, 'invalidate');
    rows = await readAll(dir);
    // 1 closed (order 1) + 1 closed (order 2 from run 3) + 1 current (order 2) + 1 current (order 3) = 4 total
    expect(rows).toHaveLength(4);
    const order1 = rows.filter((r) => r.order_id === 1);
    expect(order1).toHaveLength(1);
    expect(order1[0].flux_is_current).toBe(false);
    expect(order1[0].flux_valid_to).not.toBeNull();
    // Orders 2 and 3 should still have exactly one current version each.
    const currentOrder2 = rows.filter((r) => r.order_id === 2 && r.flux_is_current);
    const currentOrder3 = rows.filter((r) => r.order_id === 3 && r.flux_is_current);
    expect(currentOrder2).toHaveLength(1);
    expect(currentOrder3).toHaveLength(1);
  });
});
