import type { ConnectionConfig, DatabaseDriver } from "./drivers/base.js";
import { PostgresDriver } from "./drivers/postgres.js";
import { MySQLDriver } from "./drivers/mysql.js";
import { SQLiteDriver } from "./drivers/sqlite.js";
import { DuckDBDriver } from "./drivers/duckdb.js";

const DRIVER_MAP: Record<string, new () => DatabaseDriver> = {
  postgres: PostgresDriver,
  postgresql: PostgresDriver,
  mysql: MySQLDriver,
  sqlite: SQLiteDriver,
  duckdb: DuckDBDriver,
};

export class ConnectionManager {
  private connections = new Map<string, DatabaseDriver>();

  async register(name: string, config: ConnectionConfig): Promise<void> {
    const DriverClass = DRIVER_MAP[config.type];
    if (!DriverClass) {
      throw new Error(
        `Unknown database type: ${config.type}. Supported: ${Object.keys(DRIVER_MAP).join(", ")}`,
      );
    }
    const driver = new DriverClass();
    await driver.connect(config);
    this.connections.set(name, driver);
  }

  get(name: string): DatabaseDriver {
    const driver = this.connections.get(name);
    if (!driver) {
      throw new Error(
        `Connection "${name}" not found. Available: ${[...this.connections.keys()].join(", ")}`,
      );
    }
    return driver;
  }

  async disconnectAll(): Promise<void> {
    for (const driver of this.connections.values()) {
      await driver.disconnect();
    }
    this.connections.clear();
  }

  listConnections(): string[] {
    return [...this.connections.keys()];
  }
}
