# Rename: OpenBoard → Orrery

Status: **code rename complete; public publish gated on trademark clearance**

Reason: "OpenBoard" collides with an established open-source interactive whiteboard
(GPLv3, openboard.ch). Renaming to **Orrery** clears that and fits Horizon Analytic
Studios' astronomy naming theme (Siderea · Orrery · Armillary).

**Scope: full rename.** Per owner direction (2026-06-15), this went beyond the original
branding-only plan to a complete sweep — every `openboard`/`OpenBoard`/`OPENBOARD`
reference in the repo is now `orrery`/`Orrery`/`ORRERY`. The owner is the only user, so
breaking identifier/env-var/package changes are acceptable. The **`.board` file
extension is kept** ("board" isn't the trademark issue, and `openboard→orrery` never
touched it).

> **Gate:** trademark clearance via counsel (USPTO + common-law) for "Orrery" is still
> required before *publishing publicly* under the new name. The web scan was clean
> *in-category* but is not a clearance.

## Done (in-repo, this branch)

- [x] All prose: README.md, docs/, SECURITY.md, CLAUDE.md (title + banner), examples,
      templates, planning docs.
- [x] Source identifiers: CSS class prefix `.orrery-*`, the `window.__ORRERY__` state
      global, function/type names, and the armillary plugin's `orrery_project` config
      key + `writeOrreryProjectFiles`.
- [x] Env vars: `ORRERY_ACCESS_CONTROL`, `ORRERY_REQUIRE_FOLDER`, `ORRERY_FOLDERS_HEADER`,
      `ORRERY_CANEDIT_HEADER`, `ORRERY_PROJECT`, and the internal asset tokens.
- [x] npm package `orrery` + bin `orrery` (`package.json`); plugin scope `@orrery/*`.
- [x] File renames: `orrery_project.ts` (+ test), `pagila-revenue-to-orrery.json`.
- [x] Lockfiles regenerated/updated to the new package name.

## Remaining — publish surface (gated on counsel clearance)

- [ ] Rename GitHub repo `cache-has/openboard` → `orrery` (GitHub redirects old URLs);
      update the local remote URL and the `Source` link in the studio site `orrery.svx`.
- [ ] Docker image name/tag wherever it's published.
- [ ] npm publish under `orrery` (if/when the package is published).
- [ ] Marketing/launch copy (e.g. the HN "Show HN" post) → Orrery.

## Kept as-is

- **`.board` file extension** — generic; "board" isn't the trademark issue.

## Order

Counsel clearance before anything publishes under "Orrery" (public repo rename, npm
publish, Docker push). The in-repo rename above is already done and safe to keep on the
branch pre-clearance.
