# 20 — Web Editor Backend

## Goal

Server-side routes and APIs to support a browser-based `.board` file editor: load, save, validate, list connections, create from template. The frontend lives in `21-web-editor-frontend.md`. The language mode lives in `22-board-language-mode.md`.

## Framing: code-defined, not git-required

Orrery's core commitment is code-defined dashboards: a readable DSL, version-controllable files, text-based diffs. That is a *syntactic* commitment, not a *workflow* commitment. Git remains supported and recommended for teams that want PR-driven change control, but the web editor is an equally first-class path for the semi-technical authors Orrery targets. See `CLAUDE.md` for the updated project framing.

## Non-goals

- No drag-and-drop dashboard builder. The editor is a code editor with DSL support.
- No built-in auth. Orrery does not know about users, sessions, roles, or identity.
- No in-app git workflow (no commit-on-save, no branch management). If the source happens to be git-backed, that is the operator's responsibility.
- No multi-user presence/cursors. Single-author editing; last-write-wins on conflicts.
- No editing of connection YAML files through the web editor (secret-handling risk too high).

## Security model

Three independent gates. Save succeeds only if all three line up:

1. **Server feature flag** — `editor.enabled: true` in server config. Default: `false`. When false, all `/edit/*` and `/api/save/*`, `/api/new`, `/api/validate` routes return 404 as if they do not exist.
2. **Source capability** — the active source reports `writable: true`. See `18-source-write-support.md`. Independent of who the user is — this is infrastructure.
3. **Upstream auth** — operator puts the server behind an auth proxy (Cognito, Okta, Auth0, oauth2-proxy, Caddy `forward_auth`, etc.). Orrery trusts requests that reach it; the proxy is responsible for rejecting unauthenticated ones.

This is defense in depth. A misconfigured proxy is caught by the flag and/or the source. A `writable` S3 bucket is caught by the flag. Enabling the flag without a proxy is a loud, documented choice.

### "Securing the editor" documentation

Ship a dedicated docs page with concrete, copy-pasteable configs for:

