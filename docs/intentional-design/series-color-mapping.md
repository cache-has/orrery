<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Series color mapping (`series_colors`)

Design rationale for `series_colors` (`src/parser/ast.ts`,
`src/parser/parser.ts`, `src/components/chart.ts`), which lets an author pin
a specific category name (e.g. `free`, `premium`, `bad`, `good`) to a
specific color on one chart widget.

`series_colors` is declared directly inside a `chart { ... }` block in the
`.board` file — the same level as `x:`, `y:`, `series:`, or `color:`. There
is no dashboard-level or project-wide equivalent; see "Scoped to the widget"
below for why, including two earlier designs that were tried and reverted.

## The bug this fixes: colors were assigned by position, not by name

Every multi-series chart builder (`buildLineOption`, `buildBarOption`,
`buildScatterOption`, `buildDonutOption`) groups its own query rows into a
`Map` keyed by series/category name, then colors each entry by its index in
that map: `palette[i % palette.length]`. The palette array is shared
dashboard-wide, but nothing ever mapped a *name* to a color, only a
*position*.

Two widgets showing the same category (e.g. `free`) would render it in
different colors whenever it happened to land at a different index in each
widget's own query result — the common case, since different widgets rarely
return the exact same row order or the exact same set of categories.
`series_colors` closes that gap: `seriesColors?.[key]` is checked before
falling back to the existing index-based logic, so a mapped name always wins
regardless of position.

## Scoped to the widget, not the dashboard or the project

Two earlier designs were tried and reverted before landing here:

1. **Project-wide, in `theme.yaml`.** One flat name→color namespace shared
   by every dashboard. Rejected: dashboards routinely pull from entirely
   different data sources with entirely unrelated category vocabularies. A
   shared namespace either forces every dashboard's categories into one
   growing file, or risks two unrelated dashboards' same-named categories
   colliding (`"east"` meaning one thing on a sales dashboard, something
   else on a sensor-status dashboard, both wanting different colors).
2. **Per-dashboard, in the `dashboard { ... }` block.** Better — no more
   cross-dashboard collisions — but still too coarse. A single dashboard
   commonly has several widgets, each running its own independent query,
   often against different tables or even different connections. A
   dashboard-level map can't tell "these two widgets' `free` mean the same
   thing" from "these two widgets' `free` are coincidentally-named and
   unrelated" — it would force them to match regardless.

The property now lives on the chart component itself, the same place as
`x:`/`y:`/`series:`/`color:` — the same scope as the query that produces the
category names in the first place. Cross-widget visual sync is fully
explicit: if two widgets should render `free` the same color, the author
writes the same `series_colors` block on both. Nothing is inferred or
shared automatically, so there's no scope at which an unrelated match could
silently collide.

Supporting this required extending `.board`'s grammar: `ValueNode`
(`src/parser/ast.ts`) previously supported only scalars and arrays of
scalars — no object/map literal, so `series_colors: { free: "#..." }`
wasn't expressible anywhere in a `.board` file. `ObjectValue` was added as a
new `ValueNode` kind, parsed by a new `parseObject()` in
`src/parser/parser.ts`, modeled directly on the existing `parseArray()` and
on the component-body parse loop (both already loop over sub-items until a
closing brace/bracket, with no strict comma requirement). No lexer changes
were needed — `{`, `}`, `:`, and `,` tokens already existed for component
blocks and property syntax.

`parseProperty()`'s key rule was relaxed from "must be an identifier" to
"identifier or string", rather than inventing an object-literal-specific key
rule. This one change covers every property position in the grammar
(dashboard-level, component-level, param options, and now object-literal
entries) — which is exactly why moving `series_colors` from the dashboard
level to the component level required no parser changes at all: the grammar
was never dashboard-specific to begin with, only where the property
happened to be read from. Quoted keys are needed because category names can
contain characters an identifier can't — e.g. `"Store 25"` has a space.

## No threading — `chart.ts` reads its own component's property directly

Earlier designs threaded a resolved `seriesColors` map through the render
pipeline the same way `palette: string[]` is threaded — `dashboard.ts` →
`html.ts` → `ComponentRenderData` → `chart.ts` — because a dashboard- or
project-level value needs to be resolved once, upstream of any specific
widget, then handed down.

That threading is gone now. Every chart builder already receives the full
`ComponentNode` for the widget it's rendering (`chartRenderer.renderToString(component, data)`,
and each `buildXOption(component, ...)` call). Since `series_colors` is
just another property on that same component, `chart.ts` reads it directly:

