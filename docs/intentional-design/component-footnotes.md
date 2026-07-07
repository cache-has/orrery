<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Component footnotes

Design rationale for the `footnote:` component property (`src/renderer/html.ts`,
`src/parser/validator.ts`), which lets a `.board` author attach a short caveat
or definition (e.g. "Excludes refunded orders") to an individual metric,
chart, or table.

## HTML footer, not an ECharts `graphic`/`title`

ECharts can render arbitrary text inside the chart canvas via a `graphic`
element or a second `title` entry positioned at the bottom. Both were
rejected in favor of rendering the footnote as plain HTML in the existing
`.orrery-component-footer` bar (the same element that already shows "Loaded
in Xms"):

- Canvas text scales and clips with the chart's fixed coordinate system,
  so it fights word-wrap and doesn't respond to the surrounding CSS theme.
- It can't contain links, and gets no benefit from the browser's native text
  selection/accessibility tree.
- `footnote` is generic across **every** component type (metric, chart,
  table, text) — it's read the same way as the existing `color`/`background`
  props via `getStringProp`, not wired into chart-specific option-building
  code. Keeping it out of the ECharts option means it needs no chart-type-
  specific handling at all.

## One footer-render helper, not two copies

`renderComponentFooter` is shared between the full-page render
(`renderComponentContainer`) and the partial-update fragment
(`renderComponentFragment`, used by the `/api/query` refresh endpoint). Both
call sites previously built the "Loaded in Xms" span inline and
independently; folding the footnote in as a second inline block would have
meant keeping two copies of the same conditional-rendering logic in sync.
Instead, both now call one function that decides the whole footer — footnote
paragraph, query-time span, both, or neither (in which case the wrapping
`<div>` is omitted entirely, matching the pre-footnote behavior of not
emitting an empty footer bar).

## A hard render-time truncation backstop, not just a lint warning

`FOOTNOTE_MAX_LENGTH` (200 characters) is enforced twice, for different
reasons:

- **`validator.ts`** emits a **warning** (not an error) at parse/lint time if
  a footnote exceeds the limit — visible to the author while editing, but it
  doesn't fail a build. A footnote is presentational text; it shouldn't be
  able to break validation the way a missing `query` property does.
- **`html.ts`**'s `truncate()` enforces the same limit again at render time,
  unconditionally. This is the actual guarantee: even if a `.board` file is
  authored or generated somewhere the validator warning is never surfaced
  (a hand-edited file, a template, a future non-CLI ingestion path), the
  rendered page still can't get a runaway footnote that pushes into the
  component body or wraps across several lines and crowds the dashboard
  grid.

200 was picked as roughly "one sentence of caveat" — long enough for a real
caveat or definition, short enough to stay a single line at typical
component widths instead of wrapping.

## Footnotes survive printing; query time doesn't

The print stylesheet (`@media print` in `styles.ts`) hides `.orrery-query-time`
specifically, rather than the whole `.orrery-component-footer` as it did
before footnotes existed. A footnote is authored content — a data caveat or
definition — that's exactly the kind of thing worth keeping on an exported
PDF or printed page. "Loaded in 42ms" is inherently a live-session artifact
and never useful on a static export. `.orrery-component-footer:not(:has(.orrery-component-footnote))`
then collapses the footer bar entirely for components that only ever had a
query-time span, so print output doesn't show an empty bordered strip where
the timing used to be.
