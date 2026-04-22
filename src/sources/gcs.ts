/**
 * GCSSource — DashboardSource backed by Google Cloud Storage.
 *
 * Uses @google-cloud/storage (optional dependency, dynamically imported).
 * Change detection uses polling with metadata generation comparison.
 */

import type { DashboardSource, DashboardSourceEvent } from "./types.js";
import { SourceWriteError } from "./types.js";

// ---------------------------------------------------------------------------
// Types (avoid top-level import of @google-cloud/storage)
// ---------------------------------------------------------------------------

interface GCSObjectMeta {
  key: string;
  generation: string;
}

export interface GCSSourceOptions {
  /** GCS bucket name */
  bucket: string;
  /** Key prefix (e.g. "dashboards/"). Trailing slash optional — we ensure it. */
  prefix: string;
  /** Polling interval in seconds for watch(). 0 = no polling. Default: 30 */
  pollInterval?: number;
  /** File extensions to match (default: [".board"]). */
  fileExtensions?: string[];
  /** Enable write() — defaults to false (read-only). */
  writable?: boolean;
}

export class GCSSource implements DashboardSource {
  private storage: any; // Storage instance — typed as any to avoid top-level import
  private bucketHandle: any; // Bucket handle
  private bucket: string;
  private prefix: string;
  private pollInterval: number;
  private fileExtensions: string[];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private knownObjects = new Map<string, string>(); // key → generation
  private initialized = false;
  public readonly writable: boolean;

  constructor(private options: GCSSourceOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix.endsWith("/") || options.prefix === ""
      ? options.prefix
      : options.prefix + "/";
    this.pollInterval = options.pollInterval ?? 30;
    this.fileExtensions = options.fileExtensions ?? [".board"];
    this.writable = options.writable ?? false;
  }

  /** Lazily create the Storage client (dynamic import so the SDK is only loaded when needed). */
  private async ensureClient(): Promise<void> {
    if (this.storage) return;

    let gcs: any;
    try {
      gcs = await import("@google-cloud/storage");
    } catch {
      throw new Error(
        "@google-cloud/storage is required for GCS sources. Install it with: npm install @google-cloud/storage",
      );
    }

    this.storage = new gcs.Storage();
    this.bucketHandle = this.storage.bucket(this.bucket);
  }

  async list(): Promise<string[]> {
    await this.ensureClient();
    const objects = await this.listObjects();
    return objects.map((o) => o.key);
  }

  async read(path: string): Promise<string> {
    await this.ensureClient();

    const file = this.bucketHandle.file(path);
    const [content] = await file.download();
    return content.toString("utf-8");
  }

  async write(path: string, content: string): Promise<void> {
    if (!this.writable) {
      throw new SourceWriteError("readonly", "Source is not writable");
    }

    await this.ensureClient();
    const file = this.bucketHandle.file(path);

    try {
      await file.save(content, {
        contentType: "text/plain; charset=utf-8",
        resumable: false,
      });
    } catch (err) {
      throw mapGcsError(err, path);
    }

    // Update generation cache so the poller doesn't report this self-write.
    try {
      const [metadata] = await file.getMetadata();
      const generation = metadata?.generation ?? metadata?.metageneration;
      if (generation !== undefined) {
        this.knownObjects.set(path, String(generation));
      }
    } catch {
      // Acceptable: poller may emit one spurious change event.
    }
  }

  watch(onChange: (event: DashboardSourceEvent) => void): void {
    if (this.pollInterval <= 0) return;
    this.seedAndPoll(onChange);
  }

  unwatch(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  describe(): string {
    const base = `gs://${this.bucket}/${this.prefix}`;
    const poll = this.pollInterval > 0 ? ` (polling every ${this.pollInterval}s)` : "";
    const write = this.writable ? " (writable)" : "";
    return base + poll + write;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async listObjects(): Promise<GCSObjectMeta[]> {
    const results: GCSObjectMeta[] = [];

    const [files] = await this.bucketHandle.getFiles({
      prefix: this.prefix,
    });

    for (const file of files) {
      const name: string = file.name;
      if (!this.fileExtensions.some((ext) => name.endsWith(ext))) continue;
      // Use metageneration as change indicator (increments on metadata or content updates)
      const generation = file.metadata?.generation ?? file.metadata?.metageneration ?? "0";
      results.push({ key: name, generation: String(generation) });
    }

    return results;
  }

  private async seedAndPoll(onChange: (event: DashboardSourceEvent) => void): Promise<void> {
    try {
      await this.ensureClient();
      const objects = await this.listObjects();
      this.knownObjects.clear();
      for (const obj of objects) {
        this.knownObjects.set(obj.key, obj.generation);
      }
      this.initialized = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`GCSSource: failed to seed initial state: ${msg}`);
    }

    this.pollTimer = setInterval(() => {
      this.poll(onChange).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`GCSSource: poll error: ${msg}`);
      });
    }, this.pollInterval * 1000);
  }

  private async poll(onChange: (event: DashboardSourceEvent) => void): Promise<void> {
    if (!this.initialized) return;

    const current = await this.listObjects();
    const currentMap = new Map<string, string>();
    for (const obj of current) {
      currentMap.set(obj.key, obj.generation);
    }

    // Detect additions and changes
    for (const [key, generation] of currentMap) {
      const prev = this.knownObjects.get(key);
      if (!prev) {
        onChange({ type: "add", path: key });
      } else if (prev !== generation) {
        onChange({ type: "change", path: key });
      }
    }

    // Detect removals
    for (const key of this.knownObjects.keys()) {
      if (!currentMap.has(key)) {
        onChange({ type: "remove", path: key });
      }
    }

    // Update state
    this.knownObjects = currentMap;
  }
}

function mapGcsError(err: unknown, path: string): SourceWriteError {
  const e = err as any;
  const status = e?.code ?? e?.response?.statusCode;
  const msg = err instanceof Error ? err.message : String(err);

  if (status === 403 || status === 401) {
    return new SourceWriteError("permission", `Permission denied writing ${path}: ${msg}`, err);
  }
  if (status === 404) {
    return new SourceWriteError("notfound", `Target not found writing ${path}: ${msg}`, err);
  }
  if (status === 408 || status === 429 || (typeof status === "number" && status >= 500 && status < 600)) {
    return new SourceWriteError("transient", `Transient error writing ${path}: ${msg}`, err);
  }
  return new SourceWriteError("unknown", `Failed to write ${path}: ${msg}`, err);
}
