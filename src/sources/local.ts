/**
 * LocalSource — DashboardSource backed by the local filesystem.
 *
 * Wraps recursive .board file discovery and optional chokidar-based watching.
 */

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { resolve, extname, dirname } from "path";
import chokidar from "chokidar";
import type { DashboardSource, DashboardSourceEvent } from "./types.js";
import { SourceWriteError } from "./types.js";

export interface LocalSourceOptions {
  /** Enable write() — defaults to false (read-only). */
  writable?: boolean;
}

export class LocalSource implements DashboardSource {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private extensions: string[];
  public readonly writable: boolean;

  constructor(
    /** Absolute path to the directory containing files. */
    private dir: string,
    /** File extensions to match (default: [".board"]). */
    extensions?: string[],
    options?: LocalSourceOptions,
  ) {
    this.extensions = extensions ?? [".board"];
    this.writable = options?.writable ?? false;
  }

  async list(): Promise<string[]> {
    return findFiles(this.dir, this.extensions);
  }

  async read(path: string): Promise<string> {
    return readFileSync(path, "utf-8");
  }

  async write(path: string, content: string): Promise<void> {
    if (!this.writable) {
      throw new SourceWriteError("readonly", "Source is not writable");
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    } catch (err) {
      throw mapFsError(err, path);
    }
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
    return `local: ${this.dir}${this.writable ? " (writable)" : ""}`;
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

function mapFsError(err: unknown, path: string): SourceWriteError {
  const code = (err as NodeJS.ErrnoException)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  switch (code) {
    case "EACCES":
    case "EPERM":
      return new SourceWriteError("permission", `Permission denied writing ${path}: ${msg}`, err);
    case "ENOENT":
      return new SourceWriteError("notfound", `Path not found for ${path}: ${msg}`, err);
    default:
      return new SourceWriteError("unknown", `Failed to write ${path}: ${msg}`, err);
  }
}
