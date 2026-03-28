import { describe, it, expect } from "vitest";
import { parameterize } from "../../src/query/parameterizer.js";

describe("parameterize", () => {
  it("substitutes simple parameters", () => {
    const sql = "SELECT * FROM orders WHERE {{region}} = region";
    const result = parameterize(sql, { region: "'North'" });
    expect(result).toBe("SELECT * FROM orders WHERE 'North' = region");
  });

  it("substitutes multiple parameters", () => {
    const sql = "SELECT * FROM orders WHERE region = {{region}} AND {{date_range}}";
    const result = parameterize(sql, {
      region: "'North'",
      date_range: "created_at > '2024-01-01'",
    });
    expect(result).toBe(
      "SELECT * FROM orders WHERE region = 'North' AND created_at > '2024-01-01'",
    );
  });

  it("handles dotted parameter names", () => {
    const sql = "WHERE {{date_range.previous}}";
    const result = parameterize(sql, { "date_range.previous": "created_at > '2024-01-01'" });
    expect(result).toBe("WHERE created_at > '2024-01-01'");
  });

  it("throws on unknown parameter", () => {
    expect(() => parameterize("{{unknown}}", {})).toThrow("Unknown parameter: {{unknown}}");
  });

  it("returns SQL unchanged when no placeholders", () => {
    const sql = "SELECT 1";
    expect(parameterize(sql, {})).toBe("SELECT 1");
  });
});
