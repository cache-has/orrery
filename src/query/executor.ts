import { QueryCache } from "./cache.js";
import { parameterize } from "./parameterizer.js";

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

export interface QueryOptions {
  sql: string;
  connection: string;
  params?: Record<string, string>;
  cacheTtl?: number;
}

export class QueryExecutor {
  private cache: QueryCache;

  constructor() {
    this.cache = new QueryCache();
  }

  async execute(options: QueryOptions): Promise<QueryResult> {
    const resolvedSql = options.params ? parameterize(options.sql, options.params) : options.sql;
    const cacheKey = `${options.connection}:${resolvedSql}`;

    if (options.cacheTtl) {
      const cached = this.cache.get<QueryResult>(cacheKey);
      if (cached) return cached;
    }

    // TODO: Implement actual query execution via connection drivers (phase 04-05)
    throw new Error(
      `Query execution not yet implemented — see planning/05-query-engine.md. SQL: ${resolvedSql}`,
    );
  }

  clearCache(): void {
    this.cache.clear();
  }
}
