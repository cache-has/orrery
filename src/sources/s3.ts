/**
 * S3Source — DashboardSource backed by AWS S3 or S3-compatible storage.
 *
 * Uses @aws-sdk/client-s3 (optional dependency, dynamically imported).
 * Supports S3-compatible endpoints (MinIO, Cloudflare R2) via the endpoint option.
 * Change detection uses polling with ETag comparison.
 */

import type { DashboardSource, DashboardSourceEvent } from "./types.js";
import { SourceWriteError } from "./types.js";

// ---------------------------------------------------------------------------
// Types (avoid top-level import of @aws-sdk/client-s3)
// ---------------------------------------------------------------------------

interface S3ObjectMeta {
  key: string;
  etag: string;
}

export interface S3SourceOptions {
  /** S3 bucket name */
  bucket: string;
  /** Key prefix (e.g. "dashboards/"). Trailing slash optional — we ensure it. */
  prefix: string;
  /** AWS region (default: from env or "us-east-1") */
  region?: string;
  /** Custom endpoint for S3-compatible stores (MinIO, R2) */
  endpoint?: string;
  /** Polling interval in seconds for watch(). 0 = no polling. Default: 30 */
  pollInterval?: number;
  /** File extensions to match (default: [".board"]). */
  fileExtensions?: string[];
  /** Enable write() — defaults to false (read-only). */
  writable?: boolean;
}

export class S3Source implements DashboardSource {
  private client: any; // S3Client — typed as any to avoid top-level import
  private bucket: string;
  private prefix: string;
  private pollInterval: number;
  private fileExtensions: string[];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private knownObjects = new Map<string, string>(); // key → etag
  private initialized = false;
  public readonly writable: boolean;

  constructor(private options: S3SourceOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix.endsWith("/") || options.prefix === ""
      ? options.prefix
      : options.prefix + "/";
    this.pollInterval = options.pollInterval ?? 30;
    this.fileExtensions = options.fileExtensions ?? [".board"];
    this.writable = options.writable ?? false;
  }

  /** Lazily create the S3Client (dynamic import so the SDK is only loaded when needed). */
  private async ensureClient(): Promise<void> {
    if (this.client) return;

    let sdk: any;
    try {
      sdk = await import("@aws-sdk/client-s3");
    } catch {
      throw new Error(
        "@aws-sdk/client-s3 is required for S3 sources. Install it with: npm install @aws-sdk/client-s3",
      );
    }

    const clientConfig: Record<string, unknown> = {};

    if (this.options.region) {
      clientConfig.region = this.options.region;
    }

    if (this.options.endpoint) {
      clientConfig.endpoint = this.options.endpoint;
      clientConfig.forcePathStyle = true;
      // Compatibility with R2 and older MinIO versions
      clientConfig.requestChecksumCalculation = "WHEN_REQUIRED";
      clientConfig.responseChecksumValidation = "WHEN_REQUIRED";
      if (!this.options.region) {
        clientConfig.region = "auto";
      }
    }

    this.client = new sdk.S3Client(clientConfig);
  }

  async list(): Promise<string[]> {
    await this.ensureClient();
    const objects = await this.listObjects();
    return objects.map((o) => o.key);
  }

  async read(path: string): Promise<string> {
    await this.ensureClient();

    const sdk = await import("@aws-sdk/client-s3");
    const response = await this.client.send(
      new sdk.GetObjectCommand({ Bucket: this.bucket, Key: path }),
    );

    if (!response.Body) {
      throw new Error(`Empty response body for s3://${this.bucket}/${path}`);
    }

    return response.Body.transformToString();
  }