- **nginx + oauth2-proxy** (generic OAuth/OIDC in front of Orrery)
- **AWS ALB + Cognito** (the reference setup; this is the client's path)
- **Caddy + `forward_auth`** (smallest-footprint self-hosted option)
- **Cloudflare Access** (zero-config for CF users)

Every example must gate `/edit/*` and `/api/save/*`, `/api/new`, `/api/validate`, `/api/connections` behind auth. Read-only routes (`/d/:name`, static assets) can be gated or not depending on operator preference.

Page includes a prominent warning: **"Enabling the editor without an upstream auth proxy exposes SQL execution against your configured data sources to anyone who can reach the Orrery port. Do not do this."**

## Routes

### Editor pages (HTML)

```
GET  /edit              → Dashboard list / file browser page
GET  /edit/:name        → Editor page for a specific .board file
```

These serve HTML that loads the frontend bundle (see doc 21). They respect the `editor.enabled` flag: when disabled, return 404.

### APIs

```
GET  /api/dashboards           → List .board files (name, modified time)
GET  /api/dashboards/:name     → Read .board file content (text/plain)
POST /api/save/:name           → Save .board file content
POST /api/new                  → Create new .board file from starter template
POST /api/validate             → Parse + validate .board text, return diagnostics
GET  /api/connections          → List connection names and types only
```

#### `POST /api/save/:name`

Request body: raw `.board` text, `Content-Type: text/plain`.

Server flow:
1. Check `editor.enabled`. If false → 404.
2. Check `source.writable`. If false → 409 `{ error: "readonly", message: "..." }`.
3. Run `parse()` + `validate()` on the content. On any `error`-level diagnostic, return 422 with `{ errors: ValidationDiagnostic[] }`. Save is rejected — do not persist broken content.
4. Call `source.write(path, content)`.
5. Map `SourceWriteError.code` to HTTP status (see doc 18).
6. On success, return `200 { ok: true, path }`.

#### `POST /api/new`

Request body: `{ name: string }` (filename without `.board` extension).

Server flow:
1. Check flag, writable. Same as save.
2. Validate `name` — alphanumeric, hyphen, underscore only; no path separators; no leading dot.
3. Resolve target path (`name + ".board"` within the source prefix/root).
4. If path already exists → 409 `{ error: "exists" }`.
5. Write starter template content (see below).
6. Return `201 { ok: true, path, name }`.

#### `POST /api/validate`

Request body: raw `.board` text.

Response: `{ diagnostics: ValidationDiagnostic[] }`. Runs `parse()` then `validate()` and merges their outputs. Never persists. Does not require `writable` — validation is read-only. Still behind `editor.enabled` (don't expose the parser entry point on viewer instances).

#### `GET /api/connections`

Response shape:

```json
{
  "connections": [
    { "name": "warehouse", "type": "postgres" },
    { "name": "analytics", "type": "duckdb" }
  ]
}
```

**Only name and type.** Never host, port, username, database, env var names, or anything that could leak credential shape. This endpoint feeds autocomplete (doc 22) and nothing else.

Add a test that asserts the response contains only `name` and `type` fields — no accidental leakage when the underlying connection config grows.

## Starter template

Hardcoded in this phase. One template, baked into the binary. Future phase can promote to a configurable `templates/` directory if users ask for it.

```
dashboard "New Dashboard" {
  text {
    # New Dashboard

    Describe what this dashboard shows.
  }
}
```

Minimal on purpose — the user immediately edits to add their first component. Avoid scaffolding that has to be deleted.

## Config

```yaml
# orrery.config.yaml
editor:
  enabled: false              # default: false
```

Or via CLI:

```bash
orrery dev --editor         # enable on dev server
orrery start --editor       # enable on production server
```

## Error responses

Consistent JSON shape:

```json
{ "error": "<machine-readable-code>", "message": "<human-readable>" }
```

| Code | HTTP | When |
|------|------|------|
| `readonly` | 409 | Source is not writable |
| `invalid` | 422 | Validation/parse errors (includes `diagnostics` array) |
| `notfound` | 404 | File or path does not exist |
| `exists` | 409 | Trying to create an existing file |
| `permission` | 403 | Underlying source denied the write |
| `transient` | 502 | Network/backend hiccup, retry may help |
| `unknown` | 500 | Anything else |

## Testing

- Unit: each route with flag on and off.
- Unit: save rejects invalid DSL with 422 and returns diagnostics.
- Unit: save rejects on read-only source.
- Unit: `/api/connections` response contains only `name` and `type` — test asserts no other fields.
- Integration: round-trip (new → save → read → dashboard hot-reloads) against the filesystem source.
- Integration: same round-trip against MinIO (S3).
- Security: fuzz `:name` path parameter — path traversal (`../`), null bytes, overlong strings all rejected.

## Out of scope

- Rename/delete endpoints. Add later if users ask; current workflow is "git/console for destructive operations."
- Diff view, revision history, undo. Operators who want this use S3 versioning or git.
- Real-time collaboration. Single-author editing.

## Checklist

- [x] `editor.enabled` config flag + CLI flag
- [x] `GET /edit`, `GET /edit/:name` HTML route stubs (real page body in doc 21)
- [x] `GET /api/dashboards`, `GET /api/dashboards/:name`
- [x] `POST /api/save/:name` with parse+validate gate
- [x] `POST /api/new` with name validation and starter template
- [x] `POST /api/validate`
- [x] `GET /api/connections` — names and types only, with leakage-check test
- [x] Consistent error response shape
- [x] Path traversal hardening on `:name`
- [ ] ~~"Securing the editor" docs page with 4 proxy examples~~ — *deferred, see 16-deferred-backlog.md*
- [ ] ~~Prominent warning when starting with `--editor` and no proxy detected (best-effort hint)~~ — *deferred, see 16-deferred-backlog.md*
