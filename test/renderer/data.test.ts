import { describe, it, expect } from "vitest";
import { collectComponents, componentId } from "../../src/renderer/data.js";
import type { DashboardNode, RowNode, ComponentNode, Span, ParamNode, PropertyNode } from "../../src/parser/ast.js";

const span: Span = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function makeComponent(title: string | undefined, type: "metric" | "chart" = "metric"): ComponentNode {
  return {
    kind: "component",
    componentType: type,
    title,
    opts: {},
    properties: [],
    span,
  };
}

function makeRow(components: ComponentNode[]): RowNode {
  return { kind: "row", components, span };
}

function makeDashboard(items: (RowNode | ParamNode | PropertyNode)[]): DashboardNode {
  return { kind: "dashboard", title: "Test", items, span };
}

describe("componentId", () => {
  it("generates ID from title", () => {
    const comp = makeComponent("Total Revenue");
    expect(componentId(comp, 0)).toBe("total_revenue");
  });

  it("falls back to index when no title", () => {
    const comp = makeComponent(undefined);
    expect(componentId(comp, 3)).toBe("component_3");
  });

  it("strips non-alphanumeric characters", () => {
    const comp = makeComponent("Revenue ($)");
    expect(componentId(comp, 0)).toBe("revenue");
  });
});

describe("collectComponents", () => {
  it("collects components from rows in order", () => {
    const dashboard = makeDashboard([
      makeRow([makeComponent("A"), makeComponent("B")]),
      makeRow([makeComponent("C")]),
    ]);

    const result = collectComponents(dashboard);

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
    expect(result[2].id).toBe("c");
  });

  it("collects top-level components (outside rows)", () => {
    const comp = makeComponent("Solo");
    const dashboard: DashboardNode = {
      kind: "dashboard",
      title: "Test",
      items: [comp],
      span,
    };

    const result = collectComponents(dashboard);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("solo");
  });

  it("uses global index for unnamed components", () => {
    const dashboard = makeDashboard([
      makeRow([makeComponent("Named"), makeComponent(undefined)]),
    ]);

    const result = collectComponents(dashboard);

    expect(result[0].id).toBe("named");
    expect(result[1].id).toBe("component_1");
  });
});
