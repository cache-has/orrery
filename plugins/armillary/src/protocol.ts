// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

// Wire protocol client for Armillary plugins (v1).
//
// Mirrors crates/armillary-plugin-host/src/protocol/{frame,control}.rs in the
// armillary repo. Frame layout:
//
//   +----------------+--------+----------------+
//   | length (u32 LE)|  kind  |    payload     |
//   +----------------+--------+----------------+
//
// `length` covers only the payload (not itself, not the kind byte). All
// control payloads are UTF-8 JSON; RecordBatch payloads are Arrow IPC stream
// bytes carrying exactly one batch.

import type { Readable, Writable } from 'node:stream';

export const PROTOCOL_VERSION = 1;
export const MAX_PAYLOAD_LEN = 0x0400_0000; // 64 MiB, must match Rust host

export enum MessageKind {
  Hello = 0x01,
  HelloAck = 0x02,
  ConfigureSink = 0x10,
  ConfigureAck = 0x11,
  RecordBatch = 0x20,
  BatchAck = 0x21,
  Commit = 0x30,
  CommitAck = 0x31,
  Abort = 0x40,
  AbortAck = 0x41,
  Log = 0x50,
  Error = 0x51,
  Shutdown = 0xf0,
}

export function isReservedV2Kind(byte: number): boolean {
  return byte >= 0x60 && byte <= 0x8f;
}

export function knownKind(byte: number): MessageKind | null {
  switch (byte) {
    case 0x01:
    case 0x02:
    case 0x10:
    case 0x11:
    case 0x20:
    case 0x21:
    case 0x30:
    case 0x31:
    case 0x40:
    case 0x41:
    case 0x50:
    case 0x51:
    case 0xf0:
      return byte as MessageKind;
    default:
      return null;
  }
}

