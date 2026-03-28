import { describe, it, expect } from "vitest";
import { metricRenderer } from "../../src/components/metric.js";
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

function makeMetric(title: string, properties: PropertyNode[] = []): ComponentNode {
  return {
    kind: "component",
    componentType: "metric",
    title,
    opts: {},
    properties,
    span,
  };
}

function makeResult(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, rows, rowCount: rows.length, executionTimeMs: 10 };
}

describe("metricRenderer", () => {
  it("renders a simple numeric value", () => {
    const component = makeMetric("Revenue");
    const data: ComponentRenderData = {
      result: makeResult(["value"], [{ value: 42000 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("openboard-metric-value");
    expect(html).toContain("42000");
  });

  it("applies currency format", () => {
    const component = makeMetric("Revenue", [
      prop("format", "currency"),
      prop("prefix", "$"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["value"], [{ value: 1234.5 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("1,234.50");
    expect(html).toContain("openboard-metric-prefix");
    expect(html).toContain("$");
  });

  it("applies compact format", () => {
    const component = makeMetric("Users", [prop("format", "compact")]);
    const data: ComponentRenderData = {
      result: makeResult(["value"], [{ value: 3400000 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("3.4M");
  });

  it("renders prefix and suffix", () => {
    const component = makeMetric("Size", [
      prop("prefix", "~"),
      prop("suffix", " GB"),
    ]);
    const data: ComponentRenderData = {
      result: makeResult(["value"], [{ value: 512 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("openboard-metric-prefix");
    expect(html).toContain("~");
    expect(html).toContain("openboard-metric-suffix");
    expect(html).toContain(" GB");
  });

  it("renders 'No data' when result is empty", () => {
    const component = makeMetric("Revenue");
    const data: ComponentRenderData = { result: makeResult(["value"], []) };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("No data");
  });

  it("renders 'No data' when result is undefined", () => {
    const component = makeMetric("Revenue");
    const data: ComponentRenderData = {};

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("No data");
  });

  it("renders trend with positive change", () => {
    const component = makeMetric("Revenue", [prop("trend_label", "vs last month")]);
    const data: ComponentRenderData = {
      result: makeResult(["value"], [{ value: 120 }]),
      trendResult: makeResult(["value"], [{ value: 100 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("openboard-trend-up");
    expect(html).toContain("+20.0%");
    expect(html).toContain("vs last month");
    expect(html).toContain("\u25B2"); // up arrow
  });

  it("renders trend with negative change", () => {
    const component = makeMetric("Revenue");
    const data: ComponentRenderData = {
      result: makeResult(["value"], [{ value: 80 }]),
      trendResult: makeResult(["value"], [{ value: 100 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("openboard-trend-down");
    expect(html).toContain("-20.0%");
    expect(html).toContain("\u25BC"); // down arrow
  });

  it("renders flat trend when values are equal", () => {
    const component = makeMetric("Revenue");
    const data: ComponentRenderData = {
      result: makeResult(["value"], [{ value: 100 }]),
      trendResult: makeResult(["value"], [{ value: 100 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("openboard-trend-flat");
  });

  it("omits trend when no trendResult is provided", () => {
    const component = makeMetric("Revenue");
    const data: ComponentRenderData = {
      result: makeResult(["value"], [{ value: 100 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).not.toContain("openboard-metric-trend");
  });

  it("uses first column when 'value' column is absent", () => {
    const component = makeMetric("Count");
    const data: ComponentRenderData = {
      result: makeResult(["total"], [{ total: 999 }]),
    };

    const html = metricRenderer.renderToString(component, data);

    expect(html).toContain("999");
  });
});
