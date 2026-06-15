import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { dashboardRoutes } from "../../src/server/routes/dashboard.js";
import { ConnectionManager } from "../../src/connections/manager.js";
import { QueryExecutor } from "../../src/query/executor.js";
import { Hono } from "hono";

const TEST_DIR = resolve(tmpdir(), "orrery-routes-test-" + process.pid);
const BOARD_DIR = resolve(TEST_DIR, "dashboards");

const TEXT_BOARD = `dashboard "Hello" {
  description: "A text-only dashboard"

  row {
    text "Intro" {
      > Welcome to **Orrery**.
    }
  }
}`;

const QUERY_BOARD = `dashboard "Sales" {
  description: "Dashboard with queries"
  connection: "test_db"

  row {
    metric "Total" (span: 6) {
      query: "SELECT COUNT(*) as value FROM items"
      format: number
    }
    table "Items" (span: 6) {
      query: "SELECT id, name FROM items ORDER BY id"
    }
  }
}`;

let connManager: ConnectionManager;
let executor: QueryExecutor;

beforeAll(async () => {
  mkdirSync(BOARD_DIR, { recursive: true });
  writeFileSync(join(BOARD_DIR, "hello.board"), TEXT_BOARD);
  writeFileSync(join(BOARD_DIR, "sales.board"), QUERY_BOARD);

  // Set up real SQLite connection with test data
  connManager = new ConnectionManager();
  await connManager.register("test_db", { type: "sqlite", path: ":memory:" });
  const driver = connManager.get("test_db");
  await driver.query("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
  await driver.query("INSERT INTO items VALUES (1, 'Widget'), (2, 'Gadget'), (3, 'Doohickey')");
  executor = new QueryExecutor(connManager);
});

afterAll(async () => {
  await connManager.disconnectAll();
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("GET /d/:name — dashboard rendering", () => {
  function makeApp() {
    const app = new Hono();
    app.route(
      "/",
      dashboardRoutes({
        boardDir: BOARD_DIR,
        executor,
      }),
    );
    return app;
  }

  it("renders a text-only dashboard", async () => {
    const app = makeApp();
    const res = await app.request("/d/hello");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Hello");
    expect(html).toContain("Welcome to");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("renders a dashboard with query data", async () => {
    const app = makeApp();
    const res = await app.request("/d/sales");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sales");
    expect(html).toContain("Total");
  });

  it("returns 404 for non-existent dashboard", async () => {
    const app = makeApp();
    const res = await app.request("/d/nonexistent");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Dashboard not found");
  });

  it("serves CSS at /orrery/styles.css", async () => {
    const app = makeApp();
    const res = await app.request("/orrery/styles.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("serves JS at /orrery/interactive.js", async () => {
    const app = makeApp();
    const res = await app.request("/orrery/interactive.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
  });

  it("serves the locally-bundled echarts at /orrery/vendor/echarts.min.js", async () => {
    const app = makeApp();
    const res = await app.request("/orrery/vendor/echarts.min.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    const body = await res.text();
    // Sanity: the bundle should be non-trivial and define echarts.
    expect(body.length).toBeGreaterThan(100_000);
    expect(body).toContain("echarts");
  });

  it("chart hydration gates innerHTML wipe on echarts availability (race-safety)", async () => {
    // The SSR-rendered SVG must not be wiped before window.echarts exists,
    // otherwise a param-change hydration racing a slow CDN load leaves an
    // empty div. Assert the destructive DOM call only lives inside
    // doHydrateOneChart, which runs after ensureECharts() resolves.
    const { ORRERY_INTERACTIVE_JS } = await import("../../src/server/interactive.js");
    const innerHtmlWipes = (ORRERY_INTERACTIVE_JS.match(/container\.innerHTML\s*=\s*''/g) || []).length;
    expect(innerHtmlWipes).toBe(1);
    const doHydrateIdx = ORRERY_INTERACTIVE_JS.indexOf("function doHydrateOneChart(");
    const wipeIdx = ORRERY_INTERACTIVE_JS.indexOf("container.innerHTML = ''");
    expect(doHydrateIdx).toBeGreaterThan(0);
    expect(wipeIdx).toBeGreaterThan(doHydrateIdx);
    expect(ORRERY_INTERACTIVE_JS).toContain("function ensureECharts()");
    expect(ORRERY_INTERACTIVE_JS).toContain("/orrery/vendor/echarts.min.js");
    expect(ORRERY_INTERACTIVE_JS).not.toContain("cdn.jsdelivr.net");
  });
});

describe("POST /api/query — partial data update", () => {
  function makeApp() {
    const app = new Hono();
    app.route(
      "/",
      dashboardRoutes({
        boardDir: BOARD_DIR,
        executor,
      }),
    );
    return app;
  }

  it("returns JSON data for a valid dashboard query", async () => {
    const app = makeApp();
    const res = await app.request("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dashboard: "sales",
        params: {},
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeDefined();
  });

  it("returns HTML fragments when format=html", async () => {
    const app = makeApp();
    const res = await app.request("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dashboard: "sales",
        params: {},
        format: "html",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.html).toBeDefined();
  });

  it("returns 404 for non-existent dashboard", async () => {
    const app = makeApp();
    const res = await app.request("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dashboard: "no-such-dashboard",
        params: {},
      }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("not found");
  });
});