export interface Frame {
  kind: MessageKind;
  payload: Uint8Array;
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

// ---------- Control message shapes ----------

export interface HelloPayload {
  protocol: number;
  armillary_version?: string;
}

export interface Capabilities {
  transactional?: boolean;
  upsert?: boolean;
  schema_validation?: boolean;
}

export interface HelloAckPayload {
  protocol: number;
  plugin_name: string;
  plugin_version: string;
  capabilities?: Capabilities;
}

export interface ConfigureSinkPayload {
  sink_type: string;
  config: unknown;
  input_schema_ipc_b64: string;
  /**
   * Optional MaterializationPolicy forwarded by the armillary host when the sink
   * node declares a `materialization` block. Mirrors the Rust
   * `ConfigureSink.materialization` field (see
   * `crates/armillary-plugin-protocol/src/control.rs`). Shape is the JSON
   * serialization of `armillary_engine::materialization::MaterializationPolicy`;
   * this plugin parses the fields it cares about (write_strategy,
   * unique_keys, snapshot.*) and ignores the rest.
   */
  materialization?: unknown;
}

export type ConfigureAckPayload =
  | { accepted: true }
  | { accepted: false; reason: string };

export interface BatchAckPayload {
  rows_accepted: number;
  warning?: string | null;
}

export interface CommitAckPayload {
  rows: number;
  bytes: number;
  duration_ms: number;
  /**
   * Versions closed by a snapshot stage-diff-merge (doc 28). Optional for
   * back-compat with v1 hosts that ignore the field; defaults to 0 server-side
   * via `#[serde(default)]`. Mirrors `MaterializationReceipt.rows_updated`.
   */
  rows_updated?: number;
  /**
   * Hard-deletes performed by a snapshot merge with `hard_deletes: delete`
   * (doc 28). Optional for back-compat. Mirrors
   * `MaterializationReceipt.rows_deleted`.
   */
  rows_deleted?: number;
}

export interface AbortPayload {
  reason: string;
}

export interface LogPayload {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface ErrorPayload {
  message: string;
  details?: string | null;
}

// ---------- Frame encode / decode ----------

/** Encode one frame to a single Buffer ready to write. */
export function encodeFrame(kind: MessageKind, payload: Uint8Array): Buffer {
  if (payload.length > MAX_PAYLOAD_LEN) {
    throw new ProtocolError(
      `frame payload of ${payload.length} bytes exceeds ${MAX_PAYLOAD_LEN} byte limit`,
    );
  }
  const out = Buffer.allocUnsafe(4 + 1 + payload.length);
  out.writeUInt32LE(payload.length, 0);
  out.writeUInt8(kind, 4);
  out.set(payload, 5);
  return out;
}

export function encodeJsonFrame(kind: MessageKind, value: unknown): Buffer {
  return encodeFrame(kind, Buffer.from(JSON.stringify(value), 'utf8'));
}

/**
 * Stream-buffered frame parser. Feed it chunks from a Readable; pull complete
 * frames out via `next()`. Designed for backpressure-free pipe reads — partial
 * frames are held until the rest of the bytes arrive.
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer | Uint8Array): void {
    // Node may deliver stdin chunks as either Buffer or Uint8Array depending
    // on how the stream was opened; normalize so the readUIntLE/readUInt8
    // helpers below always have a real Buffer to work against.
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.buf = this.buf.length === 0 ? b : Buffer.concat([this.buf, b]);
  }

  /** Pop one frame if a complete one is buffered, else null. */
  next(): Frame | null {
    if (this.buf.length < 5) return null;
    const len = this.buf.readUInt32LE(0);
    if (len > MAX_PAYLOAD_LEN) {
      throw new ProtocolError(
        `frame payload of ${len} bytes exceeds ${MAX_PAYLOAD_LEN} byte limit`,
      );
    }
    const total = 5 + len;
    if (this.buf.length < total) return null;
    const kindByte = this.buf.readUInt8(4);
    const kind = knownKind(kindByte);
    if (kind === null) {
      if (isReservedV2Kind(kindByte)) {
        throw new ProtocolError(
          `message kind 0x${kindByte.toString(16).padStart(2, '0')} is reserved for protocol v2`,
        );
      }
      throw new ProtocolError(
        `unknown message kind 0x${kindByte.toString(16).padStart(2, '0')}`,
      );
    }
    // Copy payload so subsequent buffer compaction does not alias it.
    const payload = Buffer.from(this.buf.subarray(5, total));
    this.buf = this.buf.length === total ? Buffer.alloc(0) : this.buf.subarray(total);
    return { kind, payload };
  }
}

// ---------- Async frame stream over a Node Readable ----------

/**
 * Returns an async iterator that yields decoded frames from a Readable
 * (typically `process.stdin`). Stops cleanly on stream end. Errors from the
 * decoder propagate to the consumer.
 */
export async function* readFrames(input: Readable): AsyncGenerator<Frame> {
  const decoder = new FrameDecoder();
  for await (const chunk of input as AsyncIterable<Buffer>) {
    decoder.push(chunk);
    while (true) {
      const frame = decoder.next();
      if (!frame) break;
      yield frame;
    }
  }
}

// ---------- Frame writer with stdout backpressure ----------

export class FrameWriter {
  constructor(private readonly out: Writable) {}

  async write(kind: MessageKind, payload: Uint8Array): Promise<void> {
    const frame = encodeFrame(kind, payload);
    if (!this.out.write(frame)) {
      await new Promise<void>((resolve) => this.out.once('drain', () => resolve()));
    }
  }

