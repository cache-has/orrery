import { describe, it, expect, afterEach } from "vitest";
import { SQLiteDriver } from "../../src/connections/drivers/sqlite.js";
import { DuckDBDriver } from "../../src/connections/drivers/duckdb.js";

describe("SQLiteDriver", () => {
  let driver: SQLiteDriver;

  afterEach(async () => {
    if (driver?.isConnected()) {
      await driver.disconnect();
    }
  });

  it("connects to an in-memory database", async () => {
    driver = new SQLiteDriver();
    await driver.connect({ type: "sqlite", path: ":memory:" });
    expect(driver.isConnected()).toBe(true);
  });

  it("executes DDL and DML statements", async () => {
    driver = new SQLiteDriver();
    await driver.connect({ type: "sqlite", path: ":memory:" });

    await driver.query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    const insert = await driver.query("INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob')");
    expect(insert.rowCount).toBe(2);
  });

  it("returns columns and rows for SELECT queries", async () => {
    driver = new SQLiteDriver();
    await driver.connect({ type: "sqlite", path: ":memory:" });

    await driver.query("CREATE TABLE items (id INTEGER, label TEXT, price REAL)");
    await driver.query("INSERT INTO items VALUES (1, 'Widget', 9.99), (2, 'Gadget', 24.50)");

    const result = await driver.query("SELECT id, label, price FROM items ORDER BY id");

    expect(result.columns).toEqual(["id", "label", "price"]);
    expect(result.rows).toEqual([
      { id: 1, label: "Widget", price: 9.99 },
      { id: 2, label: "Gadget", price: 24.5 },
    ]);
    expect(result.rowCount).toBe(2);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty results for SELECT on empty table", async () => {
    driver = new SQLiteDriver();
    await driver.connect({ type: "sqlite", path: ":memory:" });

    await driver.query("CREATE TABLE empty (id INTEGER)");
    const result = await driver.query("SELECT * FROM empty");

    expect(result.columns).toEqual(["id"]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it("disconnects cleanly", async () => {
    driver = new SQLiteDriver();
    await driver.connect({ type: "sqlite", path: ":memory:" });
    await driver.disconnect();
    expect(driver.isConnected()).toBe(false);
  });

  it("throws when querying without connection", async () => {
    driver = new SQLiteDriver();
    await expect(driver.query("SELECT 1")).rejects.toThrow("not connected");
  });
});

describe("DuckDBDriver", () => {
  let driver: DuckDBDriver;

  afterEach(async () => {
    if (driver?.isConnected()) {
      await driver.disconnect();
    }
  });

  it("connects to an in-memory database", async () => {
    driver = new DuckDBDriver();
    await driver.connect({ type: "duckdb", path: ":memory:" });
    expect(driver.isConnected()).toBe(true);
  });

  it("executes DDL and returns SELECT results", async () => {
    driver = new DuckDBDriver();
    await driver.connect({ type: "duckdb", path: ":memory:" });

    await driver.query("CREATE TABLE metrics (name VARCHAR, value DOUBLE)");
    await driver.query("INSERT INTO metrics VALUES ('cpu', 72.5), ('mem', 85.1)");

    const result = await driver.query("SELECT name, value FROM metrics ORDER BY name");

    expect(result.columns).toEqual(["name", "value"]);
    expect(result.rows).toEqual([
      { name: "cpu", value: 72.5 },
      { name: "mem", value: 85.1 },
    ]);
    expect(result.rowCount).toBe(2);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty results for SELECT on empty table", async () => {
    driver = new DuckDBDriver();
    await driver.connect({ type: "duckdb", path: ":memory:" });

    await driver.query("CREATE TABLE empty (id INTEGER)");
    const result = await driver.query("SELECT * FROM empty");

    expect(result.columns).toEqual(["id"]);
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it("disconnects cleanly", async () => {
    driver = new DuckDBDriver();
    await driver.connect({ type: "duckdb", path: ":memory:" });
    await driver.disconnect();
    expect(driver.isConnected()).toBe(false);
  });

  it("throws when querying without connection", async () => {
    driver = new DuckDBDriver();
    await expect(driver.query("SELECT 1")).rejects.toThrow("not connected");
  });
});
