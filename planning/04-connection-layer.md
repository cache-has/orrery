# 04 — Connection Layer

## Goal

Define how Orrery connects to databases. Connections are declared in YAML files, credentials are referenced via environment variables, and the connection manager handles pooling, health checks, and driver selection.

## Connection File Format

Connections live in a `connections/` directory in the user's project. Each `.yaml` file defines one or more connections.

### Single Connection Per File

```yaml
# connections/warehouse.yaml
name: warehouse
type: postgres
host: ${WAREHOUSE_HOST}
port: 5432
database: analytics
username: ${WAREHOUSE_USER}
password: ${WAREHOUSE_PASSWORD}
ssl: true
pool_size: 5
```

### Multiple Connections Per File

```yaml
# connections/databases.yaml
connections:
  - name: production
    type: postgres
    connection_string: ${PROD_DATABASE_URL}

  - name: analytics
    type: duckdb
    path: ./data/analytics.duckdb

  - name: local
    type: sqlite
    path: ./data/local.db
```

## Supported Databases (MVP)

| Database | Driver Package | Connection Type |
|----------|---------------|-----------------|
| PostgreSQL | `pg` | Host/port or connection string |
| MySQL | `mysql2` | Host/port or connection string |
| SQLite | `better-sqlite3` | File path |
| DuckDB | `duckdb` or `@duckdb/node-bindings` | File path or `:memory:` |

## Post-MVP Databases

- ClickHouse
- BigQuery
- Snowflake
- Redshift (via Postgres driver with dialect flag)
- MS SQL Server
- Trino/Presto
- MongoDB (via SQL interface or aggregation pipeline)
- CSV/Parquet files (via DuckDB)

## Credential Handling

### Environment Variables (Primary)

All credential values support `${ENV_VAR}` syntax. The connection manager resolves these at startup.

```yaml
password: ${WAREHOUSE_PASSWORD}
```

Resolution order:
1. Process environment variables
2. `.env` file in project root (for local development)
3. `.env.local` file (gitignored, for personal overrides)

### Connection Strings

For convenience, support full connection strings:

```yaml
name: production
type: postgres
connection_string: ${DATABASE_URL}
```

### What NOT to Support (MVP)

- No built-in secret manager integration (Vault, AWS Secrets Manager). Users can use external tools that inject env vars.
- No encryption at rest for connection files. Credentials are in env vars, not in the YAML.
- No UI for managing connections. It's a YAML file — edit it.

## Connection Manager

### Responsibilities

- Parse and validate connection YAML files at startup
- Resolve environment variable references
- Create connection pools per database
- Provide a `query(connectionName, sql, params)` interface
- Health check connections on startup (warn if unreachable, don't crash)
- Graceful shutdown (drain pools)

### Interface

```typescript
interface ConnectionManager {
  // Initialize all connections from YAML files
  init(connectionsDir: string): Promise<void>

  // Execute a query against a named connection
  query(connectionName: string, sql: string, params?: QueryParams): Promise<QueryResult>

  // Get connection metadata (type, name, status)
  getConnection(name: string): ConnectionInfo | undefined

  // List all configured connections
  listConnections(): ConnectionInfo[]

  // Check health of all connections
  healthCheck(): Promise<Map<string, HealthStatus>>

  // Shut down all pools
  close(): Promise<void>
}

interface QueryResult {
  columns: ColumnMeta[]   // name, type
  rows: Record<string, unknown>[]
  rowCount: number
  executionTime: number   // ms
}
```

### Connection Pooling

- PostgreSQL / MySQL: Connection pool via driver (default pool_size: 5)
- SQLite: Single connection (SQLite doesn't pool)
- DuckDB: Single connection with concurrent read support

### Error Handling

- Missing env var: Error at startup with clear message — `"Connection 'warehouse': environment variable WAREHOUSE_PASSWORD is not set"`
- Connection refused: Warning at startup, error when query is attempted
- Query timeout: Configurable per-connection `timeout` property (default: 30s)
- SQL error: Pass through the database error message with connection name and query context

## Validation

The `orrery validate` CLI command checks:

- All connection YAML files parse correctly
- All referenced env vars are set (or warn if missing)
- All connections are reachable (optional `--check-connections` flag)
- All `.board` files reference valid connection names

## Testing Strategy

- Unit tests with mock database drivers
- Integration tests with SQLite and DuckDB (no external DB needed)
- Docker-compose for PostgreSQL and MySQL integration tests (CI only)
- Fixture YAML files covering all connection formats

## Acceptance Criteria

- [x] YAML connection files parse with env var resolution
- [x] Four drivers working: PostgreSQL, MySQL, SQLite, DuckDB
- [x] Connection pooling for PG and MySQL
- [x] `query()` returns typed `QueryResult` with column metadata
- [x] Missing env vars produce clear error messages at startup
- [x] Connection health check on startup with non-fatal warnings
- [x] `orrery validate` checks connection file validity
- [x] Query timeout is configurable and enforced
- [x] `.env` and `.env.local` files loaded for local development
- [x] Graceful shutdown drains all connection pools
