import Database from "better-sqlite3";
import type { ConnectionConfig, DatabaseDriver } from "./base.js";
import type { QueryResult } from "../../query/executor.js";

export class SQLiteDriver implements DatabaseDriver {
  private db: Database.Database | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    const dbPath = config.path ?? ":memory:";
    this.db = new Database(dbPath, {
      timeout: config.timeout ?? 30_000, // busy timeout in ms
    });
    // Enable WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");
  }

  async query(sql: string): Promise<QueryResult> {
    if (!this.db) {
      throw new Error("SQLite driver is not connected");
    }

    const start = performance.now();
    const stmt = this.db.prepare(sql);

    // Check if statement returns data (SELECT, etc.) vs. modifies data (INSERT, etc.)
    if (stmt.reader) {
      const rows = stmt.all() as Record<string, unknown>[];
      const columns = stmt.columns().map((c) => c.name);
      return {
        columns,
        rows,
        rowCount: rows.length,
        executionTimeMs: performance.now() - start,
      };
    }

    // Non-SELECT statements (INSERT, UPDATE, DELETE, CREATE, etc.)
    const result = stmt.run();
    return {
      columns: [],
      rows: [],
      rowCount: result.changes,
      executionTimeMs: performance.now() - start,
    };
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  isConnected(): boolean {
    return this.db !== null;
  }
}
