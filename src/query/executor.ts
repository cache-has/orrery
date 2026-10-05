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
  /** Cache TTL in seconds for this query. Defaults to the executor's default TTL. */
  cacheTtl?: number;
  /** Execution timeout in milliseconds. Defaults to the connection's `timeout`, then 30s. */
  timeout?: number;
  maxRows?: number;
  /** Skip the cache read and run the query. The result is still cached. */
  fresh?: boolean;
  /**
   * Stop waiting for this query. If no other caller is waiting on it and it
   * has not started executing, it is never sent to the database.
   */
  signal?: AbortSignal;
  /** Where the query came from (e.g. "sales/revenue_by_region"), for the slow query log. */
  label?: string;
}

export interface QueryExecutorOptions {
  /** Cache TTL in seconds applied when a query does not set its own. 0 disables caching. Default: 0. */
  defaultCacheTtl?: number;
  /** Maximum number of cached results. Default: 500. */
  maxCacheEntries?: number;
  /** Log queries that take at least this many milliseconds. 0 disables. Default: 1000. */
  slowQueryMs?: number;
  /** Sink for slow query and timeout lines. Default: console.warn. */
  log?: (message: string) => void;
}

export type QueryError =
  | { type: "connection_not_found"; connectionName: string }
  | { type: "connection_error"; connectionName: string; message: string }
  | { type: "sql_error"; message: string; sql: string }
  | { type: "param_error"; paramName: string; message: string }
  | { type: "timeout"; connectionName: string; timeoutMs: number }
  | { type: "row_limit_exceeded"; limit: number; actual: number }
  | { type: "cancelled" };

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
    case "cancelled":
      return "Query cancelled";
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_TTL = 0; // no caching unless the executor or the query asks for it
const DEFAULT_CONCURRENCY = 5; // matches the drivers' default pool size
const DEFAULT_SLOW_QUERY_MS = 1_000;

/** One execution of a query, shared by every caller that asked for it while it was in flight. */
interface Job {
  key: string;
  connectionName: string;
  promise: Promise<QueryResult>;
  resolve: (result: QueryResult) => void;
  reject: (err: unknown) => void;
  run: () => Promise<QueryResult>;
  /** Callers currently awaiting this job. */
  waiters: number;
  started: boolean;
}

export class QueryExecutor {
  private cache: QueryCache;
  private connectionManager: ConnectionManager;
  /** In-flight deduplication: key → the job every identical request shares. */
  private inflight = new Map<string, Job>();
  /** Jobs waiting for a free slot, per connection, in arrival order. */
  private queues = new Map<string, Job[]>();
  /** Jobs currently executing, per connection. */
  private active = new Map<string, number>();
  private defaultCacheTtl: number;
  private slowQueryMs: number;
  private log: (message: string) => void;

  constructor(connectionManager: ConnectionManager, options: QueryExecutorOptions = {}) {
    this.cache = new QueryCache(options.maxCacheEntries);
    this.connectionManager = connectionManager;
    this.defaultCacheTtl = options.defaultCacheTtl ?? DEFAULT_CACHE_TTL;
    this.slowQueryMs = options.slowQueryMs ?? DEFAULT_SLOW_QUERY_MS;
    this.log = options.log ?? ((message) => console.warn(message));
  }

