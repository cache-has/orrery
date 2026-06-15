import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseConnectionFile, loadConnectionFiles } from "../../src/connections/loader.js";

describe("parseConnectionFile", () => {
  beforeEach(() => {
    process.env.TEST_DB_HOST = "localhost";
    process.env.TEST_DB_PASS = "secret123";
    process.env.TEST_DB_URL = "postgres://user:pass@host/db";
  });

  afterEach(() => {
    delete process.env.TEST_DB_HOST;
    delete process.env.TEST_DB_PASS;
    delete process.env.TEST_DB_URL;
  });

  it("parses a single connection file", () => {
    const yaml = `
name: warehouse
type: postgres
host: \${TEST_DB_HOST}
port: 5432
database: analytics
password: \${TEST_DB_PASS}
ssl: true
pool_size: 10
`;
    const result = parseConnectionFile("warehouse.yaml", yaml);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("warehouse");
    expect(result[0].config.type).toBe("postgres");
    expect(result[0].config.host).toBe("localhost");
    expect(result[0].config.port).toBe(5432);
    expect(result[0].config.password).toBe("secret123");
    expect(result[0].config.ssl).toBe(true);
    expect(result[0].config.pool_size).toBe(10);
  });

  it("parses a multi-connection file", () => {
    const yaml = `
connections:
  - name: production
    type: postgres
    connection_string: \${TEST_DB_URL}
  - name: analytics
    type: duckdb
    path: ./data/analytics.duckdb
  - name: local
    type: sqlite
    path: ./data/local.db
`;
    const result = parseConnectionFile("databases.yaml", yaml);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("production");
    expect(result[0].config.connection_string).toBe("postgres://user:pass@host/db");
    expect(result[1].name).toBe("analytics");
    expect(result[1].config.type).toBe("duckdb");
    expect(result[2].name).toBe("local");
    expect(result[2].config.type).toBe("sqlite");
  });

  it("throws on empty file", () => {
    expect(() => parseConnectionFile("empty.yaml", "")).toThrow("empty");
  });

  it("throws on invalid format (no name/type)", () => {
    expect(() => parseConnectionFile("bad.yaml", "foo: bar\n")).toThrow("invalid format");
  });

  it("throws on missing env var with clear message", () => {
    const yaml = `
name: broken
type: postgres
password: \${NONEXISTENT_VAR}
`;
    expect(() => parseConnectionFile("broken.yaml", yaml)).toThrow(
      "Connection 'broken': environment variable NONEXISTENT_VAR is not set",
    );
  });
});

describe("loadConnectionFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "orrery-conn-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it("loads all YAML files from a directory", () => {
    writeFileSync(
      join(tmpDir, "a.yaml"),
      "name: alpha\ntype: sqlite\npath: ./a.db\n",
    );
    writeFileSync(
      join(tmpDir, "b.yml"),
      "name: beta\ntype: duckdb\npath: \":memory:\"\n",
    );
    // non-yaml files should be ignored
    writeFileSync(join(tmpDir, "readme.txt"), "not a connection");

    const result = loadConnectionFiles(tmpDir);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("returns empty array for empty directory", () => {
    const result = loadConnectionFiles(tmpDir);
    expect(result).toHaveLength(0);
  });

  it("throws on duplicate connection names", () => {
    writeFileSync(
      join(tmpDir, "a.yaml"),
      "name: dup\ntype: sqlite\npath: ./a.db\n",
    );
    writeFileSync(
      join(tmpDir, "b.yaml"),
      "name: dup\ntype: sqlite\npath: ./b.db\n",
    );
    expect(() => loadConnectionFiles(tmpDir)).toThrow("Duplicate connection name 'dup'");
  });
});
