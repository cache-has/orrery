/**
 * Bundles the browser editor client with esbuild on first request and caches
 * the result in memory for the lifetime of the process. Only invoked when
 * `editor.enabled` is true, so viewer-only deployments never pay the cost.
 */

import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cached: Promise<string> | undefined;

function entryPoint(): string {
  const candidates = [
    resolve(__dirname, "../editor-client/main.ts"),
    resolve(__dirname, "../../src/editor-client/main.ts"),
    resolve(process.cwd(), "src/editor-client/main.ts"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `Could not locate editor-client entry. Looked in:\n  ${candidates.join("\n  ")}`,
  );
}

export function bundleEditorClient(): Promise<string> {
  if (cached) return cached;
  cached = (async () => {
    const entry = entryPoint();
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "iife",
      target: ["es2020"],
      minify: true,
      write: false,
      platform: "browser",
      logLevel: "silent",
    });
    return result.outputFiles[0].text;
  })().catch((err) => {
    cached = undefined;
    throw err;
  });
  return cached;
}
