import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { dashboardRoutes, dashboardCacheTtl } from "../../src/server/routes/dashboard.js";
import { fetchDashboardData } from "../../src/renderer/data.js";
import { QueryExecutor } from "../../src/query/executor.js";
import { parse } from "../../src/parser/parser.js";
import { startCacheWarmer, warmIntervalSeconds } from "../../src/server/warmer.js";
import type { ProjectConfig } from "../../src/server/discovery.js";
import { fakeConnection, tick, type FakeConnectionOptions } from "../helpers/fake-connection.js";

const TEST_DIR = resolve(tmpdir(), "orrery-progressive-test-" + process.pid);
const BOARD_DIR = resolve(TEST_DIR, "dashboards");

const BOARD = `dashboard "Mixed" {
  connection: "db"

  row {
    metric "Fast" (span: 4) {
      query: "SELECT fast"
    }
    metric "Slow" (span: 4) {
      query: "SELECT slow"
    }
    metric "Slower" (span: 4) {
      query: "SELECT crawl"
    }
  }
  row {
    text "Notes" {
      > No query here.
    }
  }
}`;

const REFRESH_BOARD = `dashboard "Live" {
  connection: "db"
  refresh: 60

  row {
    metric "Now" {
      query: "SELECT now"
    }
  }
}`;

const CONFIG = { cache_ttl: 300 } as ProjectConfig;

beforeAll(() => {
  mkdirSync(BOARD_DIR, { recursive: true });
  writeFileSync(join(BOARD_DIR, "mixed.board"), BOARD);
  writeFileSync(join(BOARD_DIR, "live.board"), REFRESH_BOARD);
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function setup(options: FakeConnectionOptions = {}, config?: Partial<ProjectConfig>) {
  const db = fakeConnection(options);
  const executor = new QueryExecutor(db.manager, { slowQueryMs: 0, defaultCacheTtl: config?.cache_ttl });
  const app = new Hono();
  app.route("/", dashboardRoutes({ boardDir: BOARD_DIR, executor, config: config as ProjectConfig }));
  return { db, executor, app };
}

function postQuery(app: Hono, body: object) {
  return app.request("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dashboard: "mixed", params: {}, ...body }),
  });
}

function pageState(html: string): { pending: string[] } {
  const match = html.match(/window\.__ORRERY__ = (.*);\n/);
  if (!match) throw new Error("no serialized state in page");
  return JSON.parse(match[1]);
}

describe("fetchDashboardData options", () => {
  const dashboard = parse(BOARD);

  it("runs only the requested components", async () => {
    const { db, executor } = setup();
    const data = await fetchDashboardData(dashboard, executor, {}, { only: ["slow"] });
    expect(db.calls).toEqual(["SELECT slow"]);
    expect([...data.components.keys()]).toEqual(["slow"]);
  });

  it("returns at the deadline with unfinished components listed as pending", async () => {
    const { executor } = setup({ delays: { slow: 60, crawl: 90 } });
    const data = await fetchDashboardData(dashboard, executor, {}, { deadlineMs: 20 });
    expect(data.pending).toEqual(["slow", "slower"]);
    expect(data.components.get("fast")?.result?.rowCount).toBe(1);
    expect(data.components.has("slow")).toBe(false);
  });

  it("has nothing pending when everything beats the deadline", async () => {
    const { executor } = setup();
    const data = await fetchDashboardData(dashboard, executor, {}, { deadlineMs: 200 });
    expect(data.pending).toEqual([]);
    expect(data.components.size).toBe(4);
  });

  it("reports each component as it completes", async () => {
    const { executor } = setup({ delays: { fast: 30, slow: 10, crawl: 20 } });
    const order: string[] = [];
    await fetchDashboardData(dashboard, executor, {}, { onComponent: (id) => order.push(id) });
    expect(order).toEqual(["slow", "slower", "fast"]);
  });

  it("limits how many of the dashboard's queries run at once", async () => {
    const { db, executor } = setup({ delays: { SELECT: 5 } });
    await fetchDashboardData(dashboard, executor, {}, { concurrency: 1 });
    expect(db.peak()).toBe(1);
    expect(db.calls).toHaveLength(3);
  });

  it("labels queries with dashboard and component for the slow query log", async () => {
    const db = fakeConnection({ delays: { slow: 10 } });
    const lines: string[] = [];
    const executor = new QueryExecutor(db.manager, { slowQueryMs: 5, log: (m) => lines.push(m) });
    await fetchDashboardData(dashboard, executor, {}, { label: "mixed" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("mixed/slow");
  });
});

describe("GET /d/:name — rendering does not wait for slow queries", () => {
  it("sends the page at the deadline with placeholders for unfinished components", async () => {
    const { app } = setup({ delays: { slow: 150, crawl: 150 } }, { render_deadline_ms: 20 });
    const started = Date.now();
    const res = await app.request("/d/mixed");
    const html = await res.text();

    expect(Date.now() - started).toBeLessThan(140);
    expect(pageState(html).pending).toEqual(["slow", "slower"]);
    expect(html.match(/class="orrery-pending"/g)).toHaveLength(2);
    // The component that finished in time is rendered in the page as before.
    expect(html).toContain("SELECT fast");
  });

  it("server-renders everything when every query beats the deadline", async () => {
    const { app } = setup();
    const html = await (await app.request("/d/mixed")).text();
    expect(pageState(html).pending).toEqual([]);
    expect(html).not.toContain('class="orrery-pending"');
  });

  it("waits for every query when the deadline is disabled", async () => {
    const { app } = setup({ delays: { slow: 40 } }, { render_deadline_ms: 0 });
    const html = await (await app.request("/d/mixed")).text();
    expect(pageState(html).pending).toEqual([]);
  });

  it("lets the follow-up request join the still-running query instead of starting another", async () => {
    const { app, db } = setup({ delays: { slow: 60, crawl: 60 } }, { render_deadline_ms: 10 });
    const html = await (await app.request("/d/mixed")).text();
    const { pending } = pageState(html);

    const res = await postQuery(app, { components: pending, format: "html" });
    const body = (await res.json()) as { html: Record<string, string> };

    expect(Object.keys(body.html).sort()).toEqual(["slow", "slower"]);
    expect(db.calls.filter((sql) => sql === "SELECT slow")).toHaveLength(1);
    expect(db.calls.filter((sql) => sql === "SELECT crawl")).toHaveLength(1);
  });
});

describe("POST /api/query — scoped, streamed, cancellable", () => {
  it("executes only the requested components", async () => {
    const { app, db } = setup();
    const res = await postQuery(app, { components: ["fast"] });
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(Object.keys(body.data)).toEqual(["fast"]);
    expect(db.calls).toEqual(["SELECT fast"]);
  });

  it("still executes the whole dashboard when no components are named", async () => {
    const { app, db } = setup();
    await postQuery(app, {});
    expect(db.calls).toHaveLength(3);
  });

  it("streams one line per component in completion order, then a done marker", async () => {
    const { app } = setup({ delays: { fast: 40, slow: 10, crawl: 25 } });
    const res = await postQuery(app, { stream: true, format: "html" });

    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

    expect(lines.map((l) => l.id ?? "done")).toEqual(["slow", "slower", "fast", "notes", "done"]);
    expect(lines[0].html).toContain("orrery-component-body");
    expect(lines.at(-1)).toEqual({ done: true });
  });

  it("streams raw data when HTML is not requested", async () => {
    const { app } = setup();
    const res = await postQuery(app, { stream: true, components: ["fast"] });
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].id).toBe("fast");
    expect(lines[0].data.result.rowCount).toBe(1);
  });

  it("serves a repeat request from the cache and bypasses it when fresh is set", async () => {
    const { app, db } = setup({}, CONFIG);
    await postQuery(app, { components: ["fast"] });
    await postQuery(app, { components: ["fast"] });
    expect(db.calls).toHaveLength(1);

    await postQuery(app, { components: ["fast"], fresh: true });
    expect(db.calls).toHaveLength(2);
  });

  it("drops queued queries when the client disconnects", async () => {
    const { app, db } = setup({ poolSize: 1, hold: ["fast"] });
    const abort = new AbortController();
    const pending = app.request("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboard: "mixed", params: {} }),
      signal: abort.signal,
    });
    await tick(20);
    expect(db.calls).toEqual(["SELECT fast"]);

    abort.abort();
    await tick(20);
    db.release("fast");
    await pending.catch(() => undefined);
    await tick(20);

    // The two queries still waiting for the single slot were never sent.
    expect(db.calls).toEqual(["SELECT fast"]);
  });
});

