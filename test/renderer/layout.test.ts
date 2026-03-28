import { describe, it, expect } from "vitest";
import { resolveLayout } from "../../src/renderer/layout.js";
import type { DashboardNode, RowNode, ComponentNode, Span } from "../../src/parser/ast.js";

const span: Span = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function makeComponent(type: "metric" | "chart", title: string, colSpan?: number): ComponentNode {
  return {
    kind: "component",
    componentType: type,
    title,
    opts: colSpan !== undefined ? { span: colSpan } : {},
    properties: [],
    span,
  };
}

function makeDashboard(rows: RowNode[]): DashboardNode {
  return { kind: "dashboard", title: "Test", items: rows, span };
}

describe("resolveLayout", () => {
  it("assigns explicit spans to grid columns", () => {
    const row: RowNode = {
      kind: "row",
      components: [makeComponent("metric", "A", 4), makeComponent("metric", "B", 8)],
      span,
    };
    const layout = resolveLayout(makeDashboard([row]));
    expect(layout.rows[0].components[0].gridColumn).toBe("1 / span 4");
    expect(layout.rows[0].components[1].gridColumn).toBe("5 / span 8");
  });

  it("auto-divides columns when spans are omitted", () => {
    const row: RowNode = {
      kind: "row",
      components: [
        makeComponent("metric", "A"),
        makeComponent("metric", "B"),
        makeComponent("metric", "C"),
      ],
      span,
    };
    const layout = resolveLayout(makeDashboard([row]));
    expect(layout.rows[0].components[0].gridColumn).toBe("1 / span 4");
    expect(layout.rows[0].components[1].gridColumn).toBe("5 / span 4");
    expect(layout.rows[0].components[2].gridColumn).toBe("9 / span 4");
  });

  it("mixes explicit and auto spans", () => {
    const row: RowNode = {
      kind: "row",
      components: [makeComponent("metric", "A", 6), makeComponent("chart", "B")],
      span,
    };
    const layout = resolveLayout(makeDashboard([row]));
    expect(layout.rows[0].components[0].gridColumn).toBe("1 / span 6");
    expect(layout.rows[0].components[1].gridColumn).toBe("7 / span 6");
  });

  it("returns the dashboard title", () => {
    const layout = resolveLayout(makeDashboard([]));
    expect(layout.title).toBe("Test");
  });
});
