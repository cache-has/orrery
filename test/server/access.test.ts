import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  resolveAccess,
  isFolderAllowed,
  filterDashboards,
  accessMiddleware,
  type AccessConfig,
} from "../../src/server/access.js";
import type { DiscoveredDashboard } from "../../src/server/discovery.js";

const cfg: AccessConfig = {
  enabled: true,
  foldersHeader: "x-orrery-folders",
  canEditHeader: "x-orrery-can-edit",
  requireFolder: true,
};

function dash(slug: string, folder: string): DiscoveredDashboard {
  return { slug, filePath: `${folder ? folder + "/" : ""}${slug}.board`, title: slug, folder, lastModified: new Date(0) };
}

const DASHBOARDS = [dash("revenue-mrr", "revenue"), dash("elt-overview", "elt"), dash("root-thing", "")];

function makeContext(headers: Record<string, string>) {
  return { req: { header: (k: string) => headers[k.toLowerCase()] } } as never;
}

describe("resolveAccess", () => {
  it("parses '*' as all folders (null)", () => {
    const a = resolveAccess(makeContext({ "x-orrery-folders": "*" }), cfg);
    expect(a.folders).toBeNull();
  });
  it("parses a csv list into a set", () => {
    const a = resolveAccess(makeContext({ "x-orrery-folders": "revenue, marketing" }), cfg);
    expect([...(a.folders as Set<string>)].sort()).toEqual(["marketing", "revenue"]);
  });
  it("missing header is fail-closed (empty set)", () => {
    const a = resolveAccess(makeContext({}), cfg);
    expect(a.folders).toEqual(new Set());
  });
  it("reads the edit capability", () => {
    expect(resolveAccess(makeContext({ "x-orrery-can-edit": "1" }), cfg).canEdit).toBe(true);
    expect(resolveAccess(makeContext({ "x-orrery-can-edit": "true" }), cfg).canEdit).toBe(true);
    expect(resolveAccess(makeContext({}), cfg).canEdit).toBe(false);
  });
});

describe("isFolderAllowed / filterDashboards", () => {
  it("'*' allows every non-root folder", () => {
    const a = { folders: null, canEdit: false };
    expect(isFolderAllowed(a, "revenue", cfg)).toBe(true);
    expect(isFolderAllowed(a, "", cfg)).toBe(false); // root never served
  });
  it("scopes to the granted folders", () => {
    const a = { folders: new Set(["revenue"]), canEdit: false };
    expect(filterDashboards(DASHBOARDS, a, cfg).map((d) => d.slug)).toEqual(["revenue-mrr"]);
  });
  it("respects require_folder=false (root allowed)", () => {
    const a = { folders: null, canEdit: false };
    expect(isFolderAllowed(a, "", { ...cfg, requireFolder: false })).toBe(true);
  });
});

describe("accessMiddleware", () => {
  function app() {
    const a = new Hono();
    a.use("*", accessMiddleware(cfg, () => DASHBOARDS));
    a.get("/d/:name", (c) => c.text("rendered"));
    a.post("/api/query", (c) => c.json({ ok: true }));
    a.get("/edit", (c) => c.text("editor"));
    a.post("/api/save/:name", (c) => c.text("saved"));
    return a;
  }
  const folders = (v: string) => ({ "x-orrery-folders": v });

  it("renders a dashboard in a granted folder", async () => {
    const res = await app().request("/d/revenue-mrr", { headers: folders("revenue") });
    expect(res.status).toBe(200);
  });
  it("404s a dashboard in a non-granted folder", async () => {
    const res = await app().request("/d/revenue-mrr", { headers: folders("elt") });
    expect(res.status).toBe(404);
  });
  it("404s a root dashboard (require_folder)", async () => {
    const res = await app().request("/d/root-thing", { headers: folders("*") });
    expect(res.status).toBe(404);
  });
  it("404s /api/query for a non-granted dashboard", async () => {
    const res = await app().request("/api/query", {
      method: "POST",
      headers: { ...folders("revenue"), "content-type": "application/json" },
      body: JSON.stringify({ dashboard: "elt-overview", params: {} }),
    });
    expect(res.status).toBe(404);
  });
  it("403s the editor without the edit capability", async () => {
    expect((await app().request("/edit", { headers: folders("*") })).status).toBe(403);
    expect((await app().request("/api/save/x", { method: "POST", headers: folders("*") })).status).toBe(403);
  });
  it("allows the editor with the edit capability", async () => {
    const headers = { "x-orrery-folders": "*", "x-orrery-can-edit": "1" };
    expect((await app().request("/edit", { headers })).status).toBe(200);
  });
});
