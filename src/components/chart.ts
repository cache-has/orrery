/**
 * Chart component renderer (line and bar charts).
 *
 * Produces inline SVG for server-side rendering. Client-side hydration
 * with ECharts (tooltips, zoom, brush) will be added in phase 09.
 */

import type { ComponentNode, PropertyNode } from "../parser/ast.js";
import type { ComponentRenderer, ComponentRenderData } from "./types.js";
import { formatValue, parseFormatType, type FormatType } from "./format.js";

// ---------------------------------------------------------------------------
// Property helpers
// ---------------------------------------------------------------------------

function getStringProp(component: ComponentNode, key: string): string | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop) return undefined;
  if (prop.value.kind === "string") return prop.value.value;
  if (prop.value.kind === "ident") return prop.value.name;
  return undefined;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// SVG layout constants
// ---------------------------------------------------------------------------

const CHART_WIDTH = 600;
const CHART_HEIGHT = 300;
const PADDING = { top: 16, right: 20, bottom: 56, left: 64 };

function plotWidth(): number {
  return CHART_WIDTH - PADDING.left - PADDING.right;
}

function plotHeight(): number {
  return CHART_HEIGHT - PADDING.top - PADDING.bottom;
}

// ---------------------------------------------------------------------------
// Data extraction
// ---------------------------------------------------------------------------

interface ChartDataPoint {
  label: string;
  value: number;
  series?: string;
}

function extractChartData(
  component: ComponentNode,
  data: ComponentRenderData,
): { points: ChartDataPoint[]; xCol: string; yCol: string } | null {
  if (!data.result?.rows?.length) return null;

  const xCol = getStringProp(component, "x") ?? data.result.columns[0];
  const yCol = getStringProp(component, "y") ?? data.result.columns[1];
  const seriesCol = getStringProp(component, "series");

  const points: ChartDataPoint[] = [];
  for (const row of data.result.rows) {
    const label = String(row[xCol] ?? "");
    const value = Number(row[yCol]);
    if (isNaN(value)) continue;
    points.push({
      label,
      value,
      series: seriesCol ? String(row[seriesCol] ?? "default") : undefined,
    });
  }

  return { points, xCol, yCol };
}

// ---------------------------------------------------------------------------
// Axis tick computation
// ---------------------------------------------------------------------------

