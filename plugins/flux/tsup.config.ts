// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'openboard-plugin': 'src/index.ts' },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: true,
  // The plugin is spawned by flux as a standalone Node process. flux
  // resolves `executable = "dist/openboard-plugin.js"` (see plugin.toml)
  // and exec's it directly, so the file needs both a shebang (added via
  // `banner`) and the executable bit (set in `onSuccess`).
  //
  // Bundle our own source + the @openboard/* path-mapped imports, but
  // keep third-party deps external. `@duckdb/node-api` ships native
  // bindings that can't be inlined; `yaml` does a dynamic `require` of
  // `process` at module load that trips tsup's CJS shim; `apache-arrow`
  // is large and benefits from staying as an external. They're shipped
  // alongside the bundle by `scripts/bundle.mjs`, and present already
  // for source-tree installs (via the project's own node_modules).
  noExternal: [/^@openboard\//],
  external: ['@duckdb/node-api', 'apache-arrow', 'yaml'],
  banner: { js: '#!/usr/bin/env node' },
  onSuccess: async () => {
    const { chmodSync } = await import('node:fs');
    try {
      chmodSync('dist/openboard-plugin.js', 0o755);
    } catch {
      // chmod is a no-op on Windows; ignore failures.
    }
  },
});
