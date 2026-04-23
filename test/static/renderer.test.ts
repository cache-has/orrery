import { describe, it, expect } from "vitest";
import { renderStaticPage, renderStaticIndex } from "../../src/static/renderer.js";
import { resolveLayout } from "../../src/renderer/layout.js";
import type {
  DashboardNode,
  RowNode,
  ComponentNode,
  Span,
  ParamNode,
  PropertyNode,
} from "../../src/parser/ast.js";
import type {
  DashboardData,
  ParamInfo,
  ComponentData,
} from "../../src/renderer/data.js";
import type { QueryResult } from "../../src/query/executor.js";

const span: Span = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function makeComponent(
  type: "metric" | "chart" | "table" | "text",
  title: string,
  properties: PropertyNode[] = [],
): ComponentNode {
  return {
    kind: "component",
    componentType: type,
    title,
    opts: {},
    properties,
    span,
  };
}

function makeRow(components: ComponentNode[]): RowNode {
  return { kind: "row", components, span };
}

function makeDashboard(
  title: string,
  items: (RowNode | ParamNode | PropertyNode)[],
): DashboardNode {
  return { kind: "dashboard", title, items, span };
}

function makeData(
  componentEntries: [string, ComponentData][],
  params: ParamInfo[] = [],
): DashboardData {
  return {
    components: new Map(componentEntries),
    connection: "test_db",
    params,
  };
}

// ---------------------------------------------------------------------------
// renderStaticPage
// ---------------------------------------------------------------------------

describe("renderStaticPage", () => {
  it("embeds snapshot metadata in <head>", () => {
    const dashboard = makeDashboard("Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);
    const builtAt = new Date("2026-03-28T14:30:00Z");

    const html = renderStaticPage({
      dashboard,
      layout,
      data,
      paramValues: {},
      snapshotLabel: "Q1 2026 Report",
      builtAt,
      version: "0.1.0",
    });

    expect(html).toContain('<meta name="openboard:built-at" content="2026-03-28T14:30:00.000Z">');
    expect(html).toContain('<meta name="openboard:snapshot-label" content="Q1 2026 Report">');
    expect(html).toContain('<meta name="openboard:version" content="0.1.0">');
  });

  it("renders snapshot footer with label", () => {
    const dashboard = makeDashboard("Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderStaticPage({
      dashboard,
      layout,
      data,
      paramValues: {},
      snapshotLabel: "Monthly Report",
      builtAt: new Date("2026-03-28T14:30:00Z"),
    });

    expect(html).toContain("Data snapshot: Monthly Report");
    expect(html).toContain("openboard-snapshot-footer");
  });

  it("removes refresh buttons in static mode", () => {
    const row = makeRow([makeComponent("metric", "Revenue")]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const data = makeData([["revenue", { result: { columns: ["val"], rows: [{ val: 100 }], rowCount: 1, executionTimeMs: 5 } }]]);

    const html = renderStaticPage({
      dashboard,
      layout,
      data,
      paramValues: {},
    });

    expect(html).not.toContain('data-action="refresh"');
  });

  it("includes static interactive script for table sorting", () => {
    const dashboard = makeDashboard("Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderStaticPage({
      dashboard,
      layout,
      data,
      paramValues: {},
    });

    expect(html).toContain("state.__static__ = true");
    expect(html).toContain("Table sorting");
  });

  it("includes external data loader when externalDataComponents provided", () => {
    const dashboard = makeDashboard("Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);
    const externalDataComponents = new Map([["big_table", "data/big_table.json"]]);

    const html = renderStaticPage({
      dashboard,
      layout,
      data,
      paramValues: {},
      externalDataComponents,
    });

    expect(html).toContain("data/big_table.json");
    expect(html).toContain("Load external data files");
  });
});

// ---------------------------------------------------------------------------
// renderStaticIndex
// ---------------------------------------------------------------------------

describe("renderStaticIndex", () => {
  it("renders dashboard cards with relative links", () => {
    const dashboards = [
      { slug: "sales", title: "Sales Dashboard", description: "Revenue metrics" },
      { slug: "ops", title: "Ops Dashboard" },
    ];

    const html = renderStaticIndex(dashboards);

    expect(html).toContain('href="d/sales/index.html"');
    expect(html).toContain('href="d/ops/index.html"');
    expect(html).toContain("Sales Dashboard");
    expect(html).toContain("Ops Dashboard");
    expect(html).toContain("Revenue metrics");
    expect(html).toContain("2 dashboards");
  });

  it("includes snapshot label when provided", () => {
    const html = renderStaticIndex(
      [{ slug: "test", title: "Test" }],
      "Q1 2026 Report",
      new Date("2026-03-28T14:30:00Z"),
    );

    expect(html).toContain("Q1 2026 Report");
    expect(html).toContain('<meta name="openboard:snapshot-label"');
  });

  it("renders empty state when no dashboards", () => {
    const html = renderStaticIndex([]);

    expect(html).toContain("No dashboards exported");
    expect(html).toContain("0 dashboards");
  });

  it("honors branding title when provided", () => {
    const html = renderStaticIndex(
      [{ slug: "a", title: "A" }],
      undefined,
      new Date("2026-03-28T14:30:00Z"),
      { title: "Acme Analytics" },
    );
    expect(html).toContain("<title>Acme Analytics</title>");
    expect(html).toContain("<h1>Acme Analytics</h1>");
    expect(html).not.toContain("<title>OpenBoard</title>");
  });

  it("includes built-at metadata", () => {
    const builtAt = new Date("2026-03-28T14:30:00Z");
    const html = renderStaticIndex([{ slug: "a", title: "A" }], undefined, builtAt);

    expect(html).toContain('<meta name="openboard:built-at" content="2026-03-28T14:30:00.000Z">');
  });
});
