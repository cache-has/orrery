/**
 * GCSSource — DashboardSource backed by Google Cloud Storage.
 *
 * Uses @google-cloud/storage (optional dependency, dynamically imported).
 * Change detection uses polling with metadata generation comparison.
 */

import type { DashboardSource, DashboardSourceEvent } from "./types.js";

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

  constructor(private options: GCSSourceOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix.endsWith("/") || options.prefix === ""
      ? options.prefix
      : options.prefix + "/";
    this.pollInterval = options.pollInterval ?? 30;
    this.fileExtensions = options.fileExtensions ?? [".board"];
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
    const suffix = this.pollInterval > 0 ? ` (polling every ${this.pollInterval}s)` : "";
    return base + suffix;
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
