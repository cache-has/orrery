import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/server/index.js";
import { LocalSource } from "../../src/sources/local.js";
import { ConnectionManager } from "../../src/connections/manager.js";
import type { DiscoveredDashboard } from "../../src/server/discovery.js";
import type { AccessConfig } from "../../src/server/access.js";

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

describe("editor routes — cache invalidation + source fallback", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });
  afterEach(() => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  it("invokes onSourceChange after /api/new so subsequent reads hit the fresh cache", async () => {
    const source = new LocalSource(dir, undefined, { writable: true });
    let dashboards: DiscoveredDashboard[] = [];
    let refreshes = 0;
    const app = createApp({
      editor: {
        enabled: true,
        source,
        resolveNewPath: (name) => join(dir, `${name}.board`),
        onSourceChange: async () => {
          refreshes++;
          dashboards = [
            {
              slug: "carts-and-conversions",
              filePath: join(dir, "carts-and-conversions.board"),
              title: "Carts and Conversions",
              folder: "",
              lastModified: new Date(),
            },
          ];
        },
      },
      getDashboards: () => dashboards,
    });

    const created = await app.request("/api/new", {
      method: "POST",
      body: JSON.stringify({ name: "carts-and-conversions" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(created.status).toBe(201);
    expect(refreshes).toBe(1);

    const read = await app.request("/api/dashboards/carts-and-conversions");
    expect(read.status).toBe(200);
    expect(await read.text()).toContain("New Dashboard");
  });

  it("falls back to source.list() when the dashboard isn't in the cache yet", async () => {
    // Simulates the race: file exists at the source but the cache hasn't been
    // refreshed. Reads should still succeed via the source fallback.
    const source = new LocalSource(dir, undefined, { writable: true });
    writeFileSync(
      join(dir, "late-arrival.board"),
      `dashboard "Late" {\n  text {\n    hi\n  }\n}`,
    );
    const app = createApp({
      editor: { enabled: true, source },
      getDashboards: () => [], // cache is stale/empty
    });

    const res = await app.request("/api/dashboards/late-arrival");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Late");
  });
});

describe("editor routes — folder authorization", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });
  afterEach(() => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  const accessCfg: AccessConfig = {
    enabled: true,
    foldersHeader: "x-openboard-folders",
    canEditHeader: "x-openboard-can-edit",
    requireFolder: true,
  };

  // Two dashboards in distinct folders plus one at the root.
  function setup() {
    const source = new LocalSource(dir, undefined, { writable: true });
    mkdirSync(join(dir, "revenue"), { recursive: true });
    mkdirSync(join(dir, "marketing"), { recursive: true });
    const body = (t: string) => `dashboard "${t}" {\n  text {\n    hi\n  }\n}`;
    writeFileSync(join(dir, "revenue", "mrr.board"), body("MRR"));
    writeFileSync(join(dir, "marketing", "spend.board"), body("Spend"));
    writeFileSync(join(dir, "root-thing.board"), body("Root"));
    const dashboards: DiscoveredDashboard[] = [
      { slug: "mrr", filePath: join(dir, "revenue", "mrr.board"), title: "MRR", folder: "revenue", lastModified: new Date() },
      { slug: "spend", filePath: join(dir, "marketing", "spend.board"), title: "Spend", folder: "marketing", lastModified: new Date() },
      { slug: "root-thing", filePath: join(dir, "root-thing.board"), title: "Root", folder: "", lastModified: new Date() },
    ];
    const app = createApp({
      editor: { enabled: true, source, resolveNewPath: (name) => join(dir, `${name}.board`) },
      getDashboards: () => dashboards,
      access: accessCfg,
    });
    return app;
  }

  const hdr = (folders: string, canEdit = true) => ({
    "x-openboard-folders": folders,
    ...(canEdit ? { "x-openboard-can-edit": "1" } : {}),
    "Content-Type": "text/plain",
  });

  it("reads a dashboard in a granted folder", async () => {
    const res = await setup().request("/api/dashboards/mrr", { headers: hdr("revenue") });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("MRR");
  });

  it("404s reading a dashboard in a non-granted folder (no existence leak)", async () => {
    const res = await setup().request("/api/dashboards/mrr", { headers: hdr("marketing") });
    expect(res.status).toBe(404);
  });

  it("404s reading a root dashboard even with '*' (require_folder)", async () => {
    const res = await setup().request("/api/dashboards/root-thing", { headers: hdr("*") });
    expect(res.status).toBe(404);
  });

  it("saves over a dashboard in a granted folder", async () => {
    const res = await setup().request("/api/save/mrr", {
      method: "POST",
      headers: hdr("revenue"),
      body: `dashboard "MRR" {\n  text {\n    updated\n  }\n}`,
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(dir, "revenue", "mrr.board"), "utf-8")).toContain("updated");
  });

  it("404s saving over a dashboard in a non-granted folder (and does not write)", async () => {
    const app = setup();
    const before = readFileSync(join(dir, "revenue", "mrr.board"), "utf-8");
    const res = await app.request("/api/save/mrr", {
      method: "POST",
      headers: hdr("marketing"),
      body: `dashboard "MRR" {\n  text {\n    hijacked\n  }\n}`,
    });
    expect(res.status).toBe(404);
    expect(readFileSync(join(dir, "revenue", "mrr.board"), "utf-8")).toBe(before);
  });

  it("403s the editor without the edit capability", async () => {
    const res = await setup().request("/api/dashboards/mrr", { headers: hdr("revenue", false) });
    expect(res.status).toBe(403);
  });
});

describe("editor routes — folder-aware /api/new", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });
  afterEach(() => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); });

  const accessCfg: AccessConfig = {
    enabled: true,
    foldersHeader: "x-openboard-folders",
    canEditHeader: "x-openboard-can-edit",
    requireFolder: true,
  };

  function setup(dashboards: DiscoveredDashboard[] = []) {
    const source = new LocalSource(dir, undefined, { writable: true });
    return createApp({
      editor: {
        enabled: true,
        source,
        resolveNewPath: (name, folder) => join(dir, folder ?? "", `${name}.board`),
      },
      getDashboards: () => dashboards,
      access: accessCfg,
    });
  }

  const hdr = (folders: string) => ({
    "x-openboard-folders": folders,
    "x-openboard-can-edit": "1",
    "Content-Type": "application/json",
  });

  it("422 when requireFolder is on and no folder is given", async () => {
    const res = await setup().request("/api/new", {
      method: "POST",
      headers: hdr("revenue"),
      body: JSON.stringify({ name: "new-report" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/folder is required/i);
  });

  it("creates in a granted folder and writes under that prefix", async () => {
    const res = await setup().request("/api/new", {
      method: "POST",
      headers: hdr("revenue"),
      body: JSON.stringify({ name: "new-report", folder: "revenue" }),
    });
    expect(res.status).toBe(201);
    expect(existsSync(join(dir, "revenue", "new-report.board"))).toBe(true);
  });

  it("403 when creating in a folder the caller does not hold", async () => {
    const res = await setup().request("/api/new", {
      method: "POST",
      headers: hdr("revenue"),
      body: JSON.stringify({ name: "sneaky", folder: "marketing" }),
    });
    expect(res.status).toBe(403);
    expect(existsSync(join(dir, "marketing", "sneaky.board"))).toBe(false);
  });

  it("422 on a folder with an invalid (nested) name", async () => {
    const res = await setup().request("/api/new", {
      method: "POST",
      headers: hdr("*"),
      body: JSON.stringify({ name: "x", folder: "revenue/sub" }),
    });
    expect(res.status).toBe(422);
  });

  it("GET /api/folders returns the granted set and required flag", async () => {
    const res = await setup().request("/api/folders", { headers: hdr("revenue, marketing") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.required).toBe(true);
    expect(body.folders.sort()).toEqual(["marketing", "revenue"]);
  });

  it("GET /api/folders for '*' returns folders that have dashboards", async () => {
    const dashboards: DiscoveredDashboard[] = [
      { slug: "mrr", filePath: join(dir, "revenue", "mrr.board"), title: "MRR", folder: "revenue", lastModified: new Date() },
      { slug: "ops", filePath: join(dir, "reliability", "ops.board"), title: "Ops", folder: "reliability", lastModified: new Date() },
    ];
    const res = await setup(dashboards).request("/api/folders", { headers: hdr("*") });
    const body = await res.json();
    expect(body.folders).toEqual(["reliability", "revenue"]);
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
