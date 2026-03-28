import { describe, it, expect } from "vitest";
import { renderPage } from "../../src/renderer/html.js";
import { resolveLayout } from "../../src/renderer/layout.js";
import type { DashboardNode, RowNode, ComponentNode, Span, ParamNode, PropertyNode } from "../../src/parser/ast.js";
import type { DashboardData, ParamInfo, ComponentData } from "../../src/renderer/data.js";
import type { QueryResult } from "../../src/query/executor.js";

const span: Span = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function makeComponent(
  type: "metric" | "chart" | "table" | "text",
  title: string,
  colSpan?: number,
  properties: PropertyNode[] = [],
): ComponentNode {
  return {
    kind: "component",
    componentType: type,
    title,
    opts: colSpan !== undefined ? { span: colSpan } : {},
    properties,
    span,
  };
}

function makeTextComponent(content: string, colSpan?: number): ComponentNode {
  return {
    kind: "component",
    componentType: "text",
    opts: colSpan !== undefined ? { span: colSpan } : {},
    properties: [],
    markdownContent: content,
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

function makeQueryResult(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, rows, rowCount: rows.length, executionTimeMs: 42 };
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

describe("renderPage", () => {
  it("sets page title from dashboard title", () => {
    const dashboard = makeDashboard("My Dashboard", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain("<title>My Dashboard</title>");
  });

  it("renders CSS Grid rows with span-based columns", () => {
    const row = makeRow([
      makeComponent("metric", "Revenue", 4),
      makeComponent("metric", "Users", 8),
    ]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const data = makeData([
      ["revenue", {}],
      ["users", {}],
    ]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain('class="openboard-row"');
    expect(html).toContain("grid-column: 1 / span 4");
    expect(html).toContain("grid-column: 5 / span 8");
  });

  it("includes responsive breakpoints in CSS", () => {
    const dashboard = makeDashboard("Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain("@media (max-width: 1024px)");
    expect(html).toContain("@media (max-width: 640px)");
    expect(html).toContain("grid-template-columns: repeat(2, 1fr)");
    expect(html).toContain("grid-template-columns: 1fr");
  });

  it("renders component containers with title and refresh button", () => {
    const row = makeRow([makeComponent("metric", "Total Revenue", 12)]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const data = makeData([["total_revenue", {}]]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain('class="openboard-component-title"');
    expect(html).toContain("Total Revenue");
    expect(html).toContain('class="openboard-refresh"');
    expect(html).toContain('title="Refresh"');
  });

  it("renders query execution time in footer", () => {
    const row = makeRow([makeComponent("metric", "Revenue", 12)]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const result = makeQueryResult(["value"], [{ value: 1000 }]);
    const data = makeData([["revenue", { result }]]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain("Loaded in 42ms");
    expect(html).toContain('class="openboard-query-time"');
  });

  it("renders inline error state per component", () => {
    const row = makeRow([
      makeComponent("metric", "Good", 6),
      makeComponent("metric", "Broken", 6),
    ]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const goodResult = makeQueryResult(["value"], [{ value: 42 }]);
    const data = makeData([
      ["good", { result: goodResult }],
      ["broken", { error: 'Connection "db" not found' }],
    ]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    // Good component renders data
    expect(html).toContain("42");
    // Broken component renders error inline
    expect(html).toContain('class="openboard-error"');
    expect(html).toContain("Query Error");
    expect(html).toContain("Connection &quot;db&quot; not found");
  });

  it("renders metric with prefix and suffix", () => {
    const props: PropertyNode[] = [
      { kind: "property", key: "query", value: { kind: "string", value: "SELECT 1", span }, span },
      { kind: "property", key: "prefix", value: { kind: "string", value: "$", span }, span },
      { kind: "property", key: "suffix", value: { kind: "string", value: "k", span }, span },
    ];
    const row = makeRow([makeComponent("metric", "Revenue", 12, props)]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const result = makeQueryResult(["value"], [{ value: 500 }]);
    const data = makeData([["revenue", { result }]]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain('class="openboard-metric-prefix"');
    expect(html).toContain("$");
    expect(html).toContain("500");
    expect(html).toContain('class="openboard-metric-suffix"');
    expect(html).toContain("k");
  });

  it("renders table with columns and rows", () => {
    const row = makeRow([makeComponent("table", "Users", 12)]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const result = makeQueryResult(["name", "email"], [
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ]);
    const data = makeData([["users", { result }]]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain("openboard-data-table");
    expect(html).toContain("name");
    expect(html).toContain("email");
    expect(html).toContain("Alice");
    expect(html).toContain("bob@example.com");
  });

  it("renders parameter bar with select control", () => {
    const paramNode: ParamNode = {
      kind: "param",
      name: "region",
      paramType: "select",
      options: [
        {
          kind: "property",
          key: "options",
          value: {
            kind: "array",
            elements: [
              { kind: "string", value: "North", span },
              { kind: "string", value: "South", span },
            ],
            span,
          },
          span,
        },
        { kind: "property", key: "default", value: { kind: "string", value: "North", span }, span },
      ],
      span,
    };
    const dashboard = makeDashboard("Test", [paramNode]);
    const layout = resolveLayout(dashboard);
    const data = makeData(
      [],
      [{ name: "region", type: "select", options: { options: ["North", "South"], default: "North" } }],
    );

    const html = renderPage({ dashboard, layout, data, paramValues: { region: "North" } });

    expect(html).toContain('class="openboard-params"');
    expect(html).toContain('data-param-type="select"');
    expect(html).toContain("<select");
    expect(html).toContain("North");
    expect(html).toContain("South");
  });

  it("renders toggle parameter control", () => {
    const paramNode: ParamNode = {
      kind: "param",
      name: "show_inactive",
      paramType: "toggle",
      options: [
        { kind: "property", key: "default", value: { kind: "boolean", value: false, span }, span },
        { kind: "property", key: "label", value: { kind: "string", value: "Include inactive", span }, span },
      ],
      span,
    };
    const dashboard = makeDashboard("Test", [paramNode]);
    const layout = resolveLayout(dashboard);
    const data = makeData(
      [],
      [{ name: "show_inactive", type: "toggle", options: { default: false, label: "Include inactive" } }],
    );

    const html = renderPage({ dashboard, layout, data, paramValues: { show_inactive: false } });

    expect(html).toContain('data-param-type="toggle"');
    expect(html).toContain('role="switch"');
    expect(html).toContain("Include inactive");
    expect(html).toContain('aria-checked="false"');
    // The button element itself should not have the "on" class (CSS rules contain the class name)
    expect(html).toContain('class="openboard-toggle"');
    expect(html).not.toContain('class="openboard-toggle openboard-toggle-on"');
  });

  it("renders daterange parameter with preset dropdown", () => {
    const paramNode: ParamNode = {
      kind: "param",
      name: "date_range",
      paramType: "daterange",
      options: [
        { kind: "property", key: "default", value: { kind: "string", value: "last 30 days", span }, span },
      ],
      span,
    };
    const dashboard = makeDashboard("Test", [paramNode]);
    const layout = resolveLayout(dashboard);
    const data = makeData(
      [],
      [{ name: "date_range", type: "daterange", options: { default: "last 30 days" } }],
    );

    const html = renderPage({
      dashboard,
      layout,
      data,
      paramValues: { date_range: { start: "2025-02-14", end: "2025-03-15", preset: "last_30_days" } },
    });

    expect(html).toContain('data-param-type="daterange"');
    expect(html).toContain("openboard-daterange-preset");
    expect(html).toContain("Last 30 days");
    expect(html).toContain("Custom");
    expect(html).toContain('type="date"');
  });

  it("serializes __OPENBOARD__ state for client hydration", () => {
    const dashboard = makeDashboard("Hydration Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({ dashboard, layout, data, paramValues: { x: "1" } });

    expect(html).toContain("window.__OPENBOARD__");
    // Verify it's valid JSON embedded in the script
    const match = html.match(/window\.__OPENBOARD__ = ({.*?});/s);
    expect(match).toBeTruthy();
    const parsed = JSON.parse(match![1]);
    expect(parsed.layout.title).toBe("Hydration Test");
    expect(parsed.paramValues).toEqual({ x: "1" });
  });

  it("renders text component with markdown content", () => {
    const text = makeTextComponent("**Hello** world", 12);
    const row = makeRow([text]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const data = makeData([["component_0", {}]]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain("<strong>Hello</strong>");
    expect(html).toContain("world");
  });

  it("renders a valid HTML5 document", () => {
    const dashboard = makeDashboard("Doc Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("</html>");
  });

  it("injects theme CSS when themeCSS is provided", () => {
    const dashboard = makeDashboard("Themed", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({
      dashboard, layout, data, paramValues: {},
      themeCSS: ":root { --ob-bg: #111; }",
      themeName: "dark",
    });

    expect(html).toContain('<style id="ob-theme">');
    expect(html).toContain("--ob-bg: #111");
    expect(html).toContain('data-theme="dark"');
  });

  it("does not inject theme style block when themeCSS is absent", () => {
    const dashboard = makeDashboard("No Theme", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).not.toContain('id="ob-theme"');
    expect(html).not.toContain("data-theme");
  });

  it("applies per-component color overrides as scoped CSS variables", () => {
    const props: PropertyNode[] = [
      { kind: "property", key: "color", value: { kind: "string", value: "#E11D48", span }, span },
      { kind: "property", key: "background", value: { kind: "string", value: "#FFF1F2", span }, span },
    ];
    const row = makeRow([makeComponent("metric", "Custom Colors", 12, props)]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const data = makeData([["custom_colors", {}]]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain("--ob-text: #E11D48");
    expect(html).toContain("--ob-surface: #FFF1F2");
  });

  it("renders chart via chart renderer (no placeholder)", () => {
    const chart = makeComponent("chart", "Revenue Trend", 12);
    chart.opts.type = "area";
    const row = makeRow([chart]);
    const dashboard = makeDashboard("Test", [row]);
    const layout = resolveLayout(dashboard);
    const data = makeData([["revenue_trend", {}]]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    // Chart renderer handles area type; with no data it shows "No data"
    expect(html).toContain('data-component-type="chart"');
    expect(html).toContain("No data");
  });

  it("escapes HTML in titles and values", () => {
    const row = makeRow([makeComponent("metric", '<script>alert("xss")</script>', 12)]);
    const dashboard = makeDashboard("Test <b>Bold</b>", [row]);
    const layout = resolveLayout(dashboard);
    const data = makeData([["script_alert_xss_script", {}]]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    // The inline <script> block must not contain raw <script> tags from data
    const scriptBlockMatch = html.match(/<script>[\s\S]*?<\/script>/g) ?? [];
    for (const block of scriptBlockMatch) {
      // Only the __OPENBOARD__ script block and the closing </script> should exist
      if (block.includes("__OPENBOARD__")) {
        expect(block).not.toContain("<script>alert");
      }
    }
    // HTML-escaped in the DOM
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Test &lt;b&gt;Bold&lt;/b&gt;");
  });

  it("renders branding logo and title in header", () => {
    const dashboard = makeDashboard("Ops Monitor", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({
      dashboard, layout, data, paramValues: {},
      branding: { logo: "assets/logo.svg", title: "Acme Analytics" },
    });

    expect(html).toContain('class="openboard-header-branding"');
    expect(html).toContain('class="openboard-header-logo"');
    expect(html).toContain('src="/openboard/assets/assets/logo.svg"');
    expect(html).toContain('class="openboard-header-brand"');
    expect(html).toContain("Acme Analytics");
  });

  it("renders favicon link when branding has favicon", () => {
    const dashboard = makeDashboard("Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({
      dashboard, layout, data, paramValues: {},
      branding: { favicon: "assets/favicon.ico" },
    });

    expect(html).toContain('<link rel="icon" href="/openboard/assets/assets/favicon.ico"');
  });

  it("includes branding title in page title", () => {
    const dashboard = makeDashboard("Sales", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({
      dashboard, layout, data, paramValues: {},
      branding: { title: "Acme Corp" },
    });

    expect(html).toContain("<title>Sales — Acme Corp</title>");
  });

  it("does not render branding elements when branding is absent", () => {
    const dashboard = makeDashboard("Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    // The branding class appears in the CSS stylesheet, so check the header HTML specifically
    const headerMatch = html.match(/<header class="openboard-header[^"]*"[\s\S]*?<\/header>/);
    expect(headerMatch).toBeTruthy();
    expect(headerMatch![0]).not.toContain("openboard-header-branding");
    expect(headerMatch![0]).not.toContain("openboard-header-logo");
    expect(html).not.toContain('rel="icon"');
  });

  it("does not render theme toggle (dark mode disabled)", () => {
    const dashboard = makeDashboard("Dashboard", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({ dashboard, layout, data, paramValues: {}, devMode: true });
    expect(html).not.toContain('data-action="toggle-theme"');
  });

  it("includes print styles in CSS", () => {
    const dashboard = makeDashboard("Print Test", []);
    const layout = resolveLayout(dashboard);
    const data = makeData([]);

    const html = renderPage({ dashboard, layout, data, paramValues: {} });

    expect(html).toContain("@media print");
    expect(html).toContain("break-inside: avoid");
    // Interactive controls hidden in print
    expect(html).toContain(".openboard-params");
    expect(html).toContain(".openboard-component-actions");
  });
});
