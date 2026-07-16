# Orrery — Project Overview & Master Checklist

## Project Summary

Orrery is an open-source, code-defined BI dashboard tool. Engineers and PMs define dashboards in a lightweight DSL (`.board` files), data connections in YAML. Dashboards are plain files — they can live in git and flow through PRs for teams that want change control, or be authored in a browser-based editor for semi-technical users. Server-rendered for live data, interactive via parameterized queries, self-hostable via Docker or a single `npx` command.

**Tagline:** "Dashboards as code, not clicks."

## Architecture Summary

- **Language:** TypeScript throughout
- **Frontend:** Reactive component renderer (React or SolidJS)
- **Backend:** Lightweight HTTP server with query execution and caching
- **DSL:** Custom `.board` format — layout + SQL + parameters in a readable, purpose-built syntax
- **Connections:** YAML with env var references for credentials
- **Delivery:** npm package (`npx orrery dev`), Docker image, static export option
- **CI/CD:** GitHub Actions workflows shipped as part of the product

## Planning Documents

| Doc | Phase | Status |
|-----|-------|--------|
| [01-dsl-design.md](01-dsl-design.md) | Dashboard definition language spec | [x] Complete |
| [02-project-scaffolding.md](02-project-scaffolding.md) | Repo setup, tooling, build pipeline | [x] Complete |
| [03-dsl-parser.md](03-dsl-parser.md) | Parser for `.board` files | [x] Complete |
| [04-connection-layer.md](04-connection-layer.md) | YAML connections, credential handling, driver management | [x] Complete |
| [05-query-engine.md](05-query-engine.md) | SQL execution, parameterization, caching, error handling | [x] Complete |
| [06-rendering-engine.md](06-rendering-engine.md) | Server-side layout resolution, frontend hydration, CSS Grid | [x] Complete |
| [07-component-library.md](07-component-library.md) | Built-in components: charts, tables, KPIs, text, filters | [x] Complete |
| [08-dev-server.md](08-dev-server.md) | Hot-reload dev server, file watching, live preview | [x] Complete |
| [09-interactivity.md](09-interactivity.md) | Parameters, filters, cross-filtering, drill-down | [x] Complete |
| [10-github-actions.md](10-github-actions.md) | Shipped CI/CD workflows as product offering | [x] Complete |
| [11-static-export.md](11-static-export.md) | Static HTML/snapshot export for sharing and embedding | [x] Complete |
| [12-theming-customization.md](12-theming-customization.md) | Theme system, custom CSS, dark/light mode, branding | [x] Complete |
| [13-testing-qa.md](13-testing-qa.md) | Test strategy, CI, cross-database testing | [x] Complete |
| [14-packaging-distribution.md](14-packaging-distribution.md) | npm publishing, Docker, binary builds, release process | [ ] Not started |
| [15-documentation-launch.md](15-documentation-launch.md) | User docs, examples, website, launch strategy | [ ] Not started |
| [16-deferred-backlog.md](16-deferred-backlog.md) | Post-MVP ideas and deferred features | [ ] Not started |
| [17-remote-sources.md](17-remote-sources.md) | Remote dashboard sources (S3, GCS, HTTP) | [x] Complete (S3 + GCS + local + connection sources; HttpSource/GitSource deferred to backlog) |
| [18-source-write-support.md](18-source-write-support.md) | Writable sources (S3 + filesystem), source capability model | [x] Complete |
| [19-additional-chart-types.md](19-additional-chart-types.md) | Scatter, heatmap, stacked bar, funnel, gauge | [x] Complete (docs deferred to plan 15) |
| [20-web-editor-backend.md](20-web-editor-backend.md) | Editor routes, save/validate/connections APIs, `editor.enabled` flag | [x] Core backend complete (docs + proxy-warning deferred to 16) |
| [21-web-editor-frontend.md](21-web-editor-frontend.md) | CodeMirror 6 editor page, dashboard list, save UX | [x] Complete (Playwright E2E deferred to 16) |
| [22-board-language-mode.md](22-board-language-mode.md) | `.board` syntax highlighting, autocomplete, inline lint | [x] Complete (E2E deferred to 16) |

## Phase Timeline

| Phase | Weeks | Focus |
|-------|-------|-------|
| Language & Foundation | 1-3 | DSL design, parser, project scaffolding |
| Data Layer | 3-5 | Connections, query execution, caching, parameterization |
| Rendering | 5-8 | Layout engine, component library, frontend renderer |
| Interactivity | 8-10 | Parameters, filters, cross-filtering, live updates |
| Dev Experience | 10-12 | Dev server, hot reload, error overlay, CLI |
| CI/CD Product | 12-13 | GitHub Actions workflows, validation commands |
| Polish & Ship | 13-16 | Theming, static export, testing, docs, npm publish |

## MVP Definition

A real person can go from `npx create-orrery` to a live, interactive dashboard in under 15 minutes:

- [ ] `.board` DSL with layout, queries, parameters, and text blocks
- [ ] Parser that produces a validated AST from `.board` files
- [ ] YAML connection files with env var credential references
- [ ] 4 database drivers: PostgreSQL, MySQL, SQLite, DuckDB
- [ ] Query execution with caching (TTL-based)
- [ ] Parameterized queries with interactive filter controls
- [ ] CSS Grid-based responsive layout engine
- [ ] 5 built-in components: line chart, bar chart, table, metric/KPI card, text/markdown
- [ ] Dev server with hot reload on `.board` file changes
- [ ] `orrery validate` CLI command for CI
- [ ] 3 GitHub Actions workflows: validate on PR, preview comment on PR, deploy to GitHub Pages
- [ ] Dark and light theme with customizable colors
- [ ] Static HTML export for sharing
- [ ] Starter template (`create-orrery`) with example dashboard + connection
- [ ] npm package published and installable

## Non-Goals for MVP

- No drag-and-drop builder (code-defined only; a browser-based code editor for `.board` files is planned — see 20/21/22)
- No built-in auth / user management (operators gate the editor behind their own auth proxy)
- No semantic/data modeling layer
- No scheduled refresh (use GitHub Actions cron or external scheduler)
- No real-time streaming data
- No custom component authoring API (built-in components only for v1)
- No embedded mode / iframe SDK
