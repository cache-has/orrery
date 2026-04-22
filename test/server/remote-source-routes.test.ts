import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../../src/server/index.js";
import { loadBoardContent } from "../../src/server/routes/dashboard.js";
import { ConnectionManager } from "../../src/connections/manager.js";
import { QueryExecutor } from "../../src/query/executor.js";
import type { DashboardSource } from "../../src/sources/types.js";
import type { DiscoveredDashboard } from "../../src/server/discovery.js";

const OPERATIONS_BOARD = `dashboard "Operations" {
  description: "Ops overview"

  row {
    text "Hi" {
      > Hello from **S3**.
    }
  }
}`;

class InMemorySource implements DashboardSource {
  readonly writable = false;
  constructor(private files: Map<string, string>) {}
  async list() { return [...this.files.keys()]; }
  async read(path: string) {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`not found: ${path}`);
    return v;
  }
  describe() { return "in-memory"; }
}

describe("loadBoardContent", () => {
  it("reads through a remote source when slug matches discovery", async () => {
    const source = new InMemorySource(new Map([["dashboards/ops.board", OPERATIONS_BOARD]]));
    const discovered: DiscoveredDashboard[] = [
      { slug: "dashboards-ops", filePath: "dashboards/ops.board", title: "Operations", folder: "dashboards", lastModified: new Date() },
    ];
    const result = await loadBoardContent("dashboards-ops", {
      source,
      getDashboards: () => discovered,
      boardDir: "/does/not/exist",
    });
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Operations");
    expect(result!.filePath).toBe("dashboards/ops.board");
  });

  it("returns null for unknown slug against a remote source", async () => {
    const source = new InMemorySource(new Map([["x.board", OPERATIONS_BOARD]]));
    const result = await loadBoardContent("no-such-slug", {
      source,
      getDashboards: () => [],
      boardDir: "/does/not/exist",
    });
    expect(result).toBeNull();
  });
});

describe("GET /d/:name with a remote source", () => {
  let connManager: ConnectionManager;
  let executor: QueryExecutor;

  beforeAll(async () => {
    connManager = new ConnectionManager();
    executor = new QueryExecutor(connManager);
  });

  afterAll(async () => {
    await connManager.disconnectAll();
  });

  it("renders a dashboard whose content lives only in the source (repro of the S3 404 bug)", async () => {
    const source = new InMemorySource(new Map([["dashboards/operations.board", OPERATIONS_BOARD]]));
    const discovered: DiscoveredDashboard[] = [
      { slug: "dashboards-operations", filePath: "dashboards/operations.board", title: "Operations", folder: "dashboards", lastModified: new Date() },
    ];

    const app = createApp({
      dashboard: {
        boardDir: "/does/not/exist",
        executor,
        source,
        getDashboards: () => discovered,
      },
      getDashboards: () => discovered,
    });

    const res = await app.request("/d/dashboards-operations");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Operations");
    expect(body).toContain("Hello from");
  });

  it("returns 404 for an unknown slug", async () => {
    const source = new InMemorySource(new Map());
    const app = createApp({
      dashboard: {
        boardDir: "/does/not/exist",
        executor,
        source,
        getDashboards: () => [],
      },
      getDashboards: () => [],
    });
    const res = await app.request("/d/missing");
    expect(res.status).toBe(404);
  });
});

describe("dashboard index — editor link", () => {
  it("shows Edit dashboards link when editor is enabled", async () => {
    const app = createApp({
      editor: { enabled: true },
      getDashboards: () => [],
    });
    const res = await app.request("/");
    const body = await res.text();
    expect(body).toContain("/edit");
    expect(body).toContain("Edit dashboards");
  });

  it("omits the link when editor is disabled", async () => {
    const app = createApp({
      editor: { enabled: false },
      getDashboards: () => [],
    });
    const res = await app.request("/");
    const body = await res.text();
    expect(body).not.toContain("Edit dashboards");
  });
});
