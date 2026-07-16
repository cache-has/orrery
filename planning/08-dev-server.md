# 08 — Dev Server

## Goal

Provide a fast, hot-reloading development server that makes authoring dashboards feel immediate. Edit a `.board` file, save, see the change in the browser within a second.

## Usage

```bash
# Start dev server for a project
npx orrery dev

# Specify project directory
npx orrery dev --project ./my-dashboards

# Specify port
npx orrery dev --port 4000
```

## Project Discovery

When `orrery dev` runs, it looks for:

1. `orrery.config.yaml` in the current directory (explicit project root)
2. A `dashboards/` directory in the current directory
3. Any `.board` files in the current directory

### Project Config (Optional)

```yaml
# orrery.config.yaml
dashboards_dir: ./dashboards      # default: ./dashboards
connections_dir: ./connections    # default: ./connections
queries_dir: ./queries           # default: ./queries (for external .sql files)
port: 3000                       # default: 3000
theme: dark                      # default: light
cache_ttl: 300                   # default cache TTL in seconds
```

If no config file exists, defaults are used. Zero config to start.

## File Watching

Watch for changes in:

- `dashboards/**/*.board` — re-parse, re-render affected dashboard
- `connections/**/*.yaml` — reload connection config (reconnect if changed)
- `queries/**/*.sql` — re-execute queries that reference changed files
- `.env`, `.env.local` — reload environment variables
- `orrery.config.yaml` — reload server config

### Hot Reload Flow

```
File change detected
  → Determine change type (dashboard, connection, query, env)
    → Dashboard change:
        → Re-parse the changed .board file
        → If parse error: send error overlay to browser via WebSocket
        → If valid: send updated layout + re-execute changed queries
        → Browser updates affected components without full page reload
    → Connection change:
        → Reload connection config
        → Reconnect affected pools
        → Re-execute all queries on affected connections
    → Query file change:
        → Identify dashboards using this .sql file
        → Re-execute affected queries
        → Push updated data to browser
    → Env change:
        → Reload all env vars
        → Reconnect all connections (credentials may have changed)
```

### WebSocket for Live Updates

The dev server maintains a WebSocket connection to the browser:

```typescript
// Server → Client messages
type ServerMessage =
  | { type: 'reload'; dashboard: string }                    // full dashboard re-render
  | { type: 'update'; componentId: string; data: QueryResult } // single component update
  | { type: 'error'; error: ParseError | QueryError }        // show error overlay
  | { type: 'connected' }                                    // initial connection
```

## Error Overlay

When a `.board` file has a parse error, the browser shows an overlay (similar to Vite/Next.js error overlay):

- Full error message with file, line, column
- Source code context with the error highlighted
- The overlay dismisses automatically when the error is fixed
- The rest of the dashboard remains visible behind the overlay (semi-transparent background)

## Routes

```
GET /                        → Dashboard index (list all dashboards)
GET /d/:dashboard            → Render a specific dashboard
POST /api/query              → Execute queries with parameters
GET /api/health              → Server and connection health
GET /api/dashboards          → List available dashboards
WS  /ws                      → WebSocket for hot reload
GET /orrery/styles.css    → Dashboard stylesheet
GET /orrery/client.js     → Client-side JavaScript
```

## Dashboard Index

The root `/` page lists all available dashboards with:

- Dashboard title (from the `.board` file)
- Description (if set)
- Last modified time
- Click to open

This auto-generates from the `dashboards/` directory — no manual index needed.

## Startup Sequence

1. Find project root and load config
2. Load `.env` and `.env.local`
3. Parse all `.board` files (report errors but don't crash)
4. Initialize connection manager (connect to all databases)
5. Health check connections (warn on failures)
6. Start HTTP server
7. Start file watcher
8. Open browser (unless `--no-open` flag)
9. Print startup summary:

```
  Orrery dev server running

  Dashboard index:  http://localhost:3000
  Sales Overview:   http://localhost:3000/d/sales
  Ops Dashboard:    http://localhost:3000/d/ops

  Connections:
    ✓ warehouse (postgres) — connected
    ✓ local (sqlite) — connected
    ✗ analytics (duckdb) — file not found: ./data/analytics.duckdb

  Watching for changes...
```

## Performance Targets

- File change → browser update: < 500ms for dashboard changes
- File change → browser update: < 1s for connection/query changes
- Startup time: < 2s for a project with 10 dashboards and 3 connections
- Memory: < 100MB for typical usage

## Testing Strategy

- Integration test: start dev server, modify a `.board` file, verify WebSocket receives update
- Test parse error → error overlay → fix error → overlay dismisses
- Test connection file change → reconnection
- Test startup with missing connections (should warn, not crash)

## Acceptance Criteria

- [x] `npx orrery dev` starts server with zero config in a project with `.board` files
- [x] File watcher detects changes to `.board`, `.yaml`, `.sql`, `.env` files
- [x] WebSocket pushes updates to browser on file change
- [x] Parse errors show an overlay in the browser with file/line/column
- [x] Error overlay auto-dismisses when the file is fixed
- [x] Dashboard index at `/` lists all available dashboards
- [x] Startup prints connection status and dashboard URLs
- [x] `--no-open` flag prevents auto-opening browser
- [x] Hot reload < 500ms for dashboard file changes
- [x] Server doesn't crash on any parse or connection error

Note: `include` and `file()` resolution moved to `16-deferred-backlog.md` — these are AST resolution features that require parser changes and are not required for the core dev server experience.
