# 13 — Testing & QA

## Goal

Ensure Orrery is reliable across database drivers, dashboard configurations, and deployment modes. Testing strategy should be comprehensive but not slow — fast unit tests, targeted integration tests, and a small set of end-to-end tests.

## Test Pyramid

```
        /  E2E (5-10)  \           — Playwright, full browser
       / Integration (50+) \       — Real DB queries, server routes
      /   Unit Tests (200+)   \    — Parser, cache, layout, formatters
```

## Unit Tests

### Parser

- Lexer: token output for every syntax construct
- Parser: AST output for valid `.board` files
- Validator: error detection for every semantic rule
- Error messages: snapshot tests for every error format
- Edge cases: empty dashboards, max nesting, unicode in strings, SQL with `{` and `}` chars

### Query Engine

- Parameter substitution: `{{param}}` → parameterized query
- SQL injection prevention: verify parameters are never interpolated as strings
- Cache: TTL expiry, cache key generation, invalidation on param change
- Query deduplication: identical queries execute once

### Layout

- Span calculation: explicit spans, auto-calculated spans, overflow handling
- Responsive breakpoints: column collapse behavior
- Edge cases: empty rows, single component, all components span 12

### Formatters

- Currency, number, compact, percent, date, datetime, badge
- Edge cases: null values, negative numbers, very large numbers, empty strings

### Connection Parser

- YAML parsing with env var resolution
- Error for missing env vars
- Multiple connections per file
- Connection string format

## Integration Tests

### Database Driver Tests

Run against real databases. Use Docker containers in CI.

```yaml
# CI matrix
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_DB: test
      POSTGRES_PASSWORD: test
  mysql:
    image: mysql:8
    env:
      MYSQL_DATABASE: test
      MYSQL_ROOT_PASSWORD: test
```

Test each driver:
- [ ] PostgreSQL: connect, query, parameterized query, error handling, timeout
- [ ] MySQL: connect, query, parameterized query, error handling, timeout
- [ ] SQLite: connect, query, parameterized query (in-memory and file)
- [ ] DuckDB: connect, query, parameterized query (in-memory and file)

### Server Route Tests

- `GET /` returns dashboard index
- `GET /d/:name` returns rendered dashboard
- `POST /api/query` executes queries with parameters
- `GET /api/health` returns connection status
- Error responses for invalid dashboards, missing connections

### CLI Command Tests

- `orrery validate` on valid project → exit 0
- `orrery validate` on project with errors → exit 1 with error messages
- `orrery build` produces valid HTML output
- `orrery diff` produces meaningful diff between two refs

## End-to-End Tests

Playwright tests that run a full dev server and interact with dashboards in a browser.

### Test Scenarios

1. **Happy path:** Load dashboard, see all components rendered with data
2. **Parameter change:** Change a date range filter, verify affected charts update
3. **Error handling:** Dashboard with a broken query shows inline error, other components still work
4. **Hot reload:** Modify a `.board` file, verify browser updates without page reload
5. **Static export:** Build static export, open in browser, verify charts render
6. **Table interaction:** Sort columns, filter rows, paginate, export CSV
7. **Responsive:** Verify layout collapses correctly at mobile viewport
8. **Theme:** Toggle dark/light theme, verify all components re-theme

### Test Data

Use SQLite with pre-loaded fixture data for E2E tests. No external database dependency.

Fixture database: `test/fixtures/test.db` with tables:
- `orders` (id, customer, amount, region, status, created_at)
- `customers` (id, name, email, region, created_at)
- `products` (id, name, category, price)

Fixture dashboard: `test/fixtures/dashboards/test.board` using the fixture database.

## Performance Tests

Not automated in CI, but documented and run manually before releases:

- Parser: 10K line `.board` file parses in < 50ms
- Query: 20 parallel queries complete in < 2x slowest individual
- Hot reload: File change → browser update < 500ms
- Static build: 10 dashboards built in < 30s

## CI Pipeline

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres: ...
      mysql: ...
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test                    # unit + integration
      - run: npm run test:e2e            # Playwright
      - run: npm run build
```

## Code Coverage

Target: 80%+ overall, 95%+ on parser and query engine (these are correctness-critical).

## Acceptance Criteria

- [x] Unit test suite with 200+ tests covering parser, query, layout, formatters (342 tests)
- [x] Integration tests for SQLite and DuckDB database drivers (in-memory)
- [x] Server route tests for all API endpoints (index, dashboard render, query, health, assets)
- [x] CLI command tests for validate, build, diff
- [x] CI pipeline running on every push/PR (with coverage reporting)
- [x] Code coverage > 80% overall (87.18%)
- [x] Parser and query engine coverage > 95% (parser: 96.98%, query: 95.76%)
- [x] Test fixtures with SQLite database and example dashboards
- [x] All tests pass in < 3 minutes total (4.7s)
- Deferred to backlog: Playwright E2E tests (see `16-deferred-backlog.md`)
- Deferred to backlog: PostgreSQL/MySQL integration tests in CI (see `16-deferred-backlog.md`)