function niceAxisTicks(min: number, max: number, count: number = 5): number[] {
  if (min === max) {
    return [min - 1, min, min + 1];
  }
  const range = max - min;
  const roughStep = range / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;
  let niceStep: number;
  if (residual <= 1.5) niceStep = magnitude;
  else if (residual <= 3) niceStep = 2 * magnitude;
  else if (residual <= 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let t = niceMin; t <= niceMax + niceStep * 0.5; t += niceStep) {
    ticks.push(t);
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

function sortPoints(points: ChartDataPoint[], sortDir: string | undefined): ChartDataPoint[] {
  if (!sortDir || sortDir === "none") return points;
  const sorted = [...points];
  if (sortDir === "asc") sorted.sort((a, b) => a.value - b.value);
  else if (sortDir === "desc") sorted.sort((a, b) => b.value - a.value);
  return sorted;
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

function getColor(component: ComponentNode, index: number): string {
  const color = getStringProp(component, "color");
  if (color && index === 0) return color;
  return PALETTE[index % PALETTE.length];
}

// ---------------------------------------------------------------------------
// Label truncation
// ---------------------------------------------------------------------------

function truncateLabel(label: string, maxLen: number = 12): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 1) + "\u2026";
}

// ---------------------------------------------------------------------------
// Line chart renderer
// ---------------------------------------------------------------------------

function renderLineChart(component: ComponentNode, data: ComponentRenderData): string {
  const extracted = extractChartData(component, data);
  if (!extracted || extracted.points.length === 0) {
    return `<div class="openboard-no-data">No data</div>`;
  }

  const { points } = extracted;
  const yFormat = parseFormatType(getStringProp(component, "y_format"));

  // Group by series
  const seriesMap = new Map<string, ChartDataPoint[]>();
  for (const p of points) {
    const key = p.series ?? "default";
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key)!.push(p);
  }

  // Compute global y range
  const allValues = points.map((p) => p.value);
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yTicks = niceAxisTicks(Math.min(0, yMin), yMax);
  const yTickMin = yTicks[0];
  const yTickMax = yTicks[yTicks.length - 1];
  const yRange = yTickMax - yTickMin || 1;

  // X positions: evenly spaced using first series' order (all series share x labels)
  const allLabels = [...new Set(points.map((p) => p.label))];
  const pw = plotWidth();
  const ph = plotHeight();

  function xPos(index: number): number {
    if (allLabels.length === 1) return PADDING.left + pw / 2;
    return PADDING.left + (index / (allLabels.length - 1)) * pw;
  }

  function yPos(value: number): number {
    return PADDING.top + ph - ((value - yTickMin) / yRange) * ph;
  }

  // Build SVG
  let svg = `<svg class="openboard-chart openboard-chart-line" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(component.title ?? "Line chart")}">`;

  // Y-axis grid lines and labels
  for (const tick of yTicks) {
    const y = yPos(tick);
    svg += `<line x1="${PADDING.left}" y1="${y}" x2="${CHART_WIDTH - PADDING.right}" y2="${y}" class="openboard-chart-grid" />`;
    svg += `<text x="${PADDING.left - 8}" y="${y + 4}" class="openboard-chart-axis-label" text-anchor="end">${escapeHtml(formatValue(tick, yFormat))}</text>`;
  }

  // X-axis labels (show at most ~10 to avoid overlap)
  const xLabelStep = Math.max(1, Math.ceil(allLabels.length / 10));
  for (let i = 0; i < allLabels.length; i += xLabelStep) {
    const x = xPos(i);
    svg += `<text x="${x}" y="${CHART_HEIGHT - PADDING.bottom + 20}" class="openboard-chart-axis-label" text-anchor="middle">${escapeHtml(truncateLabel(allLabels[i]))}</text>`;
  }

  // Axis lines
  svg += `<line x1="${PADDING.left}" y1="${PADDING.top}" x2="${PADDING.left}" y2="${PADDING.top + ph}" class="openboard-chart-axis" />`;
  svg += `<line x1="${PADDING.left}" y1="${PADDING.top + ph}" x2="${CHART_WIDTH - PADDING.right}" y2="${PADDING.top + ph}" class="openboard-chart-axis" />`;

  // Draw series
  let seriesIndex = 0;
  for (const [seriesName, seriesPoints] of seriesMap) {
    const color = getColor(component, seriesIndex);

    // Build polyline path
    const linePoints: string[] = [];
    for (const sp of seriesPoints) {
      const xi = allLabels.indexOf(sp.label);
      if (xi === -1) continue;
      linePoints.push(`${xPos(xi)},${yPos(sp.value)}`);
    }

    if (linePoints.length > 0) {
      svg += `<polyline points="${linePoints.join(" ")}" fill="none" stroke="${escapeHtml(color)}" stroke-width="2" class="openboard-chart-line-path" />`;

      // Data points
      for (const sp of seriesPoints) {
        const xi = allLabels.indexOf(sp.label);
        if (xi === -1) continue;
        svg += `<circle cx="${xPos(xi)}" cy="${yPos(sp.value)}" r="3" fill="${escapeHtml(color)}" class="openboard-chart-point" />`;
      }
    }

    seriesIndex++;
  }

  // Legend (only for multi-series)
  if (seriesMap.size > 1) {
    let legendX = PADDING.left;
    const legendY = CHART_HEIGHT - 8;
    seriesIndex = 0;
    for (const [seriesName] of seriesMap) {
      const color = getColor(component, seriesIndex);
      svg += `<rect x="${legendX}" y="${legendY - 8}" width="10" height="10" rx="2" fill="${escapeHtml(color)}" />`;
      svg += `<text x="${legendX + 14}" y="${legendY}" class="openboard-chart-legend-label">${escapeHtml(truncateLabel(seriesName, 20))}</text>`;
      legendX += seriesName.length * 7 + 30;
      seriesIndex++;
    }
  }

  svg += `</svg>`;
  return `<div class="openboard-chart-container">${svg}</div>`;
}

// ---------------------------------------------------------------------------
// Bar chart renderer
// ---------------------------------------------------------------------------

