import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/server/index.js";
import { LocalSource } from "../../src/sources/local.js";
import { ConnectionManager } from "../../src/connections/manager.js";
import type { DiscoveredDashboard } from "../../src/server/discovery.js";

function makeDir() {
  const dir = resolve(tmpdir(), "openboard-editor-test-" + process.pid + "-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeDashboards(dir: string): DiscoveredDashboard[] {
  return [
    {
      slug: "sales",
      filePath: join(dir, "sales.board"),
      title: "Sales",
      folder: "",
      lastModified: new Date(),
    },
  ];
}

describe("editor routes — flag gating", () => {
  it("returns 404 on /edit and API routes when disabled", async () => {
    const app = createApp({ editor: { enabled: false } });
    for (const path of ["/edit", "/edit/foo", "/api/connections", "/api/dashboards/foo"]) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
    }
    const validate = await app.request("/api/validate", { method: "POST", body: "dashboard \"x\" {}" });
    expect(validate.status).toBe(404);
  });

  it("serves HTML stub on /edit when enabled", async () => {
    const app = createApp({ editor: { enabled: true } });
    const res = await app.request("/edit");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("html");
  });

  it("rejects path traversal on /edit/:name", async () => {
    const app = createApp({ editor: { enabled: true } });
    for (const bad of ["foo.bar", "foo%20bar", "foo%00bar", ".hidden"]) {
      const res = await app.request(`/edit/${bad}`);
      expect(res.status, `name=${bad}`).toBe(404);
    }
  });
});

describe("editor routes — /api/connections leakage", () => {
  it("returns only name and type, no credential fields", async () => {
    const cm = new ConnectionManager();
    await cm.register("warehouse", {
      type: "sqlite",
      path: ":memory:",
      host: "secret.internal",
      password: "supersecret",
    } as any, "/dev/null");
    const app = createApp({ editor: { enabled: true, connManager: cm } });
    const res = await app.request("/api/connections");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toHaveLength(1);
    const conn = body.connections[0];
    expect(Object.keys(conn).sort()).toEqual(["name", "type"]);
    expect(JSON.stringify(body)).not.toContain("supersecret");
    expect(JSON.stringify(body)).not.toContain("secret.internal");
    await cm.disconnectAll();
  });
});

describe("editor routes — save validation + path resolution", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });
  afterEach(() => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  it("422 when DSL has error diagnostics", async () => {
    const source = new LocalSource(dir, undefined, { writable: true });
    writeFileSync(join(dir, "sales.board"), `dashboard "Sales" {\n  text {\n    hello\n  }\n}`);
    const app = createApp({
      editor: { enabled: true, source },
      getDashboards: () => makeDashboards(dir),
    });
    const res = await app.request("/api/save/sales", {
      method: "POST",
      body: "not valid board syntax at all!!!",
      headers: { "Content-Type": "text/plain" },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid");
    expect(Array.isArray(body.diagnostics)).toBe(true);
  });

  it("409 when source is read-only", async () => {
    const source = new LocalSource(dir, undefined, { writable: false });
    writeFileSync(join(dir, "sales.board"), `dashboard "Sales" {\n  text {\n    hello\n  }\n}`);
    const app = createApp({
      editor: { enabled: true, source },
      getDashboards: () => makeDashboards(dir),
    });
    const res = await app.request("/api/save/sales", {
      method: "POST",
      body: `dashboard "Sales" {\n  text {\n    hello\n  }\n}`,
      headers: { "Content-Type": "text/plain" },
    });
    expect(res.status).toBe(409);
    // (assert message already below)
    expect((await res.json()).error).toBe("readonly");
  });

  it("round-trip: save valid content then read it back", async () => {
    const source = new LocalSource(dir, undefined, { writable: true });
    const filePath = join(dir, "sales.board");
    writeFileSync(filePath, `dashboard "Sales" {\n  text {\n    hello\n  }\n}`);
    const app = createApp({
      editor: { enabled: true, source },
      getDashboards: () => makeDashboards(dir),
    });
    const updated = `dashboard "Sales" {\n  text {\n    updated\n  }\n}`;
    const save = await app.request("/api/save/sales", {
      method: "POST",
      body: updated,
      headers: { "Content-Type": "text/plain" },
    });
    expect(save.status).toBe(200);
    expect(readFileSync(filePath, "utf-8")).toBe(updated);

    const read = await app.request("/api/dashboards/sales");
    expect(read.status).toBe(200);
    expect(await read.text()).toBe(updated);
  });
});

describe("editor routes — /api/new", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });
  afterEach(() => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  it("creates a new dashboard from the starter template", async () => {
    const source = new LocalSource(dir, undefined, { writable: true });
    const app = createApp({
      editor: {
        enabled: true,
        source,
        resolveNewPath: (name) => join(dir, `${name}.board`),
      },
      getDashboards: () => [],
    });
    const res = await app.request("/api/new", {
      method: "POST",
      body: JSON.stringify({ name: "new-report" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("new-report");
    const contents = readFileSync(join(dir, "new-report.board"), "utf-8");
    expect(contents).toContain("New Dashboard");
  });

  it("409 when name already exists", async () => {
    const source = new LocalSource(dir, undefined, { writable: true });
    const filePath = join(dir, "sales.board");
    writeFileSync(filePath, `dashboard "Sales" {\n  text {\n    hello\n  }\n}`);
    const app = createApp({
      editor: {
        enabled: true,
        source,
        resolveNewPath: (name) => join(dir, `${name}.board`),
      },
      getDashboards: () => makeDashboards(dir),
    });
    const res = await app.request("/api/new", {
      method: "POST",
      body: JSON.stringify({ name: "sales" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("exists");
  });

  it("422 on invalid name (path traversal, dots, spaces)", async () => {
    const source = new LocalSource(dir, undefined, { writable: true });
    const app = createApp({
      editor: {
        enabled: true,
        source,
        resolveNewPath: (name) => join(dir, `${name}.board`),
      },
      getDashboards: () => [],
    });
    for (const bad of ["../evil", "foo/bar", ".hidden", "has space", "bad.name", ""]) {
      const res = await app.request("/api/new", {
        method: "POST",
        body: JSON.stringify({ name: bad }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status, `name=${bad}`).toBe(422);
    }
  });
});

describe("editor routes — /api/validate", () => {
  it("returns diagnostics without persisting", async () => {
    const app = createApp({ editor: { enabled: true } });
    const good = await app.request("/api/validate", {
      method: "POST",
      body: `dashboard "Hi" { text "x" }`,
      headers: { "Content-Type": "text/plain" },
    });
    expect(good.status).toBe(200);
    const body = await good.json();
    expect(Array.isArray(body.diagnostics)).toBe(true);
  });

  it("reports error-level diagnostic for parse failure", async () => {
    const app = createApp({ editor: { enabled: true } });
    const res = await app.request("/api/validate", {
      method: "POST",
      body: `not a dashboard`,
      headers: { "Content-Type": "text/plain" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const errors = body.diagnostics.filter((d: any) => d.level === "error");
    expect(errors.length).toBeGreaterThan(0);
  });
});
