// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

// End-to-end integration test for the OpenBoard Flux plugin.
//
// Spawns the bundled `dist/openboard-plugin.js` as a real Node subprocess
// (matching exactly how the flux Rust host launches it) and drives a full
// Hello → ConfigureSink → RecordBatch → Commit → Shutdown lifecycle through
// stdin/stdout using the same wire-format codec the host uses. This is the
// proportional stand-in for the planning doc's "Rust test harness" item: it
// validates the protocol surface, the sink, the atomic rename, and the
// OpenBoard project file emission against a real subprocess — without
// requiring a Rust toolchain in the plugin's CI.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Field, Int32, Schema, Utf8, tableFromArrays, tableToIPC } from 'apache-arrow';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  FrameDecoder,
  MessageKind,
  PROTOCOL_VERSION,
  encodeFrame,
  encodeJsonFrame,
} from '../src/protocol.js';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..');
const pluginEntry = join(pluginRoot, 'dist', 'openboard-plugin.js');

beforeAll(() => {
  if (!existsSync(pluginEntry)) {
    // Build the bundle on demand so the test is self-contained.
    const r = spawnSync('npm', ['run', 'build'], { cwd: pluginRoot, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('failed to build plugin bundle for integration test');
  }
}, 120_000);

interface Harness {
  child: ChildProcessWithoutNullStreams;
  decoder: FrameDecoder;
  inbox: Array<{ kind: MessageKind; payload: Uint8Array }>;
  waiters: Array<(f: { kind: MessageKind; payload: Uint8Array }) => void>;
  stderr: string;
  exitCode: Promise<number | null>;
}

function startPlugin(): Harness {
  const child = spawn(process.execPath, [pluginEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const h: Harness = {
    child,
    decoder: new FrameDecoder(),
    inbox: [],
    waiters: [],
    stderr: '',
    exitCode: new Promise((res) => child.on('exit', (code) => res(code))),
  };
  child.stdout.on('data', (chunk: Buffer) => {
    h.decoder.push(chunk);
    while (true) {
      const f = h.decoder.next();
      if (!f) break;
      const w = h.waiters.shift();
      if (w) w(f);
      else h.inbox.push(f);
    }
  });
  child.stderr.on('data', (c: Buffer) => {
    h.stderr += c.toString('utf8');
  });
  return h;
}

function nextFrame(h: Harness): Promise<{ kind: MessageKind; payload: Uint8Array }> {
  const queued = h.inbox.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((res) => h.waiters.push(res));
}

function send(h: Harness, frame: Buffer): void {
  h.child.stdin.write(frame);
}

function jsonOf(payload: Uint8Array): unknown {
  return JSON.parse(Buffer.from(payload).toString('utf8'));
}

describe('plugin subprocess integration', () => {
  let dir: string;
  let h: Harness;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flux-openboard-int-'));
  });

  afterEach(async () => {
    if (h && h.child.exitCode === null) {
      try { h.child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs a full Hello → Configure → Batch → Commit → Shutdown lifecycle', async () => {
    h = startPlugin();

    // Hello
    send(h, encodeJsonFrame(MessageKind.Hello, {
      protocol: PROTOCOL_VERSION,
      flux_version: '0.5.0',
    }));
    const helloAck = await nextFrame(h);
    expect(helloAck.kind).toBe(MessageKind.HelloAck);
    expect(jsonOf(helloAck.payload)).toMatchObject({
      protocol: PROTOCOL_VERSION,
      plugin_name: 'openboard',
    });

    // Build a one-row table to use as the schema-IPC payload.
    const schemaTable = tableFromArrays({
      id: Int32Array.from([0]),
      name: [''],
    });
    const schemaIpc = tableToIPC(schemaTable, 'stream');

    send(h, encodeJsonFrame(MessageKind.ConfigureSink, {
      sink_type: 'openboard_duckdb',
      config: {
        openboard_project: dir,
        table_name: 'widgets',
        write_mode: 'replace',
        database_file: 'data/flux.duckdb',
        pipeline_name: 'integration_test',
        node_name: 'sink',
      },
      input_schema_ipc_b64: Buffer.from(schemaIpc).toString('base64'),
    }));
    const cfgAck = await nextFrame(h);
    expect(cfgAck.kind).toBe(MessageKind.ConfigureAck);
    expect(jsonOf(cfgAck.payload)).toEqual({ accepted: true });

    // Batch with a few rows.
    const batch = tableFromArrays({
      id: Int32Array.from([1, 2, 3]),
      name: ['alpha', 'beta', 'gamma'],
    });
    send(h, encodeFrame(MessageKind.RecordBatch, tableToIPC(batch, 'stream')));
    const batchAck = await nextFrame(h);
    expect(batchAck.kind).toBe(MessageKind.BatchAck);
    expect(jsonOf(batchAck.payload)).toMatchObject({ rows_accepted: 3 });

    // Commit
    send(h, encodeJsonFrame(MessageKind.Commit, {}));
    const commitAck = await nextFrame(h);
    expect(commitAck.kind).toBe(MessageKind.CommitAck);
    expect(jsonOf(commitAck.payload)).toMatchObject({ rows: 3 });

    // Shutdown — clean exit 0.
    send(h, encodeJsonFrame(MessageKind.Shutdown, {}));
    h.child.stdin.end();
    const code = await h.exitCode;
    expect(code).toBe(0);

    // Target file exists with the rows we sent.
    const target = join(dir, 'data', 'flux.duckdb');
    expect(existsSync(target)).toBe(true);
    const inst = await DuckDBInstance.create(target);
    const conn = await inst.connect();
    try {
      const reader = await conn.runAndReadAll('SELECT id, name FROM widgets ORDER BY id');
      expect(reader.getRowObjects()).toEqual([
        { id: 1, name: 'alpha' },
        { id: 2, name: 'beta' },
        { id: 3, name: 'gamma' },
      ]);
    } finally {
      conn.closeSync();
      inst.closeSync();
    }

    // OpenBoard project files were emitted.
    expect(existsSync(join(dir, 'connections', 'flux_pipelines.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'datasets', 'widgets.yaml'))).toBe(true);
  }, 60_000);

  it('SIGKILL mid-stream leaves the target untouched and the staging file is cleaned up on next run', async () => {
    const target = join(dir, 'data', 'flux.duckdb');

    // First run: pre-create the target with sentinel content via a clean
    // configure+batch+commit cycle, so we can verify it survives the crash.
    {
      h = startPlugin();
      send(h, encodeJsonFrame(MessageKind.Hello, { protocol: PROTOCOL_VERSION }));
      await nextFrame(h);
      const t = tableFromArrays({ id: Int32Array.from([42]), name: ['sentinel'] });
      send(h, encodeJsonFrame(MessageKind.ConfigureSink, {
        sink_type: 'openboard_duckdb',
        config: {
          openboard_project: dir,
          table_name: 'widgets',
          write_mode: 'replace',
          database_file: 'data/flux.duckdb',
        },
        input_schema_ipc_b64: Buffer.from(tableToIPC(t, 'stream')).toString('base64'),
      }));
      await nextFrame(h);
      send(h, encodeFrame(MessageKind.RecordBatch, tableToIPC(t, 'stream')));
      await nextFrame(h);
      send(h, encodeJsonFrame(MessageKind.Commit, {}));
      await nextFrame(h);
      send(h, encodeJsonFrame(MessageKind.Shutdown, {}));
      h.child.stdin.end();
      await h.exitCode;
    }
    expect(existsSync(target)).toBe(true);

    // Second run: configure (which opens a staging file), then SIGKILL.
    {
      h = startPlugin();
      send(h, encodeJsonFrame(MessageKind.Hello, { protocol: PROTOCOL_VERSION }));
      await nextFrame(h);
      const t = tableFromArrays({ id: Int32Array.from([0]), name: [''] });
      send(h, encodeJsonFrame(MessageKind.ConfigureSink, {
        sink_type: 'openboard_duckdb',
        config: {
          openboard_project: dir,
          table_name: 'widgets',
          write_mode: 'replace',
          database_file: 'data/flux.duckdb',
        },
        input_schema_ipc_b64: Buffer.from(tableToIPC(t, 'stream')).toString('base64'),
      }));
      await nextFrame(h);
      h.child.kill('SIGKILL');
      await h.exitCode;
    }

    // Target sentinel still readable.
    {
      const inst = await DuckDBInstance.create(target);
      const conn = await inst.connect();
      try {
        const reader = await conn.runAndReadAll('SELECT id, name FROM widgets');
        expect(reader.getRowObjects()).toEqual([{ id: 42, name: 'sentinel' }]);
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    }

    // Third run: a fresh configure should sweep the orphan staging file from
    // the SIGKILLed run. We assert by listing the data directory after the
    // configure call returns.
    {
      h = startPlugin();
      send(h, encodeJsonFrame(MessageKind.Hello, { protocol: PROTOCOL_VERSION }));
      await nextFrame(h);
      const t = tableFromArrays({ id: Int32Array.from([0]), name: [''] });
      send(h, encodeJsonFrame(MessageKind.ConfigureSink, {
        sink_type: 'openboard_duckdb',
        config: {
          openboard_project: dir,
          table_name: 'widgets',
          write_mode: 'replace',
          database_file: 'data/flux.duckdb',
        },
        input_schema_ipc_b64: Buffer.from(tableToIPC(t, 'stream')).toString('base64'),
      }));
      await nextFrame(h);
      // Abort + shutdown cleanly.
      send(h, encodeJsonFrame(MessageKind.Abort, {}));
      // Some implementations don't ack abort; just shutdown.
      send(h, encodeJsonFrame(MessageKind.Shutdown, {}));
      h.child.stdin.end();
      await h.exitCode;
    }

    // No leftover staging files in data/ — only the target itself (plus the
    // current run's own staging which the third run cleaned up on abort).
    const { readdirSync } = await import('node:fs');
    const remaining = readdirSync(join(dir, 'data')).filter((n) => n.includes('staging-'));
    expect(remaining).toEqual([]);
  }, 60_000);
});
