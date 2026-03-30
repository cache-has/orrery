/**
 * Data fetcher: walks the AST to extract queries from components,
 * executes them via QueryExecutor, and returns results keyed by component ID.
 */

import type {
  DashboardNode,
  RowNode,
  ComponentNode,
  ParamNode,
  PropertyNode,
} from "../parser/ast.js";
import type { QueryExecutor, QueryResult } from "../query/executor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentData {
  result?: QueryResult;
  trendResult?: QueryResult;
  error?: string;
}

export interface DashboardData {
  /** component ID → query result or error */
  components: Map<string, ComponentData>;
  /** Dashboard-level connection name (from AST) */
  connection: string;
  /** Param definitions extracted from the AST */
  params: ParamInfo[];
}

export interface ParamInfo {
  name: string;
  type: string;
  options: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a stable component ID from its title and position */
export function componentId(component: ComponentNode, index: number): string {
  if (component.title) {
    return component.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
  }
  return `component_${index}`;
}

/** Get a string property value from a component */
function getStringProp(component: ComponentNode, key: string): string | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop) return undefined;
  if (prop.value.kind === "string") return prop.value.value;
  return undefined;
}

/** Get the dashboard-level connection name */
function getDashboardConnection(dashboard: DashboardNode): string {
  for (const item of dashboard.items) {
    if (item.kind === "property" && item.key === "connection") {
      if (item.value.kind === "string" || item.value.kind === "ident") {
        return item.value.kind === "string" ? item.value.value : item.value.name;
      }
    }
  }
  return "default";
}

/** Extract param definitions from the AST */
function extractParams(dashboard: DashboardNode): ParamInfo[] {
  return dashboard.items
    .filter((item): item is ParamNode => item.kind === "param")
    .map((param) => {
      const options: Record<string, unknown> = {};
      for (const opt of param.options) {
        if (opt.value.kind === "string") options[opt.key] = opt.value.value;
        else if (opt.value.kind === "number") options[opt.key] = opt.value.value;
        else if (opt.value.kind === "boolean") options[opt.key] = opt.value.value;
        else if (opt.value.kind === "array") {
          options[opt.key] = opt.value.elements.map((el) =>
            el.kind === "string" ? el.value : el.kind === "number" ? el.value : String(el),
          );
        }
      }
      return { name: param.name, type: param.paramType, options };
    });
}

/**
 * For select params with a `query` option, execute the query and
 * populate the `options` array with the first column's values.
 */
async function resolveQueryDrivenParams(
  params: ParamInfo[],
  executor: QueryExecutor,
  connection: string,
): Promise<void> {
  const queryParams = params.filter(
    (p) => p.type === "select" && typeof p.options.query === "string",
  );
  if (queryParams.length === 0) return;

  const queryOptions = queryParams.map((p) => ({
    sql: p.options.query as string,
    connection,
    params: {},
  }));

  const results = await executor.executeAll(queryOptions);

  for (let i = 0; i < queryParams.length; i++) {
    const result = results.get(i);
    if (result && !(result instanceof Error) && result.rows.length > 0) {
      // Use the first column's values as the options
      const firstCol = result.columns[0];
      const optionValues = result.rows.map((row) => String(row[firstCol]));
      queryParams[i].options.options = optionValues;
      // Set default to first option if default_first is set
      if (queryParams[i].options.default_first && !queryParams[i].options.default) {
        queryParams[i].options.default = optionValues[0];
      }
    }
  }
}

/** Collect all components from the AST in order, with stable IDs */
export function collectComponents(
  dashboard: DashboardNode,
): { id: string; component: ComponentNode }[] {
  const result: { id: string; component: ComponentNode }[] = [];
  let globalIndex = 0;

  for (const item of dashboard.items) {
    if (item.kind === "row") {
      for (const comp of (item as RowNode).components) {
        result.push({ id: componentId(comp, globalIndex), component: comp });
        globalIndex++;
      }
    } else if (item.kind === "component") {
      result.push({ id: componentId(item, globalIndex), component: item });
      globalIndex++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

/**
 * Fetch all data needed to render a dashboard.
 *
 * Walks the AST, finds all components with `query` properties,
 * executes them in parallel via the QueryExecutor, and returns
 * the results keyed by component ID.
 */
export async function fetchDashboardData(
  dashboard: DashboardNode,
  executor: QueryExecutor,
  paramValues: Record<string, unknown> = {},
): Promise<DashboardData> {
  const connection = getDashboardConnection(dashboard);
  const params = extractParams(dashboard);
  const components = collectComponents(dashboard);
  const dataMap = new Map<string, ComponentData>();

  // Resolve query-driven select params (runs their queries to populate options)
  await resolveQueryDrivenParams(params, executor, connection);

  // Update paramValues with any newly resolved defaults from query-driven params
  for (const p of params) {
    if (p.options.default !== undefined && !(p.name in paramValues)) {
      paramValues[p.name] = p.options.default;
    }
    // Also update if the current value is empty string (our fallback) and we now have a real default
    if (paramValues[p.name] === "" && p.options.default !== undefined) {
      paramValues[p.name] = p.options.default;
    }
  }

  // Build list of queries to execute
  const queryJobs: { id: string; sql: string; kind: "primary" | "trend" }[] = [];

  for (const { id, component } of components) {
    const sql = getStringProp(component, "query");
    if (sql) {
      queryJobs.push({ id, sql, kind: "primary" });
    } else {
      // Components without queries (e.g., text blocks) get empty data
      dataMap.set(id, {});
    }

    // Trend queries for metric components
    const trendSql = getStringProp(component, "trend_query");
    if (trendSql) {
      queryJobs.push({ id, sql: trendSql, kind: "trend" });
    }
  }

  // Execute all queries in parallel
  if (queryJobs.length > 0) {
    const queryOptions = queryJobs.map((job) => ({
      sql: job.sql,
      connection,
      params: paramValues,
    }));

    const results = await executor.executeAll(queryOptions);

    for (let i = 0; i < queryJobs.length; i++) {
      const job = queryJobs[i];
      const result = results.get(i);
      const existing = dataMap.get(job.id) ?? {};

      if (!result) {
        if (job.kind === "primary") {
          dataMap.set(job.id, { ...existing, error: "Query returned no result" });
        }
      } else if (result instanceof Error) {
        if (job.kind === "primary") {
          dataMap.set(job.id, { ...existing, error: result.message });
        }
        // Trend query errors are silently ignored — trend is optional
      } else {
        if (job.kind === "primary") {
          dataMap.set(job.id, { ...existing, result });
        } else {
          dataMap.set(job.id, { ...existing, trendResult: result });
        }
      }
    }
  }

  return { components: dataMap, connection, params };
}
