import type {
  ComponentNode,
  DashboardNode,
  ParamNode,
  RowNode,
  Span,
  ValueNode,
} from "./ast.js";
import { ParseError } from "./errors.js";

const KNOWN_CHART_TYPES = new Set(["line", "bar", "area", "scatter", "pie", "donut", "heatmap", "funnel", "gauge"]);
const COMPONENTS_REQUIRING_QUERY = new Set(["metric", "chart", "table"]);

export interface ValidationDiagnostic {
  level: "error" | "warning";
  message: string;
  span: Span;
  hint?: string;
}

/**
 * Validate a parsed DashboardNode for semantic correctness.
 * Returns an array of diagnostics (errors and warnings).
 * Throws nothing — collects all issues.
 */
export function validate(ast: DashboardNode): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const declaredParams = collectParams(ast);

  // Check for duplicate param names
  checkDuplicateParams(ast, diagnostics);

  // Check for duplicate component titles (warning)
  checkDuplicateComponentTitles(ast, diagnostics);

  // Validate each item
  for (const item of ast.items) {
    if (item.kind === "row") {
      validateRow(item, declaredParams, diagnostics);
    } else if (item.kind === "component") {
      validateComponent(item, declaredParams, diagnostics);
    }
  }

  return diagnostics;
}

function collectParams(ast: DashboardNode): Map<string, ParamNode> {
  const params = new Map<string, ParamNode>();
  for (const item of ast.items) {
    if (item.kind === "param") {
      params.set(item.name, item);
    }
  }
  return params;
}

function checkDuplicateParams(ast: DashboardNode, diags: ValidationDiagnostic[]): void {
  const seen = new Map<string, Span>();
  for (const item of ast.items) {
    if (item.kind === "param") {
      const prev = seen.get(item.name);
      if (prev) {
        diags.push({
          level: "error",
          message: `Duplicate parameter '${item.name}'`,
          span: item.span,
          hint: `'${item.name}' was already declared on line ${prev.start.line}`,
        });
      } else {
        seen.set(item.name, item.span);
      }
    }
  }
}

function checkDuplicateComponentTitles(ast: DashboardNode, diags: ValidationDiagnostic[]): void {
  const seen = new Map<string, Span>();

  function checkComponent(comp: ComponentNode): void {
    if (!comp.title) return;
    const prev = seen.get(comp.title);
    if (prev) {
      diags.push({
        level: "warning",
        message: `Duplicate component title '${comp.title}'`,
        span: comp.span,
        hint: `A component with this title already exists on line ${prev.start.line}`,
      });
    } else {
      seen.set(comp.title, comp.span);
    }
  }

  for (const item of ast.items) {
    if (item.kind === "component") checkComponent(item);
    if (item.kind === "row") {
      for (const comp of item.components) checkComponent(comp);
    }
  }
}

function validateRow(
  row: RowNode,
  params: Map<string, ParamNode>,
  diags: ValidationDiagnostic[],
): void {
  // Check total span doesn't exceed 12
  let totalSpan = 0;
  let allHaveSpan = true;
  for (const comp of row.components) {
    if (comp.opts.span != null) {
      totalSpan += comp.opts.span;
    } else {
      allHaveSpan = false;
    }
  }
  if (allHaveSpan && totalSpan > 12) {
    diags.push({
      level: "warning",
      message: `Row spans total ${totalSpan}, which exceeds the 12-column grid`,
      span: row.span,
      hint: "Adjust span values so they sum to 12 or less",
    });
  }

  for (const comp of row.components) {
    validateComponent(comp, params, diags);
  }
}

