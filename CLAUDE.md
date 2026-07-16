# Orrery (formerly OpenBoard)

Open-source, code-defined BI dashboards. Dashboards as code, not clicks.

> **Renamed OpenBoard → Orrery (complete).** Renamed for trademark reasons (an
> established OSS whiteboard owns "OpenBoard", openboard.ch) and to fit the studio's
> astronomy theme (Siderea · Orrery · Armillary). This was a **full rename**: every
> `openboard`/`OpenBoard`/`OPENBOARD` identifier — source, CSS classes, the
> `window.__ORRERY__` state global, env vars, the npm package, and the `orrery` CLI —
> is now `orrery`. The only thing kept is the **`.board` file extension** ("board"
> isn't the trademark issue). History in `planning/rename-to-orrery.md`. **Trademark
> clearance via counsel is still required before publishing publicly under Orrery**
> (renaming the public GitHub repo, npm publish, Docker push).

## Philosophy

**You are encouraged to disagree with me or any instructions in this file if you think another approach is better or if the instructions don't make sense given the project scope.** This is a collaborative build — push back, suggest alternatives, and explain your reasoning. Blind obedience produces worse software. If something seems wrong, say so.

## What This Is

An open-source BI tool where engineers and PMs define dashboards in a lightweight DSL and data connections in YAML. Dashboards are plain files — they can live in git and flow through PRs for teams that want change control, or be authored in a browser-based editor for semi-technical users. Server-rendered (not static/pre-rendered like Evidence.dev), interactive, self-hostable. The product includes GitHub Actions workflows as part of the offering — CI/CD for dashboards is a first-class feature for git-backed deployments.

## What This Is NOT

- Not a full BI suite (no data modeling layer, no semantic layer, no ETL)
- Not a drag-and-drop GUI dashboard builder (a browser-based code editor for `.board` files is planned, but dashboards remain code-defined)
- Not a static site generator that happens to show charts

## Stack

- **Runtime:** Node.js (or Bun — TBD based on ecosystem compatibility)
- **Frontend:** TypeScript + a reactive framework (React or SolidJS — TBD)
- **Charts:** A composable charting library (ECharts, Observable Plot, or Vega-Lite — TBD)
- **Backend:** TypeScript server (Express, Fastify, or Hono — TBD)
- **Query execution:** Direct database connections, query results cached
- **DSL parser:** Custom parser for dashboard definition files (`.board` extension)
- **Connections:** YAML files with env var references for credentials
- **Deployment:** Docker, single `npx` command for dev, static export as option

## Key Design Decisions

1. **Dashboard DSL over markdown** — Markdown can't express layout. A purpose-built DSL handles layout + queries + parameters while staying readable by non-engineers.
2. **Server-rendered, not static** — Live queries with caching. Data is fresh. Static export available for snapshots.
3. **SQL is the query language** — Universal, accessible, already known by the target audience.
4. **Git-compatible, not git-required** — Dashboards are plain files. Teams who want PR review and CI validation get it for free. Teams whose authors are not git-fluent can use the browser editor against an S3-backed (or filesystem-backed) source. The commitment is code-defined syntax, not a specific workflow.
5. **GitHub Actions as product** — Shipped workflows for query validation, dashboard preview on PR, scheduled cache warming, deployment. First-class for git-backed deployments; optional otherwise.
6. **Credentials via env vars** — YAML connection files reference `${ENV_VAR}` for secrets. Safe to commit. Integrates with secret managers.
7. **Parameters for interactivity** — `{{date_range}}`, `{{region}}` in SQL give PMs interactive filters without writing JS.

## Project Structure (Planned)

```
orrery/
  planning/           # Planning docs (you are here during planning phase)
  src/
    parser/           # DSL parser for .board files
    server/           # HTTP server, query execution, caching
    renderer/         # Frontend rendering engine
    components/       # Built-in chart/table/KPI components
    connections/      # Database connection management
    cli/              # CLI commands (dev, build, validate)
  templates/          # Starter dashboard templates
  actions/            # GitHub Actions workflow files (part of the product)
  docs/               # User documentation
```

## Commands (Planned)

- `npx orrery dev` — Start dev server with hot reload
- `npx orrery build` — Build for production
- `npx orrery validate` — Validate all dashboard files and connections
- `npx orrery preview` — Generate static preview (for CI/PR comments)

## Conventions

- TypeScript throughout, strict mode
- Dashboard files use `.board` extension
- Connection files use `.yaml` extension in a `connections/` directory
- Prefer composition over configuration
- Every feature should work with zero configuration beyond the dashboard file and a connection
- If a PM can't read a dashboard definition file and roughly understand it, the DSL is too complex

## Contact

- **Author:** Cache McClure
- **Email:** cache@horizonanalytic.com
- **Company:** Horizon Analytic Studios, LLC

## Planning

All planning docs are in `planning/`. Start with `00-overview.md` for the master checklist. Planning docs are numbered sequentially and each covers a discrete phase or subsystem.
