import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser.js";
import { ParseError } from "../../src/parser/errors.js";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Parser", () => {
  it("parses a minimal dashboard", () => {
    const ast = parse('dashboard "Hello" {}');
    expect(ast.kind).toBe("dashboard");
    expect(ast.title).toBe("Hello");
    expect(ast.items).toEqual([]);
  });

  it("parses dashboard-level properties", () => {
    const ast = parse(`dashboard "Sales" {
      description: "Overview"
      connection: "pg"
      refresh: 60
    }`);
    expect(ast.items).toHaveLength(3);
    const desc = ast.items[0];
    expect(desc.kind).toBe("property");
    if (desc.kind === "property") {
      expect(desc.key).toBe("description");
      expect(desc.value).toMatchObject({ kind: "string", value: "Overview" });
    }
    const refresh = ast.items[2];
    if (refresh.kind === "property") {
      expect(refresh.value).toMatchObject({ kind: "number", value: 60 });
    }
  });

  it("parses a daterange param", () => {
    const ast = parse(`dashboard "D" {
      param date_range = daterange(default: "last 7 days")
    }`);
    const param = ast.items[0];
    expect(param.kind).toBe("param");
    if (param.kind === "param") {
      expect(param.name).toBe("date_range");
      expect(param.paramType).toBe("daterange");
      expect(param.options).toHaveLength(1);
      expect(param.options[0].key).toBe("default");
    }
  });

  it("parses a select param with array options", () => {
    const ast = parse(`dashboard "D" {
      param region = select(
        options: ["North", "South", "East"]
        default: "North"
      )
    }`);
    const param = ast.items[0];
    if (param.kind === "param") {
      expect(param.paramType).toBe("select");
      expect(param.options).toHaveLength(2);
      const optionsVal = param.options[0].value;
      if (optionsVal.kind === "array") {
        expect(optionsVal.elements).toHaveLength(3);
      }
    }
  });

  it("parses a text param", () => {
    const ast = parse(`dashboard "D" {
      param search = text(placeholder: "Search...")
    }`);
    const param = ast.items[0];
    if (param.kind === "param") {
      expect(param.paramType).toBe("text");
    }
  });

  it("parses a number param", () => {
    const ast = parse(`dashboard "D" {
      param min_amount = number(default: 0, min: 0, max: 100000)
    }`);
    const param = ast.items[0];
    if (param.kind === "param") {
      expect(param.paramType).toBe("number");
      expect(param.options).toHaveLength(3);
    }
  });

  it("parses a toggle param", () => {
    const ast = parse(`dashboard "D" {
      param show_inactive = toggle(default: false, label: "Include inactive")
    }`);
    const param = ast.items[0];
    expect(param.kind).toBe("param");
    if (param.kind === "param") {
      expect(param.paramType).toBe("toggle");
      expect(param.options).toHaveLength(2);
      expect(param.options[0].key).toBe("default");
      expect(param.options[1].key).toBe("label");
    }
  });

  it("parses a row with metric components", () => {
    const ast = parse(`dashboard "D" {
      row {
        metric "Revenue" (span: 4) {
          query: "SELECT SUM(amount) as value FROM orders"
          format: currency
        }
        metric "Users" (span: 4) {
          query: "SELECT COUNT(*) as value FROM users"
        }
      }
    }`);
    const row = ast.items[0];
    expect(row.kind).toBe("row");
    if (row.kind === "row") {
      expect(row.components).toHaveLength(2);
      expect(row.components[0].componentType).toBe("metric");
      expect(row.components[0].title).toBe("Revenue");
      expect(row.components[0].opts.span).toBe(4);
      expect(row.components[0].properties).toHaveLength(2);
    }
  });

  it("parses a chart with type option and triple-quoted SQL", () => {
    const ast = parse(`dashboard "D" {
      row {
        chart "Trend" (span: 8, type: line) {
          query: """
            SELECT date, SUM(amount) as revenue
            FROM orders
            GROUP BY date
          """
          x: date
          y: revenue
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      const chart = row.components[0];
      expect(chart.componentType).toBe("chart");
      expect(chart.opts.type).toBe("line");
      expect(chart.opts.span).toBe(8);
      expect(chart.properties).toHaveLength(3); // query, x, y
    }
  });

  it("parses a table with columns block", () => {
    const ast = parse(`dashboard "D" {
      row {
        table "Orders" (span: 12) {
          query: "SELECT id, amount, status FROM orders"
          sortable: true
          columns {
            amount { format: currency }
            status { format: badge, label: "Order Status" }
          }
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      const table = row.components[0];
      expect(table.componentType).toBe("table");
      expect(table.columns).toBeDefined();
      expect(table.columns!.columns).toHaveLength(2);
      expect(table.columns!.columns[0].name).toBe("amount");
      expect(table.columns!.columns[1].properties).toHaveLength(2);
    }
  });

  it("parses a text block with markdown content", () => {
    const ast = parse(`dashboard "D" {
      text (span: 12) {
        > **Note:** Revenue figures exclude refunds.
        > Data refreshes every 5 minutes.
      }
    }`);
    const text = ast.items[0];
    expect(text.kind).toBe("component");
    if (text.kind === "component") {
      expect(text.componentType).toBe("text");
      expect(text.markdownContent).toContain("**Note:**");
      expect(text.markdownContent).toContain("Revenue figures exclude refunds");
    }
  });

  it("parses include directives", () => {
    const ast = parse(`dashboard "D" {
      include "sections/revenue.board"
      include "sections/customers.board"
    }`);
    expect(ast.items).toHaveLength(2);
    expect(ast.items[0].kind).toBe("include");
    if (ast.items[0].kind === "include") {
      expect(ast.items[0].path).toBe("sections/revenue.board");
    }
  });

  it("parses file() references", () => {
    const ast = parse(`dashboard "D" {
      row {
        chart "Report" (span: 12, type: line) {
          query: file("queries/report.sql")
          x: date
          y: value
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      const query = row.components[0].properties[0];
      expect(query.value.kind).toBe("file_ref");
      if (query.value.kind === "file_ref") {
        expect(query.value.path).toBe("queries/report.sql");
      }
    }
  });

  it("parses visibility expressions", () => {
    const ast = parse(`dashboard "D" {
      row {
        chart "Detail" (span: 12, type: bar, visible: region != "All") {
          query: "SELECT 1"
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      const chart = row.components[0];
      expect(chart.opts.visible).toBeDefined();
      expect(chart.opts.visible!.left).toBe("region");
      expect(chart.opts.visible!.op).toBe("!=");
      expect(chart.opts.visible!.right).toMatchObject({ kind: "string", value: "All" });
    }
  });

  it("parses boolean property values", () => {
    const ast = parse(`dashboard "D" {
      row {
        table "T" (span: 12) {
          query: "SELECT 1"
          sortable: true
          filterable: false
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      const props = row.components[0].properties;
      expect(props[1].value).toMatchObject({ kind: "boolean", value: true });
      expect(props[2].value).toMatchObject({ kind: "boolean", value: false });
    }
  });

  it("parses identifier values (e.g., format: currency)", () => {
    const ast = parse(`dashboard "D" {
      row {
        metric "M" (span: 4) {
          query: "SELECT 1"
          format: currency
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      const format = row.components[0].properties[1];
      expect(format.value).toMatchObject({ kind: "ident", name: "currency" });
    }
  });

  it("handles comments and blank lines gracefully", () => {
    const ast = parse(`# Top comment
dashboard "D" {
  # Connection info
  connection: "db"

  # Params section
  param date_range = daterange(default: "last 7 days")

  # Layout
  row {
    # Revenue metric
    metric "Revenue" (span: 12) {
      query: "SELECT 1"
    }
  }
}`);
    expect(ast.title).toBe("D");
    expect(ast.items).toHaveLength(3); // property, param, row
  });

  it("parses the test fixture file", () => {
    const fixturePath = resolve(__dirname, "../fixtures/example.board");
    const source = readFileSync(fixturePath, "utf-8");
    const ast = parse(source, fixturePath);

    expect(ast.kind).toBe("dashboard");
    expect(ast.title).toBe("Test Dashboard");
    // description, connection, refresh, param, row, row = 6 items
    expect(ast.items.length).toBeGreaterThanOrEqual(5);
  });

  // --- Error cases ---

  it("throws on missing dashboard keyword", () => {
    expect(() => parse('row { }')).toThrow(ParseError);
  });

  it("throws on missing dashboard title", () => {
    expect(() => parse("dashboard {")).toThrow(ParseError);
  });

  it("throws on unknown param type", () => {
    expect(() =>
      parse('dashboard "D" { param x = dropdown(default: "a") }'),
    ).toThrow(/Unknown parameter type/);
  });

  it("throws on unexpected token in row", () => {
    expect(() =>
      parse('dashboard "D" { row { 123 } }'),
    ).toThrow(ParseError);
  });

  it("throws on missing colon in property", () => {
    expect(() =>
      parse('dashboard "D" { description "hello" }'),
    ).toThrow(ParseError);
  });

  it("provides source location in errors", () => {
    try {
      parse('dashboard "D" {\n  param x = badtype()\n}');
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      if (e instanceof ParseError) {
        expect(e.span.start.line).toBe(2);
      }
    }
  });

  it("formats error messages with file, line, column, and hint", () => {
    const source = 'dashboard "D" {\n  param x = badtype()\n}';
    try {
      parse(source, "test.board");
      expect.fail("Should have thrown");
    } catch (e) {
      if (e instanceof ParseError) {
        const formatted = e.format(source, "test.board");
        expect(formatted).toContain("test.board");
        expect(formatted).toContain("error:");
        expect(formatted).toContain("hint:");
      }
    }
  });

  it("parses component with type option as string", () => {
    const ast = parse(`dashboard "D" {
      row {
        chart "Revenue" (type: "bar") {
          query: "SELECT 1"
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      const comp = row.components[0];
      expect(comp.opts?.type).toBe("bar");
    }
  });

  it("parses component with connection option", () => {
    const ast = parse(`dashboard "D" {
      row {
        chart "Revenue" (connection: "pg_main") {
          query: "SELECT 1"
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      const comp = row.components[0];
      expect(comp.opts?.connection).toBe("pg_main");
    }
  });

  it("parses component with unknown option", () => {
    const ast = parse(`dashboard "D" {
      row {
        chart "Revenue" (custom_opt: 42) {
          query: "SELECT 1"
        }
      }
    }`);
    const row = ast.items[0];
    if (row.kind === "row") {
      expect(row.components[0].opts?.custom_opt).toBe(42);
    }
  });

  it("parses visibility expression on component", () => {
    const ast = parse(`dashboard "D" {
      param region = select(default: "US", options: ["US", "EU"])
      row {
        metric "US Only" (visible: region == "US") {
          query: "SELECT 1 as value"
        }
      }
    }`);
    const row = ast.items.find((i) => i.kind === "row");
    if (row && row.kind === "row") {
      expect(row.components[0].opts?.visible).toBeDefined();
    }
  });

  it("throws on invalid value in property", () => {
    expect(() =>
      parse(`dashboard "D" { row { metric "M" { query: } } }`),
    ).toThrow(ParseError);
  });

  it("parses components outside rows (top-level)", () => {
    const ast = parse(`dashboard "D" {
      metric "Revenue" (span: 4) {
        query: "SELECT 1"
      }
    }`);
    expect(ast.items[0].kind).toBe("component");
  });
});
