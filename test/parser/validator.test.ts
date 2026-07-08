import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser.js";
import { validate, validateOrThrow } from "../../src/parser/validator.js";
import { ParseError } from "../../src/parser/errors.js";

function parseAndValidate(source: string) {
  return validate(parse(source));
}

describe("Validator", () => {
  it("returns no diagnostics for a valid dashboard", () => {
    const diags = parseAndValidate(`dashboard "D" {
      connection: "db"
      param date_range = daterange(default: "last 7 days")
      row {
        metric "Revenue" (span: 6) {
          query: "SELECT SUM(amount) as value FROM orders WHERE {{date_range}}"
        }
        chart "Trend" (span: 6, type: line) {
          query: "SELECT date, amount FROM orders WHERE {{date_range}}"
          x: date
          y: amount
        }
      }
    }`);
    expect(diags).toHaveLength(0);
  });

  it("errors on missing query property for metric", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        metric "Revenue" (span: 6) {
          format: currency
        }
      }
    }`);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("error");
    expect(diags[0].message).toContain("Missing required property 'query'");
  });

  it("errors on missing query property for chart", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "Trend" (span: 6, type: line) {
          x: date
        }
      }
    }`);
    expect(diags[0].message).toContain("Missing required property 'query'");
  });

  it("errors on missing query property for table", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        table "Orders" (span: 12) {
          sortable: true
        }
      }
    }`);
    expect(diags[0].message).toContain("Missing required property 'query'");
  });

  it("does not require query for text components", () => {
    const diags = parseAndValidate(`dashboard "D" {
      text (span: 12) {
        Some markdown content
      }
    }`);
    expect(diags).toHaveLength(0);
  });

  it("errors on unknown chart type", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "C" (span: 6, type: hbar) {
          query: "SELECT 1"
        }
      }
    }`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("Unknown chart type 'hbar'");
    expect(diags[0].hint).toContain("bar"); // suggests 'bar'
  });

  it("accepts funnel as a known chart type", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "Funnel" (span: 6, type: funnel) {
          query: "SELECT stage, count FROM funnel ORDER BY sort_order"
          label: stage
          value: count
        }
      }
    }`);
    expect(diags).toHaveLength(0);
  });

  it("accepts gauge as a known chart type", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "Gauge" (span: 4, type: gauge) {
          query: "SELECT current_value, target_value FROM t LIMIT 1"
          value: current_value
          max: target_value
          thresholds: [0.5, 0.8]
        }
      }
    }`);
    expect(diags).toHaveLength(0);
  });

  it("errors on undefined parameter reference in query", () => {
    const diags = parseAndValidate(`dashboard "D" {
      param date_range = daterange(default: "last 7 days")
      row {
        metric "M" (span: 6) {
          query: "SELECT 1 WHERE {{date_rnage}}"
        }
      }
    }`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("Undefined parameter 'date_rnage'");
    expect(diags[0].hint).toContain("date_range"); // typo suggestion
  });

  it("errors on span outside 1-12 range", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        metric "M" (span: 0) {
          query: "SELECT 1"
        }
      }
    }`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("Invalid span value");
  });

  it("warns when row spans exceed 12", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        metric "A" (span: 8) { query: "SELECT 1" }
        metric "B" (span: 8) { query: "SELECT 1" }
      }
    }`);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("warning");
    expect(diags[0].message).toContain("exceeds the 12-column grid");
  });

  it("errors on duplicate param names", () => {
    const diags = parseAndValidate(`dashboard "D" {
      param x = text(placeholder: "a")
      param x = text(placeholder: "b")
    }`);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("error");
    expect(diags[0].message).toContain("Duplicate parameter 'x'");
  });

  it("warns on duplicate component titles", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        metric "Revenue" (span: 6) { query: "SELECT 1" }
        metric "Revenue" (span: 6) { query: "SELECT 2" }
      }
    }`);
    expect(diags).toHaveLength(1);
    expect(diags[0].level).toBe("warning");
    expect(diags[0].message).toContain("Duplicate component title 'Revenue'");
  });

  it("provides typo suggestions for chart types", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "C" (span: 6, type: scater) {
          query: "SELECT 1"
        }
      }
    }`);
    expect(diags[0].hint).toContain("scatter");
  });

  it("validateOrThrow throws on first error", () => {
    const ast = parse(`dashboard "D" {
      row {
        metric "M" (span: 0) { format: currency }
      }
    }`);
    expect(() => validateOrThrow(ast)).toThrow(ParseError);
  });

  it("validateOrThrow does not throw on warnings only", () => {
    const ast = parse(`dashboard "D" {
      row {
        metric "A" (span: 8) { query: "SELECT 1" }
        metric "B" (span: 8) { query: "SELECT 1" }
      }
    }`);
    // Row span warning only — should not throw
    expect(() => validateOrThrow(ast)).not.toThrow();
  });

  it("accepts stacked: true on a bar chart", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "C" (span: 12, type: bar) {
          query: "SELECT 1"
          x: a
          y: b
          series: c
          stacked: true
        }
      }
    }`);
    expect(diags).toHaveLength(0);
  });

  it("accepts stacked: \"percent\" on a bar chart", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "C" (span: 12, type: bar) {
          query: "SELECT 1"
          x: a
          y: b
          series: c
          stacked: "percent"
        }
      }
    }`);
    expect(diags).toHaveLength(0);
  });

  it("errors on stacked applied to a line chart", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "C" (span: 12, type: line) {
          query: "SELECT 1"
          x: a
          y: b
          stacked: true
        }
      }
    }`);
    expect(diags.some((d) => d.level === "error" && d.message.includes("'stacked' is only valid on bar charts"))).toBe(true);
  });

  it("errors on invalid stacked string value", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        chart "C" (span: 12, type: bar) {
          query: "SELECT 1"
          x: a
          y: b
          stacked: "yes"
        }
      }
    }`);
    expect(diags.some((d) => d.level === "error" && d.message.includes("Invalid 'stacked' value"))).toBe(true);
  });

  it("warns on a footnote over the display limit", () => {
    const longText = "a".repeat(201);
    const diags = parseAndValidate(`dashboard "D" {
      row {
        metric "M" (span: 12) {
          query: "SELECT 1"
          footnote: "${longText}"
        }
      }
    }`);
    expect(
      diags.some((d) => d.level === "warning" && d.message.includes("over the 200-character display limit")),
    ).toBe(true);
  });

  it("does not warn on a footnote within the display limit", () => {
    const diags = parseAndValidate(`dashboard "D" {
      row {
        metric "M" (span: 12) {
          query: "SELECT 1"
          footnote: "Excludes refunded orders."
        }
      }
    }`);
    expect(diags.some((d) => d.message.includes("footnote"))).toBe(false);
  });

  it("handles param references with dot notation (e.g., date_range.previous)", () => {
    const diags = parseAndValidate(`dashboard "D" {
      param date_range = daterange(default: "last 7 days")
      row {
        metric "M" (span: 6) {
          query: "SELECT 1 WHERE {{date_range.previous}}"
        }
      }
    }`);
    expect(diags).toHaveLength(0);
  });
});