  /**
   * Execute a single query with caching, parameterization, and safety limits.
   */
  async execute(options: QueryOptions): Promise<QueryResult> {
    const { sql, connection: connectionName, params, cacheTtl, timeout, maxRows, fresh, signal, label } = options;

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

    if (signal?.aborted) throw new QueryExecutionError({ type: "cancelled" });

    // 3. Cache key: connection + prepared SQL + serialized values
    const cacheKey = computeCacheKey(connectionName, preparedSql, values);
    const effectiveTtl = cacheTtl ?? this.defaultCacheTtl;

    if (effectiveTtl > 0 && !fresh) {
      const cached = this.cache.get<QueryResult>(cacheKey);
      if (cached) return cached;
    }

    // 4. Deduplication: if the exact same query is already queued or running, share it
    let job = this.inflight.get(cacheKey);
    if (!job) {
      job = this.createJob(cacheKey, connectionName, () =>
        this.doExecute(
          connectionName,
          preparedSql,
          values,
          timeout ?? connInfo.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxRows ?? DEFAULT_MAX_ROWS,
          label,
        ).then((result) => {
          if (effectiveTtl > 0) this.cache.set(cacheKey, result, effectiveTtl);
          return result;
        }),
      );
      this.inflight.set(cacheKey, job);
      this.enqueue(job, connInfo.poolSize ?? DEFAULT_CONCURRENCY);
    }

    // 5. Wait for it, unless this caller gives up first
    job.waiters++;
    try {
      return await raceAbort(job.promise, signal);
    } finally {
      job.waiters--;
      // Nobody is waiting and it never reached the database: drop it rather
      // than spend a connection on a result no one will read. A job that has
      // already started runs to completion (and populates the cache).
      if (job.waiters === 0 && !job.started && this.inflight.get(cacheKey) === job) {
        this.dequeue(job);
        this.inflight.delete(cacheKey);
        job.reject(new QueryExecutionError({ type: "cancelled" }));
      }
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
        .catch((err) => results.set(i, toQueryExecutionError(err, q.sql))),
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

  private createJob(key: string, connectionName: string, run: () => Promise<QueryResult>): Job {
    let resolve!: (result: QueryResult) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<QueryResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Every waiter may have gone by the time the job settles; a rejection with
    // no listener must not surface as an unhandled rejection.
    promise.catch(() => {});
    return { key, connectionName, promise, resolve, reject, run, waiters: 0, started: false };
  }

  /**
   * Run at most `limit` queries at once per connection; the rest wait here, in
   * order. Queueing in the executor rather than in the driver's pool means the
   * timeout measures execution only (not time spent waiting for a connection)
   * and a queued query can be dropped if every caller abandons it.
   */
  private enqueue(job: Job, limit: number): void {
    const queue = this.queues.get(job.connectionName) ?? [];
    this.queues.set(job.connectionName, queue);
    queue.push(job);
    this.pump(job.connectionName, Math.max(1, limit));
  }

  private dequeue(job: Job): void {
    const queue = this.queues.get(job.connectionName);
    const index = queue?.indexOf(job) ?? -1;
    if (index >= 0) queue!.splice(index, 1);
  }

  private pump(connectionName: string, limit: number): void {
    const queue = this.queues.get(connectionName);
    if (!queue) return;
    while (queue.length > 0 && (this.active.get(connectionName) ?? 0) < limit) {
      const job = queue.shift()!;
      job.started = true;
      this.active.set(connectionName, (this.active.get(connectionName) ?? 0) + 1);
      job
        .run()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active.set(connectionName, (this.active.get(connectionName) ?? 1) - 1);
          if (this.inflight.get(job.key) === job) this.inflight.delete(job.key);
          this.pump(connectionName, limit);
        });
    }
  }

  private async doExecute(
    connectionName: string,
    preparedSql: string,
    values: unknown[],
    timeoutMs: number,
    maxRows: number,
    label?: string,
  ): Promise<QueryResult> {
    const origin = label ? ` ${label}` : "";
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    let result: QueryResult;
    try {
      const driver = this.connectionManager.get(connectionName);
      const queryPromise = driver.query(preparedSql, values);

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
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

      result = await Promise.race([queryPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof QueryExecutionError) {
        if (err.detail.type === "timeout") {
          this.log(`[orrery] query timed out after ${timeoutMs}ms connection=${connectionName}${origin}`);
        }
        throw err;
      }
      throw new QueryExecutionError({
        type: "connection_error",
        connectionName,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }

    const elapsedMs = Math.round(performance.now() - started);
    if (this.slowQueryMs > 0 && elapsedMs >= this.slowQueryMs) {
      this.log(
        `[orrery] slow query ${elapsedMs}ms rows=${result.rowCount} connection=${connectionName}${origin}`,
      );
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

/** Normalize anything thrown while executing a query into a QueryExecutionError. */
export function toQueryExecutionError(err: unknown, sql: string): QueryExecutionError {
  if (err instanceof QueryExecutionError) return err;
  return new QueryExecutionError({
    type: "sql_error",
    message: err instanceof Error ? err.message : String(err),
    sql,
  });
}

/** Resolve with the promise, or reject as cancelled as soon as the signal aborts. */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new QueryExecutionError({ type: "cancelled" }));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function computeCacheKey(
  connectionName: string,
  sql: string,
  values: unknown[],
): string {
  // Simple deterministic key. For MVP, string concatenation is fine.
  return `${connectionName}::${sql.trim()}::${JSON.stringify(values)}`;
}
