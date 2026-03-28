/**
 * Format system for OpenBoard components.
 *
 * Reusable value formatters applied to numbers, dates, and strings
 * across all component types (metric cards, tables, chart axes).
 */

export type FormatType =
  | "currency"
  | "number"
  | "compact"
  | "percent"
  | "datetime"
  | "date"
  | "badge"
  | "raw";

export interface FormatOptions {
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

/**
 * Format a numeric value using compact notation (1.2K, 3.4M, etc.)
 */
function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/**
 * Format a value based on the format type.
 * Returns an HTML string (badge format produces markup).
 */
export function formatValue(
  value: unknown,
  format: FormatType,
  opts: FormatOptions = {},
): string {
  if (value == null) return "\u2014"; // em-dash for null/undefined

  switch (format) {
    case "currency": {
      const num = Number(value);
      if (isNaN(num)) return String(value);
      const decimals = opts.decimals ?? 2;
      return num.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    case "number": {
      const num = Number(value);
      if (isNaN(num)) return String(value);
      return num.toLocaleString("en-US");
    }
    case "compact": {
      const num = Number(value);
      if (isNaN(num)) return String(value);
      return compactNumber(num);
    }
    case "percent": {
      const num = Number(value);
      if (isNaN(num)) return String(value);
      const decimals = opts.decimals ?? 1;
      return `${(num * 100).toFixed(decimals)}%`;
    }
    case "datetime": {
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleString("en-US");
    }
    case "date": {
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleDateString("en-US");
    }
    case "badge": {
      const str = String(value);
      const slug = str.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return `<span class="openboard-badge openboard-badge-${slug}">${str}</span>`;
    }
    case "raw":
    default:
      return String(value);
  }
}

/**
 * Parse a format name string into a FormatType.
 * Returns "raw" for unrecognized format names.
 */
export function parseFormatType(name: string | undefined): FormatType {
  if (!name) return "raw";
  const normalized = name.toLowerCase().trim();
  const valid: FormatType[] = [
    "currency",
    "number",
    "compact",
    "percent",
    "datetime",
    "date",
    "badge",
    "raw",
  ];
  return valid.includes(normalized as FormatType)
    ? (normalized as FormatType)
    : "raw";
}
