import mysql from "mysql2/promise";
import type { ConnectionConfig, DatabaseDriver } from "./base.js";
import type { QueryResult } from "../../query/executor.js";

export class MySQLDriver implements DatabaseDriver {
  private pool: mysql.Pool | null = null;
  private queryTimeoutMs: number = 30_000;

  async connect(config: ConnectionConfig): Promise<void> {
    this.queryTimeoutMs = config.timeout ?? 30_000;

    if (config.connection_string) {
      this.pool = mysql.createPool({
        uri: config.connection_string,
        connectionLimit: config.pool_size ?? 5,
        connectTimeout: this.queryTimeoutMs,
      });
    } else {
      this.pool = mysql.createPool({
        host: config.host,
        port: config.port ?? 3306,
        database: config.database,
        user: config.username,
        password: config.password,
        ssl: config.ssl ? {} : undefined,
        connectionLimit: config.pool_size ?? 5,
        connectTimeout: this.queryTimeoutMs,
      });
    }
  }

  async query(sql: string): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error("MySQL driver is not connected");
    }

    const start = performance.now();

    // Race query against a timeout
    const queryPromise = this.pool.query(sql).then(([rows, fields]) => {
      // DDL/DML statements return OkPacket, not arrays
      if (!Array.isArray(rows)) {
        return {
          columns: [] as string[],
          rows: [] as Record<string, unknown>[],
          rowCount: rows.affectedRows ?? 0,
          executionTimeMs: performance.now() - start,
        };
      }

      const columns = fields ? fields.map((f) => f.name) : [];

      return {
        columns,
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length,
        executionTimeMs: performance.now() - start,
      };
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `MySQL query timed out after ${this.queryTimeoutMs}ms`,
            ),
          ),
        this.queryTimeoutMs,
      );
    });

    return Promise.race([queryPromise, timeoutPromise]);
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
