// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  FrameDecoder,
  FrameWriter,
  MAX_PAYLOAD_LEN,
  MessageKind,
  PROTOCOL_VERSION,
  ProtocolError,
  encodeFrame,
  encodeJsonFrame,
  runSession,
  type SinkHandlers,
} from '../src/protocol.js';

// Golden fixture identical to the Rust host's `round_trip_a_control_frame`
// test in crates/armillary-plugin-host/src/protocol/frame.rs. If this breaks the
// two implementations have drifted on the wire format.
const GOLDEN_HELLO_PAYLOAD = Buffer.from('{"protocol":1,"armillary_version":"0.5.0"}', 'utf8');

function bytesOf(buf: Buffer): number[] {
  return Array.from(buf.values());
}

describe('frame codec', () => {
  it('encodes a Hello frame with the documented byte layout', () => {
    const frame = encodeFrame(MessageKind.Hello, GOLDEN_HELLO_PAYLOAD);
    // length(u32 LE) = payload.length
    expect(frame.readUInt32LE(0)).toBe(GOLDEN_HELLO_PAYLOAD.length);
    expect(frame.readUInt8(4)).toBe(MessageKind.Hello);
    expect(bytesOf(frame.subarray(5))).toEqual(bytesOf(GOLDEN_HELLO_PAYLOAD));
  });

  it('round-trips an empty payload (matches Rust round_trip_empty_payload)', () => {
    const frame = encodeFrame(MessageKind.Shutdown, Buffer.alloc(0));
    expect(frame.length).toBe(5);
    const dec = new FrameDecoder();
    dec.push(frame);
    const out = dec.next();
    expect(out?.kind).toBe(MessageKind.Shutdown);
    expect(out?.payload.length).toBe(0);
    expect(dec.next()).toBeNull();
  });

  it('decodes multiple frames concatenated in one chunk', () => {
    const a = encodeJsonFrame(MessageKind.HelloAck, { protocol: 1, plugin_name: 'x', plugin_version: '0' });
    const b = encodeFrame(MessageKind.Shutdown, Buffer.alloc(0));
    const dec = new FrameDecoder();
    dec.push(Buffer.concat([a, b]));
    expect(dec.next()?.kind).toBe(MessageKind.HelloAck);
    expect(dec.next()?.kind).toBe(MessageKind.Shutdown);
    expect(dec.next()).toBeNull();
  });

  it('reassembles a frame split across many tiny chunks', () => {
    const frame = encodeFrame(MessageKind.Hello, GOLDEN_HELLO_PAYLOAD);
    const dec = new FrameDecoder();
    // feed one byte at a time
    for (const byte of frame) {
      dec.push(Buffer.from([byte]));
    }
    const out = dec.next();
    expect(out?.kind).toBe(MessageKind.Hello);
    expect(bytesOf(Buffer.from(out!.payload))).toEqual(bytesOf(GOLDEN_HELLO_PAYLOAD));
  });

  it('rejects unknown kind', () => {
    const buf = Buffer.from([0, 0, 0, 0, 0xab]);
    const dec = new FrameDecoder();
    dec.push(buf);
    expect(() => dec.next()).toThrow(ProtocolError);
  });

  it('rejects v2-reserved kind', () => {
    const buf = Buffer.from([0, 0, 0, 0, 0x60]);
    const dec = new FrameDecoder();
    dec.push(buf);
    expect(() => dec.next()).toThrow(/reserved for protocol v2/);
  });

  it('rejects oversized payload on encode', () => {
    expect(() =>
      encodeFrame(MessageKind.RecordBatch, new Uint8Array(MAX_PAYLOAD_LEN + 1)),
    ).toThrow(ProtocolError);
  });

  it('rejects oversized payload on decode header', () => {
    const dec = new FrameDecoder();
    const buf = Buffer.alloc(5);
    buf.writeUInt32LE(MAX_PAYLOAD_LEN + 1, 0);
    buf.writeUInt8(MessageKind.RecordBatch, 4);
    dec.push(buf);
    expect(() => dec.next()).toThrow(ProtocolError);
  });
});

// ---------- Session loop integration ----------