  async write(path: string, content: string): Promise<void> {
    if (!this.writable) {
      throw new SourceWriteError("readonly", "Source is not writable");
    }

    await this.ensureClient();
    const sdk = await import("@aws-sdk/client-s3");

    let response: any;
    try {
      response = await this.client.send(
        new sdk.PutObjectCommand({
          Bucket: this.bucket,
          Key: path,
          Body: content,
          ContentType: "text/plain; charset=utf-8",
        }),
      );
    } catch (err) {
      throw mapS3Error(err, path);
    }

    // Update ETag cache so the poller doesn't re-report a self-write as a change.
    let etag: string | undefined = response?.ETag;
    if (!etag) {
      // Fall back to a HEAD request to fetch the ETag.
      try {
        const head = await this.client.send(
          new sdk.HeadObjectCommand({ Bucket: this.bucket, Key: path }),
        );
        etag = head?.ETag;
      } catch {
        // Leave cache unchanged — poller will emit a spurious change event; acceptable.
      }
    }
    if (etag) {
      this.knownObjects.set(path, etag);
    }
  }

  watch(onChange: (event: DashboardSourceEvent) => void): void {
    if (this.pollInterval <= 0) return;

    // Seed the initial state, then start polling
    this.seedAndPoll(onChange);
  }

  unwatch(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  describe(): string {
    const base = `s3://${this.bucket}/${this.prefix}`;
    const poll = this.pollInterval > 0 ? ` (polling every ${this.pollInterval}s)` : "";
    const write = this.writable ? " (writable)" : "";
    return base + poll + write;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async listObjects(): Promise<S3ObjectMeta[]> {
    const sdk = await import("@aws-sdk/client-s3");
    const results: S3ObjectMeta[] = [];

    const paginator = sdk.paginateListObjectsV2(
      { client: this.client },
      { Bucket: this.bucket, Prefix: this.prefix },
    );

    for await (const page of paginator) {
      for (const obj of page.Contents ?? []) {
        if (!obj.Key || !obj.ETag) continue;
        // Only include files matching configured extensions
        if (!this.fileExtensions.some((ext) => obj.Key!.endsWith(ext))) continue;
        results.push({ key: obj.Key, etag: obj.ETag });
      }
    }

    return results;
  }

  private async seedAndPoll(onChange: (event: DashboardSourceEvent) => void): Promise<void> {
    try {
      await this.ensureClient();
      const objects = await this.listObjects();
      this.knownObjects.clear();
      for (const obj of objects) {
        this.knownObjects.set(obj.key, obj.etag);
      }
      this.initialized = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`S3Source: failed to seed initial state: ${msg}`);
    }

    this.pollTimer = setInterval(() => {
      this.poll(onChange).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`S3Source: poll error: ${msg}`);
      });
    }, this.pollInterval * 1000);
  }

  private async poll(onChange: (event: DashboardSourceEvent) => void): Promise<void> {
    if (!this.initialized) return;

    const current = await this.listObjects();
    const currentMap = new Map<string, string>();
    for (const obj of current) {
      currentMap.set(obj.key, obj.etag);
    }

    // Detect additions and changes
    for (const [key, etag] of currentMap) {
      const prev = this.knownObjects.get(key);
      if (!prev) {
        onChange({ type: "add", path: key });
      } else if (prev !== etag) {
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

function mapS3Error(err: unknown, path: string): SourceWriteError {
  const e = err as any;
  const status = e?.$metadata?.httpStatusCode;
  const name = e?.name ?? e?.Code;
  const msg = err instanceof Error ? err.message : String(err);

  if (status === 403 || name === "AccessDenied") {
    return new SourceWriteError("permission", `Permission denied writing ${path}: ${msg}`, err);
  }
  if (status === 404 || name === "NoSuchBucket" || name === "NoSuchKey") {
    return new SourceWriteError("notfound", `Target not found writing ${path}: ${msg}`, err);
  }
  if (status === 408 || status === 429 || (status && status >= 500 && status < 600) || name === "TimeoutError" || name === "NetworkingError") {
    return new SourceWriteError("transient", `Transient error writing ${path}: ${msg}`, err);
  }
  return new SourceWriteError("unknown", `Failed to write ${path}: ${msg}`, err);
}