function renderBarChart(component: ComponentNode, data: ComponentRenderData): string {
  const extracted = extractChartData(component, data);
  if (!extracted || extracted.points.length === 0) {
    return `<div class="openboard-no-data">No data</div>`;
  }

  const { points } = extracted;
  const sortDir = getStringProp(component, "sort");
  const orientation = getStringProp(component, "orientation") ?? "vertical";
  const yFormat = parseFormatType(getStringProp(component, "y_format"));

  // Group by series
  const seriesMap = new Map<string, ChartDataPoint[]>();
  for (const p of points) {
    const key = p.series ?? "default";
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key)!.push(p);
  }

  const seriesKeys = [...seriesMap.keys()];
  const isMultiSeries = seriesKeys.length > 1;

  // Get unique labels (sorted if requested — sort applies to single-series)
  let uniqueLabels: string[];
  if (!isMultiSeries) {
    const sorted = sortPoints(points, sortDir);
    uniqueLabels = sorted.map((p) => p.label);
  } else {
    uniqueLabels = [...new Set(points.map((p) => p.label))];
  }

  // Compute value range
  const allValues = points.map((p) => p.value);
  const yMax = Math.max(...allValues);
  const yTicks = niceAxisTicks(0, yMax);
  const yTickMax = yTicks[yTicks.length - 1];

  const pw = plotWidth();
  const ph = plotHeight();

  if (orientation === "horizontal") {
    return renderHorizontalBarChart(component, uniqueLabels, seriesMap, seriesKeys, yTicks, yTickMax, yFormat);
  }

  // Vertical bars
  const groupWidth = pw / uniqueLabels.length;
  const barPadding = Math.max(groupWidth * 0.15, 2);
  const totalBarWidth = groupWidth - barPadding * 2;
  const barWidth = isMultiSeries ? totalBarWidth / seriesKeys.length : totalBarWidth;

  function yPos(value: number): number {
    return PADDING.top + ph - (value / (yTickMax || 1)) * ph;
  }

  let svg = `<svg class="openboard-chart openboard-chart-bar" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(component.title ?? "Bar chart")}">`;

  // Y-axis grid lines and labels
  for (const tick of yTicks) {
    const y = yPos(tick);
    svg += `<line x1="${PADDING.left}" y1="${y}" x2="${CHART_WIDTH - PADDING.right}" y2="${y}" class="openboard-chart-grid" />`;
    svg += `<text x="${PADDING.left - 8}" y="${y + 4}" class="openboard-chart-axis-label" text-anchor="end">${escapeHtml(formatValue(tick, yFormat))}</text>`;
  }

  // Axis lines
  svg += `<line x1="${PADDING.left}" y1="${PADDING.top}" x2="${PADDING.left}" y2="${PADDING.top + ph}" class="openboard-chart-axis" />`;
  svg += `<line x1="${PADDING.left}" y1="${PADDING.top + ph}" x2="${CHART_WIDTH - PADDING.right}" y2="${PADDING.top + ph}" class="openboard-chart-axis" />`;

  // X-axis labels
  const xLabelStep = Math.max(1, Math.ceil(uniqueLabels.length / 12));
  for (let i = 0; i < uniqueLabels.length; i += xLabelStep) {
    const x = PADDING.left + i * groupWidth + groupWidth / 2;
    svg += `<text x="${x}" y="${CHART_HEIGHT - PADDING.bottom + 20}" class="openboard-chart-axis-label" text-anchor="middle">${escapeHtml(truncateLabel(uniqueLabels[i]))}</text>`;
  }

  // Draw bars
  for (let si = 0; si < seriesKeys.length; si++) {
    const seriesName = seriesKeys[si];
    const seriesPoints = seriesMap.get(seriesName)!;
    const color = getColor(component, si);

    // Build lookup by label
    const lookup = new Map<string, number>();
    for (const sp of seriesPoints) {
      lookup.set(sp.label, sp.value);
    }

    for (let li = 0; li < uniqueLabels.length; li++) {
      const label = uniqueLabels[li];
      const value = lookup.get(label);
      if (value == null) continue;

      const barX = PADDING.left + li * groupWidth + barPadding + (isMultiSeries ? si * barWidth : 0);
      const barH = (value / (yTickMax || 1)) * ph;
      const barY = PADDING.top + ph - barH;

      svg += `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barH}" fill="${escapeHtml(color)}" rx="1" class="openboard-chart-bar-rect" />`;
    }
  }

  // Legend (multi-series)
  if (isMultiSeries) {
    let legendX = PADDING.left;
    const legendY = CHART_HEIGHT - 8;
    for (let si = 0; si < seriesKeys.length; si++) {
      const color = getColor(component, si);
      svg += `<rect x="${legendX}" y="${legendY - 8}" width="10" height="10" rx="2" fill="${escapeHtml(color)}" />`;
      svg += `<text x="${legendX + 14}" y="${legendY}" class="openboard-chart-legend-label">${escapeHtml(truncateLabel(seriesKeys[si], 20))}</text>`;
      legendX += seriesKeys[si].length * 7 + 30;
    }
  }

  svg += `</svg>`;
  return `<div class="openboard-chart-container">${svg}</div>`;
}

// ---------------------------------------------------------------------------
// Horizontal bar chart
// ---------------------------------------------------------------------------

