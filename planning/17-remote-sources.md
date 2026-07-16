# 17 — Remote Dashboard Sources

## Goal

Allow `.board` files and connection configs to live outside the local filesystem — in S3, GCS, Azure Blob Storage, or any HTTP-accessible location. Local filesystem remains the default. Source type is selected via CLI args or config.

## Motivation

In larger orgs, dashboards are managed by multiple teams and deployed across environments. Storing `.board` files in object storage enables:

- Central dashboard registry shared across deployments
- CI/CD pipelines that publish dashboards to S3 on merge
- Separation of dashboard definitions from the Orrery server deployment
- Multi-environment setups (staging dashboards in one bucket, prod in another)

## Architecture

### DashboardSource Interface

```typescript
interface DashboardSource {
  /** List all .board file paths/keys */
  list(): Promise<string[]>;
  /** Read a single file's content by path/key */
  read(path: string): Promise<string>;
  /** Watch for changes (optional — not all sources support it) */
  watch?(onChange: (event: { type: 'add' | 'change' | 'remove'; path: string }) => void): void;
  /** Stop watching */
  unwatch?(): void;
  /** Human-readable source description for logs */
  describe(): string;
}
```

### Source Implementations

| Source | Backend | Watch Strategy | Auth |
|--------|---------|---------------|------|
| `LocalSource` | Local filesystem (current behavior) | `chokidar` file watcher | None |
| `S3Source` | AWS S3 / S3-compatible (MinIO, R2) | Polling interval or S3 Event Notifications | AWS SDK credentials (env vars, IAM role, profile) |
| `GCSSource` | Google Cloud Storage | Polling interval | Service account key or ADC |
| `HttpSource` | Any HTTP/HTTPS endpoint | Polling with ETag/Last-Modified | Optional Bearer token |

### CLI Arguments

```bash
# Local (default — unchanged)
orrery dev
orrery dev --project ./my-dashboards

# S3
orrery dev --source s3://my-bucket/dashboards/
orrery dev --source s3://my-bucket/dashboards/ --source-poll 30

# GCS
orrery dev --source gs://my-bucket/dashboards/

# HTTP (static file server, GitHub raw, etc.)
orrery dev --source https://dashboards.internal.co/boards/ --source-poll 60

# Connections can also be remote
orrery dev --source s3://bucket/dashboards/ --connections s3://bucket/connections/
```

### Config File Support

```yaml
# orrery.config.yaml
source: s3://my-bucket/dashboards/
source_poll: 30        # seconds (default: 30 for remote, 0 for local)
source_writable: false # opt-in write support for the web editor (default: false)
connections_source: s3://my-bucket/connections/
```

CLI flags equivalent: `--source-writable` / `--no-source-writable`. Writes still require the web editor's own feature flag and upstream auth — see `18-source-write-support.md` and `20-web-editor-backend.md`.

## Implementation Plan

### Phase 1 — Source Abstraction

- [x] Define `DashboardSource` interface in `src/sources/types.ts`
- [x] Implement `LocalSource` wrapping current `discovery.ts` + `chokidar` logic
- [x] Refactor `discoverDashboards()` to use `LocalSource` internally
- [x] Refactor dev server, build, and validate commands to accept a `DashboardSource`
- [x] Refactor `FileWatcher` to use `source.watch()` instead of direct chokidar
- [x] Verify all existing behavior is unchanged (local FS still works identically)
- [x] Tests: LocalSource unit tests, refactored integration tests

### Phase 2 — S3 Source

- [x] Implement `S3Source` using `@aws-sdk/client-s3`
- [x] `list()` — `ListObjectsV2` with prefix, filter `.board` extension
- [x] `read()` — `GetObject`, return body as string
- [x] `watch()` — poll on configurable interval, diff file list + ETags
- [x] Handle credentials: env vars (`AWS_ACCESS_KEY_ID`), IAM role, named profile (SDK default chain)
- [x] Handle S3-compatible endpoints (MinIO, Cloudflare R2) via `--source-endpoint`
- [x] CLI argument parsing: `--source s3://bucket/prefix`
- [x] Config file parsing: `source: s3://...`
- [x] Tests: S3Source with mocked AWS SDK
- [ ] Integration test with LocalStack or MinIO (deferred — requires CI infrastructure)

### Phase 3 — Connection Sources

- [x] Allow `--connections` flag to accept a source URI (same scheme as `--source`)
- [x] Connection YAML files loaded from remote source instead of local `connections/` dir
- [x] Credentials still resolved from env vars (the YAML references `${ENV_VAR}`, env vars are always local)
- [x] Polling-based reload when remote connection files change

### Phase 4 — Additional Sources

- [x] `GCSSource` using `@google-cloud/storage`
- HttpSource and GitSource deferred to backlog — see `planning/16-deferred-backlog.md`

## Design Decisions

1. **Source URI scheme** — `s3://`, `gs://`, `https://`, `file://` (or bare path for local). Parsed at startup to select the right implementation. Unknown schemes fail fast with a clear error.

2. **Polling vs push** — Remote sources poll by default (configurable interval). Push-based watch (S3 EventBridge, GCS Pub/Sub) is possible but requires infrastructure setup — defer to post-MVP.

3. **Caching** — Remote sources cache file contents locally with ETag/hash. On poll, only re-read files whose ETag changed. This minimizes bandwidth and avoids re-parsing unchanged dashboards.

4. **Connection files stay local by default** — Most deployments will keep connection YAML local (or in the Docker image) since it references env vars. Remote connection source is opt-in.

5. **No mixed sources** — A single Orrery instance reads dashboards from one source. If you need dashboards from multiple S3 buckets, use a single prefix that contains them all, or run multiple instances.

6. **AWS SDK as optional dependency** — `@aws-sdk/client-s3` is only imported when `--source s3://` is used. Not bundled by default. Install prompt or peer dependency.

## Acceptance Criteria

- [ ] `orrery dev` with no args works exactly as today (LocalSource)
- [ ] `orrery dev --source s3://bucket/prefix/` discovers and renders dashboards from S3
- [ ] Changing a `.board` file in S3 triggers a reload within the poll interval
- [ ] Adding/removing `.board` files in S3 updates the dashboard index
- [ ] `orrery validate --source s3://bucket/prefix/` validates remote dashboards
- [ ] `orrery build --source s3://bucket/prefix/` builds static export from remote dashboards
- [ ] S3-compatible endpoints (MinIO, R2) work via `--source-endpoint`
- [ ] Clear error messages for auth failures, missing buckets, network errors
- [ ] Source type logged at startup: `Source: s3://my-bucket/dashboards/ (polling every 30s)`
- [ ] All existing local filesystem tests continue to pass unchanged
