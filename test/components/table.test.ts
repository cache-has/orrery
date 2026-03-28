import { describe, it, expect } from "vitest";
import { tableRenderer } from "../../src/components/table.js";
import type { ComponentNode, PropertyNode, ColumnDef, ColumnsBlock, Span } from "../../src/parser/ast.js";
import type { QueryResult } from "../../src/query/executor.js";
import type { ComponentRenderData } from "../../src/components/types.js";

const span: Span = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function prop(key: string, value: string): PropertyNode {
  return { kind: "property", key, value: { kind: "string", value, span }, span };
}

function boolProp(key: string, value: boolean): PropertyNode {
  return { kind: "property", key, value: { kind: "boolean", value, span }, span };
}

function numProp(key: string, value: number): PropertyNode {
  return { kind: "property", key, value: { kind: "number", value, span }, span };
}

function identProp(key: string, name: string): PropertyNode {
  return { kind: "property", key, value: { kind: "ident", name, span }, span };
}

function makeTable(
  title: string,
  properties: PropertyNode[] = [],
  columns?: ColumnsBlock,
): ComponentNode {
  return {
    kind: "component",
    componentType: "table",
    title,
    opts: {},
    properties,
    columns,
    span,
  };
}

function makeColumnsBlock(defs: ColumnDef[]): ColumnsBlock {
  return { kind: "columns_block", columns: defs, span };
}

function colDef(name: string, properties: PropertyNode[]): ColumnDef {
  return { kind: "column_def", name, properties, span };
}

function makeResult(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, rows, rowCount: rows.length, executionTimeMs: 10 };
}

describe("tableRenderer", () => {
  it("renders a basic table with headers and rows", () => {
    const component = makeTable("Orders");
    const data: ComponentRenderData = {
      result: makeResult(["id", "name"], [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("openboard-data-table");
    expect(html).toContain("id");
    expect(html).toContain("name");
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("2 rows");
  });

  it("renders 'No data' when result is empty", () => {
    const component = makeTable("Orders");
    const data: ComponentRenderData = { result: makeResult(["id"], []) };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("No data");
  });

  it("renders 'No data' when result is undefined", () => {
    const component = makeTable("Orders");
    const data: ComponentRenderData = {};

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("No data");
  });

  it("applies column format (currency)", () => {
    const component = makeTable(
      "Revenue",
      [prop("query", "SELECT amount FROM orders")],
      makeColumnsBlock([colDef("amount", [identProp("format", "currency")])]),
    );
    const data: ComponentRenderData = {
      result: makeResult(["amount"], [{ amount: 1234.5 }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("1,234.50");
  });

  it("applies column format (badge)", () => {
    const component = makeTable(
      "Orders",
      [],
      makeColumnsBlock([colDef("status", [identProp("format", "badge")])]),
    );
    const data: ComponentRenderData = {
      result: makeResult(["status"], [{ status: "Active" }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("openboard-badge");
    expect(html).toContain("openboard-badge-active");
    expect(html).toContain("Active");
  });

  it("applies column label override", () => {
    const component = makeTable(
      "Orders",
      [],
      makeColumnsBlock([colDef("created_at", [prop("label", "Date")])]),
    );
    const data: ComponentRenderData = {
      result: makeResult(["created_at"], [{ created_at: "2024-01-01" }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("Date");
  });

  it("applies column alignment", () => {
    const component = makeTable(
      "Orders",
      [],
      makeColumnsBlock([colDef("amount", [identProp("align", "right")])]),
    );
    const data: ComponentRenderData = {
      result: makeResult(["amount"], [{ amount: 100 }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain('data-ob-align="right"');
  });

  it("renders filter input when filterable is true", () => {
    const component = makeTable("Orders", [boolProp("filterable", true)]);
    const data: ComponentRenderData = {
      result: makeResult(["id"], [{ id: 1 }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("openboard-table-filter");
    expect(html).toContain('placeholder="Filter rows');
  });

  it("does not render filter input when filterable is false", () => {
    const component = makeTable("Orders", [boolProp("filterable", false)]);
    const data: ComponentRenderData = {
      result: makeResult(["id"], [{ id: 1 }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).not.toContain("openboard-table-filter");
  });

  it("renders CSV export button", () => {
    const component = makeTable("Orders");
    const data: ComponentRenderData = {
      result: makeResult(["id"], [{ id: 1 }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("openboard-table-csv-btn");
    expect(html).toContain("CSV");
  });

  it("renders pagination when rows exceed page_size", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));
    const component = makeTable("Orders", [numProp("page_size", 10)]);
    const data: ComponentRenderData = {
      result: makeResult(["id"], rows),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("openboard-table-pagination");
    expect(html).toContain("Page");
    expect(html).toContain("of 3");
    expect(html).toContain("30 rows");
  });

  it("hides rows beyond first page", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    const component = makeTable("Orders", [numProp("page_size", 2)]);
    const data: ComponentRenderData = {
      result: makeResult(["id"], rows),
    };

    const html = tableRenderer.renderToString(component, data);

    // First 2 rows visible, rows 3-5 hidden
    expect(html).toContain('data-ob-row="0">');
    expect(html).toContain('data-ob-row="1">');
    expect(html).toContain('class="openboard-table-row-hidden"');
  });

  it("renders sortable column headers by default", () => {
    const component = makeTable("Orders");
    const data: ComponentRenderData = {
      result: makeResult(["id", "name"], [{ id: 1, name: "Alice" }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain('data-ob-sortable="true"');
    expect(html).toContain("openboard-sort-icon");
  });

  it("renders inline script for client-side interactivity", () => {
    const component = makeTable("Orders");
    const data: ComponentRenderData = {
      result: makeResult(["id"], [{ id: 1 }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("<script>");
    expect(html).toContain("</script>");
  });

  it("handles null values in cells", () => {
    const component = makeTable("Orders");
    const data: ComponentRenderData = {
      result: makeResult(["id", "name"], [{ id: 1, name: null }]),
    };

    const html = tableRenderer.renderToString(component, data);

    // formatValue returns em-dash for null
    expect(html).toContain("\u2014");
  });

  it("applies prefix and suffix from column config", () => {
    const component = makeTable(
      "Revenue",
      [],
      makeColumnsBlock([
        colDef("amount", [
          identProp("format", "currency"),
          prop("prefix", "$"),
        ]),
      ]),
    );
    const data: ComponentRenderData = {
      result: makeResult(["amount"], [{ amount: 99.99 }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).toContain("$99.99");
  });

  it("does not render pagination when all rows fit on one page", () => {
    const component = makeTable("Orders", [numProp("page_size", 25)]);
    const data: ComponentRenderData = {
      result: makeResult(["id"], [{ id: 1 }, { id: 2 }]),
    };

    const html = tableRenderer.renderToString(component, data);

    expect(html).not.toContain("openboard-table-pagination");
    expect(html).toContain("2 rows");
  });
});
