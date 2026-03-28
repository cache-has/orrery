/**
 * Component registry.
 *
 * Maps component type strings to their renderer implementations.
 */

import type { ComponentType } from "../parser/ast.js";
import type { ComponentRenderer } from "./types.js";
import { metricRenderer } from "./metric.js";
import { chartRenderer } from "./chart.js";

const renderers: Record<string, ComponentRenderer> = {
  metric: metricRenderer,
  chart: chartRenderer,
};

/**
 * Get the renderer for a component type, or undefined if not registered.
 */
export function getRenderer(type: ComponentType): ComponentRenderer | undefined {
  return renderers[type];
}

/**
 * Register a renderer for a component type.
 */
export function registerRenderer(type: string, renderer: ComponentRenderer): void {
  renderers[type] = renderer;
}
