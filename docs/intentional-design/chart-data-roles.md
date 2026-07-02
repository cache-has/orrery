<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Chart data roles vs. screen position

In `src/components/chart.ts`, `x` and `y` (and `x_label` / `y_label`) name
**data roles**, not screen positions. This distinction matters because bar
charts support an `orientation: horizontal` mode that swaps which physical
axis (screen-horizontal vs screen-vertical) each role is drawn on.

## The two roles

`extractChartData` (`chart.ts`) defines the roles once, up front, independent
of how the chart is later drawn:

- **`x` → category column.** The `x` prop (or the first result column by
  default) selects the field used as each point's `label` — the discrete
  category / bucket a value belongs to (a date, a region, a name, etc).
- **`y` → value column.** The `y` prop (or the second result column) selects
  the field used as each point's `value` — the numeric measure being
  charted.

`x_label` and `y_label` are the human-readable titles for those same two
roles — not for "whatever ends up on the bottom" and "whatever ends up on the
left."

## Orientation changes screen position, never the role

For vertical bars (the default) and line/area charts, the mapping is
intuitive because it also matches physical position: category → bottom axis,
value → left axis.

`orientation: horizontal` on a bar chart flips which *physical* axis carries
each role — the category axis is drawn vertically (left) and the value axis
is drawn horizontally (bottom) — but the roles themselves don't change. `x`
is still the category column and `x_label` still titles it; it's just now
rendered on the vertical axis.

| Orientation | Category axis (`x`, `x_label`) | Value axis (`y`, `y_label`) |
|---|---|---|
| vertical (default) | bottom (horizontal) | left (vertical) |
| horizontal | left (vertical) | bottom (horizontal) |

`buildBarOption` implements this by keeping `x_label` bound to `categoryAxis`
and `y_label` bound to `valueAxis` unconditionally, and only letting
`isHorizontal` change which physical axis object (`xAxis`/`yAxis` in the
ECharts option) each of those is assigned to, and the `nameGap` used to
position the title text. Charting a `region`/`revenue` dataset with
`x_label: "Region"` and `y_label: "Revenue"` always gets "Region" on the
category axis and "Revenue" on the value axis, whether the bars are drawn
vertically or horizontally.

Earlier code bound the label props directly to the physical `xAxis`/`yAxis`
objects instead of to `categoryAxis`/`valueAxis`, which silently swapped the
titles in horizontal mode. If a future change needs axis titles to describe
screen position instead of data role, that should be a distinct, explicitly
named prop (e.g. `bottom_label`/`left_label`) rather than overloading
`x_label`/`y_label`.
