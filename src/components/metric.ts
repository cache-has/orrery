/**
 * Metric / KPI Card component.
 *
 * Displays a single numeric value with optional format and trend comparison.
 */

import type { ComponentNode, PropertyNode } from "../parser/ast.js";
import type { ComponentRenderer, ComponentRenderData } from "./types.js";
import { formatValue, parseFormatType } from "./format.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getStringProp(component: ComponentNode, key: string): string | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop) return undefined;
  if (prop.value.kind === "string") return prop.value.value;
  return undefined;
}

/**
 * Compute the trend percentage and direction from current and previous values.
 */
function computeTrend(
  currentValue: number,
  previousValue: number,
): { percent: number; direction: "up" | "down" | "flat" } {
  if (previousValue === 0) {
    if (currentValue === 0) return { percent: 0, direction: "flat" };
    return { percent: 100, direction: currentValue > 0 ? "up" : "down" };
  }

  const percent = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  const direction =
    Math.abs(percent) < 0.01 ? "flat" : percent > 0 ? "up" : "down";

  return { percent, direction };
}

export const metricRenderer: ComponentRenderer = {
  renderToString(component: ComponentNode, data: ComponentRenderData): string {
    // No data / empty result
    if (!data.result?.rows?.length) {
      return `<div class="openboard-no-data">No data</div>`;
    }

    const row = data.result.rows[0];
    const rawValue = row.value ?? row[data.result.columns[0]];
    const prefix = getStringProp(component, "prefix") ?? "";
    const suffix = getStringProp(component, "suffix") ?? "";
    const format = parseFormatType(getStringProp(component, "format"));

    const formatted = formatValue(rawValue, format);
    const trendHtml = renderTrend(component, data, rawValue);

    return `<div class="openboard-metric">
      <div class="openboard-metric-value">
        ${prefix ? `<span class="openboard-metric-prefix">${escapeHtml(prefix)}</span>` : ""}${escapeHtml(formatted)}${suffix ? `<span class="openboard-metric-suffix">${escapeHtml(suffix)}</span>` : ""}
      </div>
      ${trendHtml}
    </div>`;
  },
};

function renderTrend(
  component: ComponentNode,
  data: ComponentRenderData,
  currentRawValue: unknown,
): string {
  if (!data.trendResult?.rows?.length) return "";

  const trendRow = data.trendResult.rows[0];
  const previousValue = trendRow.value ?? trendRow[data.trendResult.columns[0]];

  if (previousValue == null || currentRawValue == null) return "";

  const current = Number(currentRawValue);
  const previous = Number(previousValue);
  if (isNaN(current) || isNaN(previous)) return "";

  const { percent, direction } = computeTrend(current, previous);
  const trendLabel = getStringProp(component, "trend_label") ?? "vs previous period";

  const arrow = direction === "up" ? "\u25B2" : direction === "down" ? "\u25BC" : "\u25C6";
  const sign = percent > 0 ? "+" : "";
  const dirClass = `openboard-trend-${direction}`;

  return `<div class="openboard-metric-trend ${dirClass}">
        <span class="openboard-trend-arrow">${arrow}</span>
        <span class="openboard-trend-percent">${sign}${percent.toFixed(1)}%</span>
        <span class="openboard-trend-label">${escapeHtml(trendLabel)}</span>
      </div>`;
}
