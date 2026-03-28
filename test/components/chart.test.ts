import { describe, it, expect } from "vitest";
import { chartRenderer } from "../../src/components/chart.js";
import type { ComponentNode, PropertyNode, Span } from "../../src/parser/ast.js";
import type { QueryResult } from "../../src/query/executor.js";
import type { ComponentRenderData } from "../../src/components/types.js";

const span: Span = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function prop(key: string, value: string): PropertyNode {
  return { kind: "property", key, value: { kind: "string", value, span }, span };
}

function identProp(key: string, name: string): PropertyNode {
  return { kind: "property", key, value: { kind: "ident", name, span }, span };
}

function makeChart(
  title: string,
  type: string,
  properties: PropertyNode[] = [],
): ComponentNode {
  return {
    kind: "component",
    componentType: "chart",
    title,
    opts: { type },
    properties,
    span,
  };
}

function makeResult(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, rows, rowCount: rows.length, executionTimeMs: 10 };
}

// ---------------------------------------------------------------------------
// Line chart tests
// ---------------------------------------------------------------------------

describe("chartRenderer — line chart", () => {
  it("renders an SVG line chart with data", () => {
    const component = makeChart("Revenue Trend", "line", [
      identProp("x", "date"),
      identProp("y", "revenue"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["date", "revenue"], [
        { date: "Jan", revenue: 100 },
        { date: "Feb", revenue: 200 },
        { date: "Mar", revenue: 150 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("openboard-chart-line");
    expect(html).toContain("<polyline");
    expect(html).toContain("<circle");
    expect(html).toContain("Jan");
  });

  it("renders 'No data' when result is empty", () => {
    const component = makeChart("Empty", "line", [
      identProp("x", "date"),
      identProp("y", "value"),
    ]);
    const data: ComponentRenderData = { result: makeResult(["date", "value"], []) };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("No data");
  });

  it("renders 'No data' when result is undefined", () => {
    const component = makeChart("Empty", "line");
    const data: ComponentRenderData = {};

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("No data");
  });

  it("uses first two columns when x/y not specified", () => {
    const component = makeChart("Auto Columns", "line");
    const data: ComponentRenderData = {
      result: makeResult(["month", "sales"], [
        { month: "Jan", sales: 50 },
        { month: "Feb", sales: 75 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("<polyline");
    expect(html).toContain("Jan");
  });

  it("applies custom color", () => {
    const component = makeChart("Colored", "line", [
      identProp("x", "date"),
      identProp("y", "val"),
      prop("color", "#ff0000"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["date", "val"], [
        { date: "A", val: 10 },
        { date: "B", val: 20 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("#ff0000");
  });

  it("renders multi-series with legend", () => {
    const component = makeChart("Multi", "line", [
      identProp("x", "month"),
      identProp("y", "value"),
      identProp("series", "region"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["month", "value", "region"], [
        { month: "Jan", value: 100, region: "East" },
        { month: "Jan", value: 80, region: "West" },
        { month: "Feb", value: 120, region: "East" },
        { month: "Feb", value: 90, region: "West" },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    // Should have two polylines (two series)
    const polylineCount = (html.match(/<polyline/g) || []).length;
    expect(polylineCount).toBe(2);
    // Should have legend labels
    expect(html).toContain("East");
    expect(html).toContain("West");
    expect(html).toContain("openboard-chart-legend-label");
  });

  it("formats y-axis labels with y_format", () => {
    const component = makeChart("Formatted", "line", [
      identProp("x", "date"),
      identProp("y", "val"),
      identProp("y_format", "compact"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["date", "val"], [
        { date: "A", val: 1000 },
        { date: "B", val: 5000 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    // Should contain compact-formatted tick labels like "1K", "5K", etc.
    expect(html).toContain("K");
  });

  it("treats area type as line chart", () => {
    const component = makeChart("Area", "area", [
      identProp("x", "x"),
      identProp("y", "y"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["x", "y"], [
        { x: "A", y: 10 },
        { x: "B", y: 20 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("openboard-chart-line");
    expect(html).toContain("<polyline");
  });
});

// ---------------------------------------------------------------------------
// Bar chart tests
// ---------------------------------------------------------------------------

describe("chartRenderer — bar chart", () => {
  it("renders vertical bars", () => {
    const component = makeChart("Revenue by Region", "bar", [
      identProp("x", "region"),
      identProp("y", "revenue"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["region", "revenue"], [
        { region: "East", revenue: 300 },
        { region: "West", revenue: 200 },
        { region: "North", revenue: 400 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("openboard-chart-bar");
    expect(html).toContain("openboard-chart-bar-rect");
    expect(html).toContain("East");
    // Should have 3 bars
    const rectCount = (html.match(/openboard-chart-bar-rect/g) || []).length;
    expect(rectCount).toBe(3);
  });

  it("renders 'No data' when result is empty", () => {
    const component = makeChart("Empty", "bar", [
      identProp("x", "x"),
      identProp("y", "y"),
    ]);
    const data: ComponentRenderData = { result: makeResult(["x", "y"], []) };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("No data");
  });

  it("sorts bars descending", () => {
    const component = makeChart("Sorted", "bar", [
      identProp("x", "name"),
      identProp("y", "val"),
      identProp("sort", "desc"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["name", "val"], [
        { name: "A", val: 10 },
        { name: "B", val: 30 },
        { name: "C", val: 20 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    // B (30) should appear before C (20) and A (10) in x-axis labels
    const bIdx = html.indexOf(">B<");
    const cIdx = html.indexOf(">C<");
    const aIdx = html.indexOf(">A<");
    expect(bIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(aIdx);
  });

  it("sorts bars ascending", () => {
    const component = makeChart("Sorted Asc", "bar", [
      identProp("x", "name"),
      identProp("y", "val"),
      identProp("sort", "asc"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["name", "val"], [
        { name: "A", val: 30 },
        { name: "B", val: 10 },
        { name: "C", val: 20 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    // B (10) should appear before C (20) and A (30)
    const bIdx = html.indexOf(">B<");
    const cIdx = html.indexOf(">C<");
    const aIdx = html.indexOf(">A<");
    expect(bIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(aIdx);
  });

  it("renders horizontal bars", () => {
    const component = makeChart("Horizontal", "bar", [
      identProp("x", "name"),
      identProp("y", "val"),
      identProp("orientation", "horizontal"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["name", "val"], [
        { name: "A", val: 100 },
        { name: "B", val: 200 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("openboard-chart-bar-horizontal");
    expect(html).toContain("openboard-chart-bar-rect");
  });

  it("renders multi-series grouped bars with legend", () => {
    const component = makeChart("Multi Bar", "bar", [
      identProp("x", "quarter"),
      identProp("y", "revenue"),
      identProp("series", "product"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["quarter", "revenue", "product"], [
        { quarter: "Q1", revenue: 100, product: "Widget" },
        { quarter: "Q1", revenue: 80, product: "Gadget" },
        { quarter: "Q2", revenue: 120, product: "Widget" },
        { quarter: "Q2", revenue: 90, product: "Gadget" },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    // 2 quarters x 2 products = 4 bars
    const rectCount = (html.match(/openboard-chart-bar-rect/g) || []).length;
    expect(rectCount).toBe(4);
    expect(html).toContain("Widget");
    expect(html).toContain("Gadget");
    expect(html).toContain("openboard-chart-legend-label");
  });

  it("renders unsupported chart type with placeholder", () => {
    const component = makeChart("Unknown", "scatter");
    const data: ComponentRenderData = {
      result: makeResult(["x", "y"], [{ x: 1, y: 2 }]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("Unsupported chart type");
    expect(html).toContain("scatter");
  });
});
