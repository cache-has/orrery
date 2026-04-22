// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Bool, DateDay, Decimal, Field, Float64, Int32, RecordBatch, Schema, Struct,
  Table, TimestampMicrosecond, Utf8, makeData, makeVector,
  tableFromArrays, tableToIPC,
} from 'apache-arrow';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OpenBoardSink } from '../src/sink.js';
import { arrowFieldToDuckDBSql, diffColumnPlans, planColumns } from '../src/arrow_types.js';

function buildSchema(): Schema {
  return new Schema([
    new Field('order_id', new Int32(), false),
    new Field('customer', new Utf8(), false),
    new Field('amount', new Float64(), true),
    new Field('refunded', new Bool(), true),
  ]);
}

function ipcOf(table: Table): Uint8Array {
  return tableToIPC(table, 'stream');
}

function makeBatchTable(rows: Array<{
  order_id: number; customer: string; amount: number; refunded: boolean;
}>): Table {
  return tableFromArrays({
    order_id: Int32Array.from(rows.map((r) => r.order_id)),
    customer: rows.map((r) => r.customer),
    amount: Float64Array.from(rows.map((r) => r.amount)),
    refunded: rows.map((r) => r.refunded),
  });
}

function schemaIpc(): Uint8Array {
  // Build a one-row table to ensure Arrow infers concrete (non-Null) types
  // for every column, then ship the IPC stream as the input schema.
  const t = makeBatchTable([{ order_id: 0, customer: '', amount: 0, refunded: false }]);
  return tableToIPC(t, 'stream');
}

describe('arrow_types', () => {
  it('maps primitive Arrow types to DuckDB SQL types', () => {
    expect(arrowFieldToDuckDBSql(new Field('a', new Int32(), false))).toBe('INTEGER');
    expect(arrowFieldToDuckDBSql(new Field('b', new Float64(), false))).toBe('DOUBLE');
    expect(arrowFieldToDuckDBSql(new Field('c', new Utf8(), false))).toBe('VARCHAR');
    expect(arrowFieldToDuckDBSql(new Field('d', new Bool(), false))).toBe('BOOLEAN');
  });

  it('detects schema mismatches', () => {
    const a = planColumns(new Schema([new Field('x', new Int32(), false)]));
    const b = planColumns(new Schema([new Field('x', new Float64(), false)]));
    expect(diffColumnPlans(a, b)).toMatch(/type mismatch/);
  });
});

