import { describe, it, expect } from "vitest";
import { formatValue, parseFormatType } from "../../src/components/format.js";

describe("formatValue", () => {
  it("formats currency with 2 decimal places", () => {
    expect(formatValue(1234.5, "currency")).toBe("1,234.50");
  });

  it("formats number with locale separators", () => {
    expect(formatValue(1234567, "number")).toBe("1,234,567");
  });

  it("formats compact numbers", () => {
    expect(formatValue(1200, "compact")).toBe("1.2K");
    expect(formatValue(3400000, "compact")).toBe("3.4M");
    expect(formatValue(1500000000, "compact")).toBe("1.5B");
    expect(formatValue(42, "compact")).toBe("42");
  });

  it("formats percent (multiplies by 100)", () => {
    expect(formatValue(0.856, "percent")).toBe("85.6%");
  });

  it("formats badge as HTML span", () => {
    const result = formatValue("Active", "badge");
    expect(result).toContain("openboard-badge");
    expect(result).toContain("openboard-badge-active");
    expect(result).toContain("Active");
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatValue(null, "currency")).toBe("\u2014");
    expect(formatValue(undefined, "number")).toBe("\u2014");
  });

  it("returns string representation for NaN values", () => {
    expect(formatValue("not-a-number", "currency")).toBe("not-a-number");
  });

  it("formats raw values as plain strings", () => {
    expect(formatValue(42, "raw")).toBe("42");
    expect(formatValue("hello", "raw")).toBe("hello");
  });
});

describe("parseFormatType", () => {
  it("parses valid format names", () => {
    expect(parseFormatType("currency")).toBe("currency");
    expect(parseFormatType("compact")).toBe("compact");
    expect(parseFormatType("percent")).toBe("percent");
  });

  it("returns raw for undefined or unknown formats", () => {
    expect(parseFormatType(undefined)).toBe("raw");
    expect(parseFormatType("unknown")).toBe("raw");
  });

  it("is case-insensitive", () => {
    expect(parseFormatType("Currency")).toBe("currency");
    expect(parseFormatType("PERCENT")).toBe("percent");
  });
});
