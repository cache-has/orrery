# 12 — Theming & Customization

## Goal

Provide a clean default theme that works out of the box, with customization through CSS variables and a theme configuration file. Dashboards should look professional without any styling effort, but teams can brand them to match their organization.

## Default Theme

Ship two built-in themes: **light** and **dark**.

Set in project config:
```yaml
# orrery.config.yaml
theme: dark  # or "light"
```

Or per-dashboard:
```board
dashboard "Ops Monitor" {
  theme: dark
}
```

## CSS Variable System

All visual properties are controlled by CSS variables. Users override them in a `theme.css` file:

```css
/* theme.css in project root */
:root {
  --ob-color-primary: #4F46E5;
  --ob-color-background: #FFFFFF;
  --ob-color-surface: #F9FAFB;
  --ob-color-text: #111827;
  --ob-color-text-secondary: #6B7280;
  --ob-color-border: #E5E7EB;
  --ob-color-success: #10B981;
  --ob-color-danger: #EF4444;
  --ob-color-warning: #F59E0B;

  --ob-font-family: 'Inter', system-ui, sans-serif;
  --ob-font-mono: 'JetBrains Mono', monospace;
  --ob-font-size-base: 14px;

  --ob-radius: 8px;
  --ob-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  --ob-gap: 1rem;

  /* Chart colors (used in sequence for multi-series) */
  --ob-chart-1: #4F46E5;
  --ob-chart-2: #06B6D4;
  --ob-chart-3: #8B5CF6;
  --ob-chart-4: #EC4899;
  --ob-chart-5: #F59E0B;
  --ob-chart-6: #10B981;
  --ob-chart-7: #EF4444;
  --ob-chart-8: #6366F1;
}
```

## Theme Configuration (Alternative to CSS)

For users who don't want to write CSS, support a YAML theme config:

```yaml
# theme.yaml
colors:
  primary: "#4F46E5"
  background: "#FFFFFF"
  surface: "#F9FAFB"
  text: "#111827"
  chart_palette:
    - "#4F46E5"
    - "#06B6D4"
    - "#8B5CF6"

typography:
  font_family: "Inter, system-ui, sans-serif"
  base_size: 14

branding:
  logo: "./assets/logo.svg"    # shown in header
  title: "Acme Analytics"      # replaces "Orrery" in header
  favicon: "./assets/favicon.ico"
```

The `theme.yaml` is compiled into CSS variables at build/startup time. Users can use either `theme.css` or `theme.yaml` — not both.

## Component-Level Styling

Individual components support limited inline style overrides:

```board
chart "Revenue" (span: 6, type: line) {
  query: "..."
  color: "#E11D48"
  background: "#FFF1F2"
}

metric "Total" (span: 3) {
  query: "..."
  color: "#059669"
}
```

These map to CSS variables scoped to the component container.

## Dashboard Header

Every dashboard renders a header:

```
┌─────────────────────────────────────────┐
│ [Logo] Dashboard Title    [↻] [⚙]      │
│ Description text (if set)               │
│ Last updated: 2 min ago                 │
├─────────────────────────────────────────┤
│ [Date Range ▾] [Region ▾] [Search...]  │
├─────────────────────────────────────────┤
```

- Logo from `theme.yaml` or hidden if not set
- Settings gear opens a panel with: theme toggle, auto-refresh toggle, export options
- Last updated timestamp

## Print Styles

CSS `@media print` rules that:
- Remove header controls, refresh buttons, filter controls
- Optimize chart sizes for paper
- Use light theme regardless of setting
- Page breaks between rows

## Acceptance Criteria

- [x] Light and dark themes work out of the box
- [x] CSS variable overrides in `theme.css` apply correctly
- [x] `theme.yaml` compiles to CSS variables
- [x] Chart color palette is configurable
- [x] Custom logo and title in dashboard header
- [x] Per-component color/background overrides work
- [x] Theme toggle in settings panel (dev mode)
- [x] Print styles produce clean output
- [x] Fonts load correctly (system fonts as default, custom fonts supported)
- [x] Theme applies consistently across all component types