```ts
function getSeriesColorsProp(component: ComponentNode): Record<string, string> | undefined {
  const prop = component.properties.find((p) => p.key === "series_colors");
  if (!prop || prop.value.kind !== "object") return undefined;
  const map: Record<string, string> = {};
  for (const entry of prop.value.entries) {
    if (entry.value.kind === "string") map[entry.key] = entry.value.value;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}
```

This is strictly simpler than the threaded designs, not just smaller: there
is no `ComponentRenderData.seriesColors`, no `RenderOptions.seriesColors`,
no `getDashboardSeriesColors()` helper duplicated between `dashboard.ts` and
`static/builder.ts`, and no risk of a code path (the independent
`/api/query` per-widget refresh, the static-export pipeline) missing a
thread and silently losing the mapping — the exact class of bug the two
previous designs had to actively guard against by threading the value
through every render entry point. Here there's nothing to thread: wherever
a `ComponentNode` is rendered, its own `series_colors` comes along with it
for free, because it already carries the property.

## Object entries reuse `PropertyNode`, not a bespoke key/value shape

`ObjectValue.entries` is typed as `PropertyNode[]`, the same node the parser
already produces for every `key: value` pair elsewhere in the grammar,
rather than a new `{ key, value }` entry type built just for object
literals. An object literal *is* a brace-delimited list of properties —
that's exactly what `parseObject()` parses by calling the existing
`parseProperty()` in a loop, identical to how a component body parses its
own properties. Reusing the type means no second parallel representation of
"a name paired with a value" to keep in sync, and any future consumer that
already knows how to walk `PropertyNode[]` (validators, the diff tool, etc.)
needs no new code path to also walk object entries.

## Explicit opt-in, not automatic hash-based coloring

An alternative considered: derive each series' color deterministically from
a hash of its name, so identical names always sync with zero config, without
touching the `.board` file at all. That was rejected in favor of the
explicit map:

- A hash gives no control over *which* color a name gets — you can't say
  "bad" is red and "good" is green, only that "bad" is *some* consistent
  color. Pinning specific brand/semantic colors to specific categories was
  an explicit requirement, not just cross-widget consistency for its own
  sake.
- A hash can't distinguish "these names happen to collide" from "these
  categories are actually unrelated" — two unrelated categories can hash to
  the same palette slot, which is a worse failure mode than today's
  position-based inconsistency because it looks intentional.
- An explicit map is git-diffable, self-documenting alongside the query it
  colors, and degrades safely: unmapped names silently keep the pre-existing
  index-based behavior, so adopting it is opt-in per category, not a
  breaking change to any existing widget.

Categories not present in `series_colors` are unaffected — same
`palette[i % palette.length]` fallback as before.

## Precedence: name match beats the component-level `color:` prop

Each chart type already supports a per-component `color:` property that
overrides only the first series (`color && i === 0 ? color : ...`). Where
both apply, the name-based map wins:

```ts
const seriesColor = seriesColors?.[key] ?? (color && i === 0 ? color : palette[i % palette.length]);
```

`series_colors` is the more specific signal — the author explicitly named
*this exact category* — so it wins over the more generic override, which
was really only ever meant to recolor "whatever series happens to render
first" on that one chart.

## Donut/pie: per-slice `itemStyle`, not a reordered `color` array

Line/bar/scatter series each get their own `itemStyle.color`, set directly
per series object — trivial to override by name. Donut/pie charts instead
pass ECharts a single `color: string[]` array and let it assign colors to
pie slices by their position in the `data` array. Reordering `data` to put
mapped categories at their "correct" palette index would only work by
coincidence and would silently break the moment an unmapped category was
inserted between two mapped ones.

Instead, mapped slices get an explicit per-item override:

```ts
const data = [...agg.entries()].map(([name, value]) => {
  const c = seriesColors?.[name];
  return c ? { name, value, itemStyle: { color: c } } : { name, value };
});
```

Unmapped slices are left with no `itemStyle` at all, so they fall through to
ECharts' normal index-into-`color`-array behavior, unchanged from before
this feature existed.

Note that `donut`/`pie` charts key by the chart's `label` column directly
(there's no separate `series:` grouping concept for a pie slice), while
`bar`/`line`/`area`/`scatter` key by the `series:` column's values — a
single-series bar/line chart (no `series:` property set) has only one
series named `"default"`, so `series_colors` has no effect on it; per-slice
coloring for an ungrouped categorical breakdown is what `donut` is for.
