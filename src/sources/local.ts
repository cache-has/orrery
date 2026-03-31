/**
 * LocalSource — DashboardSource backed by the local filesystem.
 *
 * Wraps recursive .board file discovery and optional chokidar-based watching.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, extname } from "path";
import chokidar from "chokidar";
import type { DashboardSource, DashboardSourceEvent } from "./types.js";

export class LocalSource implements DashboardSource {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private extensions: string[];

  constructor(
    /** Absolute path to the directory containing files. */
    private dir: string,
    /** File extensions to match (default: [".board"]). */
    extensions?: string[],
  ) {
    this.extensions = extensions ?? [".board"];
  }

  async list(): Promise<string[]> {
    return findFiles(this.dir, this.extensions);
  }

  async read(path: string): Promise<string> {
    return readFileSync(path, "utf-8");
  }

  watch(onChange: (event: DashboardSourceEvent) => void): void {
    if (!existsSync(this.dir)) return;

    this.watcher = chokidar.watch(this.dir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    });

    const handle = (type: "add" | "change" | "remove") => (filePath: string) => {
      if (this.extensions.includes(extname(filePath))) {
        onChange({ type, path: filePath });
      }
    };

    this.watcher.on("add", handle("add"));
    this.watcher.on("change", handle("change"));
    this.watcher.on("unlink", handle("remove"));
    this.watcher.on("error", (err: unknown) => {
      console.warn(`LocalSource watcher error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  unwatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  describe(): string {
    return `local: ${this.dir}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFiles(dir: string, extensions: string[], recursive = true): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      results.push(...findFiles(fullPath, extensions, true));
    } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}
