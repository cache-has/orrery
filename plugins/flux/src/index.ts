// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

// Entry point for the OpenBoard Flux sink plugin.
//
// Wires the wire-protocol session loop in `protocol.ts` to the OpenBoard
// DuckDB sink in `sink.ts`. The sink owns its own staging-file lifecycle;
// this file is intentionally thin so the protocol surface and the sink
// implementation can evolve independently.

import { OpenBoardSink } from './sink.js';
import { runSession } from './protocol.js';

const PLUGIN_NAME = 'openboard';
const PLUGIN_VERSION = '0.1.0';

async function main(): Promise<void> {
  // process.stdin defaults to Buffer chunks (no encoding) which is exactly
  // what the wire protocol needs — Arrow IPC bytes must not be re-encoded.

  const sink = new OpenBoardSink();
  const code = await runSession(
    {
      pluginName: PLUGIN_NAME,
      pluginVersion: PLUGIN_VERSION,
      capabilities: {
        transactional: true,
        upsert: true,
        schema_validation: true,
      },
    },
    sink,
    process.stdin,
    process.stdout,
  );
  process.exit(code);
}

main().catch((err: unknown) => {
  process.stderr.write(`openboard-plugin: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
