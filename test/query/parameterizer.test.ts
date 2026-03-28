import { describe, it, expect } from "vitest";
import {
  prepareQuery,
  resolveParams,
  extractParamNames,
  placeholderStyleForDriver,
} from "../../src/query/parameterizer.js";

describe("prepareQuery", () => {
  it("converts {{param}} to $1 placeholder (postgres style)", () => {
    const result = prepareQuery(
      "SELECT * FROM orders WHERE region = {{region}}",
      { region: "North" },
      "postgres",
    );
    expect(result.sql).toBe("SELECT * FROM orders WHERE region = $1");
    expect(result.values).toEqual(["North"]);
  });

  it("converts {{param}} to ? placeholder (sqlite style)", () => {
    const result = prepareQuery(
      "SELECT * FROM orders WHERE region = {{region}}",
      { region: "North" },
      "sqlite",
    );
    expect(result.sql).toBe("SELECT * FROM orders WHERE region = ?");
    expect(result.values).toEqual(["North"]);
  });

  it("handles multiple different parameters", () => {
    const result = prepareQuery(
      "WHERE region = {{region}} AND status = {{status}}",
      { region: "North", status: "active" },
      "postgres",
    );
    expect(result.sql).toBe("WHERE region = $1 AND status = $2");
    expect(result.values).toEqual(["North", "active"]);
  });

  it("reuses positional placeholder for repeated params (postgres)", () => {
    const result = prepareQuery(
      "WHERE a = {{x}} OR b = {{x}}",
      { x: "val" },
      "postgres",
    );
    expect(result.sql).toBe("WHERE a = $1 OR b = $1");
    expect(result.values).toEqual(["val"]);
  });

  it("emits separate ? for repeated params (mysql/sqlite)", () => {
    const result = prepareQuery(
      "WHERE a = {{x}} OR b = {{x}}",
      { x: "val" },
      "mysql",
    );
    expect(result.sql).toBe("WHERE a = ? OR b = ?");
    expect(result.values).toEqual(["val", "val"]);
  });

  it("throws on unknown parameter", () => {
    expect(() =>
      prepareQuery("SELECT {{unknown}}", {}, "postgres"),
    ).toThrow("Unknown parameter: {{unknown}}");
  });

  it("returns SQL unchanged when no placeholders", () => {
    const result = prepareQuery("SELECT 1", {}, "postgres");
    expect(result.sql).toBe("SELECT 1");
    expect(result.values).toEqual([]);
  });

  it("handles numeric parameter values", () => {
    const result = prepareQuery(
      "WHERE id = {{id}}",
      { id: 42 },
      "postgres",
    );
    expect(result.sql).toBe("WHERE id = $1");
    expect(result.values).toEqual([42]);
  });

  it("prevents SQL injection via parameterized values", () => {
    const malicious = "'; DROP TABLE users; --";
    const result = prepareQuery(
      "WHERE name = {{name}}",
      { name: malicious },
      "postgres",
    );
    // The malicious string is in values, not interpolated into SQL
    expect(result.sql).toBe("WHERE name = $1");
    expect(result.values).toEqual([malicious]);
    expect(result.sql).not.toContain("DROP");
  });
});

describe("resolveParams", () => {
  it("passes through flat scalar values", () => {
    const resolved = resolveParams({ region: "North", count: 5 });
    expect(resolved).toEqual({ region: "North", count: 5 });
  });

  it("expands daterange objects to .start and .end", () => {
    const resolved = resolveParams({
      date_range: { start: "2024-01-01", end: "2024-01-31" },
    });
    expect(resolved).toEqual({
      "date_range.start": "2024-01-01",
      "date_range.end": "2024-01-31",
    });
  });

  it("handles mixed flat and daterange params", () => {
    const resolved = resolveParams({
      region: "North",
      date_range: { start: "2024-01-01", end: "2024-12-31" },
    });
    expect(resolved).toEqual({
      region: "North",
      "date_range.start": "2024-01-01",
      "date_range.end": "2024-12-31",
    });
  });
});

describe("extractParamNames", () => {
  it("extracts parameter names from SQL", () => {
    const names = extractParamNames(
      "WHERE region = {{region}} AND created_at >= {{date_range.start}}",
    );
    expect(names).toEqual(["region", "date_range.start"]);
  });

  it("returns empty array for SQL with no params", () => {
    expect(extractParamNames("SELECT 1")).toEqual([]);
  });
});

describe("placeholderStyleForDriver", () => {
  it("returns postgres for postgres/postgresql", () => {
    expect(placeholderStyleForDriver("postgres")).toBe("postgres");
    expect(placeholderStyleForDriver("postgresql")).toBe("postgres");
  });

  it("returns correct style for mysql and sqlite", () => {
    expect(placeholderStyleForDriver("mysql")).toBe("mysql");
    expect(placeholderStyleForDriver("sqlite")).toBe("sqlite");
  });

  it("returns duckdb for duckdb", () => {
    expect(placeholderStyleForDriver("duckdb")).toBe("duckdb");
  });
});
