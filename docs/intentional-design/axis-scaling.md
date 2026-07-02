<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Axis scaling

Design rationale for how Orrery picks the y-axis scale type (`value` vs `log`)
in `src/components/chart.ts`. The `y_scale: log` component prop is a request,
not a guarantee — Orrery silently falls back to a linear axis whenever a log
axis would be mathematically invalid or misleading, rather than rendering a
broken chart or transforming the underlying data to force log scale to work.

## Percent-stacked bars never use log scale

When a stacked bar chart's `stacked` mode is `percent`, series values are
normalized to sum to 100 per category and the axis is pinned to a `[0, 100]`
range. A log axis on a bounded percentage range doesn't communicate anything
useful and log(0) is undefined, so `y_scale: log` is ignored whenever
`isPercentStacked` is true — the axis stays linear regardless of the prop.

## Log scale falls back to linear when data isn't strictly positive

A log-scale axis is undefined at zero and negative values, so ECharts breaks
(or silently drops points) if any plotted value is `<= 0`. Orrery checks the
raw series values before applying `y_scale: log`; if any value is `<= 0`, the
axis renders as `value` (linear) instead.

Two transformations were deliberately rejected for making the data
"log-safe":

- **Taking `Math.abs(v)`** — negative values are often meaningful (e.g. net
  change, profit/loss). Silently flipping their sign to fit a log axis would
  misrepresent the data.
- **Adding an offset (e.g. `log(v + 1)`)** — this is a common trick to handle
  zeros, but it distorts the shape of the data, especially for series
  measuring rare/low-count events where the difference between 0 and 1 is
  often the most important signal.

Instead of guessing at a transform, Orrery treats "data contains a
non-positive value" as "this dataset cannot be log-scaled" and falls back to
linear. This applies in both `buildLineOption` and `buildBarOption`.
