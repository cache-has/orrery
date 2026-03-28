import { describe, it, expect } from "vitest";
import {
  resolveDateRangePreset,
  resolveDateRange,
  DATE_RANGE_PRESETS,
} from "../../src/query/daterange.js";

// Fixed date for deterministic tests: 2025-03-15
const NOW = new Date(2025, 2, 15); // March 15, 2025

describe("resolveDateRangePreset", () => {
  it("resolves 'last 7 days'", () => {
    const result = resolveDateRangePreset("last 7 days", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-03-09");
    expect(result!.end).toBe("2025-03-15");
    // Previous period: 7 days before start
    expect(result!.previous.start).toBe("2025-03-02");
    expect(result!.previous.end).toBe("2025-03-08");
  });

  it("resolves 'last 30 days'", () => {
    const result = resolveDateRangePreset("last 30 days", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-02-14");
    expect(result!.end).toBe("2025-03-15");
    expect(result!.previous.end).toBe("2025-02-13");
  });

  it("resolves 'this month'", () => {
    const result = resolveDateRangePreset("this month", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-03-01");
    expect(result!.end).toBe("2025-03-15");
    expect(result!.previous.start).toBe("2025-02-01");
    expect(result!.previous.end).toBe("2025-02-28");
  });

  it("resolves 'last month'", () => {
    const result = resolveDateRangePreset("last month", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-02-01");
    expect(result!.end).toBe("2025-02-28");
    expect(result!.previous.start).toBe("2025-01-01");
    expect(result!.previous.end).toBe("2025-01-31");
  });

  it("resolves 'this year'", () => {
    const result = resolveDateRangePreset("this year", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-01-01");
    expect(result!.end).toBe("2025-03-15");
    expect(result!.previous.start).toBe("2024-01-01");
    expect(result!.previous.end).toBe("2024-12-31");
  });

  it("normalizes various input formats", () => {
    const a = resolveDateRangePreset("last_30_days", NOW);
    const b = resolveDateRangePreset("Last 30 Days", NOW);
    const c = resolveDateRangePreset("last-30-days", NOW);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("returns null for unknown presets", () => {
    expect(resolveDateRangePreset("unknown", NOW)).toBeNull();
    expect(resolveDateRangePreset("", NOW)).toBeNull();
  });
});

describe("resolveDateRange", () => {
  it("resolves a preset string", () => {
    const result = resolveDateRange("last 7 days", NOW);
    expect(result.start).toBe("2025-03-09");
    expect(result.end).toBe("2025-03-15");
  });

  it("resolves a custom {start, end} object", () => {
    const result = resolveDateRange(
      { start: "2025-01-01", end: "2025-01-31" },
      NOW,
    );
    expect(result.start).toBe("2025-01-01");
    expect(result.end).toBe("2025-01-31");
    // Previous period should be 30 days before start
    expect(result.previous.end).toBe("2024-12-31");
  });

  it("falls back to last 30 days for unrecognized string", () => {
    const result = resolveDateRange("garbage", NOW);
    expect(result.start).toBe("2025-02-14");
    expect(result.end).toBe("2025-03-15");
  });
});

describe("resolveDateRangePreset — additional presets", () => {
  it("resolves 'last 90 days'", () => {
    const result = resolveDateRangePreset("last 90 days", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2024-12-16");
    expect(result!.end).toBe("2025-03-15");
    expect(result!.previous).toBeDefined();
  });

  it("resolves 'this month'", () => {
    const result = resolveDateRangePreset("this month", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-03-01");
    expect(result!.end).toBe("2025-03-15");
  });

  it("resolves 'last month'", () => {
    const result = resolveDateRangePreset("last month", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-02-01");
    expect(result!.end).toBe("2025-02-28");
  });

  it("resolves 'this quarter'", () => {
    const result = resolveDateRangePreset("this quarter", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-01-01");
    expect(result!.end).toBe("2025-03-15");
  });

  it("resolves 'this year'", () => {
    const result = resolveDateRangePreset("this year", NOW);
    expect(result).not.toBeNull();
    expect(result!.start).toBe("2025-01-01");
    expect(result!.end).toBe("2025-03-15");
  });

  it("returns null for unknown preset", () => {
    const result = resolveDateRangePreset("not a preset", NOW);
    expect(result).toBeNull();
  });
});

describe("resolveDateRange — object input", () => {
  it("resolves custom range object with start and end", () => {
    const result = resolveDateRange({ start: "2025-01-01", end: "2025-01-31" }, NOW);
    expect(result.start).toBe("2025-01-01");
    expect(result.end).toBe("2025-01-31");
    expect(result.previous).toBeDefined();
  });
});

describe("DATE_RANGE_PRESETS", () => {
  it("has all expected presets", () => {
    expect(Object.keys(DATE_RANGE_PRESETS)).toContain("last_7_days");
    expect(Object.keys(DATE_RANGE_PRESETS)).toContain("last_30_days");
    expect(Object.keys(DATE_RANGE_PRESETS)).toContain("this_month");
    expect(Object.keys(DATE_RANGE_PRESETS)).toContain("this_year");
  });
});