describe("dashboardCacheTtl", () => {
  it("uses the configured TTL", () => {
    expect(dashboardCacheTtl(parse(BOARD), CONFIG)).toBe(300);
  });

  it("caps the TTL at the dashboard's refresh interval", () => {
    expect(dashboardCacheTtl(parse(REFRESH_BOARD), CONFIG)).toBe(60);
    expect(dashboardCacheTtl(parse(REFRESH_BOARD), { cache_ttl: 30 } as ProjectConfig)).toBe(30);
  });

  it("defers to the executor when there is no config", () => {
    expect(dashboardCacheTtl(parse(BOARD), undefined)).toBeUndefined();
  });
});

describe("cache warmer", () => {
  function warmerFor(options: FakeConnectionOptions = {}) {
    const db = fakeConnection(options);
    const executor = new QueryExecutor(db.manager, { slowQueryMs: 0, defaultCacheTtl: 300 });
    const lines: string[] = [];
    const warmer = startCacheWarmer({
      executor,
      config: CONFIG,
      boardDir: BOARD_DIR,
      getDashboards: () =>
        ["mixed", "live", "missing"].map((slug) => ({
          slug,
          filePath: join(BOARD_DIR, `${slug}.board`),
          title: slug,
          folder: "",
          lastModified: new Date(),
        })),
      log: (m) => lines.push(m),
    });
    return { db, executor, warmer, lines };
  }

  it("populates the cache so a later request does not reach the database", async () => {
    const { db, executor, warmer } = warmerFor();
    const result = await warmer.runOnce();
    warmer.stop();

    expect(result.dashboards).toBe(3);
    expect(result.failed).toBe(0);
    expect(db.calls).toHaveLength(4);

    await fetchDashboardData(parse(BOARD), executor, {}, { cacheTtl: 300 });
    expect(db.calls).toHaveLength(4);
  });

  it("runs one query at a time", async () => {
    const { db, warmer } = warmerFor({ delays: { SELECT: 3 } });
    await warmer.runOnce();
    warmer.stop();
    expect(db.peak()).toBe(1);
  });

  it("replaces cached results rather than reading them back", async () => {
    const { db, warmer } = warmerFor();
    await warmer.runOnce();
    await warmer.runOnce();
    warmer.stop();
    expect(db.calls).toHaveLength(8);
  });

  it("does not stack a pass on top of one that is still running", async () => {
    const { db, warmer } = warmerFor({ delays: { SELECT: 5 } });
    const [a, b] = await Promise.all([warmer.runOnce(), warmer.runOnce()]);
    warmer.stop();
    expect(a).toBe(b);
    expect(db.calls).toHaveLength(4);
  });

  it("re-warms before entries expire", () => {
    expect(warmIntervalSeconds(300)).toBe(240);
    expect(warmIntervalSeconds(10)).toBe(30);
  });
});
