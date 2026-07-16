# 01 — Dashboard DSL Design

## Goal

Design a lightweight, readable domain-specific language for defining dashboards. The DSL must be readable by PMs, writable by engineers, diffable in git, and expressive enough to handle real-world dashboard layouts without becoming a programming language.

## File Extension

`.board` — dashboard definition files use this extension.

## Design Principles

1. **Readable by non-engineers** — A PM should be able to open a `.board` file and understand what it shows
2. **Layout is explicit** — No guessing how things will be arranged. Rows and spans are declared.
3. **SQL is inline** — Queries live next to the components they power. No indirection to separate files (though file references should be supported for large queries).
4. **Parameters are first-class** — Interactive filters are declared at the top and referenced in SQL with `{{param_name}}`
5. **Minimal syntax** — Braces for blocks, colons for key-value, no semicolons, no commas required
6. **Whitespace insensitive** — Indentation is for readability, not syntax

## Language Spec

### Top-Level Structure

```board
dashboard "Dashboard Title" {
  description: "Optional description shown in the header"
  connection: "connection_name"          # default connection for all queries
  refresh: 300                           # auto-refresh interval in seconds (optional)

  param ...                              # parameter declarations
  row { ... }                            # layout rows
  text { ... }                           # standalone text blocks
}
```

### Parameters

Parameters generate interactive filter controls in the rendered dashboard.

```board
# Date range picker
param date_range = daterange(default: "last 30 days")

# Dropdown from static values
param region = select(
  options: ["North", "South", "East", "West"]
  default: "North"
)

# Dropdown populated by a query
param customer = select(
  query: "SELECT DISTINCT name FROM customers ORDER BY name"
  default_first: true
)

# Text input
param search = text(placeholder: "Search orders...")

# Number input
param min_amount = number(default: 0, min: 0, max: 100000)
```

### Layout: Rows and Spans

Layout uses a 12-column grid (like Bootstrap/Tailwind). Rows contain components. Each component has an optional `span` (defaults to equal division of 12).

```board
row {
  metric "Revenue" (span: 3) { ... }
  metric "Orders" (span: 3) { ... }
  chart "Trend" (span: 6, type: line) { ... }
}

row {
  table "Recent Orders" (span: 12) { ... }
}
```

If spans are omitted, components in a row split the 12 columns equally.

```board
# These three components each get span: 4 automatically
row {
  metric "Revenue" { ... }
  metric "Orders" { ... }
  metric "Customers" { ... }
}
```

### Components

#### Metric / KPI Card

```board
metric "Total Revenue" (span: 4) {
  query: "SELECT SUM(amount) as value FROM orders WHERE {{date_range}}"
  format: currency
  prefix: "$"
  trend_query: "SELECT SUM(amount) FROM orders WHERE {{date_range.previous}}"
  trend_label: "vs previous period"
}
```

#### Charts

```board
chart "Revenue Over Time" (span: 8, type: line) {
  query: """
    SELECT
      date_trunc('day', created_at) as date,
      SUM(amount) as revenue
    FROM orders
    WHERE {{date_range}}
    GROUP BY 1
    ORDER BY 1
  """
  x: date
  y: revenue
  color: "#4F46E5"
}
```

Supported chart types: `line`, `bar`, `area`, `scatter`, `pie`, `donut`, `heatmap`

Multi-series:

```board
chart "Revenue by Region" (span: 12, type: bar) {
  query: """
    SELECT date, region, SUM(amount) as revenue
    FROM orders
    WHERE {{date_range}}
    GROUP BY 1, 2
  """
  x: date
  y: revenue
  series: region
}
```

#### Tables

```board
table "Recent Orders" (span: 12) {
  query: """
    SELECT id, customer, amount, status, created_at
    FROM orders
    WHERE {{date_range}}
    ORDER BY created_at DESC
    LIMIT 100
  """
  filterable: true
  sortable: true
  page_size: 25
  columns {
    amount { format: currency }
    created_at { format: datetime, label: "Date" }
    status { format: badge }
  }
}
```

#### Text / Markdown Block

```board
text (span: 6) {
  > **Note:** Revenue figures exclude refunded orders.
  > Data refreshes every 5 minutes.
}
```

Markdown syntax supported inside text blocks.

### Connections

Components inherit the dashboard-level `connection` by default. Override per-component:

```board
chart "External Data" (span: 6, type: bar) {
  connection: "other_database"
  query: "SELECT ..."
}
```

### Query File References

For large queries, reference an external `.sql` file:

```board
chart "Complex Report" (span: 12, type: line) {
  query: file("queries/complex_report.sql")
  x: date
  y: value
}
```

### Conditional Visibility

Show/hide components based on parameter values:

```board
chart "Regional Detail" (span: 12, type: bar, visible: region != "All") {
  query: "SELECT ... WHERE region = '{{region}}'"
}
```

### Dashboard Includes

Split large dashboards across files:

```board
dashboard "Executive Summary" {
  include "sections/revenue.board"
  include "sections/customers.board"
  include "sections/operations.board"
}
```

