/**
 * Source factory — parse a source URI and create the right DashboardSource.
 *
 * Supported schemes:
 *   - (bare path or file://)  → LocalSource
 *   - s3://bucket/prefix      → S3Source
 *   - gs://bucket/prefix      → GCSSource
 *   - https://                → reserved (not yet implemented)
 */

import { resolve } from "path";
import { LocalSource } from "./local.js";
import type { DashboardSource } from "./types.js";

// ---------------------------------------------------------------------------
// URI parsing
// ---------------------------------------------------------------------------

export interface ParsedSourceUri {
  scheme: "local" | "s3" | "gs" | "http" | "https";
  bucket?: string; // s3, gs
  prefix?: string; // s3, gs
  path?: string;   // local, http/https
}

export function parseSourceUri(uri: string): ParsedSourceUri {
  // s3://bucket/prefix
  const s3Match = uri.match(/^s3:\/\/([^/]+)\/?(.*)$/);
  if (s3Match) {
    return { scheme: "s3", bucket: s3Match[1], prefix: s3Match[2] };
  }

  // gs://bucket/prefix (reserved)
  const gsMatch = uri.match(/^gs:\/\/([^/]+)\/?(.*)$/);
  if (gsMatch) {
    return { scheme: "gs", bucket: gsMatch[1], prefix: gsMatch[2] };
  }

  // https:// or http://
  if (uri.startsWith("https://")) {
    return { scheme: "https", path: uri };
  }
  if (uri.startsWith("http://")) {
    return { scheme: "http", path: uri };
  }

  // file:// or bare path → local
  const localPath = uri.startsWith("file://") ? uri.slice(7) : uri;
  return { scheme: "local", path: localPath };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateSourceOptions {
  /** Raw source URI from --source arg or config */
  uri: string;
  /** Polling interval in seconds (for remote sources) */
  pollInterval?: number;
  /** Custom S3-compatible endpoint */
  endpoint?: string;
  /** AWS region override */
  region?: string;
}

/** File extensions used for connection files. */
const CONNECTION_EXTENSIONS = [".yaml", ".yml"];

/**
 * Create a DashboardSource configured for connection files (.yaml/.yml).
 * Same URI schemes as createSource but filters for YAML extensions.
 */
export async function createConnectionSource(options: CreateSourceOptions): Promise<DashboardSource> {
  const parsed = parseSourceUri(options.uri);

  switch (parsed.scheme) {
    case "local": {
      const absPath = resolve(parsed.path!);
      return new LocalSource(absPath, CONNECTION_EXTENSIONS);
    }

    case "s3": {
      const { S3Source } = await import("./s3.js");
      return new S3Source({
        bucket: parsed.bucket!,
        prefix: parsed.prefix!,
        endpoint: options.endpoint,
        region: options.region,
        pollInterval: options.pollInterval,
        fileExtensions: CONNECTION_EXTENSIONS,
      });
    }

    case "gs": {
      const { GCSSource } = await import("./gcs.js");
      return new GCSSource({
        bucket: parsed.bucket!,
        prefix: parsed.prefix!,
        pollInterval: options.pollInterval,
        fileExtensions: CONNECTION_EXTENSIONS,
      });
    }

    case "http":
    case "https":
      throw new Error("HTTP source is not yet implemented. See planning/17-remote-sources.md Phase 4.");

    default:
      throw new Error(`Unknown source scheme: ${parsed.scheme}`);
  }
}

/**
 * Create a DashboardSource from a URI string.
 * For local paths, resolves relative to `cwd`.
 */
export async function createSource(options: CreateSourceOptions): Promise<DashboardSource> {
  const parsed = parseSourceUri(options.uri);

  switch (parsed.scheme) {
    case "local": {
      const absPath = resolve(parsed.path!);
      return new LocalSource(absPath);
    }

    case "s3": {
      // Dynamic import to avoid loading AWS SDK when not needed
      const { S3Source } = await import("./s3.js");
      return new S3Source({
        bucket: parsed.bucket!,
        prefix: parsed.prefix!,
        endpoint: options.endpoint,
        region: options.region,
        pollInterval: options.pollInterval,
      });
    }

    case "gs": {
      const { GCSSource } = await import("./gcs.js");
      return new GCSSource({
        bucket: parsed.bucket!,
        prefix: parsed.prefix!,
        pollInterval: options.pollInterval,
      });
    }

    case "http":
    case "https":
      throw new Error("HTTP source is not yet implemented. See planning/17-remote-sources.md Phase 4.");

    default:
      throw new Error(`Unknown source scheme: ${parsed.scheme}`);
  }
}
