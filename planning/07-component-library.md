# 07 — Component Library

## Goal

Ship a set of built-in components that cover 90% of dashboard needs. Each component receives query results and configuration from the DSL, and renders an interactive visualization.

## MVP Components

### 1. Metric / KPI Card

Displays a single numeric value with optional trend comparison.

```board
metric "Total Revenue" (span: 3) {
  query: "SELECT SUM(amount) as value FROM orders WHERE {{date_range}}"
  format: currency
  prefix: "$"
  trend_query: "SELECT SUM(amount) as value FROM orders WHERE {{date_range.previous}}"
  trend_label: "vs previous period"
}
```

**Rendering:**
- Large number prominently displayed
- Optional trend arrow (up/down) with percentage change
- Color coding: green for positive trend, red for negative (configurable)
- Format options: `currency`, `number`, `percent`, `compact` (1.2K, 3.4M)

**Data contract:** Query must return a single row with a `value` column.

### 2. Line Chart

```board
chart "Revenue Trend" (span: 8, type: line) {
  query: "SELECT date, SUM(amount) as revenue FROM orders GROUP BY date ORDER BY date"
  x: date
  y: revenue
}
```

**Features:**
- Tooltip on hover showing exact values
- Optional multi-series via `series` property
- Axis labels auto-formatted based on data type (dates, numbers, currency)
- Responsive sizing within grid cell
- Optional `y_format` for axis labels (currency, percent, compact)

### 3. Bar Chart

```board
chart "Revenue by Region" (span: 6, type: bar) {
  query: "SELECT region, SUM(amount) as revenue FROM orders GROUP BY region"
  x: region
  y: revenue
  sort: desc
}
```

**Features:**
- Vertical bars (default) or horizontal via `orientation: horizontal`
- Grouped or stacked multi-series
- Value labels on bars (optional)
- Sort: `asc`, `desc`, or `none` (preserve query order)

### 4. Table

```board
table "Recent Orders" (span: 12) {
  query: "SELECT * FROM orders ORDER BY created_at DESC LIMIT 100"
  filterable: true
  sortable: true
  page_size: 25
  columns {
    amount { format: currency, align: right }
    created_at { format: datetime, label: "Date" }
    status { format: badge }
  }
}
```

**Features:**
- Client-side sorting (click column headers)
- Client-side text filtering (search box)
- Pagination
- Column format overrides (currency, date, badge, percent, link)
- Column alignment (left, center, right)
- Column label override
- Sticky header
- Row count display
- CSV export button

### 5. Text / Markdown Block

```board
text (span: 6) {
  > ## Revenue Notes
  >
  > Revenue figures **exclude** refunded orders.
  > Data source: `warehouse.orders` table.
  > Last updated: query execution time.
}
```

**Features:**
- Full markdown rendering (CommonMark)
- Styled to match dashboard theme
- Can reference parameter values: `Current region: {{region}}`

## Post-MVP Components

These are designed into the component architecture but not built for v1:

- **Area chart** — line chart with filled area
- **Scatter plot** — x/y with optional size/color dimensions
- **Pie / Donut chart** — category distribution
- **Heatmap** — 2D matrix with color intensity
- **Sparkline** — tiny inline chart inside a metric card
- **Number ticker** — animated counting number
- **Map** — geographic data visualization
- **Funnel chart** — conversion funnel
- **Progress bar** — single metric as a bar toward a goal
- **Alert / status card** — conditional formatting based on thresholds

## Charting Library

### Options

| Library | Size | Style | Customization | License |
|---------|------|-------|---------------|---------|
| ECharts | ~800kb (tree-shakeable) | Rich, polished | Extremely configurable | Apache 2.0 |
| Observable Plot | ~100kb | Clean, academic | Good, D3-based | ISC |
| Chart.js | ~200kb | Clean, standard | Good | MIT |
| Vega-Lite | ~300kb | Grammar of graphics | Declarative spec | BSD |
| Nivo | ~varies | Modern, React-based | Component-based | MIT |

### Recommendation

**ECharts** — broadest chart type support, best interactivity (tooltips, zoom, brush), most polished out of the box, tree-shakeable to reduce bundle. The learning curve is higher but the DSL abstracts it — users never write ECharts config directly.

Alternative: **Observable Plot** if minimalism is preferred — smaller, cleaner, but less interactive.

## Component Interface

Every component implements a standard interface:

```typescript
interface ComponentRenderer {
  // Server-side: produce HTML string
  renderToString(config: ComponentConfig, data: QueryResult): string

  // Client-side: hydrate server-rendered HTML with interactivity
  hydrate(element: HTMLElement, config: ComponentConfig, data: QueryResult): ComponentInstance

  // Client-side: update with new data (after parameter change)
  update(instance: ComponentInstance, data: QueryResult): void

  // Clean up (remove event listeners, destroy chart instance)
  destroy(instance: ComponentInstance): void
}
```

## Format System

Reusable formatters applied to values:

```typescript
const formats = {
  currency: (v: number, opts?) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
  number: (v: number) => v.toLocaleString(),
  compact: (v: number) => compactNumber(v),       // 1.2K, 3.4M, etc.
  percent: (v: number) => `${(v * 100).toFixed(1)}%`,
  datetime: (v: string) => new Date(v).toLocaleString(),
  date: (v: string) => new Date(v).toLocaleDateString(),
  badge: (v: string) => `<span class="badge badge-${v.toLowerCase()}">${v}</span>`,
}
```

## Acceptance Criteria

- [x] Metric card renders with value, format, and optional trend
- [x] Line chart renders with proper axis formatting and tooltip
- [x] Bar chart renders with sort and optional multi-series
- [x] Table renders with sorting, filtering, pagination, and CSV export
- [x] Text block renders markdown with parameter value interpolation
- [x] All components handle empty query results gracefully (show "No data" message)
- [x] All components handle query errors gracefully (show error inline)
- [x] All components are responsive within their grid cell
- [x] Format system works across all component types
- [x] Charts resize correctly when browser window changes