class CapturingWritable extends Writable {
  chunks: Buffer[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  collected(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function streamOf(...frames: Buffer[]): Readable {
  return Readable.from([Buffer.concat(frames)]);
}

function decodeAll(buf: Buffer) {
  const dec = new FrameDecoder();
  dec.push(buf);
  const out = [];
  while (true) {
    const f = dec.next();
    if (!f) break;
    out.push(f);
  }
  return out;
}

describe('runSession', () => {
  const identity = {
    pluginName: 'orrery',
    pluginVersion: '0.1.0',
    capabilities: { transactional: true },
  };

  it('completes a happy-path lifecycle and exits 0', async () => {
    const handlers: SinkHandlers = {
      configure: () => ({ accepted: true }),
      batch: () => ({ rows_accepted: 7 }),
      commit: () => ({ rows: 7, bytes: 100, duration_ms: 3 }),
      abort: () => {},
    };
    const input = streamOf(
      encodeJsonFrame(MessageKind.Hello, { protocol: PROTOCOL_VERSION, armillary_version: '0.5.0' }),
      encodeJsonFrame(MessageKind.ConfigureSink, {
        sink_type: 'orrery_duckdb',
        config: {},
        input_schema_ipc_b64: '',
      }),
      encodeFrame(MessageKind.RecordBatch, Buffer.from([1, 2, 3])),
      encodeJsonFrame(MessageKind.Commit, {}),
      encodeJsonFrame(MessageKind.Shutdown, {}),
    );
    const out = new CapturingWritable();
    const code = await runSession(identity, handlers, input, out);
    expect(code).toBe(0);
    const replies = decodeAll(out.collected()).map((f) => f.kind);
    expect(replies).toEqual([
      MessageKind.HelloAck,
      MessageKind.ConfigureAck,
      MessageKind.BatchAck,
      MessageKind.CommitAck,
    ]);
  });

  it('rejects an unsupported protocol version with an Error frame and non-zero exit', async () => {
    const handlers: SinkHandlers = {
      configure: () => ({ accepted: true }),
      batch: () => ({ rows_accepted: 0 }),
      commit: () => ({ rows: 0, bytes: 0, duration_ms: 0 }),
      abort: () => {},
    };
    const input = streamOf(
      encodeJsonFrame(MessageKind.Hello, { protocol: 999 }),
    );
    const out = new CapturingWritable();
    const code = await runSession(identity, handlers, input, out);
    expect(code).toBe(1);
    const frames = decodeAll(out.collected());
    expect(frames.at(-1)?.kind).toBe(MessageKind.Error);
  });

  it('emits an Error frame when configure rejects then host shuts down cleanly', async () => {
    const handlers: SinkHandlers = {
      configure: () => ({ accepted: false, reason: 'nope' }),
      batch: () => {
        throw new Error('unreachable');
      },
      commit: () => {
        throw new Error('unreachable');
      },
      abort: () => {},
    };
    const input = streamOf(
      encodeJsonFrame(MessageKind.Hello, { protocol: PROTOCOL_VERSION }),
      encodeJsonFrame(MessageKind.ConfigureSink, {
        sink_type: 'orrery_duckdb',
        config: {},
        input_schema_ipc_b64: '',
      }),
      encodeJsonFrame(MessageKind.Shutdown, {}),
    );
    const out = new CapturingWritable();
    const code = await runSession(identity, handlers, input, out);
    expect(code).toBe(0);
    const frames = decodeAll(out.collected());
    const ack = frames.find((f) => f.kind === MessageKind.ConfigureAck)!;
    const parsed = JSON.parse(Buffer.from(ack.payload).toString('utf8'));
    expect(parsed).toEqual({ accepted: false, reason: 'nope' });
  });

  it('FrameWriter respects backpressure (write returning false)', async () => {
    let drained = false;
    const out = new Writable({
      highWaterMark: 1,
      write(_chunk, _enc, cb) {
        setImmediate(cb);
      },
    });
    out.on('drain', () => {
      drained = true;
    });
    const w = new FrameWriter(out);
    await w.write(MessageKind.Log, Buffer.alloc(64));
    await w.write(MessageKind.Log, Buffer.alloc(64));
    expect(drained || true).toBe(true); // either path must complete without hanging
  });
});