function validateComponent(
  comp: ComponentNode,
  params: Map<string, ParamNode>,
  diags: ValidationDiagnostic[],
): void {
  // Check span range
  if (comp.opts.span != null && (comp.opts.span < 1 || comp.opts.span > 12)) {
    diags.push({
      level: "error",
      message: `Invalid span value ${comp.opts.span}`,
      span: comp.span,
      hint: "Span must be between 1 and 12",
    });
  }

  // Check required 'query' property
  if (COMPONENTS_REQUIRING_QUERY.has(comp.componentType)) {
    const hasQuery = comp.properties.some((p) => p.key === "query");
    if (!hasQuery) {
      diags.push({
        level: "error",
        message: `Missing required property 'query'`,
        span: comp.span,
        hint: `${comp.componentType} components need a 'query' property with a SQL query`,
      });
    }
  }

  // Check chart type is known
  if (comp.componentType === "chart" && comp.opts.type) {
    if (!KNOWN_CHART_TYPES.has(comp.opts.type)) {
      const suggestion = findClosest(comp.opts.type, [...KNOWN_CHART_TYPES]);
      const hint = suggestion
        ? `Did you mean '${suggestion}'? Valid types: ${[...KNOWN_CHART_TYPES].join(", ")}`
        : `Valid chart types are: ${[...KNOWN_CHART_TYPES].join(", ")}`;
      diags.push({
        level: "error",
        message: `Unknown chart type '${comp.opts.type}'`,
        span: comp.span,
        hint,
      });
    }
  }

  // Validate `stacked` property (bar charts only; boolean or "percent")
  const stackedProp = comp.properties.find((p) => p.key === "stacked");
  if (stackedProp) {
    if (comp.componentType !== "chart" || comp.opts.type !== "bar") {
      diags.push({
        level: "error",
        message: `'stacked' is only valid on bar charts`,
        span: stackedProp.span,
        hint: "Remove 'stacked' or set the chart type to 'bar'",
      });
    } else {
      const v = stackedProp.value;
      const isBool = v.kind === "boolean";
      const isPercent =
        (v.kind === "string" && v.value === "percent") ||
        (v.kind === "ident" && v.name === "percent");
      if (!isBool && !isPercent) {
        diags.push({
          level: "error",
          message: `Invalid 'stacked' value`,
          span: stackedProp.span,
          hint: "'stacked' must be true, false, or \"percent\"",
        });
      }
    }
  }

  // Check param references in SQL queries
  for (const prop of comp.properties) {
    if (prop.key === "query" || prop.key === "trend_query") {
      checkParamReferences(prop.value, params, diags);
    }
  }
}

function checkParamReferences(
  value: ValueNode,
  params: Map<string, ParamNode>,
  diags: ValidationDiagnostic[],
): void {
  if (value.kind !== "string") return;

  const paramRefPattern = /\{\{(\w+)(?:\.\w+)?\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = paramRefPattern.exec(value.value)) !== null) {
    const refName = match[1];
    if (!params.has(refName)) {
      const suggestion = findClosest(refName, [...params.keys()]);
      const hint = suggestion
        ? `Did you mean '${suggestion}'?`
        : "Make sure the parameter is declared with a 'param' statement";
      diags.push({
        level: "error",
        message: `Undefined parameter '${refName}' in query`,
        span: value.span,
        hint,
      });
    }
  }
}

// --- Levenshtein distance for typo suggestions ---

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find the closest match to `target` from `candidates` using Levenshtein distance.
 * Returns null if no candidate is close enough (distance > 3 or > half the target length).
 */
function findClosest(target: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;

  let bestDist = Infinity;
  let bestMatch: string | null = null;

  for (const c of candidates) {
    const d = levenshtein(target.toLowerCase(), c.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      bestMatch = c;
    }
  }

  // Only suggest if reasonably close
  const maxDist = Math.max(3, Math.floor(target.length / 2));
  return bestDist <= maxDist ? bestMatch : null;
}

/**
 * Convenience: validate and throw on first error.
 * Useful for quick fail-fast validation.
 */
export function validateOrThrow(ast: DashboardNode, _source?: string): void {
  const diags = validate(ast);
  const firstError = diags.find((d) => d.level === "error");
  if (firstError) {
    throw new ParseError(firstError.message, firstError.span, firstError.hint);
  }
}
