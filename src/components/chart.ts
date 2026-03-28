/**
 * Chart component renderer (line, bar, area charts).
 *
 * Uses ECharts SSR mode to produce inline SVG on the server.
 * Client-side hydration (tooltips, zoom, brush) will be added in phase 09.
 */

import type { ComponentNode, PropertyNode } from "../parser/ast.js";
import type { ComponentRenderer, ComponentRenderData } from "./types.js";
import { formatValue, parseFormatType } from "./format.js";
import { echarts } from "./echarts-setup.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_WIDTH = 600;
const CHART_HEIGHT = 350;

const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

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
// Sort helper
// ---------------------------------------------------------------------------

function sortPoints(points: ChartDataPoint[], sortDir: string | undefined): ChartDataPoint[] {
  if (!sortDir || sortDir === "none") return points;
  const sorted = [...points];
  if (sortDir === "asc") sorted.sort((a, b) => a.value - b.value);
  else if (sortDir === "desc") sorted.sort((a, b) => b.value - a.value);
  return sorted;
}

// ---------------------------------------------------------------------------
// ECharts SSR helper
// ---------------------------------------------------------------------------

function renderEChartsSvg(option: Record<string, unknown>): string {
  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
  });
  chart.setOption(option);
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

// ---------------------------------------------------------------------------
// Axis formatter
// ---------------------------------------------------------------------------

function makeAxisFormatter(yFormatName: string | undefined): ((v: number) => string) | undefined {
  const fmt = parseFormatType(yFormatName);
  if (fmt === "raw") return undefined;
  return (v: number) => formatValue(v, fmt);
}

// ---------------------------------------------------------------------------
// Build ECharts option: line / area
// ---------------------------------------------------------------------------

function buildLineOption(component: ComponentNode, points: ChartDataPoint[], isArea: boolean): Record<string, unknown> {
  const color = getStringProp(component, "color");
  const yFormatName = getStringProp(component, "y_format");
  const axisFormatter = makeAxisFormatter(yFormatName);

  // Group by series
  const seriesMap = new Map<string, ChartDataPoint[]>();
  for (const p of points) {
    const key = p.series ?? "default";
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key)!.push(p);
  }

  const allLabels = [...new Set(points.map((p) => p.label))];
  const seriesKeys = [...seriesMap.keys()];
  const isMultiSeries = seriesKeys.length > 1;

  const echartsSeriesList = seriesKeys.map((key, i) => {
    const seriesPoints = seriesMap.get(key)!;
    // Build data aligned to allLabels
    const lookup = new Map<string, number>();
    for (const sp of seriesPoints) lookup.set(sp.label, sp.value);
    const data = allLabels.map((l) => lookup.get(l) ?? null);

    const seriesColor = color && i === 0 ? color : PALETTE[i % PALETTE.length];

    return {
      type: "line" as const,
      name: isMultiSeries ? key : undefined,
      data,
      smooth: false,
      symbol: "circle",
      symbolSize: 6,
      itemStyle: { color: seriesColor },
      lineStyle: { width: 2 },
      ...(isArea ? { areaStyle: { opacity: 0.15 } } : {}),
    };
  });

  return {
    color: color && !isMultiSeries ? [color] : PALETTE,
    grid: { left: 60, right: 20, top: 20, bottom: isMultiSeries ? 60 : 36, containLabel: false },
    xAxis: {
      type: "category",
      data: allLabels,
      axisLabel: { fontSize: 11, rotate: allLabels.length > 8 ? 30 : 0 },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 11,
        ...(axisFormatter ? { formatter: axisFormatter } : {}),
      },
      splitLine: { lineStyle: { type: "dashed", color: "#e2e8f0" } },
    },
    series: echartsSeriesList,
    ...(isMultiSeries ? { legend: { bottom: 0, textStyle: { fontSize: 11 } } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Build ECharts option: bar
// ---------------------------------------------------------------------------

function buildBarOption(component: ComponentNode, points: ChartDataPoint[]): Record<string, unknown> {
  const color = getStringProp(component, "color");
  const sortDir = getStringProp(component, "sort");
  const orientation = getStringProp(component, "orientation") ?? "vertical";
  const yFormatName = getStringProp(component, "y_format");
  const axisFormatter = makeAxisFormatter(yFormatName);
  const isHorizontal = orientation === "horizontal";

  // Group by series
  const seriesMap = new Map<string, ChartDataPoint[]>();
  for (const p of points) {
    const key = p.series ?? "default";
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key)!.push(p);
  }

  const seriesKeys = [...seriesMap.keys()];
  const isMultiSeries = seriesKeys.length > 1;

  // Get unique labels — sort single-series if requested
  let allLabels: string[];
  if (!isMultiSeries && sortDir && sortDir !== "none") {
    const sorted = sortPoints(points, sortDir);
    allLabels = sorted.map((p) => p.label);
  } else {
    allLabels = [...new Set(points.map((p) => p.label))];
  }

  const echartsSeriesList = seriesKeys.map((key, i) => {
    const seriesPoints = seriesMap.get(key)!;
    const lookup = new Map<string, number>();
    for (const sp of seriesPoints) lookup.set(sp.label, sp.value);
    const data = allLabels.map((l) => lookup.get(l) ?? null);

    const seriesColor = color && i === 0 ? color : PALETTE[i % PALETTE.length];

    return {
      type: "bar" as const,
      name: isMultiSeries ? key : undefined,
      data,
      itemStyle: { color: seriesColor, borderRadius: isHorizontal ? [0, 2, 2, 0] : [2, 2, 0, 0] },
      barMaxWidth: 48,
    };
  });

  const categoryAxis = {
    type: "category" as const,
    data: allLabels,
    axisLabel: { fontSize: 11, rotate: !isHorizontal && allLabels.length > 8 ? 30 : 0 },
    axisTick: { alignWithLabel: true },
  };

  const valueAxis = {
    type: "value" as const,
    axisLabel: {
      fontSize: 11,
      ...(axisFormatter ? { formatter: axisFormatter } : {}),
    },
    splitLine: { lineStyle: { type: "dashed", color: "#e2e8f0" } },
  };

  return {
    color: color && !isMultiSeries ? [color] : PALETTE,
    grid: {
      left: isHorizontal ? 80 : 60,
      right: 20,
      top: 20,
      bottom: isMultiSeries ? 60 : 36,
      containLabel: false,
    },
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? categoryAxis : valueAxis,
    series: echartsSeriesList,
    ...(isMultiSeries ? { legend: { bottom: 0, textStyle: { fontSize: 11 } } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Exported renderer
// ---------------------------------------------------------------------------

export const chartRenderer: ComponentRenderer = {
  renderToString(component: ComponentNode, data: ComponentRenderData): string {
    const chartType = String(component.opts.type ?? "line");

    const extracted = extractChartData(component, data);
    if (!extracted || extracted.points.length === 0) {
      return `<div class="openboard-no-data">No data</div>`;
    }

    let option: Record<string, unknown>;

    switch (chartType) {
      case "line":
        option = buildLineOption(component, extracted.points, false);
        break;
      case "area":
        option = buildLineOption(component, extracted.points, true);
        break;
      case "bar":
        option = buildBarOption(component, extracted.points);
        break;
      default:
        return `<div class="openboard-placeholder">Unsupported chart type: ${escapeHtml(chartType)}</div>`;
    }

    const svg = renderEChartsSvg(option);
    return `<div class="openboard-chart-container">${svg}</div>`;
  },
};
