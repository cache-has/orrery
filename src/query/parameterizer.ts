/**
 * Converts {{param}} placeholders in SQL to parameterized queries.
 *
 * Supports two placeholder styles:
 * - "postgres" / "duckdb": $1, $2, $3, ...
 * - "mysql" / "sqlite": ?, ?, ?, ...
 *
 * Handles dotted names like {{date_range.start}} for daterange sub-properties.
 */

export type PlaceholderStyle = "postgres" | "mysql" | "sqlite" | "duckdb";

export interface PreparedQuery {
  sql: string;
  values: unknown[];
}

const PARAM_PATTERN = /\{\{(\w+(?:\.\w+)?)\}\}/g;

/**
 * Resolves daterange parameters into their .start and .end sub-properties.
 * Input params may contain { date_range: { start: "2024-01-01", end: "2024-01-31" } }
 * or flat values like { region: "North" }.
 */
export function resolveParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "start" in (value as Record<string, unknown>) &&
      "end" in (value as Record<string, unknown>)
    ) {
      // Daterange: expose sub-properties
      const dr = value as { start: string; end: string };
      resolved[`${key}.start`] = dr.start;
      resolved[`${key}.end`] = dr.end;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Extract parameter names referenced in a SQL string (in order of appearance).
 */
export function extractParamNames(sql: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(PARAM_PATTERN.source, PARAM_PATTERN.flags);
  while ((match = pattern.exec(sql)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Convert a SQL string with {{param}} placeholders into a parameterized query.
 *
 * Deduplicates: if the same param appears multiple times, it reuses the same
 * positional placeholder (for postgres/duckdb) or emits a new ? (for mysql/sqlite).
 */
export function prepareQuery(
  sql: string,
  params: Record<string, unknown>,
  style: PlaceholderStyle = "postgres",
): PreparedQuery {
  const resolved = resolveParams(params);
  const values: unknown[] = [];
  // Map from param name to its positional index (1-based for postgres)
  const paramIndex = new Map<string, number>();

  const preparedSql = sql.replace(PARAM_PATTERN, (_match, name: string) => {
    if (!(name in resolved)) {
      throw new Error(`Unknown parameter: {{${name}}}`);
    }

    if (style === "postgres" || style === "duckdb") {
      // Reuse same positional placeholder for repeated params
      let idx = paramIndex.get(name);
      if (idx === undefined) {
        values.push(resolved[name]);
        idx = values.length;
        paramIndex.set(name, idx);
      }
      return `$${idx}`;
    } else {
      // mysql/sqlite: always emit ? and push value again
      values.push(resolved[name]);
      return "?";
    }
  });

  return { sql: preparedSql, values };
}

/**
 * Map a connection type string to the appropriate placeholder style.
 */
export function placeholderStyleForDriver(
  driverType: string,
): PlaceholderStyle {
  switch (driverType) {
    case "postgres":
    case "postgresql":
    case "duckdb":
      return driverType === "duckdb" ? "duckdb" : "postgres";
    case "mysql":
    case "sqlite":
      return driverType as PlaceholderStyle;
    default:
      return "postgres";
  }
}
