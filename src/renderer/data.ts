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
import { toQueryExecutionError } from "../query/executor.js";
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
  /**
   * IDs of components whose queries had not finished when `deadlineMs`
   * elapsed. Their queries keep running; ask for them again to get the result.
   * Empty unless a deadline was set.
   */
  pending?: string[];
}

export interface FetchOptions {
  /** Only run the queries of these component IDs. Default: every component. */
  only?: Iterable<string>;
  /** Cache TTL in seconds for this dashboard's queries. Default: the executor's default. */
  cacheTtl?: number;
  /** Skip the cache read (results are still cached). */
  fresh?: boolean;
  /** Abandon the fetch; queries that have not started are never run. */
  signal?: AbortSignal;
  /** Dashboard name, used to label queries in the slow query log. */
  label?: string;
  /**
   * Return after this many milliseconds with whatever has finished, listing
   * the rest in `pending`. Default: wait for every query.
   */
  deadlineMs?: number;
  /** Run this many of the dashboard's queries at a time. Default: all at once. */
  concurrency?: number;
  /** Called as each component's data becomes available, in completion order. */
  onComponent?: (id: string, data: ComponentData) => void;
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
  options: FetchOptions = {},
): Promise<DashboardData> {
  const { cacheTtl, fresh, signal, label, deadlineMs, concurrency, onComponent } = options;
  const only = options.only ? new Set(options.only) : undefined;
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

  // One task per component: its primary query plus its optional trend query.
  const tasks: { id: string; run: () => Promise<ComponentData> }[] = [];

  for (const { id, component } of components) {
    if (only && !only.has(id)) continue;

    const sql = getStringProp(component, "query");
    // Trend queries for metric components
    const trendSql = getStringProp(component, "trend_query");

    if (!sql && !trendSql) {
      // Components without queries (e.g., text blocks) get empty data
      dataMap.set(id, {});
      continue;
    }

    const run = (querySql: string) =>
      executor.execute({
        sql: querySql,
        connection,
        params: paramValues,
        cacheTtl,
        fresh,
        signal,
        label: label ? `${label}/${id}` : id,
      });

    tasks.push({
      id,
      run: async () => {
        const [primary, trend] = await Promise.all([
          sql ? run(sql).catch((err) => toQueryExecutionError(err, sql)) : undefined,
          // Trend query errors are silently ignored — trend is optional
          trendSql ? run(trendSql).catch(() => undefined) : undefined,
        ]);
        const data: ComponentData = {};
        if (primary instanceof Error) data.error = primary.message;
        else if (primary) data.result = primary;
        if (trend) data.trendResult = trend;
        return data;
      },
    });
  }

  const settle = async (task: (typeof tasks)[number]) => {
    const data = await task.run();
    dataMap.set(task.id, data);
    onComponent?.(task.id, data);
  };

  let all: Promise<unknown>;
  if (concurrency && concurrency > 0 && concurrency < tasks.length) {
    // A bounded number of workers pull from the shared list in order.
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) await settle(tasks[next++]);
    };
    all = Promise.all(Array.from({ length: concurrency }, worker));
  } else {
    all = Promise.all(tasks.map(settle));
  }

  if (deadlineMs !== undefined && deadlineMs > 0 && tasks.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
    });
    await Promise.race([all, deadline]);
    clearTimeout(timer);
  } else {
    await all;
  }

  // Anything not in the map yet is still running (only possible after a deadline).
  const pending = tasks.filter((t) => !dataMap.has(t.id)).map((t) => t.id);

  return { components: dataMap, connection, params, pending };
}
