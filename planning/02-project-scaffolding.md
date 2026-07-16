# 02 — Project Scaffolding

## Goal

Set up the repository structure, tooling, build pipeline, and development environment. Everything should work with a single `npm install && npm run dev` (or bun equivalent).

## Repository Structure

```
orrery/
  src/
    parser/              # DSL lexer, parser, AST types
      lexer.ts
      parser.ts
      ast.ts
      errors.ts
    server/              # HTTP server and API
      index.ts
      routes/
      middleware/
    query/               # Query execution and caching
      executor.ts
      cache.ts
      parameterizer.ts
    connections/         # Connection management and drivers
      manager.ts
      drivers/
        postgres.ts
        mysql.ts
        sqlite.ts
        duckdb.ts
    renderer/            # Dashboard rendering
      layout.ts          # CSS Grid layout resolver
      components/        # Component renderers
    cli/                 # CLI entry points
      dev.ts
      build.ts
      validate.ts
      create.ts
  templates/             # create-orrery starter templates
    default/
      dashboards/
        example.board
      connections/
        local.yaml
      .env.example
  actions/               # GitHub Actions workflows (shipped as product)
    validate.yml
    preview.yml
    deploy.yml
  test/
    parser/
    query/
    renderer/
    fixtures/            # Example .board files and connections for testing
  docs/                  # User documentation (post-MVP)
  package.json
  tsconfig.json
  vitest.config.ts
  .eslintrc.cjs
  .prettierrc
  CLAUDE.md
  LICENSE
```

## Tooling Decisions

| Tool | Purpose | Rationale |
|------|---------|-----------|
| TypeScript | Language | Type safety, ecosystem, target audience writes TS |
| Vitest | Testing | Fast, native TS support, compatible with Node |
| ESLint + Prettier | Linting/formatting | Standard, no debate |
| tsup or unbuild | Build/bundle | Simple TS → JS build for npm package |
| Changesets | Versioning | Standard for npm package releases |

## Runtime Decision: Node vs Bun

Defer this decision until the connection layer is built. Bun is faster but some database drivers (especially native addons like `pg-native`, `better-sqlite3`) may have compatibility issues. Start with Node, benchmark Bun later. The code should be runtime-agnostic where possible.

## Package Structure

Orrery ships as two npm packages:

1. **`orrery`** — The main package. CLI, server, parser, renderer.
2. **`create-orrery`** — Scaffolding tool. `npm create orrery` generates a starter project.

## Monorepo vs Single Package

Start as a single package. Split into a monorepo only if the parser or renderer need to be independently importable. Premature monorepo is worse than a slightly large single package.

## TypeScript Configuration

- Strict mode enabled
- ES2022 target (Node 18+)
- ESM output (no CJS unless required for compatibility)
- Path aliases: `@parser/`, `@server/`, `@query/`, `@renderer/`, `@connections/`

## Development Workflow

```bash
# Install dependencies
npm install

# Run dev server against test fixtures
npm run dev -- --project test/fixtures/example-project

# Run tests
npm test

# Run linter
npm run lint

# Build for distribution
npm run build

# Run the CLI locally
npx tsx src/cli/dev.ts --project test/fixtures/example-project
```

## CI Pipeline (Internal — for developing Orrery itself)

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

This is the CI for developing Orrery itself — distinct from the GitHub Actions workflows shipped as part of the product (covered in `10-github-actions.md`).

## Acceptance Criteria

- [x] Repository initialized with all directories
- [x] TypeScript compiles with zero errors in strict mode
- [x] `npm run dev` starts a dev server that serves a test dashboard
- [x] `npm test` runs and passes with at least one test per module
- [x] `npm run build` produces a distributable package
- [x] ESLint and Prettier configured and passing
- [x] CI pipeline runs on push/PR
