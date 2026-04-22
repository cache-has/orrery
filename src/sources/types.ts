/**
 * DashboardSource — abstraction over where .board files live.
 *
 * Local filesystem is the default. Remote sources (S3, GCS, HTTP)
 * implement the same interface so the rest of the system is source-agnostic.
 */

export interface DashboardSourceEvent {
  type: "add" | "change" | "remove";
  path: string;
}

export interface DashboardSource {
  /** List all .board file paths/keys available from this source. */
  list(): Promise<string[]>;

  /** Read a single file's content by path/key. */
  read(path: string): Promise<string>;

  /** Watch for changes (optional — not all sources support it). */
  watch?(onChange: (event: DashboardSourceEvent) => void): void;

  /** Stop watching. */
  unwatch?(): void;

  /** Human-readable source description for logs. */
  describe(): string;

  /** True if the source supports write(). Defaults to false for read-only sources. */
  readonly writable: boolean;

  /**
   * Write `content` to `path`. Creates the object/file if absent, overwrites if present.
   * Sources that report `writable: false` MUST throw on call.
   */
  write?(path: string, content: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// SourceWriteError
// ---------------------------------------------------------------------------

export type SourceWriteErrorCode =
  | "readonly"
  | "permission"
  | "notfound"
  | "transient"
  | "unknown";

export class SourceWriteError extends Error {
  readonly code: SourceWriteErrorCode;
  readonly cause?: unknown;

  constructor(code: SourceWriteErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SourceWriteError";
    this.code = code;
    this.cause = cause;
  }
}
