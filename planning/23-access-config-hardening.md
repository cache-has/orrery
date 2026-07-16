# 23 — Access Config Hardening (createApp getDashboards footgun)

## Purpose

Follow-up to PR #31 ("Edit dashboard" button on dashboard pages). Review of that
PR surfaced a pre-existing configuration footgun in `createApp` that the new
per-request edit-button gating now also trips over. This doc scopes a follow-up
PR that fixes the root cause rather than the symptom.

## Status

- **Found:** 2026-07-06, during review of PR #31
- **Severity:** Not reachable via the CLI/bootstrap path; affects library
  embedders only. But when it fires, access control is silently not enforced —
  fail-open, which contradicts the module's stated fail-closed design
  (`src/server/access.ts` header comment).
- **Pre-existing:** Yes. PR #31 did not introduce it; it added a new symptom
  (hidden Edit button) on top of the existing silent-no-enforcement behavior.

## The Problem

`createApp` (`src/server/index.ts`) accepts `getDashboards` in **two places**:

1. Top-level `AppOptions.getDashboards` — used by the access middleware mount,
   the editor routes, the index page, and `/api/dashboards`.
2. `AppOptions.dashboard.getDashboards` (a `DashboardRouteOptions` field) —
   used by the dashboard render routes, with a fallback to the top-level one:

   ```ts
   // index.ts:74
   getDashboards: options.dashboard.getDashboards ?? options.getDashboards,
   ```

The access middleware, however, is mounted only when the **top-level** resolver
exists:

```ts
// index.ts:51-53
if (options.access?.enabled && options.getDashboards) {
  app.use("*", accessMiddleware(options.access, options.getDashboards));
}
```

So an embedder can write a configuration that looks fully enabled but silently
enforces nothing:

```ts
createApp({
  dashboard: { boardDir, executor, getDashboards },  // resolver here...
  access: { enabled: true, ... },                    // ...access "on"
  editor: { enabled: true, source },
});
// top-level getDashboards omitted -> middleware never mounted
```

### Consequences in that configuration

All of these follow from `accessMiddleware` never running, which means
`getRequestAccess(c)` (a plain `c.get(ACCESS_KEY)`, `access.ts:98-100`) returns
`undefined` everywhere:

- **Folder enforcement is off.** Dashboard render routes serve every dashboard
  to every caller; the folder-scoping headers are ignored. Fail-open.
- **The editor 403 gate is off.** `isEditorPath` enforcement (`access.ts:136-138`)
  never runs, so `/edit`, `/api/save`, etc. are reachable without the
  can-edit header. (The editor still needs `enabled: true`, but access checks
  within it are skipped.)
- **The new Edit button (PR #31) inverts.** `dashboard.ts` computes
  `showEditor = getRequestAccess(c)?.canEdit ?? false` -> always `false`, so the
  button is hidden even from callers presenting valid edit headers — while the
  ungated `/edit` routes remain directly reachable. Visibility and enforcement
  disagree in both directions.
- **Index page fails closed, differently.** `index.ts:86` maps a missing
  access to an empty dashboard list, so `/` shows nothing while `/d/:name`
  serves everything. Inconsistent per-route behavior for the same request.

### Why the CLI path is safe

`bootstrap.ts:119-147` always passes both `dashboard.getDashboards` (line 127)
and top-level `getDashboards` (line 130), so every CLI/dev-server/Docker
deployment mounts the middleware whenever access is enabled. Only direct
`createApp` embedders can hit the footgun.

## Proposed Fix

### 1. Normalize to a single resolver (root cause)

At the top of `createApp`, resolve one function and use it everywhere — the
middleware mount, editor routes, dashboard routes, index page, and
`/api/dashboards`:

```ts
const getDashboards = options.getDashboards ?? options.dashboard?.getDashboards;
```

`DashboardRouteOptions.getDashboards` stays (the routes module is usable
standalone), but `createApp` becomes indifferent to which slot the embedder
used.

### 2. Fail loudly when access is enabled but unenforceable

If `access.enabled` is true and no resolver exists in either slot, throw at
`createApp` time:

```ts
if (options.access?.enabled && !getDashboards) {
  throw new Error(
    "access.enabled requires getDashboards (top-level or dashboard.getDashboards): " +
      "folder enforcement cannot run without the dashboard list.",
  );
}
```

Rationale: the access module's contract is fail-closed. A config that requests
enforcement it cannot deliver should be a startup error, not a silent no-op.
This is a behavior change for embedders currently (unknowingly) running in the
broken state — that break is the point.

### 3. Extract the shared editor-visibility helper (same review, finding 2)

The "can this request see edit affordances" policy is hand-rolled twice with
identical semantics: `index.ts:83-90` (index page) and the PR #31 block in
`dashboard.ts` (~223-227). Hoist it into `access.ts` next to
`getRequestAccess`:

```ts
/** Whether this request should see editor entry points (links, buttons). */
export function canShowEditor(
  c: Context,
  editorEnabled: boolean | undefined,
  cfg: AccessConfig | undefined,
): boolean {
  if (!editorEnabled) return false;
  if (!cfg?.enabled) return true;
  return getRequestAccess(c)?.canEdit ?? false;
}
```

Both call sites collapse to `canShowEditor(c, editorEnabled, access)`. Verified
during review: the two existing expressions are truth-table identical, so this
is a pure refactor.

## Scope of the Follow-up PR

- `src/server/index.ts` — single resolver, throw-on-unenforceable, use the
  shared helper on the index page.
- `src/server/routes/dashboard.ts` — use the shared helper.
- `src/server/access.ts` — add `canShowEditor`.
- Tests:
  - `createApp({ dashboard: { getDashboards }, access: { enabled: true } })`
    mounts the middleware (folder header now filters `/d/:name`).
  - `createApp({ access: { enabled: true } })` with no resolver anywhere throws.
  - Edit button visibility matches `/edit` enforcement for the same headers
    (canEdit caller sees button and can save; non-canEdit caller sees no button
    and gets 403).
  - Index page and dashboard page agree on editor visibility for the same
    request.
- Docs: note in the deployment guide / embedding docs that `access.enabled`
  requires a dashboard resolver, and that `createApp` now throws otherwise.

## Out of Scope

- Folder-level write scoping (view-folders vs edit-folders split). The current
  model gates the editor on the global `canEdit` only; a per-folder edit
  capability is a product decision, tracked separately if wanted
  (`16-deferred-backlog.md` candidate).
- Unifying the index page's standalone stylesheet with `styles.ts` (the
  duplicated edit-button CSS from the PR #31 review is structurally forced
  until then).
