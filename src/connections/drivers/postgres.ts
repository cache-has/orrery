import pg from "pg";
import type { ConnectionConfig, DatabaseDriver } from "./base.js";
import type { QueryResult } from "../../query/executor.js";

export class PostgresDriver implements DatabaseDriver {
  private pool: pg.Pool | null = null;
  private queryTimeoutMs: number = 30_000;

  async connect(config: ConnectionConfig): Promise<void> {
    this.queryTimeoutMs = config.timeout ?? 30_000;

    const poolConfig: pg.PoolConfig = {
      max: config.pool_size ?? 5,
      connectionTimeoutMillis: this.queryTimeoutMs,
      idleTimeoutMillis: 10_000,
      // PG enforces statement_timeout server-side
      statement_timeout: this.queryTimeoutMs,
    };

    if (config.connection_string) {
      poolConfig.connectionString = config.connection_string;
    } else {
      poolConfig.host = config.host;
      poolConfig.port = config.port ?? 5432;
      poolConfig.database = config.database;
      poolConfig.user = config.username;
      poolConfig.password = config.password;
      poolConfig.ssl = config.ssl ? { rejectUnauthorized: false } : undefined;
    }

    this.pool = new pg.Pool(poolConfig);
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error("PostgreSQL driver is not connected");
    }

    const start = performance.now();
    const result = params?.length
      ? await this.pool.query(sql, params)
      : await this.pool.query(sql);

    const columns = result.fields.map((f) => f.name);
    const rows = result.rows as Record<string, unknown>[];

    return {
      columns,
      rows,
      rowCount: rows.length,
      executionTimeMs: performance.now() - start,
    };
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }
}
