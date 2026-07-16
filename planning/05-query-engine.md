# 05 — Query Engine

## Goal

Execute SQL queries from `.board` files against configured connections, with parameter substitution, caching, and error handling. The query engine sits between the parsed AST and the renderer — it takes query strings with parameter placeholders, resolves them against current parameter values, executes against the appropriate connection, and returns typed results.

## Architecture

```
Dashboard AST (with query strings + param refs)
  → Parameter Resolution (substitute {{param}} with current values)
    → Cache Check (return cached result if valid)
      → Query Execution (send to connection manager)
        → Result Normalization (uniform format)
          → Cache Store
            → Return to Renderer
```

## Parameter Substitution

### How Parameters Reach SQL

Dashboard params declared in the `.board` file generate UI controls. When a user changes a filter, the current parameter values are sent to the server, which re-executes affected queries.

```board
param date_range = daterange(default: "last 30 days")
param region = select(options: ["North", "South", "East", "West"])
```

```sql
SELECT date, SUM(amount) as revenue
FROM orders
WHERE created_at >= '{{date_range.start}}'
  AND created_at <= '{{date_range.end}}'
  AND region = '{{region}}'
GROUP BY 1
```

### Parameter Types and SQL Generation

| Param Type | SQL Output | Sanitization |
|-----------|-----------|--------------|
| `daterange` | `.start` and `.end` as ISO date strings | Date validation |
| `select` | Selected value as string | Must match declared options or query results |
| `text` | User input as string | Parameterized query (NOT string interpolation) |
| `number` | Numeric value | Type validation |

### SQL Injection Prevention

**Critical:** `{{param}}` references MUST be converted to parameterized queries, NOT string concatenation.

```sql
-- What the user writes:
WHERE region = '{{region}}'

-- What gets executed:
WHERE region = $1  -- with params: [currentRegionValue]
```

The query engine strips the `{{param}}` markers and replaces them with the driver's placeholder syntax (`$1` for Postgres, `?` for MySQL/SQLite). Parameter values are passed separately.

Exception: `daterange` start/end values may be safe to inline as ISO strings since they're validated, but prefer parameterized queries universally.

## Caching

### Cache Strategy

TTL-based (time-to-live) caching keyed on:
- Connection name
- Normalized SQL string (whitespace-trimmed)
- Resolved parameter values (serialized)

```typescript
interface CacheEntry {
  key: string                    // hash of connection + sql + params
  result: QueryResult
  createdAt: number              // timestamp
  ttl: number                    // milliseconds
  connectionName: string
  sql: string
}
```

### Cache Configuration

Dashboard-level:
```board
dashboard "Sales" {
  cache_ttl: 300  # 5 minutes, applies to all queries in this dashboard
}
```

Component-level override:
```board
metric "Live Count" {
  query: "SELECT COUNT(*) FROM active_sessions"
  cache_ttl: 10  # 10 seconds for near-real-time
}
```

### Cache Invalidation

- TTL expiry (primary)
- Manual refresh button in the UI
- Parameter change: only invalidates queries that use the changed parameter
- `orrery cache clear` CLI command
- Server restart clears cache

### Cache Storage

In-memory (Map) for MVP. No Redis, no disk cache. Keep it simple. A dashboard server is typically single-process, so in-memory is fine.

## Query Execution

### Execution Flow

```typescript
async function executeQuery(
  connectionName: string,
  sql: string,
  params: ResolvedParams,
  options: QueryOptions
): Promise<QueryResult> {
  // 1. Resolve parameter placeholders → parameterized query
  const { preparedSql, paramValues } = prepareQuery(sql, params)

  // 2. Check cache
  const cacheKey = computeCacheKey(connectionName, preparedSql, paramValues)
  const cached = cache.get(cacheKey)
  if (cached && !cached.isExpired()) return cached.result

  // 3. Execute via connection manager
  const startTime = performance.now()
  const result = await connectionManager.query(connectionName, preparedSql, paramValues)
  result.executionTime = performance.now() - startTime

  // 4. Store in cache
  cache.set(cacheKey, result, options.cacheTtl)

  return result
}
```

### Query Options

```typescript
interface QueryOptions {
  cacheTtl?: number         // Override default TTL
  timeout?: number          // Query timeout in ms
  maxRows?: number          // Limit result rows (safety net)
}
```

### Default Row Limit

Queries return a maximum of 10,000 rows by default (configurable). This prevents accidentally loading a million rows into the browser. The limit is applied as a wrapping query or warning, not by silently truncating.

## Error Handling

### Error Types

```typescript
type QueryError =
  | { type: 'connection_not_found'; connectionName: string }
  | { type: 'connection_error'; connectionName: string; message: string }
  | { type: 'sql_error'; message: string; sql: string; line?: number }
  | { type: 'param_error'; paramName: string; message: string }
  | { type: 'timeout'; connectionName: string; timeoutMs: number }
  | { type: 'row_limit_exceeded'; limit: number; actual: number }
```

### Error Display

Query errors should be shown inline in the component that failed — not as a full-page error. A chart with a broken query shows an error card in the chart's position with:
- The error message
- The SQL that was attempted (with params resolved, for debugging)
- A "Retry" button

Other components on the dashboard continue rendering normally.

## Performance Considerations

- Queries within a single dashboard should execute in parallel (Promise.all), not sequentially
- Queries that share the same SQL + params but appear in multiple components should be deduplicated (execute once, share result)
- Large result sets should be streamed if the driver supports it (post-MVP)

## Testing Strategy

- Unit tests for parameter substitution (especially injection prevention)
- Unit tests for cache key generation and TTL behavior
- Integration tests with SQLite/DuckDB for actual query execution
- Error handling tests for each error type
- Performance test: 20 queries in parallel should complete within 2x the slowest individual query

## Acceptance Criteria

- [x] Parameter substitution converts `{{param}}` to parameterized queries
- [x] SQL injection is impossible via parameter substitution
- [x] TTL-based caching works with dashboard-level and component-level overrides
- [x] Cache invalidates correctly on parameter change
- [x] Parallel query execution for independent components
- [x] Query deduplication for identical queries across components
- [x] Default row limit (10,000) with configurable override
- [x] Query timeout enforced
- [x] `daterange` parameter resolves to `.start` and `.end` sub-properties