function renderHorizontalBarChart(
  component: ComponentNode,
  labels: string[],
  seriesMap: Map<string, ChartDataPoint[]>,
  seriesKeys: string[],
  xTicks: number[],
  xTickMax: number,
  yFormat: FormatType,
): string {
  const isMultiSeries = seriesKeys.length > 1;
  const pw = plotWidth();
  const ph = plotHeight();

  const groupHeight = ph / labels.length;
  const barPadding = Math.max(groupHeight * 0.15, 2);
  const totalBarHeight = groupHeight - barPadding * 2;
  const barHeight = isMultiSeries ? totalBarHeight / seriesKeys.length : totalBarHeight;

  function xPos(value: number): number {
    return PADDING.left + (value / (xTickMax || 1)) * pw;
  }

  let svg = `<svg class="openboard-chart openboard-chart-bar openboard-chart-bar-horizontal" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(component.title ?? "Bar chart")}">`;

  // X-axis grid lines and labels (value axis is horizontal)
  for (const tick of xTicks) {
    const x = xPos(tick);
    svg += `<line x1="${x}" y1="${PADDING.top}" x2="${x}" y2="${PADDING.top + ph}" class="openboard-chart-grid" />`;
    svg += `<text x="${x}" y="${CHART_HEIGHT - PADDING.bottom + 20}" class="openboard-chart-axis-label" text-anchor="middle">${escapeHtml(formatValue(tick, yFormat))}</text>`;
  }

  // Y-axis labels (category axis is vertical)
  for (let i = 0; i < labels.length; i++) {
    const y = PADDING.top + i * groupHeight + groupHeight / 2;
    svg += `<text x="${PADDING.left - 8}" y="${y + 4}" class="openboard-chart-axis-label" text-anchor="end">${escapeHtml(truncateLabel(labels[i]))}</text>`;
  }

  // Axis lines
  svg += `<line x1="${PADDING.left}" y1="${PADDING.top}" x2="${PADDING.left}" y2="${PADDING.top + ph}" class="openboard-chart-axis" />`;
  svg += `<line x1="${PADDING.left}" y1="${PADDING.top + ph}" x2="${CHART_WIDTH - PADDING.right}" y2="${PADDING.top + ph}" class="openboard-chart-axis" />`;

  // Draw bars
  for (let si = 0; si < seriesKeys.length; si++) {
    const seriesName = seriesKeys[si];
    const seriesPoints = seriesMap.get(seriesName)!;
    const color = getColor(component, si);

    const lookup = new Map<string, number>();
    for (const sp of seriesPoints) {
      lookup.set(sp.label, sp.value);
    }

    for (let li = 0; li < labels.length; li++) {
      const label = labels[li];
      const value = lookup.get(label);
      if (value == null) continue;

      const barY = PADDING.top + li * groupHeight + barPadding + (isMultiSeries ? si * barHeight : 0);
      const barW = (value / (xTickMax || 1)) * pw;

      svg += `<rect x="${PADDING.left}" y="${barY}" width="${barW}" height="${barHeight}" fill="${escapeHtml(color)}" rx="1" class="openboard-chart-bar-rect" />`;
    }
  }

  // Legend (multi-series)
  if (isMultiSeries) {
    let legendX = PADDING.left;
    const legendY = CHART_HEIGHT - 8;
    for (let si = 0; si < seriesKeys.length; si++) {
      const color = getColor(component, si);
      svg += `<rect x="${legendX}" y="${legendY - 8}" width="10" height="10" rx="2" fill="${escapeHtml(color)}" />`;
      svg += `<text x="${legendX + 14}" y="${legendY}" class="openboard-chart-legend-label">${escapeHtml(truncateLabel(seriesKeys[si], 20))}</text>`;
      legendX += seriesKeys[si].length * 7 + 30;
    }
  }

  svg += `</svg>`;
  return `<div class="openboard-chart-container">${svg}</div>`;
}

// ---------------------------------------------------------------------------
// Exported renderer
// ---------------------------------------------------------------------------

export const chartRenderer: ComponentRenderer = {
  renderToString(component: ComponentNode, data: ComponentRenderData): string {
    const chartType = String(component.opts.type ?? "line");

    switch (chartType) {
      case "line":
      case "area": // area treated as line for SSR; fill added in hydration phase
        return renderLineChart(component, data);
      case "bar":
        return renderBarChart(component, data);
      default:
        return `<div class="openboard-placeholder">Unsupported chart type: ${escapeHtml(chartType)}</div>`;
    }
  },
};
