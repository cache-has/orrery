import type { ConnectionConfig, DatabaseDriver } from "./base.js";
import type { QueryResult } from "../../query/executor.js";

export class PostgresDriver implements DatabaseDriver {
  private connected = false;

  async connect(_config: ConnectionConfig): Promise<void> {
    // TODO: Implement with pg driver (phase 04)
    this.connected = true;
  }

  async query(_sql: string): Promise<QueryResult> {
    throw new Error("PostgreSQL driver not yet implemented — see planning/04-connection-layer.md");
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
