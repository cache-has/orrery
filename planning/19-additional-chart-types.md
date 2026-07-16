# 19 — Additional Chart Types

## Goal

Ship five additional chart types to cover common analytics use cases currently unsupported:

- **Scatter** (+ optional `size:` for bubble-style)
- **Heatmap**
- **Stacked bar** (additive and 100%-normalized)
- **Funnel**
- **Gauge**

Two of these (`scatter`, `heatmap`) are already listed in `KNOWN_CHART_TYPES` in the validator but render as "unsupported" — those are half-implemented and should be finished first.

## Current state

Implemented in `src/components/chart.ts`: `line`, `area`, `bar`, `donut`, `pie`.
Declared in validator but not rendered: `scatter`, `heatmap`.
Not declared and not rendered: `funnel`, `gauge`. (Bubble is subsumed by scatter — see below.)

## Design principles

- Stay close to ECharts native series types — our job is DSL → ECharts option mapping, not reinventing visual semantics.
- Prefer one property that means one thing across chart types (`x`, `y`, `series`, `value`, `label`) over type-specific vocabulary.
- Add new properties only when a new chart type genuinely needs them (`size`, `max`, `stacked`, `thresholds`).

## Chart-by-chart spec

### Scatter (and bubble)

Bubble is scatter with an optional `size:` column. One type, not two.

```board
chart "Spend vs Retention" (span: 6, type: scatter) {
  query: "SELECT months_active, total_spend, plan FROM analytics.v_members"
  x: months_active
  y: total_spend
  series: plan        # optional, color-codes by plan
  size: total_spend   # optional, bubble sizing
}
```

- ECharts `type: "scatter"` series.
- `series:` column → one series per distinct value, each colored from the theme palette.
- `size:` column → per-point `symbolSize` scaled to a sensible pixel range (e.g., 6–40 px, linear).
- Already in `KNOWN_CHART_TYPES` — just wire the renderer and drop the default/unsupported branch.

### Heatmap

```board
chart "Order Volume by Hour/Day" (span: 12, type: heatmap) {
  query: "SELECT day_of_week, hour_of_day, order_count FROM analytics.v_order_heatmap"
  x: hour_of_day
  y: day_of_week
  value: order_count
}
```

- ECharts `type: "heatmap"` series with a `visualMap` component driving color intensity.
- `x` and `y` axes are categorical by default; numeric inputs bucket into the distinct values returned by the query.
- Color scale from the theme's sequential palette. `min:` / `max:` properties optional to pin the range.
- Tooltip: `x`, `y`, `value`.
- Already in `KNOWN_CHART_TYPES` — wire the renderer.

### Stacked bar

Extend existing `bar`, not a new type.

```board
chart "Revenue by Category" (span: 8, type: bar) {
  query: "SELECT month, category, revenue FROM analytics.v_monthly_revenue"
  x: month
  y: revenue
  series: category
  stacked: true       # or "percent" for 100%-normalized
}
```

- `stacked: true` → each series gets the same `stack` name in ECharts.
- `stacked: "percent"` → same, plus a transform that normalizes each x-bucket to sum to 100. Tooltip shows both raw value and percent.
- `stacked: false` (default) → current side-by-side behavior, unchanged.
- Validator: accept boolean or the literal string `"percent"` on the `bar` component.

### Funnel

New type.

```board
chart "Conversion Funnel" (span: 6, type: funnel) {
  query: "SELECT stage, count FROM analytics.v_conversion_funnel ORDER BY sort_order"
  label: stage
  value: count
}
```

- ECharts `type: "funnel"` series.
- Rows rendered in query order (respect `ORDER BY`), largest at top.
- Tooltip: stage name, count, and percent of first stage.
- Add `funnel` to `KNOWN_CHART_TYPES`.

### Gauge

New type.

```board
chart "Monthly Target" (span: 4, type: gauge) {
  query: "SELECT current_value, target_value FROM analytics.v_monthly_targets WHERE metric = 'new_subscriptions'"
  value: current_value
  max: target_value   # column name OR literal number, e.g. max: 100
  format: compact
  thresholds: [0.5, 0.8]   # optional; color bands at 50% and 80% of max
}
```

- ECharts `type: "gauge"` series.
- `value:` column provides the current value; query must return exactly one row.
- `max:` accepts either a column name (read from the single row) or a literal number in the DSL.
- `thresholds: [0.5, 0.8]` creates three color bands: `0→50%`, `50→80%`, `80→100%` using theme's warn/ok/alert palette roles. Operator-definable colors via `threshold_colors: [...]` for full control; defaults work for the common red/yellow/green case.
- `format:` uses the existing format system (currency, percent, compact, etc.).
- Add `gauge` to `KNOWN_CHART_TYPES`.

## Validator changes

- Add `funnel` and `gauge` to `KNOWN_CHART_TYPES`.
- Per-type property allow-lists (if the validator enforces them) need the new properties: `size`, `value`, `label`, `stacked`, `max`, `thresholds`, `threshold_colors`.
- Reject `stacked` on non-bar types; reject `size`/`series` on types that don't support them.

## Renderer changes

`src/components/chart.ts` currently switches on chart type and falls through to an "unsupported" default. Add cases for each new type. Each case returns an ECharts option object; shared axis/tooltip/legend setup is pulled into helpers to avoid duplication, but only once there's a second duplicate — not preemptively.

## Testing

- Parser/validator tests for each new property and each accepted `stacked` value.
- Renderer tests that snapshot the generated ECharts option for a known query result (deterministic fixtures).
- At least one example dashboard per chart type in the existing examples directory, wired to a DuckDB fixture so the examples are runnable.

## Docs

- Update chart type reference in user docs with one section per new type: DSL example, screenshot, property list, common pitfalls.
- Call out: bubble is scatter with `size:`; stacked bar is bar with `stacked:`.

## Implementation order

Author-driven priority (from the request doc):

1. Stacked bar — most commonly needed.
2. Funnel — high-value for conversion analytics.
3. Scatter — already half-implemented, small finish.
4. Heatmap — already half-implemented, small finish.
5. Gauge — nice-to-have; ECharts makes it easy.

Each ships independently. No cross-type dependencies.

## Checklist

- [x] Stacked bar (`stacked: true` and `stacked: "percent"`)
- [x] Funnel
- [x] Scatter (with `size:` and `series:`)
- [x] Heatmap
- [x] Gauge (with `thresholds:`)
- [x] Validator: add `funnel`, `gauge` to `KNOWN_CHART_TYPES`; property allow-lists
- [x] Example dashboards for each
- [x] Renderer snapshot tests

Docs work (chart type reference for scatter/heatmap/funnel/gauge/stacked bar) is deferred to plan 15 (component reference — item: "Component reference with examples for each component type").
