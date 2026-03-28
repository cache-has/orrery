import { QueryCache } from "./cache.js";
import {
  prepareQuery,
  placeholderStyleForDriver,
  extractParamNames,
} from "./parameterizer.js";
import type { ConnectionManager } from "../connections/manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  truncated?: boolean;
}

export interface QueryOptions {
  sql: string;
  connection: string;
  params?: Record<string, unknown>;
  cacheTtl?: number;
  timeout?: number;
  maxRows?: number;
}

export type QueryError =
  | { type: "connection_not_found"; connectionName: string }
  | { type: "connection_error"; connectionName: string; message: string }
  | { type: "sql_error"; message: string; sql: string }
  | { type: "param_error"; paramName: string; message: string }
  | { type: "timeout"; connectionName: string; timeoutMs: number }
  | { type: "row_limit_exceeded"; limit: number; actual: number };

export class QueryExecutionError extends Error {
  constructor(public readonly detail: QueryError) {
    super(queryErrorMessage(detail));
    this.name = "QueryExecutionError";
  }
}

function queryErrorMessage(e: QueryError): string {
  switch (e.type) {
    case "connection_not_found":
      return `Connection "${e.connectionName}" not found`;
    case "connection_error":
      return `Connection "${e.connectionName}" error: ${e.message}`;
    case "sql_error":
      return `SQL error: ${e.message}`;
    case "param_error":
      return `Parameter "${e.paramName}" error: ${e.message}`;
    case "timeout":
      return `Query timed out after ${e.timeoutMs}ms on connection "${e.connectionName}"`;
    case "row_limit_exceeded":
      return `Query returned ${e.actual} rows, exceeding the limit of ${e.limit}`;
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL = 0; // no caching by default

export class QueryExecutor {
  private cache: QueryCache;
  private connectionManager: ConnectionManager;
  /** In-flight deduplication: key → pending promise */
  private inflight = new Map<string, Promise<QueryResult>>();

  constructor(connectionManager: ConnectionManager) {
    this.cache = new QueryCache();
    this.connectionManager = connectionManager;
  }

  /**
   * Execute a single query with caching, parameterization, and safety limits.
   */
  async execute(options: QueryOptions): Promise<QueryResult> {
    const { sql, connection: connectionName, params, cacheTtl, timeout, maxRows } = options;

    // 1. Resolve connection and determine driver type
    const connInfo = this.connectionManager.getConnection(connectionName);
    if (!connInfo) {
      throw new QueryExecutionError({
        type: "connection_not_found",
        connectionName,
      });
    }

    // 2. Prepare parameterized query
    let preparedSql: string;
    let values: unknown[];
    try {
      const style = placeholderStyleForDriver(connInfo.type);
      const prepared = prepareQuery(sql, params ?? {}, style);
      preparedSql = prepared.sql;
      values = prepared.values;
    } catch (err) {
      // Extract param name from error message if possible
      const paramMatch =
        err instanceof Error ? err.message.match(/\{\{(\S+?)\}\}/) : null;
      throw new QueryExecutionError({
        type: "param_error",
        paramName: paramMatch ? paramMatch[1] : "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. Cache key: connection + prepared SQL + serialized values
    const cacheKey = computeCacheKey(connectionName, preparedSql, values);
    const effectiveTtl = cacheTtl ?? DEFAULT_CACHE_TTL;

    if (effectiveTtl > 0) {
      const cached = this.cache.get<QueryResult>(cacheKey);
      if (cached) return cached;
    }

    // 4. Deduplication: if the exact same query is already in-flight, wait for it
    const existing = this.inflight.get(cacheKey);
    if (existing) return existing;

    // 5. Execute
    const promise = this.doExecute(
      connectionName,
      preparedSql,
      values,
      timeout ?? DEFAULT_TIMEOUT_MS,
      maxRows ?? DEFAULT_MAX_ROWS,
    );

    this.inflight.set(cacheKey, promise);

    try {
      const result = await promise;

      // 6. Store in cache
      if (effectiveTtl > 0) {
        this.cache.set(cacheKey, result, effectiveTtl);
      }

      return result;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  /**
   * Execute multiple queries in parallel. Each query is independent.
   * Deduplication happens automatically through execute().
   */
  async executeAll(
    queries: QueryOptions[],
  ): Promise<Map<number, QueryResult | QueryExecutionError>> {
    const results = new Map<number, QueryResult | QueryExecutionError>();
    const promises = queries.map((q, i) =>
      this.execute(q)
        .then((result) => results.set(i, result))
        .catch((err) => {
          if (err instanceof QueryExecutionError) {
            results.set(i, err);
          } else {
            results.set(
              i,
              new QueryExecutionError({
                type: "sql_error",
                message: err instanceof Error ? err.message : String(err),
                sql: q.sql,
              }),
            );
          }
        }),
    );
    await Promise.all(promises);
    return results;
  }

  /**
   * Invalidate cache entries whose SQL references any of the given parameter names.
   * Used when a user changes a dashboard parameter.
   */
  invalidateByParams(paramNames: string[]): void {
    this.cache.invalidateByPredicate((_key, meta) => {
      if (!meta?.sql) return false;
      const referenced = extractParamNames(meta.sql);
      return paramNames.some((p) => referenced.includes(p));
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async doExecute(
    connectionName: string,
    preparedSql: string,
    values: unknown[],
    timeoutMs: number,
    maxRows: number,
  ): Promise<QueryResult> {
    const driver = this.connectionManager.get(connectionName);

    const queryPromise = driver.query(preparedSql, values);

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new QueryExecutionError({
              type: "timeout",
              connectionName,
              timeoutMs,
            }),
          ),
        timeoutMs,
      );
    });

    let result: QueryResult;
    try {
      result = await Promise.race([queryPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof QueryExecutionError) throw err;
      throw new QueryExecutionError({
        type: "connection_error",
        connectionName,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Row limit enforcement
    if (result.rowCount > maxRows) {
      throw new QueryExecutionError({
        type: "row_limit_exceeded",
        limit: maxRows,
        actual: result.rowCount,
      });
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeCacheKey(
  connectionName: string,
  sql: string,
  values: unknown[],
): string {
  // Simple deterministic key. For MVP, string concatenation is fine.
  return `${connectionName}::${sql.trim()}::${JSON.stringify(values)}`;
}
