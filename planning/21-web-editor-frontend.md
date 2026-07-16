# 21 — Web Editor Frontend

## Goal

Browser-based code editor for `.board` files, served at `/edit` and `/edit/:name` by the backend (doc 20). CodeMirror 6 with a save workflow, dashboard list, and new-dashboard creation. Language-aware features (highlighting, autocomplete, lint) live in the language mode (doc 22) and plug into this editor.

## Scope

This doc covers the editor UI and client-side behavior only. Routes, APIs, auth, and the save pipeline are in doc 20. Syntax highlighting and completion are in doc 22.

## Pages

### `/edit` — dashboard list

Landing page when opening the editor without a specific file.

- List of `.board` files from `GET /api/dashboards` (name, last-modified).
- Click a name → navigate to `/edit/:name`.
- "New dashboard" button — prompts for name, calls `POST /api/new`, navigates to `/edit/:name` on success.
- Link to `/` (dashboard viewer home) in the nav.

Minimal styling, consistent with the rest of Orrery. No sidebar trees, no folders — flat list, alphabetized. Add filtering only if the list gets long enough to matter.

### `/edit/:name` — editor page

Layout:

```
┌────────────────────────────────────────────────┐
│ [Orrery]  dashboards ▾    [Open /d/:name ↗] │  ← header
├────────────────────────────────────────────────┤
│                                                │
│   CodeMirror editor                            │
│                                                │
│                                                │
├────────────────────────────────────────────────┤
│ status bar: saved · Cmd+S to save · 42 lines   │
└────────────────────────────────────────────────┘
```

Header:
- Orrery logo/name links to `/edit`.
- Dashboard switcher — dropdown of `.board` files. Switching navigates to `/edit/:other`, with an unsaved-changes warning if dirty.
- "Open /d/:name ↗" — opens the live dashboard view in a new tab.

Editor:
- CodeMirror 6, full width/height between header and status bar.
- Loaded with the result of `GET /api/dashboards/:name`.
- Language mode from doc 22 (highlighting, completion, lint).
- Keyboard shortcuts:
  - `Cmd/Ctrl+S` — save
  - `Cmd/Ctrl+P` — dashboard switcher (optional, nice-to-have)
  - Standard CM6 shortcuts otherwise

Status bar:
- Left: save state — `saved` / `unsaved changes` / `saving…` / `error: <msg>`.
- Right: hint — `Cmd+S to save`.
- Collapses to one line on narrow screens.

## Save flow

1. User hits Cmd/Ctrl+S or clicks Save.
2. Client runs a final `/api/validate` call (optional — skip if no lint errors already visible).
3. Client `POST /api/save/:name` with editor content.
4. On 200 → status bar "saved", mark editor clean.
5. On 422 → render diagnostics inline (CodeMirror lint markers from doc 22), status bar "validation errors", do not mark clean.
6. On 409 (readonly) → status bar "source is read-only", block further save attempts, dim the save button.
7. On 403/502/500 → status bar "error: <message>", user can retry.

No auto-save. Explicit save is the model — matches author expectations (PRs, etc.) and prevents accidental broadcast of half-edited dashboards via the S3 watcher.

## Preview integration

The "Open /d/:name ↗" link opens the dashboard in a new tab. The existing WebSocket hot-reload path already watches the source — when the editor saves and the watcher fires, the `/d/:name` tab reloads automatically. No special integration required on the editor side beyond the link.

Do not embed `/d/:name` in an iframe within the editor page. Two reasons: auth proxies frequently break iframes; and the preview tab is more useful as a full-size view the user tabs between. Can revisit if users ask.

## New dashboard flow

1. User clicks "New dashboard" on `/edit`.
2. Modal: single text field ("Name"), validation hint ("letters, numbers, hyphens, underscores").
3. Submit → `POST /api/new { name }`.
4. On 201 → navigate to `/edit/:name`. The editor loads the starter template and the user is editing immediately.
5. On 409 (exists) → show error in the modal, let user pick a different name.

## Unsaved changes

- Dirty flag set when editor content differs from last-saved content.
- `beforeunload` handler warns on tab close with unsaved changes.
- Dashboard switcher and nav links check the dirty flag and prompt before navigating.

## Frontend stack

- CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/autocomplete`, `@codemirror/lint`).
- Whatever reactive framework the rest of Orrery settled on (React or SolidJS per `00-overview.md`). The editor page should match the rest of the frontend's choice — do not introduce a second framework.
- No heavy state management. Local component state + fetch calls. If we need anything more, revisit.

## Bundle impact

CodeMirror 6 is modular; importing only the pieces needed should keep the editor bundle under 300 KB gzipped. The editor bundle is served only on `/edit` and `/edit/:name` — the dashboard viewer (`/d/:name`) does not load it.

## Accessibility

- Keyboard-first: every action reachable without a mouse.
- CodeMirror 6 has solid a11y defaults; do not disable them.
- Save button is a real `<button>`, not a div.
- Status bar updates use `aria-live="polite"` so screen readers announce save/error state.

## Testing

- E2E (Playwright or similar):
  - Load `/edit`, see list.
  - Click a file, load editor, see content.
  - Edit, save with Cmd+S, reload, changes persist.
  - Introduce a syntax error, save, see inline diagnostic, confirm file did not change on disk.
  - Click "New dashboard", create, land in editor with template.
- Unit: dirty flag behavior, switcher unsaved-changes prompt, status bar state transitions.

## Out of scope

- Diff view against last-saved.
- Multi-file tabbed editing.
- Split-pane live preview.
- Themeable editor UI (use the same theme system as the rest of Orrery — no editor-specific theme).

## Checklist

- [x] `/edit` dashboard list page
- [x] `/edit/:name` editor page with CodeMirror 6
- [x] Header with dashboard switcher and "Open preview" link
- [x] Status bar with save state
- [x] Cmd/Ctrl+S save with status transitions
- [x] Inline lint diagnostics surface (server 422 → CM6 `setDiagnostics`; in-editor linting ties into doc 22)
- [x] New dashboard modal + flow
- [x] Dirty flag + `beforeunload` + navigation guards
- [x] Bundle only loaded on `/edit/*` routes (esbuild, cached in-memory, served at `/edit/assets/editor.js`)
- [ ] ~~E2E tests for create → edit → save → reload~~ — *deferred, see 16-deferred-backlog.md (Playwright E2E Tests)*
