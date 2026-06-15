import { describe, it, expect } from "vitest";
import { createApp } from "../../src/server/index.js";
import type { DiscoveredDashboard } from "../../src/server/discovery.js";

describe("createApp", () => {
  it("serves dashboard index at / when getDashboards is provided", async () => {
    const dashboards: DiscoveredDashboard[] = [
      {
        slug: "sales",
        filePath: "/tmp/dashboards/sales.board",
        title: "Sales Overview",
        description: "Revenue metrics",
        lastModified: new Date("2025-01-01"),
      },
      {
        slug: "ops",
        filePath: "/tmp/dashboards/ops.board",
        title: "Ops Dashboard",
        lastModified: new Date("2025-01-02"),
      },
    ];

    const app = createApp({
      getDashboards: () => dashboards,
    });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sales Overview");
    expect(html).toContain("Revenue metrics");
    expect(html).toContain("Ops Dashboard");
    expect(html).toContain("/d/sales");
    expect(html).toContain("/d/ops");
    expect(html).toContain("2 dashboards");
  });

  it("shows empty state when no dashboards", async () => {
    const app = createApp({
      getDashboards: () => [],
    });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No dashboards found");
    expect(html).toContain("0 dashboards");
  });

  it("serves /api/dashboards as JSON", async () => {
    const dashboards: DiscoveredDashboard[] = [
      {
        slug: "test",
        filePath: "/tmp/test.board",
        title: "Test",
        lastModified: new Date("2025-06-01T00:00:00Z"),
      },
    ];

    const app = createApp({
      getDashboards: () => dashboards,
    });

    const res = await app.request("/api/dashboards");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].slug).toBe("test");
    expect(data[0].title).toBe("Test");
    expect(data[0].url).toBe("/d/test");
  });

  it("serves health check", async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  it("serves default landing page when no getDashboards", async () => {
    const app = createApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Orrery");
    expect(html).toContain("Dashboards as code");
  });
});