  writeJson(kind: MessageKind, value: unknown): Promise<void> {
    return this.write(kind, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  log(level: LogPayload['level'], message: string): Promise<void> {
    return this.writeJson(MessageKind.Log, { level, message } satisfies LogPayload);
  }

  error(message: string, details?: string | null): Promise<void> {
    const payload: ErrorPayload = { message, details: details ?? null };
    return this.writeJson(MessageKind.Error, payload);
  }
}

// ---------- Session loop ----------

export interface SessionIdentity {
  pluginName: string;
  pluginVersion: string;
  capabilities?: Capabilities;
}

/**
 * Hooks the session loop calls into. Each call corresponds to one host
 * message; throwing from any handler causes the session to emit an Error
 * frame and exit non-zero. The sink implementation lives behind this
 * interface so the protocol client and the DuckDB writer can be developed
 * and tested independently.
 */
export interface SinkHandlers {
  configure(
    payload: ConfigureSinkPayload,
  ): Promise<ConfigureAckPayload> | ConfigureAckPayload;
  batch(payload: Uint8Array): Promise<BatchAckPayload> | BatchAckPayload;
  commit(): Promise<CommitAckPayload> | CommitAckPayload;
  abort(payload: AbortPayload): Promise<void> | void;
  shutdown?(): Promise<void> | void;
}

function parseJson<T>(payload: Uint8Array, kindName: string): T {
  try {
    return JSON.parse(Buffer.from(payload).toString('utf8')) as T;
  } catch (e) {
    throw new ProtocolError(
      `failed to parse ${kindName} payload as JSON: ${(e as Error).message}`,
    );
  }
}

/**
 * Drive a full plugin session against the given stdin/stdout. Returns a
 * suggested process exit code: 0 on clean Shutdown, non-zero on protocol
 * violation, handler error, or premature stream end.
 */
export async function runSession(
  identity: SessionIdentity,
  handlers: SinkHandlers,
  input: Readable,
  output: Writable,
): Promise<number> {
  const writer = new FrameWriter(output);
  const frames = readFrames(input);

  // Phase 1: handshake
  const first = await frames.next();
  if (first.done) {
    return failExit(writer, 'host closed stream before Hello');
  }
  if (first.value.kind !== MessageKind.Hello) {
    return failExit(
      writer,
      `expected Hello (0x01) as first frame, got 0x${first.value.kind.toString(16)}`,
    );
  }
  const hello = parseJson<HelloPayload>(first.value.payload, 'Hello');
  if (hello.protocol !== PROTOCOL_VERSION) {
    return failExit(
      writer,
      `unsupported protocol version ${hello.protocol}; this plugin speaks v${PROTOCOL_VERSION}`,
    );
  }
  const helloAck: HelloAckPayload = {
    protocol: PROTOCOL_VERSION,
    plugin_name: identity.pluginName,
    plugin_version: identity.pluginVersion,
    ...(identity.capabilities ? { capabilities: identity.capabilities } : {}),
  };
  await writer.writeJson(MessageKind.HelloAck, helloAck);

  // Phase 2: configure → batches → commit/abort → shutdown
  let configured = false;
  try {
    for await (const frame of frames) {
      switch (frame.kind) {
        case MessageKind.ConfigureSink: {
          if (configured) {
            throw new ProtocolError('received ConfigureSink twice');
          }
          const payload = parseJson<ConfigureSinkPayload>(frame.payload, 'ConfigureSink');
          const ack = await handlers.configure(payload);
          await writer.writeJson(MessageKind.ConfigureAck, ack);
          if (!ack.accepted) {
            // Host will follow with Shutdown; keep loop running until it does.
          }
          configured = true;
          break;
        }
        case MessageKind.RecordBatch: {
          if (!configured) {
            throw new ProtocolError('RecordBatch received before ConfigureSink');
          }
          const ack = await handlers.batch(frame.payload);
          await writer.writeJson(MessageKind.BatchAck, ack);
          break;
        }
        case MessageKind.Commit: {
          if (!configured) {
            throw new ProtocolError('Commit received before ConfigureSink');
          }
          const ack = await handlers.commit();
          await writer.writeJson(MessageKind.CommitAck, ack);
          break;
        }
        case MessageKind.Abort: {
          const payload = parseJson<AbortPayload>(frame.payload, 'Abort');
          await handlers.abort(payload);
          await writer.writeJson(MessageKind.AbortAck, {});
          break;
        }
        case MessageKind.Shutdown: {
          if (handlers.shutdown) await handlers.shutdown();
          return 0;
        }
        default:
          throw new ProtocolError(
            `unexpected message kind 0x${frame.kind.toString(16)} in plugin->host direction`,
          );
      }
    }
  } catch (e) {
    return failExit(writer, (e as Error).message);
  }

  // Stream ended without Shutdown.
  return failExit(writer, 'host closed stream before Shutdown');
}

async function failExit(writer: FrameWriter, message: string): Promise<number> {
  try {
    await writer.error(message);
  } catch {
    // best effort — host may have already closed the pipe
  }
  process.stderr.write(`orrery-plugin: ${message}\n`);
  return 1;
}
