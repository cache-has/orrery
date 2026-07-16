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

function objectProp(key: string, entries: Record<string, string>): PropertyNode {
  return {
    kind: "property",
    key,
    value: {
      kind: "object",
      entries: Object.entries(entries).map(([k, v]) => prop(k, v)),
      span,
    },
    span,
  };
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
  it("renders an ECharts SVG with data", () => {
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

    expect(html).toContain("orrery-chart-container");
    expect(html).toContain("<svg");
    expect(html).toContain("</svg>");
  });

  it("renders 'No data' when result is empty", () => {
    const component = makeChart("Empty", "line", [
      identProp("x", "date"),
      identProp("y", "value"),
    ]);
    const data: ComponentRenderData = { result: makeResult(["date", "value"], []) };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("No data");
    expect(html).not.toContain("<svg");
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

    expect(html).toContain("<svg");
  });

  it("renders multi-series line chart", () => {
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

    expect(html).toContain("<svg");
    // ECharts renders legend text for multi-series
    expect(html).toContain("East");
    expect(html).toContain("West");
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

    // Compact formatter should produce K-suffixed labels
    expect(html).toContain("K");
  });

  it("renders area chart with areaStyle", () => {
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

    // Area charts still produce an SVG — the areaStyle fill is inside
    expect(html).toContain("<svg");
    expect(html).toContain("orrery-chart-container");
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

    expect(html).toContain("<svg");
    expect(html).toContain("East");
    expect(html).toContain("West");
    expect(html).toContain("North");
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

    // B (30) should appear before C (20) and A (10) in the SVG output
    const bIdx = html.indexOf(">B<");
    const cIdx = html.indexOf(">C<");
    const aIdx = html.indexOf(">A<");
    expect(bIdx).toBeGreaterThan(-1);
    expect(cIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeGreaterThan(-1);
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

    // B (10) should appear before C (20) and A (30) in the SVG
    const bIdx = html.indexOf(">B<");
    const cIdx = html.indexOf(">C<");
    const aIdx = html.indexOf(">A<");
    expect(bIdx).toBeGreaterThan(-1);
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

    expect(html).toContain("<svg");
    // Category labels should appear (on y-axis for horizontal)
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
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

    expect(html).toContain("<svg");
    expect(html).toContain("Widget");
    expect(html).toContain("Gadget");
  });

  it("applies the widget's own series_colors property by category name, overriding index-based palette order", () => {
    const component = makeChart("Multi Bar", "bar", [
      identProp("x", "quarter"),
      identProp("y", "revenue"),
      identProp("series", "product"),
      objectProp("series_colors", { Widget: "#ef4444", Gadget: "#22c55e" }),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["quarter", "revenue", "product"], [
        // "Gadget" appears first here (index 0), unlike the earlier test where
        // "Widget" is first — series_colors should still pin each name's color
        // regardless of which index it lands on in this widget's query order.
        { quarter: "Q1", revenue: 80, product: "Gadget" },
        { quarter: "Q1", revenue: 100, product: "Widget" },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("&quot;name&quot;:&quot;Gadget&quot;");
    expect(html).toContain("&quot;name&quot;:&quot;Widget&quot;");
    expect(html).toContain("&quot;color&quot;:&quot;#22c55e&quot;");
    expect(html).toContain("&quot;color&quot;:&quot;#ef4444&quot;");
  });

  it("falls back to palette order for series not listed in the widget's series_colors", () => {
    const component = makeChart("Multi Bar", "bar", [
      identProp("x", "quarter"),
      identProp("y", "revenue"),
      identProp("series", "product"),
      objectProp("series_colors", { Widget: "#ef4444" }),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["quarter", "revenue", "product"], [
        { quarter: "Q1", revenue: 80, product: "Gadget" },
        { quarter: "Q1", revenue: 100, product: "Widget" },
      ]),
      palette: ["#111111", "#222222"],
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("&quot;color&quot;:&quot;#ef4444&quot;");
    // "Gadget" (index 0, unmapped) keeps the existing index-based palette color
    expect(html).toContain("&quot;color&quot;:&quot;#111111&quot;");
  });

  it("ignores series_colors keys that don't match any returned category — no crash, no leak, matched keys unaffected", () => {
    const component = makeChart("Multi Bar", "bar", [
      identProp("x", "quarter"),
      identProp("y", "revenue"),
      identProp("series", "status"),
      // "godo" is a typo for "good" (never matches); "ugly" never appears in
      // the data at all. Both should be silently unused — not applied to
      // any series, and no error/crash — while "bad" (correctly spelled)
      // still gets its mapped color.
      objectProp("series_colors", { godo: "#22c55e", bad: "#ef4444", ugly: "#000000" }),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["quarter", "revenue", "status"], [
        { quarter: "Q1", revenue: 5, status: "good" },
        { quarter: "Q1", revenue: 3, status: "bad" },
      ]),
      palette: ["#111111", "#222222"],
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("<svg");
    // "good" isn't matched by the typo'd "godo" key, so it keeps its
    // index-based palette color instead of the intended green.
    expect(html).toContain("&quot;name&quot;:&quot;good&quot;");
    expect(html).toContain("&quot;color&quot;:&quot;#111111&quot;");
    expect(html).not.toContain("#22c55e");
    // "bad" is spelled correctly and still gets its mapped color.
    expect(html).toContain("&quot;name&quot;:&quot;bad&quot;");
    expect(html).toContain("&quot;color&quot;:&quot;#ef4444&quot;");
    // "ugly" never appears in the data, so it can't show up anywhere.
    expect(html).not.toContain("#000000");
  });

  it("renders unsupported chart type with placeholder", () => {
    const component = makeChart("Unknown", "sunburst");
    const data: ComponentRenderData = {
      result: makeResult(["x", "y"], [{ x: 1, y: 2 }]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("Unsupported chart type");
    expect(html).toContain("sunburst");
  });

  it("renders stacked bars (stacked: true) — series share a stack name", () => {
    const component = makeChart("Stacked", "bar", [
      identProp("x", "quarter"),
      identProp("y", "revenue"),
      identProp("series", "product"),
      { kind: "property", key: "stacked", value: { kind: "boolean", value: true, span }, span },
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

    // The serialized client option should carry the stack name
    expect(html).toContain("&quot;stack&quot;:&quot;total&quot;");
    expect(html).toContain("<svg");
  });

  it("renders percent-stacked bars — values normalized to 100", () => {
    const component = makeChart("Pct Stacked", "bar", [
      identProp("x", "quarter"),
      identProp("y", "revenue"),
      identProp("series", "product"),
      { kind: "property", key: "stacked", value: { kind: "string", value: "percent", span }, span },
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["quarter", "revenue", "product"], [
        { quarter: "Q1", revenue: 75, product: "Widget" },
        { quarter: "Q1", revenue: 25, product: "Gadget" },
        { quarter: "Q2", revenue: 60, product: "Widget" },
        { quarter: "Q2", revenue: 40, product: "Gadget" },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    // Stacked + axis pinned to 0..100 — a 100 max appears in serialized option
    expect(html).toContain("&quot;stack&quot;:&quot;total&quot;");
    expect(html).toContain("&quot;max&quot;:100");
    // Normalized values: 75/(75+25)*100 = 75, 25 → the exact percent values appear as series data
    expect(html).toMatch(/&quot;data&quot;:\[75,60\]/);
    expect(html).toMatch(/&quot;data&quot;:\[25,40\]/);
  });

  it("stacked: false is a no-op (no stack key)", () => {
    const component = makeChart("Not Stacked", "bar", [
      identProp("x", "quarter"),
      identProp("y", "revenue"),
      identProp("series", "product"),
      { kind: "property", key: "stacked", value: { kind: "boolean", value: false, span }, span },
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["quarter", "revenue", "product"], [
        { quarter: "Q1", revenue: 100, product: "Widget" },
        { quarter: "Q1", revenue: 80, product: "Gadget" },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);
    expect(html).not.toContain("&quot;stack&quot;");
  });

  it("renders a funnel chart with stages in query order", () => {
    const component = makeChart("Conversion", "funnel", [
      identProp("label", "stage"),
      identProp("value", "count"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["stage", "count"], [
        { stage: "Visited", count: 1000 },
        { stage: "Signed Up", count: 400 },
        { stage: "Activated", count: 150 },
        { stage: "Paid", count: 50 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("<svg");
    expect(html).toContain("orrery-chart-container");
    // Funnel series type and sort:none (preserve query order) should appear in serialized option
    expect(html).toContain("&quot;type&quot;:&quot;funnel&quot;");
    expect(html).toContain("&quot;sort&quot;:&quot;none&quot;");
    // Stage labels should be present
    expect(html).toContain("Visited");
    expect(html).toContain("Paid");
  });

  it("renders 'No data' for empty funnel", () => {
    const component = makeChart("Empty Funnel", "funnel", [
      identProp("label", "stage"),
      identProp("value", "count"),
    ]);
    const data: ComponentRenderData = { result: makeResult(["stage", "count"], []) };
    const html = chartRenderer.renderToString(component, data);
    expect(html).toContain("No data");
  });

  it("renders a scatter chart with numeric x/y", () => {
    const component = makeChart("Scatter", "scatter", [
      identProp("x", "months_active"),
      identProp("y", "total_spend"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["months_active", "total_spend"], [
        { months_active: 1, total_spend: 50 },
        { months_active: 6, total_spend: 220 },
        { months_active: 12, total_spend: 480 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("<svg");
    expect(html).toContain("&quot;type&quot;:&quot;scatter&quot;");
    // Numeric x/y data is emitted as [x,y] pairs in the serialized option
    expect(html).toMatch(/&quot;data&quot;:\[\[1,50\],\[6,220\],\[12,480\]\]/);
  });

  it("renders 'No data' for empty scatter", () => {
    const component = makeChart("Empty Scatter", "scatter", [
      identProp("x", "x"),
      identProp("y", "y"),
    ]);
    const data: ComponentRenderData = { result: makeResult(["x", "y"], []) };
    const html = chartRenderer.renderToString(component, data);
    expect(html).toContain("No data");
  });

  it("skips non-numeric rows in scatter", () => {
    const component = makeChart("Scatter Skip", "scatter", [
      identProp("x", "a"),
      identProp("y", "b"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["a", "b"], [
        { a: 1, b: 2 },
        { a: "oops", b: 5 },
        { a: 3, b: 4 },
      ]),
    };
    const html = chartRenderer.renderToString(component, data);
    expect(html).toMatch(/&quot;data&quot;:\[\[1,2\],\[3,4\]\]/);
  });

  it("color-codes scatter by series column", () => {
    const component = makeChart("Scatter Multi", "scatter", [
      identProp("x", "x"),
      identProp("y", "y"),
      identProp("series", "plan"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["x", "y", "plan"], [
        { x: 1, y: 10, plan: "Pro" },
        { x: 2, y: 20, plan: "Free" },
        { x: 3, y: 30, plan: "Pro" },
      ]),
    };
    const html = chartRenderer.renderToString(component, data);
    expect(html).toContain("<svg");
    expect(html).toContain("Pro");
    expect(html).toContain("Free");
    // Points are grouped into two series in the serialized option
    expect(html).toMatch(/&quot;data&quot;:\[\[1,10\],\[3,30\]\]/);
    expect(html).toMatch(/&quot;data&quot;:\[\[2,20\]\]/);
  });

  it("renders bubble-style scatter when size: is provided", () => {
    const component = makeChart("Bubble", "scatter", [
      identProp("x", "x"),
      identProp("y", "y"),
      identProp("size", "s"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["x", "y", "s"], [
        { x: 1, y: 1, s: 10 },
        { x: 2, y: 2, s: 100 },
      ]),
    };
    const html = chartRenderer.renderToString(component, data);
    // Data tuples include the size value as the third element
    expect(html).toMatch(/&quot;data&quot;:\[\[1,1,10\],\[2,2,100\]\]/);
    expect(html).toContain("<svg");
  });

  it("renders a heatmap with x/y categories and values", () => {
    const component = makeChart("Order Heatmap", "heatmap", [
      identProp("x", "hour_of_day"),
      identProp("y", "day_of_week"),
      identProp("value", "order_count"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["hour_of_day", "day_of_week", "order_count"], [
        { hour_of_day: "9", day_of_week: "Mon", order_count: 10 },
        { hour_of_day: "10", day_of_week: "Mon", order_count: 25 },
        { hour_of_day: "9", day_of_week: "Tue", order_count: 5 },
        { hour_of_day: "10", day_of_week: "Tue", order_count: 40 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("<svg");
    expect(html).toContain("&quot;type&quot;:&quot;heatmap&quot;");
    // Data is emitted as [xIndex, yIndex, value] triples
    expect(html).toMatch(/&quot;data&quot;:\[\[0,0,10\],\[1,0,25\],\[0,1,5\],\[1,1,40\]\]/);
    // visualMap auto-pinned from data
    expect(html).toContain("&quot;visualMap&quot;");
    expect(html).toContain("&quot;min&quot;:5");
    expect(html).toContain("&quot;max&quot;:40");
  });

  it("heatmap respects explicit min/max props", () => {
    const component = makeChart("Heatmap Bounds", "heatmap", [
      identProp("x", "x"),
      identProp("y", "y"),
      identProp("value", "v"),
      { kind: "property", key: "min", value: { kind: "number", value: 0, span }, span },
      { kind: "property", key: "max", value: { kind: "number", value: 100, span }, span },
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["x", "y", "v"], [
        { x: "a", y: "1", v: 10 },
        { x: "b", y: "1", v: 20 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);
    expect(html).toContain("&quot;min&quot;:0");
    expect(html).toContain("&quot;max&quot;:100");
  });

  it("renders 'No data' for empty heatmap", () => {
    const component = makeChart("Empty Heatmap", "heatmap", [
      identProp("x", "x"),
      identProp("y", "y"),
      identProp("value", "v"),
    ]);
    const data: ComponentRenderData = { result: makeResult(["x", "y", "v"], []) };
    const html = chartRenderer.renderToString(component, data);
    expect(html).toContain("No data");
  });

  it("renders a gauge with literal max and thresholds", () => {
    const component = makeChart("Monthly Target", "gauge", [
      identProp("value", "current_value"),
      { kind: "property", key: "max", value: { kind: "number", value: 100, span }, span },
      {
        kind: "property",
        key: "thresholds",
        value: {
          kind: "array",
          elements: [
            { kind: "number", value: 0.5, span },
            { kind: "number", value: 0.8, span },
          ],
          span,
        },
        span,
      },
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["current_value"], [{ current_value: 72 }]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("<svg");
    expect(html).toContain("&quot;type&quot;:&quot;gauge&quot;");
    expect(html).toContain("&quot;max&quot;:100");
    // Three threshold bands with default danger/warn/ok colors
    expect(html).toContain("#ef4444");
    expect(html).toContain("#f59e0b");
    expect(html).toContain("#10b981");
  });

  it("gauge reads max from a column name", () => {
    const component = makeChart("Target", "gauge", [
      identProp("value", "current"),
      identProp("max", "target"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["current", "target"], [{ current: 40, target: 200 }]),
    };

    const html = chartRenderer.renderToString(component, data);
    expect(html).toContain("&quot;max&quot;:200");
  });

  it("gauge respects custom threshold_colors", () => {
    const component = makeChart("Colored Gauge", "gauge", [
      identProp("value", "v"),
      { kind: "property", key: "max", value: { kind: "number", value: 1, span }, span },
      {
        kind: "property",
        key: "thresholds",
        value: {
          kind: "array",
          elements: [{ kind: "number", value: 0.5, span }],
          span,
        },
        span,
      },
      {
        kind: "property",
        key: "threshold_colors",
        value: {
          kind: "array",
          elements: [
            { kind: "string", value: "#111111", span },
            { kind: "string", value: "#222222", span },
          ],
          span,
        },
        span,
      },
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["v"], [{ v: 0.3 }]),
    };

    const html = chartRenderer.renderToString(component, data);
    expect(html).toContain("#111111");
    expect(html).toContain("#222222");
  });

  it("renders 'No data' for empty gauge", () => {
    const component = makeChart("Empty Gauge", "gauge", [identProp("value", "v")]);
    const data: ComponentRenderData = { result: makeResult(["v"], []) };
    const html = chartRenderer.renderToString(component, data);
    expect(html).toContain("No data");
  });

  it("applies custom color", () => {
    const component = makeChart("Colored", "bar", [
      identProp("x", "name"),
      identProp("y", "val"),
      prop("color", "#ff0000"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["name", "val"], [
        { name: "A", val: 10 },
        { name: "B", val: 20 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("#ff0000");
  });
});

// ---------------------------------------------------------------------------
// Donut chart tests
// ---------------------------------------------------------------------------

describe("chartRenderer — donut chart", () => {
  it("renders an ECharts SVG with data", () => {
    const component = makeChart("Breakdown", "donut", [
      identProp("x", "tier"),
      identProp("y", "count"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["tier", "count"], [
        { tier: "free", count: 70 },
        { tier: "premium", count: 30 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("<svg");
    expect(html).toContain("</svg>");
  });

  it("applies the widget's own series_colors property by category name via per-slice itemStyle override", () => {
    const component = makeChart("Breakdown", "donut", [
      identProp("x", "tier"),
      identProp("y", "count"),
      objectProp("series_colors", { free: "#d97706", premium: "#16a34a" }),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["tier", "count"], [
        { tier: "free", count: 70 },
        { tier: "premium", count: 30 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("&quot;name&quot;:&quot;free&quot;");
    expect(html).toContain("&quot;color&quot;:&quot;#d97706&quot;");
    expect(html).toContain("&quot;name&quot;:&quot;premium&quot;");
    expect(html).toContain("&quot;color&quot;:&quot;#16a34a&quot;");
  });

  it("leaves unmapped slices without an itemStyle override", () => {
    const component = makeChart("Breakdown", "donut", [
      identProp("x", "tier"),
      identProp("y", "count"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["tier", "count"], [
        { tier: "free", count: 70 },
        { tier: "premium", count: 30 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).not.toContain("&quot;itemStyle&quot;:{&quot;color&quot;");
  });

  it("ignores series_colors keys that don't match any returned slice label — no crash, matched keys unaffected", () => {
    const component = makeChart("Breakdown", "donut", [
      identProp("x", "tier"),
      identProp("y", "count"),
      // "premiun" is a typo for "premium" (never matches); "enterprise"
      // never appears in the data at all.
      objectProp("series_colors", { free: "#d97706", premiun: "#16a34a", enterprise: "#000000" }),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["tier", "count"], [
        { tier: "free", count: 70 },
        { tier: "premium", count: 30 },
      ]),
    };

    const html = chartRenderer.renderToString(component, data);

    expect(html).toContain("<svg");
    // "free" is spelled correctly and still gets its mapped color.
    expect(html).toContain("&quot;name&quot;:&quot;free&quot;");
    expect(html).toContain("&quot;color&quot;:&quot;#d97706&quot;");
    // "premium" isn't matched by the typo'd "premiun" key, so it gets no
    // itemStyle override at all (falls through to ECharts' own coloring).
    expect(html).toContain("&quot;name&quot;:&quot;premium&quot;,&quot;value&quot;:30}");
    expect(html).not.toContain("#16a34a");
    // "enterprise" never appears in the data, so it can't show up anywhere.
    expect(html).not.toContain("#000000");
  });
});
