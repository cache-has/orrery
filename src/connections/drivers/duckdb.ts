import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";
import type { ConnectionConfig, DatabaseDriver } from "./base.js";
import type { QueryResult } from "../../query/executor.js";

export class DuckDBDriver implements DatabaseDriver {
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private queryTimeoutMs: number = 30_000;

  async connect(config: ConnectionConfig): Promise<void> {
    this.queryTimeoutMs = config.timeout ?? 30_000;
    const dbPath = config.path ?? ":memory:";
    this.instance = await DuckDBInstance.create(dbPath);
    this.connection = await this.instance.connect();
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.connection) {
      throw new Error("DuckDB driver is not connected");
    }

    const start = performance.now();

    // Race the query against a timeout
    const runQuery = params?.length
      ? this.connection.run(sql, params as DuckDBValue[])
      : this.connection.run(sql);
    const queryPromise = runQuery.then(async (result) => {
      const columns = result.columnNames();
      const rows = (await result.getRowObjectsJS()) as Record<
        string,
        unknown
      >[];
      return { columns, rows };
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        this.connection?.interrupt();
        reject(
          new Error(`DuckDB query timed out after ${this.queryTimeoutMs}ms`),
        );
      }, this.queryTimeoutMs);
    });

    const { columns, rows } = await Promise.race([
      queryPromise,
      timeoutPromise,
    ]);

    return {
      columns,
      rows,
      rowCount: rows.length,
      executionTimeMs: performance.now() - start,
    };
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      this.connection.closeSync();
      this.connection = null;
    }
    if (this.instance) {
      this.instance.closeSync();
      this.instance = null;
    }
  }

  isConnected(): boolean {
    return this.connection !== null;
  }
}
