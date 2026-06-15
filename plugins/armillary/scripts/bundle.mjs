// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0
//
// Assembles a self-contained, drop-in plugin directory at `dist/plugin/`
// that armillary can launch as-is. Layout:
//
//   dist/plugin/
//     plugin.toml
//     config_schema.json
//     dist/orrery-plugin.js          (built by tsup, marked +x with shebang)
//     node_modules/                     (runtime deps only)
//
// `npm run bundle` runs `tsup` first to refresh `dist/orrery-plugin.js`,
// then this script copies the manifest + entry into `dist/plugin/`,
// writes a minimal `package.json` containing only the runtime dependencies
// from the parent `package.json`, and runs `npm install --omit=dev` inside
// `dist/plugin/` so the bundled directory carries its own node_modules.
//
// To install the bundled plugin:
//
//   PLUGIN_DIR="$(armillary plugin path | head -1)"
//   mkdir -p "$PLUGIN_DIR"
//   cp -r dist/plugin "$PLUGIN_DIR/orrery"
//   armillary plugin list   # → orrery 0.1.0 (sinks: orrery_duckdb)

import { execSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..');
const distRoot = join(pluginRoot, 'dist');
const out = join(distRoot, 'plugin');

const builtEntry = join(distRoot, 'orrery-plugin.js');
if (!existsSync(builtEntry)) {
  console.error(
    `bundle.mjs: ${builtEntry} does not exist — run \`npm run build\` first ` +
      `(or use \`npm run bundle\` which chains build → bundle).`,
  );
  process.exit(1);
}

// Clean output, recreate directory tree.
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });

// Manifest + schema.
copyFileSync(join(pluginRoot, 'plugin.toml'), join(out, 'plugin.toml'));
copyFileSync(join(pluginRoot, 'config_schema.json'), join(out, 'config_schema.json'));

// Built entry + sourcemap, preserving the executable bit + shebang.
copyFileSync(builtEntry, join(out, 'dist', 'orrery-plugin.js'));
chmodSync(join(out, 'dist', 'orrery-plugin.js'), 0o755);
const mapPath = builtEntry + '.map';
if (existsSync(mapPath)) {
  copyFileSync(mapPath, join(out, 'dist', 'orrery-plugin.js.map'));
}

// Write a minimal package.json for the bundle. We carry over only the
// runtime dependencies from the parent so `npm install --omit=dev`
// produces a tight node_modules — the resulting tree is what armillary will
// resolve at runtime when the bundled plugin's entry imports
// `@duckdb/node-api`, `apache-arrow`, and `yaml`.
const parentPkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'));
const bundlePkg = {
  name: parentPkg.name + '-bundle',
  version: parentPkg.version,
  description: parentPkg.description,
  license: parentPkg.license,
  type: 'module',
  private: true,
  dependencies: parentPkg.dependencies,
};
writeFileSync(join(out, 'package.json'), JSON.stringify(bundlePkg, null, 2) + '\n');

// Install runtime deps into the bundled directory. We pass --no-audit
// --no-fund --silent to keep the output minimal; --omit=dev ensures we
// don't carry tsup/vitest/typescript along.
console.log('bundle: installing runtime dependencies into dist/plugin/ ...');
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock --silent', {
  cwd: out,
  stdio: 'inherit',
});

console.log(`bundle: wrote self-contained plugin directory to ${out}`);
