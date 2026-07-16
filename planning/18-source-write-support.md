# 18 — Source Write Support

## Goal

Extend `DashboardSource` with a write capability so dashboards edited through the web editor (see `20-web-editor-backend.md`) can be persisted back to the source (filesystem, S3, GCS). Writing is opt-in per source; sources default to read-only.

## Motivation

Orrery's original design assumed dashboards flow through git: edit locally, commit, deploy. That remains supported, but the web editor is an equally first-class path for semi-technical authors who should not have to learn git. Saving from the editor requires the source layer to support writes.

## Design

### Interface addition

```typescript
// src/sources/types.ts
export interface DashboardSource {
  // existing:
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  watch?(onChange: (event: DashboardSourceEvent) => void): void;
  unwatch?(): void;
  describe(): string;

  /** True if the source supports write(). Defaults to false for read-only sources. */
  readonly writable: boolean;

  /**
   * Write `content` to `path`. Creates the object/file if absent, overwrites if present.
   * Sources that report `writable: false` MUST throw on call.
   */
  write?(path: string, content: string): Promise<void>;
}
```

One boolean, one method. No per-path rules, no user-scoped permissions — authorization is an external concern (see `20-web-editor-backend.md` "Securing the editor").

### Three independent gates

A write succeeds only if all three line up:

1. **Source capability** — `writable: true` in the connection/source YAML (this doc).
2. **Server feature flag** — `editor.enabled: true` in the server config (doc 20).
3. **Upstream auth** — the operator's auth proxy allows the request (doc 20).

Any one says no, save is refused. Defense in depth.

### Why a capability flag at the source level

An auth proxy alone is not sufficient. Legitimate configurations where the source should be read-only even when users are authenticated:

- S3 bucket whose IAM role intentionally lacks `PutObject` (prod viewer mirroring prod data).
- Filesystem source mounted read-only in the container.
- Two instances pointed at the same bucket — one edit-enabled, one viewer-only — same auth, different capability.
- Misconfigured proxy: a forgotten staging env should not silently allow writes to whatever source it happens to be pointing at.

### YAML surface

```yaml
# orrery.config.yaml
source: s3://my-bucket/dashboards/
source_writable: true        # default: false
```

Or via CLI flag:

```bash
orrery dev --source s3://my-bucket/dashboards/ --source-writable
```

For the local default (no explicit source configured) running `orrery dev` stays read-only by default to preserve current behavior; `--source-writable` (or config equivalent) opts into local writes.

## Implementation

### `LocalSource.write()`

- Use `fs.promises.writeFile(path, content, "utf8")`.
- `writable` reflects the `writable` option passed in (default false).
- After write, the existing `chokidar` watcher will fire a `change` event. That's fine — the filesystem is the source of truth; a reload on self-write is cheap and keeps the watcher simple.

### `S3Source.write()`

- Use `PutObjectCommand` from `@aws-sdk/client-s3` (already a dependency for S3 sources).
- Set `ContentType: "text/plain; charset=utf-8"` on uploaded objects.
- Capture the response `ETag` and update `this.knownObjects.set(path, etag)` **before** the next poll fires, so self-triggered writes do not show up as external changes.
- If the SDK response omits `ETag` (rare), fall back to re-listing that single key to get the current ETag.

### `GCSSource.write()`

Optional for this phase. If trivial, add it for parity — same shape, using `@google-cloud/storage`'s `file.save()`. If it adds scope, defer to backlog and mark GCS as read-only.

### Factory / config

- `src/sources/factory.ts` threads the `writable` option into each source's constructor.
- Sources ignore `writable: true` if the underlying implementation cannot write — default to false and emit a startup warning (example: a future read-only `HttpSource`).

## Error handling

`write()` can fail for many reasons; map them to clear error classes so the editor backend can return the right HTTP status:

| Error | HTTP mapping in editor backend |
|-------|-------------------------------|
| Source is read-only (capability) | 409 Conflict — "Source is not writable" |
| Permission denied (S3 403, fs EACCES) | 403 Forbidden |
| Bucket/path not found | 404 Not Found |
| Network / transient | 502 Bad Gateway |
| Unknown | 500 Internal Server Error |

A small `SourceWriteError` class with a `code` field (`"readonly" | "permission" | "notfound" | "transient" | "unknown"`) is enough.

## Testing

- Unit: `LocalSource.write()` round-trips content; `writable: false` throws; filesystem watcher ignores self-writes (acceptable: fires one reload, harmless).
- Unit: `S3Source.write()` calls `PutObjectCommand`, updates `knownObjects`, subsequent poll does not emit a change event for the same key.
- Integration: MinIO-backed test that writes, reads back, and confirms no spurious watch event.
- Negative: read-only source rejects; bad credentials surface as `permission`; nonexistent bucket surfaces as `notfound`.

## Out of scope

- Atomic/transactional writes across multiple files.
- Conflict resolution when two editors save the same file concurrently — last-write-wins, documented. Revisit if users hit it.
- Versioning / undo history — S3 bucket versioning is the answer if operators want it; Orrery does not manage versions.
- Write support for `ConnectionSource` (YAML connection files via the source layer). Connections remain read-only; editing credentials through the web editor is intentionally not supported.

## Checklist

- [x] Add `writable` field and optional `write()` to `DashboardSource` interface
- [x] Implement `LocalSource.write()` and wire `writable` option
- [x] Implement `S3Source.write()` with ETag cache update
- [x] Implement `GCSSource.write()` (or defer and mark GCS read-only)
- [x] `SourceWriteError` class with `code` enum
- [x] Factory passes `writable` option from CLI/config
- [x] `--source-writable` CLI flag + `source_writable` config key
- [x] Unit tests for each source
- [x] Integration test against MinIO
- [x] Docs: YAML reference and CLI flag reference (in `17-remote-sources.md`)
