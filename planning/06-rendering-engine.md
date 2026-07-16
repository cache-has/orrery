# 06 — Rendering Engine

## Goal

Take a validated AST + query results and produce an interactive, responsive dashboard in the browser. The rendering engine handles layout resolution (CSS Grid), component rendering, and client-side interactivity (parameter changes trigger re-queries).

## Architecture

### Server-Side

```
Validated AST
  → Layout Resolver (AST rows → CSS Grid template)
    → Data Fetcher (execute all queries in parallel)
      → Page Builder (HTML shell + serialized data + component config)
        → HTTP Response
```

### Client-Side

```
HTML Page loads
  → Hydrate components (attach interactivity to server-rendered HTML)
    → Parameter controls emit change events
      → Fetch updated data for affected components
        → Re-render affected components only
```

## Layout System

### CSS Grid Approach

Each `row` in the DSL maps to a CSS Grid row. The 12-column grid is implemented with:

```css
.orrery-row {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 1rem;
}
```

A component with `span: 4` gets:

```css
.component-xxx {
  grid-column: span 4;
}
```

### Responsive Behavior

At smaller viewports, spans collapse:

```css
/* Tablet: 2-column max */
@media (max-width: 1024px) {
  .orrery-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .orrery-component {
    grid-column: span 1 !important;
  }
}

/* Mobile: single column */
@media (max-width: 640px) {
  .orrery-row {
    grid-template-columns: 1fr;
  }
}
```

### Layout Resolution

The layout resolver transforms the AST into a concrete layout plan:

```typescript
interface LayoutPlan {
  rows: LayoutRow[]
  params: ParamLayout[]  // parameter controls rendered at the top
}

interface LayoutRow {
  components: LayoutComponent[]
}

interface LayoutComponent {
  id: string              // unique component ID
  type: ComponentType
  span: number            // 1-12
  config: ComponentConfig // chart type, format, etc.
  queryKey: string        // reference to query result
}
```

## Page Structure

The server responds with a full HTML page:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Dashboard Title</title>
  <link rel="stylesheet" href="/orrery/styles.css">
</head>
<body>
  <div id="orrery-root">
    <!-- Parameter bar -->
    <div class="orrery-params">...</div>

    <!-- Dashboard rows -->
    <div class="orrery-row">
      <div class="orrery-component" style="grid-column: span 4">
        <!-- Server-rendered component -->
      </div>
    </div>
  </div>

  <!-- Serialized initial data and config -->
  <script>
    window.__ORRERY__ = { layout: ..., data: ..., params: ... }
  </script>
  <script src="/orrery/client.js"></script>
</body>
</html>
```

## Rendering Approach

### Server-Side Rendering

The first page load is server-rendered:
1. Parse `.board` file → AST
2. Execute all queries with default parameter values
3. Render HTML with chart containers and data
4. Send full HTML page

### Client-Side Hydration

After the page loads, the client JS:
1. Reads `window.__ORRERY__` for initial state
2. Attaches event listeners to parameter controls
3. Initializes chart libraries with the data already on the page
4. Listens for parameter changes → fetch new data → update affected components

### Partial Updates

When a parameter changes:
1. Client sends new parameter values to the server
2. Server identifies which queries are affected (only those referencing the changed param)
3. Server re-executes only affected queries
4. Server returns JSON with new data for affected components
5. Client re-renders only those components

API endpoint:

```
POST /api/query
{
  "dashboard": "sales",
  "params": { "date_range": { "start": "2026-01-01", "end": "2026-03-28" } },
  "components": ["revenue_chart", "orders_table"]  // only re-query these
}
```

## Component Container

Every component is wrapped in a standard container:

```html
<div class="orrery-component" data-component-id="revenue_chart">
  <div class="orrery-component-header">
    <h3 class="orrery-component-title">Revenue Over Time</h3>
    <div class="orrery-component-actions">
      <button class="orrery-refresh" title="Refresh">↻</button>
    </div>
  </div>
  <div class="orrery-component-body">
    <!-- Chart/table/metric rendered here -->
  </div>
  <div class="orrery-component-footer">
    <span class="orrery-query-time">Loaded in 45ms</span>
  </div>
</div>
```

## Loading States

- **Initial load:** Full page skeleton with shimmer/placeholder for each component
- **Parameter change:** Affected components show a subtle loading overlay while data refreshes; unaffected components remain interactive
- **Error:** Component shows inline error card (see query engine doc)

## Framework Choice

### Option A: Vanilla JS + Web Components

- No framework dependency
- Smallest bundle size
- Each component type is a custom element
- Simple but more manual work for reactivity

### Option B: Preact

- Tiny (3kb) React-compatible library
- Component model familiar to most frontend devs
- Good hydration support
- Easy to find contributors

### Option C: SolidJS

- Fine-grained reactivity (no virtual DOM)
- Small bundle
- Best performance for partial updates
- Smaller ecosystem

### Recommendation

Start with **Preact** — smallest risk, familiar model, good SSR/hydration, tiny footprint. Revisit if performance becomes an issue (unlikely at dashboard scale).

## Acceptance Criteria

- [x] CSS Grid layout correctly renders rows with span-based columns
- [x] Responsive breakpoints collapse to 2-column and 1-column layouts
- [x] Server-side rendering produces a fully rendered initial page
- [x] Component containers with title, refresh button, and query time
- [x] Error states render inline per-component
- [x] Page title set from dashboard title

### Deferred to Phase 09 (Interactivity)

The following items require client-side JavaScript (framework choice, bundling, hydration) and are covered by the interactivity phase:

- [ ] Client-side hydration attaches interactivity without re-rendering
- [ ] Parameter changes trigger partial data refresh (only affected components)
- [ ] Loading states visible during data fetch (CSS is in place; JS toggle deferred)
- [ ] Auto-refresh works when `refresh` property is set