describe('OpenBoardSink (replace mode)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flux-openboard-sink-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a fresh DuckDB file via staging + atomic rename', async () => {
    const sink = new OpenBoardSink();
    const schemaIpcBytes = schemaIpc();

    const ack = await sink.configure({
      sink_type: 'openboard_duckdb',
      config: {
        openboard_project: dir,
        table_name: 'orders',
        write_mode: 'replace',
        database_file: 'data/flux.duckdb',
      },
      input_schema_ipc_b64: Buffer.from(schemaIpcBytes).toString('base64'),
    });
    expect(ack).toEqual({ accepted: true });

    const batch = makeBatchTable([
      { order_id: 1, customer: 'alice', amount: 12.5, refunded: false },
      { order_id: 2, customer: 'bob', amount: 99.0, refunded: true },
    ]);
    const batchAck = await sink.batch(ipcOf(batch));
    expect(batchAck.rows_accepted).toBe(2);

    const commit = await sink.commit();
    expect(commit.rows).toBe(2);
    expect(existsSync(join(dir, 'data/flux.duckdb'))).toBe(true);

    // No staging files left behind.
    const dataEntries = readdirSync(join(dir, 'data'));
    expect(dataEntries.filter((n) => n.includes('staging-'))).toEqual([]);

    // Verify the data via a fresh DuckDB connection.
    const inst = await DuckDBInstance.create(join(dir, 'data/flux.duckdb'));
    const conn = await inst.connect();
    try {
      const reader = await conn.runAndReadAll('SELECT order_id, customer FROM orders ORDER BY order_id');
      const rows = reader.getRowObjects() as Array<{ order_id: number; customer: string }>;
      expect(rows).toEqual([
        { order_id: 1, customer: 'alice' },
        { order_id: 2, customer: 'bob' },
      ]);
    } finally {
      conn.closeSync();
      inst.closeSync();
    }
  });

  it('append mode preserves existing rows and adds new ones', async () => {
    const targetPath = join(dir, 'data', 'flux.duckdb');
    mkdirSync(join(dir, 'data'), { recursive: true });
    // Pre-create the target with the same schema and one row.
    {
      const inst = await DuckDBInstance.create(targetPath);
      const conn = await inst.connect();
      await conn.run(
        'CREATE TABLE orders (order_id INTEGER, customer VARCHAR, amount DOUBLE, refunded BOOLEAN);' +
          " INSERT INTO orders VALUES (1, 'alice', 10.0, false)",
      );
      conn.closeSync();
      inst.closeSync();
    }

    const sink = new OpenBoardSink();
    await sink.configure({
      sink_type: 'openboard_duckdb',
      config: {
        openboard_project: dir,
        table_name: 'orders',
        write_mode: 'append',
        database_file: 'data/flux.duckdb',
      },
      input_schema_ipc_b64: Buffer.from(schemaIpc()).toString('base64'),
    });
    await sink.batch(ipcOf(makeBatchTable([
      { order_id: 2, customer: 'bob', amount: 20.0, refunded: false },
    ])));
    const commit = await sink.commit();
    expect(commit.rows).toBe(1);

    const inst = await DuckDBInstance.create(targetPath);
    const conn = await inst.connect();
    try {
      const reader = await conn.runAndReadAll('SELECT order_id FROM orders ORDER BY order_id');
      expect(reader.getRowObjects()).toEqual([{ order_id: 1 }, { order_id: 2 }]);
    } finally {
      conn.closeSync();
      inst.closeSync();
    }
  });

  it('upsert mode replaces rows with matching keys (last write wins)', async () => {
    const targetPath = join(dir, 'data', 'flux.duckdb');
    mkdirSync(join(dir, 'data'), { recursive: true });
    {
      const inst = await DuckDBInstance.create(targetPath);
      const conn = await inst.connect();
      await conn.run(
        'CREATE TABLE orders (order_id INTEGER, customer VARCHAR, amount DOUBLE, refunded BOOLEAN);' +
          " INSERT INTO orders VALUES (1, 'alice', 10.0, false), (2, 'bob', 20.0, false)",
      );
      conn.closeSync();
      inst.closeSync();
    }

    const sink = new OpenBoardSink();
    await sink.configure({
      sink_type: 'openboard_duckdb',
      config: {
        openboard_project: dir,
        table_name: 'orders',
        write_mode: 'upsert',
        upsert_keys: ['order_id'],
        database_file: 'data/flux.duckdb',
      },
      input_schema_ipc_b64: Buffer.from(schemaIpc()).toString('base64'),
    });
    // Update order_id=1 (amount 10 → 99) and insert order_id=3.
    await sink.batch(ipcOf(makeBatchTable([
      { order_id: 1, customer: 'alice', amount: 99.0, refunded: true },
      { order_id: 3, customer: 'carol', amount: 30.0, refunded: false },
    ])));
    await sink.commit();

    const inst = await DuckDBInstance.create(targetPath);
    const conn = await inst.connect();
    try {
      const reader = await conn.runAndReadAll(
        'SELECT order_id, amount, refunded FROM orders ORDER BY order_id',
      );
      expect(reader.getRowObjects()).toEqual([
        { order_id: 1, amount: 99.0, refunded: true },
        { order_id: 2, amount: 20.0, refunded: false },
        { order_id: 3, amount: 30.0, refunded: false },
      ]);
    } finally {
      conn.closeSync();
      inst.closeSync();
    }
  });

  it('append mode rejects at configure when target schema differs', async () => {
    const targetPath = join(dir, 'data', 'flux.duckdb');
    mkdirSync(join(dir, 'data'), { recursive: true });
    {
      const inst = await DuckDBInstance.create(targetPath);
      const conn = await inst.connect();
      // Note: order_id is BIGINT here, but the incoming schema uses INTEGER.
      await conn.run('CREATE TABLE orders (order_id BIGINT, customer VARCHAR, amount DOUBLE, refunded BOOLEAN)');
      conn.closeSync();
      inst.closeSync();
    }

    const sink = new OpenBoardSink();
    const ack = await sink.configure({
      sink_type: 'openboard_duckdb',
      config: {
        openboard_project: dir,
        table_name: 'orders',
        write_mode: 'append',
        database_file: 'data/flux.duckdb',
      },
      input_schema_ipc_b64: Buffer.from(schemaIpc()).toString('base64'),
    });
    expect(ack.accepted).toBe(false);
    const reason = (ack as { accepted: false; reason?: string }).reason ?? '';
    expect(reason).toMatch(/schema does not match/i);
  });

  it('configure cleans up orphan staging files left behind by a prior crash', async () => {
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir, { recursive: true });
    // Create a stale staging sibling that looks like a crashed prior run.
    const orphan = join(dataDir, 'flux.duckdb.staging-DEADBEEF.duckdb');
    writeFileSync(orphan, 'garbage');
    expect(existsSync(orphan)).toBe(true);

    const sink = new OpenBoardSink();
    await sink.configure({
      sink_type: 'openboard_duckdb',
      config: {
        openboard_project: dir,
        table_name: 'orders',
        write_mode: 'replace',
        database_file: 'data/flux.duckdb',
      },
      input_schema_ipc_b64: Buffer.from(schemaIpc()).toString('base64'),
    });
    expect(existsSync(orphan)).toBe(false);
    await sink.abort();
  });

  it('round-trips Decimal128, Date32, and Timestamp(us) losslessly', async () => {
    // Build an Arrow Table by hand so we can use Decimal/Date/Timestamp
    // types that tableFromArrays can't infer. Each column is one Data
    // chunk, then we wrap them in a Struct-typed parent and a RecordBatch.
    const decimalType = new Decimal(2, 5); // scale=2, precision=5 → numeric(5,2)
    // Two values: 12.50 (scaled 1250) and 99.00 (scaled 9900). Each takes
    // 4 little-endian u32 words.
    const decimalWords = new Uint32Array([
      1250, 0, 0, 0,
      9900, 0, 0, 0,
    ]);
    const decimalData = makeData({
      type: decimalType,
      length: 2,
      nullCount: 0,
      data: decimalWords,
    });

    const dateType = new DateDay();
    // 2026-01-01 and 2026-01-02 expressed as days since 1970-01-01.
    const day0 = Math.floor(Date.UTC(2026, 0, 1) / 86_400_000);
    const dateData = makeData({
      type: dateType,
      length: 2,
      nullCount: 0,
      data: new Int32Array([day0, day0 + 1]),
    });

    const tsType = new TimestampMicrosecond();
    const usAtMidnightJan1 = BigInt(Date.UTC(2026, 0, 1)) * 1000n;
    const tsData = makeData({
      type: tsType,
      length: 2,
      nullCount: 0,
      data: new BigInt64Array([usAtMidnightJan1, usAtMidnightJan1 + 1n]),
    });

    const fields = [
      new Field('amount', decimalType, false),
      new Field('day', dateType, false),
      new Field('ts', tsType, false),
    ];
    const schema = new Schema(fields);
    const structData = makeData({
      type: new Struct(fields),
      length: 2,
      nullCount: 0,
      children: [decimalData, dateData, tsData],
    });
    const batch = new RecordBatch(schema, structData);
    const table = new Table([batch]);

    const sink = new OpenBoardSink();
    const ack = await sink.configure({
      sink_type: 'openboard_duckdb',
      config: {
        openboard_project: dir,
        table_name: 'temporal',
        write_mode: 'replace',
        database_file: 'data/flux.duckdb',
      },
      input_schema_ipc_b64: Buffer.from(tableToIPC(table, 'stream')).toString('base64'),
    });
    expect(ack).toEqual({ accepted: true });
    expect((await sink.batch(tableToIPC(table, 'stream'))).rows_accepted).toBe(2);
    expect((await sink.commit()).rows).toBe(2);

    // Verify what actually landed via a fresh DuckDB connection. Cast
    // everything to VARCHAR so the assertion doesn't depend on the
    // node-api's choice of JS representation for these types.
    const inst = await DuckDBInstance.create(join(dir, 'data/flux.duckdb'));
    const conn = await inst.connect();
    try {
      const reader = await conn.runAndReadAll(
        "SELECT amount::VARCHAR AS amount, day::VARCHAR AS day, ts::VARCHAR AS ts FROM temporal ORDER BY day",
      );
      expect(reader.getRowObjects()).toEqual([
        { amount: '12.50', day: '2026-01-01', ts: '2026-01-01 00:00:00' },
        { amount: '99.00', day: '2026-01-02', ts: '2026-01-01 00:00:00.000001' },
      ]);

      // And confirm the column types DuckDB created match our intent.
      const types = await conn.runAndReadAll(
        "SELECT data_type FROM information_schema.columns WHERE table_name = 'temporal' ORDER BY ordinal_position",
      );
      expect(types.getRowObjects()).toEqual([
        { data_type: 'DECIMAL(5,2)' },
        { data_type: 'DATE' },
        { data_type: 'TIMESTAMP' },
      ]);
    } finally {
      conn.closeSync();
      inst.closeSync();
    }
  });

  it('abort cleans up the staging file and leaves the target untouched', async () => {
    // Pre-create a target file with sentinel content via DuckDB.
    const targetPath = join(dir, 'data', 'flux.duckdb');
    require('node:fs').mkdirSync(join(dir, 'data'), { recursive: true });
    {
      const inst = await DuckDBInstance.create(targetPath);
      const conn = await inst.connect();
      await conn.run('CREATE TABLE sentinel(x INTEGER); INSERT INTO sentinel VALUES (42)');
      conn.closeSync();
      inst.closeSync();
    }

    const sink = new OpenBoardSink();
    const schemaIpcBytes = schemaIpc();
    await sink.configure({
      sink_type: 'openboard_duckdb',
      config: {
        openboard_project: dir,
        table_name: 'orders',
        write_mode: 'replace',
        database_file: 'data/flux.duckdb',
      },
      input_schema_ipc_b64: Buffer.from(schemaIpcBytes).toString('base64'),
    });
    await sink.abort();

    // staging file gone, target sentinel still readable
    const stagingLeft = readdirSync(join(dir, 'data')).filter((n) => n.includes('staging-'));
    expect(stagingLeft).toEqual([]);
    const inst = await DuckDBInstance.create(targetPath);
    const conn = await inst.connect();
    try {
      const reader = await conn.runAndReadAll('SELECT x FROM sentinel');
      expect(reader.getRowObjects()).toEqual([{ x: 42 }]);
    } finally {
      conn.closeSync();
      inst.closeSync();
    }
  });
});
