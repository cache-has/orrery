/**
 * Text / Markdown Block component.
 *
 * Renders markdown content with parameter value interpolation.
 * Uses the `marked` library for full CommonMark rendering.
 */

import { marked } from "marked";
import type { ComponentNode } from "../parser/ast.js";
import type { ComponentRenderer, ComponentRenderData } from "./types.js";

// Configure marked for safe, synchronous rendering
marked.setOptions({
  async: false,
  gfm: true,
  breaks: false,
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Interpolate `{{param_name}}` placeholders with actual parameter values.
 * Unresolved placeholders are left as-is (displayed literally).
 */
function interpolateParams(
  content: string,
  paramValues?: Record<string, unknown>,
): string {
  if (!paramValues) return content;

  return content.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_match, key: string) => {
    const value = resolveParamValue(key, paramValues);
    if (value === undefined) return `{{${key}}}`;
    return escapeHtml(String(value));
  });
}

/**
 * Resolve a dotted param key like "date_range.start" from param values.
 */
function resolveParamValue(
  key: string,
  paramValues: Record<string, unknown>,
): unknown {
  if (key in paramValues) return paramValues[key];

  // Support dotted access: "date_range.start"
  const dotIndex = key.indexOf(".");
  if (dotIndex !== -1) {
    const parent = key.slice(0, dotIndex);
    const child = key.slice(dotIndex + 1);
    const parentValue = paramValues[parent];
    if (parentValue && typeof parentValue === "object") {
      return (parentValue as Record<string, unknown>)[child];
    }
  }

  return undefined;
}

export const textRenderer: ComponentRenderer = {
  renderToString(component: ComponentNode, data: ComponentRenderData): string {
    if (!component.markdownContent) {
      return `<div class="orrery-text orrery-text-empty">Empty text block</div>`;
    }

    // Interpolate parameter values before rendering markdown
    const interpolated = interpolateParams(
      component.markdownContent,
      data.paramValues,
    );

    // Render markdown to HTML (synchronous)
    const html = marked.parse(interpolated) as string;

    return `<div class="orrery-text">${html}</div>`;
  },
};
