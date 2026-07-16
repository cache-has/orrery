# 09 — Interactivity

## Goal

Make dashboards interactive through parameters, filters, and cross-component communication. Users should be able to filter, drill down, and explore data without editing `.board` files — all driven by the parameter declarations in the DSL.

## Parameter Controls

Each `param` declaration in the DSL generates a UI control in the parameter bar at the top of the dashboard.

### Control Types

#### Date Range Picker

```board
param date_range = daterange(default: "last 30 days")
```

Renders a date range picker with:
- Preset options: Last 7 days, Last 30 days, Last 90 days, This month, Last month, This quarter, This year, Custom
- Custom date range selection (calendar picker)
- Outputs: `{{date_range.start}}` and `{{date_range.end}}` as ISO date strings
- Also provides `{{date_range.previous}}` — the equivalent previous period for comparison

#### Select Dropdown

```board
# Static options
param region = select(
  options: ["All", "North", "South", "East", "West"]
  default: "All"
)

# Query-driven options
param customer = select(
  query: "SELECT DISTINCT name FROM customers ORDER BY name"
  default_first: true
  searchable: true
)
```

Renders a dropdown. `searchable: true` adds a text filter within the dropdown for long lists.

#### Text Input

```board
param search = text(placeholder: "Search...", debounce: 300)
```

Renders a text input. `debounce` controls delay before triggering re-query (in ms).

#### Number Input

```board
param min_amount = number(default: 0, min: 0, max: 100000, step: 100)
```

Renders a number input with optional min/max/step constraints.

#### Toggle

```board
param show_inactive = toggle(default: false, label: "Include inactive")
```

Renders a toggle switch. Value is boolean.

### Parameter Bar Layout

Parameters render in declaration order in a horizontal bar above the dashboard. On mobile, they stack vertically.

```
┌─────────────────────────────────────────────────────────┐
│ Date Range: [Last 30 days ▾]  Region: [All ▾]  [🔍 Search...] │
├─────────────────────────────────────────────────────────┤
│                    Dashboard content                     │
```

## Parameter → Query Flow

1. User changes a parameter value (e.g., selects a new region)
2. Client identifies which components reference `{{region}}` in their queries
3. Client sends POST to `/api/query` with new param values and affected component IDs
4. Server re-executes only affected queries with new parameter values
5. Server returns updated data for affected components
6. Client re-renders only those components

Components that don't reference the changed parameter are untouched.

## URL State

Parameter values are synced to the URL as query parameters:

```
/d/sales?date_range=last_30_days&region=North&search=acme
```

This means:
- Dashboards are shareable — send someone a URL with your current filters
- Browser back/forward navigates parameter history
- Bookmarkable states

## Cross-Filtering (Post-MVP Design, Document Now)

Clicking a bar in a chart could filter other components. E.g., clicking "North" in a region bar chart filters the table below to North only.

This requires:
- Components to declare they emit filter events
- Other components to declare they listen to filters
- A client-side event bus connecting them

DSL syntax (future):

```board
chart "Revenue by Region" (span: 6, type: bar, emits: region_filter) {
  query: "SELECT region, SUM(amount) FROM orders GROUP BY region"
  x: region
  y: amount
}

table "Orders" (span: 6, listens: region_filter) {
  query: "SELECT * FROM orders WHERE region = '{{region_filter}}'"
}
```

**Not in MVP.** Document the design so the architecture supports it.

## Refresh Behavior

### Manual Refresh

Each component has a small refresh button (↻) that re-executes its query.

### Auto-Refresh

Dashboard-level:
```board
dashboard "Live Ops" {
  refresh: 30  # seconds
}
```

Re-executes all queries every 30 seconds. Components update smoothly (no full page reload).

### Refresh Indicator

A subtle indicator shows when data was last refreshed:
- "Updated 5s ago" in the dashboard header
- Pulse animation on components when they receive new data

## Keyboard Shortcuts

- `R` — Refresh all queries
- `Esc` — Clear all filters (reset to defaults)
- `/` — Focus the first text parameter (search)

## Acceptance Criteria

- [x] Date range picker with presets and custom range
- [x] Select dropdown with static and query-driven options
- [x] Text input with configurable debounce
- [x] Number input with min/max/step
- [x] Toggle switch
- [x] Parameter changes trigger partial re-query (only affected components)
- [x] Parameter values synced to URL query string
- [x] Shareable URLs with filter state
- [x] Browser back/forward navigates parameter history
- [x] Auto-refresh at configurable interval
- [x] Manual refresh per-component and dashboard-wide
- [x] Query-driven select options load from database
- [x] `daterange.previous` computed correctly for comparison metrics
- [x] Client-side hydration attaches interactivity without re-rendering (from phase 06)
- [x] Loading states visible during data fetch — JS toggle (from phase 06, CSS in place)
