/**
 * Component renderer interface.
 *
 * Every built-in component implements this interface. The renderer
 * dispatches to the appropriate component based on componentType.
 */

import type { ComponentNode } from "../parser/ast.js";
import type { QueryResult } from "../query/executor.js";

/**
 * Data available to a component at render time.
 * Includes the primary query result and optional auxiliary results
 * (e.g., trend_query for metric cards).
 */
export interface ComponentRenderData {
  result?: QueryResult;
  trendResult?: QueryResult;
  error?: string;
  /** Current parameter values — used by text components for {{param}} interpolation. */
  paramValues?: Record<string, unknown>;
  /** Chart color palette from theme (concrete hex values for SSR). */
  palette?: string[];
}

/**
 * Server-side component renderer.
 *
 * Produces an HTML string for initial SSR. Client-side hydration
 * (hydrate, update, destroy) will be added in phase 09.
 */
export interface ComponentRenderer {
  /** Produce an HTML string for the component body. */
  renderToString(component: ComponentNode, data: ComponentRenderData): string;
}