## Formal Grammar

The grammar is designed for unambiguous parsing with a hand-written recursive descent parser. Each production has a unique leading token, eliminating ambiguity.

### Lexical Tokens

```
STRING       := '"' [^"]* '"' | '"""' .*? '"""'    # single or triple-quoted
NUMBER       := [0-9]+ ('.' [0-9]+)?
BOOLEAN      := 'true' | 'false'
IDENT        := [a-zA-Z_] [a-zA-Z0-9_]*
COMMENT      := '#' .* '\n'                         # line comments, ignored
WHITESPACE   := [ \t\n\r]+                          # ignored (not significant)
```

### Grammar Productions (BNF)

```
Dashboard     := 'dashboard' STRING '{' DashboardItem* '}'

DashboardItem := Param
               | Row
               | TextBlock
               | Include
               | Property

Property      := IDENT ':' Value

Value         := STRING
               | NUMBER
               | BOOLEAN
               | IDENT
               | FileRef
               | Array

FileRef       := 'file' '(' STRING ')'
Array         := '[' (Value (',' Value)*)? ']'

Param         := 'param' IDENT '=' ParamType '(' ParamOpts? ')'
ParamType     := 'daterange' | 'select' | 'text' | 'number'
ParamOpts     := ParamOpt (',' ParamOpt)*
ParamOpt      := IDENT ':' Value

Row           := 'row' '{' Component+ '}'

Component     := ComponentType STRING? ComponentOpts? '{' ComponentBody '}'
ComponentType := 'metric' | 'chart' | 'table' | 'text'
ComponentOpts := '(' OptPair (',' OptPair)* ')'
OptPair       := IDENT ':' Value

ComponentBody := (Property | ColumnsBlock | MarkdownContent)*

ColumnsBlock  := 'columns' '{' ColumnDef+ '}'
ColumnDef     := IDENT '{' Property+ '}'

TextBlock     := 'text' ComponentOpts? '{' MarkdownContent '}'

MarkdownContent := (any text not starting with '}' until matching '}')*

Include       := 'include' STRING
```

### Disambiguation Rules

1. **DashboardItem dispatch** — determined by leading keyword:
   - `param` → Param
   - `row` → Row
   - `text` → TextBlock (top-level, outside a row)
   - `include` → Include
   - Any IDENT followed by `:` → Property
2. **Component dispatch inside Row** — leading keyword is one of: `metric`, `chart`, `table`, `text`
3. **ComponentBody dispatch** — `columns` keyword → ColumnsBlock; IDENT `:` → Property; anything else inside `text` → MarkdownContent
4. **String types** — triple-quoted `"""` for multiline SQL, double-quoted `"` for single-line values. The lexer greedily matches `"""` before `"`.

### Expression Grammar (Visibility Conditions)

Used only in the `visible:` option within ComponentOpts.

```
Expr          := IDENT CompOp Value
CompOp        := '==' | '!=' | '<' | '>' | '<=' | '>='
```

Visibility expressions are intentionally limited — no boolean operators, no nested expressions. This keeps the DSL simple and prevents it from becoming a programming language. If a use case requires complex conditions, compose them in SQL or split into separate dashboards.

## Resolved Questions

| Question | Decision | Rationale |
|----------|----------|-----------|
| `column` blocks for vertical stacking? | **Deferred** — moved to backlog | Rows with `span: 12` achieve vertical stacking. Not needed for MVP. |
| Tab/page support? | **Deferred** — moved to backlog | Already tracked in `16-deferred-backlog.md` as "Multi-Page Dashboards". Use separate `.board` files for now. |
| Chart axis/legend config inline or theme? | **Inline for MVP** | Keep it simple — `x_label`, `y_label`, `legend` as optional component properties. Theming layer (phase 12) can provide defaults. |
| Error message verbosity? | **Yes, Rust/Elm-style** | Show file, line, column, caret, and a help hint. Already designed in `03-dsl-parser.md`. |
| SQL dialect hints? | **Deferred** | Connection type implies dialect. Explicit dialect hints add complexity without clear MVP value. |

## Example Files

Three example `.board` files are in `examples/`:

- [`ecommerce-overview.board`](../examples/ecommerce-overview.board) — E-commerce sales dashboard with KPIs, charts, and an orders table. Uses all 5 MVP component types and 3 parameter types.
- [`saas-metrics.board`](../examples/saas-metrics.board) — SaaS subscription metrics (MRR, churn, signups). Demonstrates text blocks, area charts, and complex SQL.
- [`infrastructure-health.board`](../examples/infrastructure-health.board) — API latency and error monitoring. Demonstrates fast refresh, text search parameter, and donut charts.

## Acceptance Criteria

- [x] Language spec is complete and covers all MVP components
- [x] At least 3 example `.board` files written covering different use cases
- [x] Grammar is unambiguous and parseable with a recursive descent parser
- [x] A PM who has never seen the DSL can read an example and explain what the dashboard shows
