import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { LocalSource } from "../../src/sources/local.js";
import { createConnectionSource } from "../../src/sources/factory.js";
import { loadConnectionFilesFromSource } from "../../src/connections/loader.js";
import type { DashboardSourceEvent } from "../../src/sources/types.js";

const TMP = resolve(__dirname, "../.tmp-remote-connections");

beforeEach(() => {
  mkdirSync(resolve(TMP, "connections"), { recursive: true });
  process.env.TEST_REMOTE_HOST = "db.example.com";
  process.env.TEST_REMOTE_PASS = "s3cret";
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.TEST_REMOTE_HOST;
  delete process.env.TEST_REMOTE_PASS;
});

describe("LocalSource with custom extensions", () => {
  it("lists .yaml and .yml files when configured", async () => {
    writeFileSync(resolve(TMP, "connections/db.yaml"), "name: db\ntype: sqlite\npath: ./a.db");
    writeFileSync(resolve(TMP, "connections/cache.yml"), "name: cache\ntype: duckdb\npath: :memory:");
    writeFileSync(resolve(TMP, "connections/readme.md"), "not a connection");
    writeFileSync(resolve(TMP, "connections/test.board"), "not a connection");

    const source = new LocalSource(resolve(TMP, "connections"), [".yaml", ".yml"]);
    const files = await source.list();

    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".yaml") || f.endsWith(".yml"))).toBe(true);
  });

  it("watches only .yaml/.yml files", async () => {
    const source = new LocalSource(resolve(TMP, "connections"), [".yaml", ".yml"]);
    const events: DashboardSourceEvent[] = [];
    source.watch!((event) => events.push(event));

    await new Promise((r) => setTimeout(r, 500));

    // Should trigger
    writeFileSync(resolve(TMP, "connections/new.yaml"), "name: new\ntype: sqlite\npath: ./b.db");
    // Should NOT trigger
    writeFileSync(resolve(TMP, "connections/ignore.board"), "dashboard content");

    await new Promise((r) => setTimeout(r, 1000));
    source.unwatch!();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.path.endsWith(".yaml") || e.path.endsWith(".yml"))).toBe(true);
  });
});

describe("createConnectionSource", () => {
  it("creates a local source for bare paths", async () => {
    writeFileSync(resolve(TMP, "connections/db.yaml"), "name: db\ntype: sqlite\npath: ./a.db");

    const source = await createConnectionSource({
      uri: resolve(TMP, "connections"),
    });

    const files = await source.list();
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("db.yaml");
  });

  it("creates a local source for file:// URIs", async () => {
    writeFileSync(resolve(TMP, "connections/db.yaml"), "name: db\ntype: sqlite\npath: ./a.db");

    const source = await createConnectionSource({
      uri: `file://${resolve(TMP, "connections")}`,
    });

    const files = await source.list();
    expect(files).toHaveLength(1);
  });

  it("throws for unimplemented schemes", async () => {
    await expect(
      createConnectionSource({ uri: "https://example.com/connections/" }),
    ).rejects.toThrow("not yet implemented");
  });

  it("creates a GCS source for gs:// URIs", async () => {
    const source = await createConnectionSource({
      uri: "gs://bucket/connections/",
    });
    expect(source.describe()).toContain("gs://bucket/connections/");
  });
});

describe("loadConnectionFilesFromSource", () => {
  it("loads connections from a source", async () => {
    writeFileSync(
      resolve(TMP, "connections/warehouse.yaml"),
      `name: warehouse\ntype: postgres\nhost: \${TEST_REMOTE_HOST}\npassword: \${TEST_REMOTE_PASS}\n`,
    );
    writeFileSync(
      resolve(TMP, "connections/local.yml"),
      `name: local\ntype: sqlite\npath: ./data.db\n`,
    );

    const source = new LocalSource(resolve(TMP, "connections"), [".yaml", ".yml"]);
    const connections = await loadConnectionFilesFromSource(source);

    expect(connections).toHaveLength(2);
    expect(connections.map((c) => c.name).sort()).toEqual(["local", "warehouse"]);
    // Env vars should be resolved
    expect(connections.find((c) => c.name === "warehouse")!.config.host).toBe("db.example.com");
    expect(connections.find((c) => c.name === "warehouse")!.config.password).toBe("s3cret");
  });

  it("returns empty array when source has no files", async () => {
    const source = new LocalSource(resolve(TMP, "connections"), [".yaml", ".yml"]);
    const connections = await loadConnectionFilesFromSource(source);
    expect(connections).toHaveLength(0);
  });

  it("throws on duplicate connection names", async () => {
    writeFileSync(
      resolve(TMP, "connections/a.yaml"),
      `name: dup\ntype: sqlite\npath: ./a.db\n`,
    );
    writeFileSync(
      resolve(TMP, "connections/b.yaml"),
      `name: dup\ntype: sqlite\npath: ./b.db\n`,
    );

    const source = new LocalSource(resolve(TMP, "connections"), [".yaml", ".yml"]);
    await expect(loadConnectionFilesFromSource(source)).rejects.toThrow(
      "Duplicate connection name 'dup'",
    );
  });

  it("resolves env vars from local process.env", async () => {
    writeFileSync(
      resolve(TMP, "connections/db.yaml"),
      `name: remote_db\ntype: postgres\nhost: \${TEST_REMOTE_HOST}\n`,
    );

    const source = new LocalSource(resolve(TMP, "connections"), [".yaml", ".yml"]);
    const connections = await loadConnectionFilesFromSource(source);

    expect(connections[0].config.host).toBe("db.example.com");
  });
});
