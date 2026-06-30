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

const DEFAULT_PALETTE = [
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

/**
 * Read the `stacked` property: accepts boolean or the literal string "percent".
 * Returns "stack" for plain stacking, "percent" for 100%-normalized, or false.
 */
function getStackedMode(component: ComponentNode): false | "stack" | "percent" {
  const prop = component.properties.find((p: PropertyNode) => p.key === "stacked");
  if (!prop) return false;
  if (prop.value.kind === "boolean") return prop.value.value ? "stack" : false;
  if (prop.value.kind === "string" && prop.value.value === "percent") return "percent";
  if (prop.value.kind === "ident" && prop.value.name === "percent") return "percent";
  return false;
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
    const rawLabel = String(row[xCol] ?? "");
    const label = formatChartLabel(rawLabel);
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
// Label formatting
// ---------------------------------------------------------------------------

/** ISO 8601 full datetime pattern: 2022-07-28T05:00:00.000Z */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Format chart labels — auto-shorten ISO timestamps to YYYY-MM-DD */
function formatChartLabel(raw: string): string {
  if (ISO_DATETIME_RE.test(raw)) {
    return raw.slice(0, 10);
  }
  return raw;
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

function buildLineOption(component: ComponentNode, points: ChartDataPoint[], isArea: boolean, palette: string[]): Record<string, unknown> {
  const color = getStringProp(component, "color");
  const yFormatName = getStringProp(component, "y_format");
  const yScale = getStringProp(component, "y_scale");
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

    const seriesColor = color && i === 0 ? color : palette[i % palette.length];

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
    color: color && !isMultiSeries ? [color] : palette,
    grid: { left: 60, right: 20, top: 20, bottom: isMultiSeries ? 60 : 36, containLabel: false },
    xAxis: {
      type: "category",
      data: allLabels,
      axisLabel: { fontSize: 11, rotate: allLabels.length > 8 ? 30 : 0 },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: yScale === "log" ? "log" : "value",
      axisLabel: {
        fontSize: 11,
        ...(axisFormatter ? { formatter: axisFormatter } : {}),
      },
      splitLine: { lineStyle: { type: "dashed" } },
    },
    series: echartsSeriesList,
    ...(isMultiSeries ? { legend: { bottom: 0, textStyle: { fontSize: 11 } } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Build ECharts option: bar
// ---------------------------------------------------------------------------

function buildBarOption(component: ComponentNode, points: ChartDataPoint[], palette: string[]): Record<string, unknown> {
  const color = getStringProp(component, "color");
  const sortDir = getStringProp(component, "sort");
  const orientation = getStringProp(component, "orientation") ?? "vertical";
  const yFormatName = getStringProp(component, "y_format");
  const yScale = getStringProp(component, "y_scale");
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
  const stackedMode = getStackedMode(component);
  const isStacked = isMultiSeries && stackedMode !== false;

  // Get unique labels — sort single-series if requested
  let allLabels: string[];
  if (!isMultiSeries && sortDir && sortDir !== "none") {
    const sorted = sortPoints(points, sortDir);
    allLabels = sorted.map((p) => p.label);
  } else {
    allLabels = [...new Set(points.map((p) => p.label))];
  }

  // Precompute per-x totals for percent normalization
  const labelTotals = new Map<string, number>();
  if (isStacked && stackedMode === "percent") {
    for (const l of allLabels) {
      let total = 0;
      for (const key of seriesKeys) {
        const v = seriesMap.get(key)!.find((sp) => sp.label === l)?.value;
        if (typeof v === "number" && !isNaN(v)) total += v;
      }
      labelTotals.set(l, total);
    }
  }

  const echartsSeriesList = seriesKeys.map((key, i) => {
    const seriesPoints = seriesMap.get(key)!;
    const lookup = new Map<string, number>();
    for (const sp of seriesPoints) lookup.set(sp.label, sp.value);
    const data = allLabels.map((l) => {
      const v = lookup.get(l);
      if (v == null) return null;
      if (isStacked && stackedMode === "percent") {
        const total = labelTotals.get(l) ?? 0;
        return total === 0 ? 0 : (v / total) * 100;
      }
      return v;
    });

    const seriesColor = color && i === 0 ? color : palette[i % palette.length];

    return {
      type: "bar" as const,
      name: isMultiSeries ? key : undefined,
      data,
      ...(isStacked ? { stack: "total" } : {}),
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

  const isPercentStacked = isStacked && stackedMode === "percent";
  const percentFormatter = (v: number) => `${Math.round(v)}%`;
  const valueAxis = {
    type: (yScale === "log" ? "log" : "value") as "value" | "log",
    ...(isPercentStacked ? { max: 100, min: 0 } : {}),
    axisLabel: {
      fontSize: 11,
      ...(isPercentStacked
        ? { formatter: percentFormatter }
        : axisFormatter
        ? { formatter: axisFormatter }
        : {}),
    },
    splitLine: { lineStyle: { type: "dashed" } },
  };

  return {
    color: color && !isMultiSeries ? [color] : palette,
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
// Build ECharts option: funnel
// ---------------------------------------------------------------------------

interface FunnelDataPoint {
  name: string;
  value: number;
}

function extractFunnelData(
  component: ComponentNode,
  data: ComponentRenderData,
): FunnelDataPoint[] | null {
  if (!data.result?.rows?.length) return null;

  const labelCol = getStringProp(component, "label") ?? data.result.columns[0];
  const valueCol = getStringProp(component, "value") ?? data.result.columns[1];

  const points: FunnelDataPoint[] = [];
  for (const row of data.result.rows) {
    const name = String(row[labelCol] ?? "");
    const value = Number(row[valueCol]);
    if (isNaN(value)) continue;
    points.push({ name, value });
  }
  return points;
}

function buildFunnelOption(
  component: ComponentNode,
  points: FunnelDataPoint[],
  palette: string[],
): Record<string, unknown> {
  const valueFormatName = getStringProp(component, "format") ?? getStringProp(component, "value_format");
  const fmt = parseFormatType(valueFormatName);
  const firstValue = points[0]?.value ?? 0;

  // Tooltip showing stage, count, and percent of first stage
  const tooltipFormatter = (params: { name: string; value: number }) => {
    const formatted = formatValue(params.value, fmt);
    const pctOfFirst = firstValue > 0 ? (params.value / firstValue) * 100 : 0;
    return `${escapeHtml(params.name)}<br/>${formatted} (${pctOfFirst.toFixed(1)}% of ${escapeHtml(points[0]?.name ?? "")})`;
  };

  return {
    color: palette,
    series: [
      {
        type: "funnel",
        left: "10%",
        right: "10%",
        top: 20,
        bottom: 20,
        // Respect query order: largest at top
        sort: "none",
        gap: 2,
        minSize: "10%",
        maxSize: "100%",
        label: {
          show: true,
          position: "inside",
          fontSize: 12,
          formatter: "{b}",
        },
        labelLine: { show: false },
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
        data: points,
      },
    ],
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
    },
  };
}

// ---------------------------------------------------------------------------
// Build ECharts option: scatter (and bubble)
// ---------------------------------------------------------------------------

interface ScatterDataPoint {
  x: number;
  y: number;
  series?: string;
  size?: number;
}

function extractScatterData(
  component: ComponentNode,
  data: ComponentRenderData,
): { points: ScatterDataPoint[]; xCol: string; yCol: string } | null {
  if (!data.result?.rows?.length) return null;

  const xCol = getStringProp(component, "x") ?? data.result.columns[0];
  const yCol = getStringProp(component, "y") ?? data.result.columns[1];
  const seriesCol = getStringProp(component, "series");
  const sizeCol = getStringProp(component, "size");

  const points: ScatterDataPoint[] = [];
  for (const row of data.result.rows) {
    const x = Number(row[xCol]);
    const y = Number(row[yCol]);
    if (isNaN(x) || isNaN(y)) continue;
    const point: ScatterDataPoint = { x, y };
    if (seriesCol) point.series = String(row[seriesCol] ?? "default");
    if (sizeCol) {
      const s = Number(row[sizeCol]);
      if (!isNaN(s)) point.size = s;
    }
    points.push(point);
  }
  return { points, xCol, yCol };
}

const BUBBLE_MIN_PX = 6;
const BUBBLE_MAX_PX = 40;

function buildScatterOption(
  component: ComponentNode,
  points: ScatterDataPoint[],
  xCol: string,
  yCol: string,
  palette: string[],
): Record<string, unknown> {
  const color = getStringProp(component, "color");
  const xFormatName = getStringProp(component, "x_format");
  const yFormatName = getStringProp(component, "y_format");
  const xAxisFormatter = makeAxisFormatter(xFormatName);
  const yAxisFormatter = makeAxisFormatter(yFormatName);

  const hasSize = points.some((p) => p.size != null);
  let sizeMin = 0;
  let sizeMax = 0;
  if (hasSize) {
    const sizeValues = points.map((p) => p.size ?? 0);
    sizeMin = Math.min(...sizeValues);
    sizeMax = Math.max(...sizeValues);
  }
  const scaleSize = (v: number): number => {
    if (!hasSize) return 8;
    if (sizeMax === sizeMin) return (BUBBLE_MIN_PX + BUBBLE_MAX_PX) / 2;
    const t = (v - sizeMin) / (sizeMax - sizeMin);
    return BUBBLE_MIN_PX + t * (BUBBLE_MAX_PX - BUBBLE_MIN_PX);
  };

  // Group by series
  const seriesMap = new Map<string, ScatterDataPoint[]>();
  for (const p of points) {
    const key = p.series ?? "default";
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key)!.push(p);
  }
  const seriesKeys = [...seriesMap.keys()];
  const isMultiSeries = seriesKeys.length > 1;

  const echartsSeriesList = seriesKeys.map((key, i) => {
    const pts = seriesMap.get(key)!;
    const data = pts.map((p) =>
      hasSize ? [p.x, p.y, p.size ?? 0] : [p.x, p.y],
    );
    const seriesColor = color && i === 0 ? color : palette[i % palette.length];
    return {
      type: "scatter" as const,
      name: isMultiSeries ? key : undefined,
      data,
      symbolSize: hasSize
        ? (val: number[]) => scaleSize(val[2])
        : 8,
      itemStyle: { color: seriesColor, opacity: 0.75 },
    };
  });

  return {
    color: color && !isMultiSeries ? [color] : palette,
    grid: { left: 60, right: 20, top: 20, bottom: isMultiSeries ? 60 : 36, containLabel: false },
    xAxis: {
      type: "value",
      name: xCol,
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { fontSize: 11 },
      axisLabel: { fontSize: 11, ...(xAxisFormatter ? { formatter: xAxisFormatter } : {}) },
      splitLine: { lineStyle: { type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: yCol,
      nameLocation: "middle",
      nameGap: 44,
      nameTextStyle: { fontSize: 11 },
      axisLabel: { fontSize: 11, ...(yAxisFormatter ? { formatter: yAxisFormatter } : {}) },
      splitLine: { lineStyle: { type: "dashed" } },
    },
    series: echartsSeriesList,
    ...(isMultiSeries ? { legend: { bottom: 0, textStyle: { fontSize: 11 } } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Build ECharts option: heatmap
// ---------------------------------------------------------------------------

interface HeatmapDataPoint {
  x: string;
  y: string;
  value: number;
}

function getNumberProp(component: ComponentNode, key: string): number | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop) return undefined;
  if (prop.value.kind === "number") return prop.value.value;
  return undefined;
}

function extractHeatmapData(
  component: ComponentNode,
  data: ComponentRenderData,
): { points: HeatmapDataPoint[]; xCol: string; yCol: string; valueCol: string } | null {
  if (!data.result?.rows?.length) return null;

  const xCol = getStringProp(component, "x") ?? data.result.columns[0];
  const yCol = getStringProp(component, "y") ?? data.result.columns[1];
  const valueCol = getStringProp(component, "value") ?? data.result.columns[2];

  const points: HeatmapDataPoint[] = [];
  for (const row of data.result.rows) {
    const xRaw = row[xCol];
    const yRaw = row[yCol];
    const v = Number(row[valueCol]);
    if (isNaN(v)) continue;
    if (xRaw == null || yRaw == null) continue;
    points.push({
      x: formatChartLabel(String(xRaw)),
      y: formatChartLabel(String(yRaw)),
      value: v,
    });
  }
  return { points, xCol, yCol, valueCol };
}

// Sequential palette for heatmap color scale (light → dark blue).
const HEATMAP_SEQUENTIAL = ["#eff6ff", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a"];

function buildHeatmapOption(
  component: ComponentNode,
  points: HeatmapDataPoint[],
): Record<string, unknown> {
  const valueFormatName = getStringProp(component, "format") ?? getStringProp(component, "value_format");
  const fmt = parseFormatType(valueFormatName);

  const xLabels: string[] = [];
  const yLabels: string[] = [];
  const xSeen = new Set<string>();
  const ySeen = new Set<string>();
  for (const p of points) {
    if (!xSeen.has(p.x)) {
      xSeen.add(p.x);
      xLabels.push(p.x);
    }
    if (!ySeen.has(p.y)) {
      ySeen.add(p.y);
      yLabels.push(p.y);
    }
  }

  const xIndex = new Map(xLabels.map((l, i) => [l, i]));
  const yIndex = new Map(yLabels.map((l, i) => [l, i]));

  const seriesData = points.map((p) => [xIndex.get(p.x)!, yIndex.get(p.y)!, p.value]);

  const values = points.map((p) => p.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const vmMin = getNumberProp(component, "min") ?? dataMin;
  const vmMax = getNumberProp(component, "max") ?? dataMax;

  const tooltipFormatter = (params: { value: [number, number, number] }) => {
    const [xi, yi, v] = params.value;
    const formatted = formatValue(v, fmt);
    return `${escapeHtml(xLabels[xi] ?? "")} / ${escapeHtml(yLabels[yi] ?? "")}<br/>${formatted}`;
  };

  return {
    grid: { left: 80, right: 20, top: 20, bottom: 60, containLabel: true },
    xAxis: {
      type: "category",
      data: xLabels,
      splitArea: { show: true },
      axisLabel: { fontSize: 11, rotate: xLabels.length > 8 ? 30 : 0 },
    },
    yAxis: {
      type: "category",
      data: yLabels,
      splitArea: { show: true },
      axisLabel: { fontSize: 11 },
    },
    visualMap: {
      min: vmMin,
      max: vmMax,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { fontSize: 11 },
      inRange: { color: HEATMAP_SEQUENTIAL },
    },
    series: [
      {
        type: "heatmap",
        data: seriesData,
        label: { show: false },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.3)" } },
      },
    ],
    tooltip: {
      trigger: "item",
      formatter: tooltipFormatter,
    },
  };
}

// ---------------------------------------------------------------------------
// Build ECharts option: gauge
// ---------------------------------------------------------------------------

interface GaugeData {
  value: number;
  max: number;
}

function extractGaugeData(
  component: ComponentNode,
  data: ComponentRenderData,
): GaugeData | null {
  if (!data.result?.rows?.length) return null;
  const row = data.result.rows[0];

  const valueCol = getStringProp(component, "value") ?? data.result.columns[0];
  const rawValue = Number(row[valueCol]);
  if (isNaN(rawValue)) return null;

  // `max` can be a literal number or a column name.
  const maxProp = component.properties.find((p: PropertyNode) => p.key === "max");
  let max: number;
  if (!maxProp) {
    max = rawValue === 0 ? 1 : rawValue;
  } else if (maxProp.value.kind === "number") {
    max = maxProp.value.value;
  } else if (maxProp.value.kind === "string" || maxProp.value.kind === "ident") {
    const colName = maxProp.value.kind === "string" ? maxProp.value.value : maxProp.value.name;
    const m = Number(row[colName]);
    max = isNaN(m) ? (rawValue === 0 ? 1 : rawValue) : m;
  } else {
    max = rawValue === 0 ? 1 : rawValue;
  }
  if (max <= 0) max = 1;

  return { value: rawValue, max };
}

// Default band colors for gauges (danger → warn → ok).
const DEFAULT_THRESHOLD_COLORS = ["#ef4444", "#f59e0b", "#10b981"];

function readNumberArray(component: ComponentNode, key: string): number[] | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop || prop.value.kind !== "array") return undefined;
  const nums: number[] = [];
  for (const el of prop.value.elements) {
    if (el.kind === "number") nums.push(el.value);
  }
  return nums.length > 0 ? nums : undefined;
}

function readStringArray(component: ComponentNode, key: string): string[] | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop || prop.value.kind !== "array") return undefined;
  const strs: string[] = [];
  for (const el of prop.value.elements) {
    if (el.kind === "string") strs.push(el.value);
    else if (el.kind === "ident") strs.push(el.name);
  }
  return strs.length > 0 ? strs : undefined;
}

function buildGaugeOption(
  component: ComponentNode,
  gauge: GaugeData,
): Record<string, unknown> {
  const valueFormatName = getStringProp(component, "format") ?? getStringProp(component, "value_format");
  const fmt = parseFormatType(valueFormatName);

  const thresholds = readNumberArray(component, "thresholds");
  const customColors = readStringArray(component, "threshold_colors");

  // Build axisLine color bands. ECharts expects tuples [fraction, color] where
  // fraction is position along the axis (0..1), and bands are drawn from the
  // previous fraction up to that one.
  let colorBands: [number, string][];
  if (thresholds && thresholds.length > 0) {
    const palette = customColors && customColors.length >= thresholds.length + 1
      ? customColors
      : DEFAULT_THRESHOLD_COLORS;
    const stops = [...thresholds, 1];
    colorBands = stops.map((stop, i) => [
      Math.max(0, Math.min(1, stop)),
      palette[i % palette.length],
    ]);
  } else {
    colorBands = [[1, customColors?.[0] ?? "#3b82f6"]];
  }

  const detailFormatter = (v: number) => formatValue(v, fmt);

  return {
    series: [
      {
        type: "gauge",
        min: 0,
        max: gauge.max,
        radius: "85%",
        center: ["50%", "60%"],
        startAngle: 200,
        endAngle: -20,
        progress: { show: false },
        axisLine: {
          lineStyle: {
            width: 18,
            color: colorBands,
          },
        },
        pointer: { length: "60%", width: 5 },
        axisTick: { distance: -22, length: 6, lineStyle: { color: "#fff", width: 1 } },
        splitLine: { distance: -24, length: 10, lineStyle: { color: "#fff", width: 2 } },
        axisLabel: { distance: 6, fontSize: 10, color: "#6b7280" },
        title: { show: false },
        detail: {
          valueAnimation: false,
          offsetCenter: [0, "35%"],
          fontSize: 22,
          fontWeight: "bold",
          color: "#1f2937",
          formatter: detailFormatter,
        },
        data: [{ value: gauge.value }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Build ECharts option: donut / pie
// ---------------------------------------------------------------------------

function buildDonutOption(_component: ComponentNode, points: ChartDataPoint[], palette: string[]): Record<string, unknown> {
  // Aggregate duplicate labels (e.g. multiple rows for the same category)
  const agg = new Map<string, number>();
  for (const p of points) {
    agg.set(p.label, (agg.get(p.label) ?? 0) + p.value);
  }

  const data = [...agg.entries()].map(([name, value]) => ({ name, value }));

  return {
    color: palette,
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "50%"],
        data,
        label: {
          fontSize: 11,
          formatter: "{b}: {d}%",
        },
        labelLine: { length: 12, length2: 8 },
        itemStyle: { borderRadius: 4, borderColor: "#fff", borderWidth: 2 },
      },
    ],
    legend: {
      orient: "horizontal",
      bottom: 0,
      textStyle: { fontSize: 11 },
    },
  };
}

// ---------------------------------------------------------------------------
// Exported renderer
// ---------------------------------------------------------------------------

export const chartRenderer: ComponentRenderer = {
  renderToString(component: ComponentNode, data: ComponentRenderData): string {
    const chartType = String(component.opts.type ?? "line");
    const palette = data.palette ?? DEFAULT_PALETTE;

    let option: Record<string, unknown>;
    let tooltipTrigger: "axis" | "item" = "axis";

    if (chartType === "funnel") {
      const funnelPoints = extractFunnelData(component, data);
      if (!funnelPoints || funnelPoints.length === 0) {
        return `<div class="orrery-no-data">No data</div>`;
      }
      option = buildFunnelOption(component, funnelPoints, palette);
      tooltipTrigger = "item";
    } else if (chartType === "scatter") {
      const scatter = extractScatterData(component, data);
      if (!scatter || scatter.points.length === 0) {
        return `<div class="orrery-no-data">No data</div>`;
      }
      option = buildScatterOption(component, scatter.points, scatter.xCol, scatter.yCol, palette);
      tooltipTrigger = "item";
    } else if (chartType === "gauge") {
      const gauge = extractGaugeData(component, data);
      if (!gauge) {
        return `<div class="orrery-no-data">No data</div>`;
      }
      option = buildGaugeOption(component, gauge);
      tooltipTrigger = "item";
    } else if (chartType === "heatmap") {
      const heatmap = extractHeatmapData(component, data);
      if (!heatmap || heatmap.points.length === 0) {
        return `<div class="orrery-no-data">No data</div>`;
      }
      option = buildHeatmapOption(component, heatmap.points);
      tooltipTrigger = "item";
    } else {
      const extracted = extractChartData(component, data);
      if (!extracted || extracted.points.length === 0) {
        return `<div class="orrery-no-data">No data</div>`;
      }

      switch (chartType) {
        case "line":
          option = buildLineOption(component, extracted.points, false, palette);
          break;
        case "area":
          option = buildLineOption(component, extracted.points, true, palette);
          break;
        case "bar":
          option = buildBarOption(component, extracted.points, palette);
          break;
        case "donut":
        case "pie":
          option = buildDonutOption(component, extracted.points, palette);
          break;
        default:
          return `<div class="orrery-placeholder">Unsupported chart type: ${escapeHtml(chartType)}</div>`;
      }
    }

    const svg = renderEChartsSvg(option);

    // Add tooltip config for client-side hydration
    const clientOption = {
      ...option,
      tooltip: {
        ...(typeof option.tooltip === "object" && option.tooltip !== null ? option.tooltip : {}),
        trigger: tooltipTrigger,
        backgroundColor: "rgba(50,50,50,0.9)",
        borderColor: "transparent",
        textStyle: { color: "#fff", fontSize: 12 },
      },
    };
    // Escape for safe embedding in HTML attribute
    const optionJson = JSON.stringify(clientOption)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return `<div class="orrery-chart-container" data-chart-option="${optionJson}">${svg}</div>`;
  },
};
