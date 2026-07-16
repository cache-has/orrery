# 03 — DSL Parser

## Goal

Build a parser that reads `.board` files and produces a typed AST (Abstract Syntax Tree). The parser should produce excellent error messages — when a `.board` file has a syntax error, the user should see the exact line, column, and a human-readable explanation of what went wrong.

## Architecture

```
.board file (string)
  → Lexer (tokenizer)
    → Token stream
      → Parser (recursive descent)
        → AST (typed tree)
          → Validator (semantic checks)
            → Validated AST (ready for rendering)
```

## Lexer

Hand-written lexer (not regex-based). Produces tokens with source positions for error reporting.

### Token Types

```typescript
type TokenType =
  // Keywords
  | 'dashboard' | 'row' | 'param' | 'metric' | 'chart'
  | 'table' | 'text' | 'include' | 'columns' | 'file'
  // Literals
  | 'string' | 'number' | 'boolean' | 'identifier'
  // Delimiters
  | 'lbrace' | 'rbrace' | 'lparen' | 'rparen'
  | 'lbracket' | 'rbracket'
  // Operators
  | 'colon' | 'equals' | 'dot' | 'bang_equals' | 'equals_equals'
  // Special
  | 'triple_quote_string'  // """ multi-line strings """
  | 'markdown_text'        // raw text inside text blocks
  | 'comment'              // # line comments
  | 'eof'
```

### Token Structure

```typescript
interface Token {
  type: TokenType
  value: string
  line: number
  column: number
  offset: number  // byte offset for source mapping
}
```

### String Handling

- Single-line strings: `"hello world"`
- Multi-line strings: `"""..."""` (for SQL queries — preserves whitespace, strips common leading indent)
- Markdown text: Raw text inside `text { }` blocks, parsed until closing `}`

## Parser

Recursive descent parser. No parser generator — hand-written for full control over error messages.

### AST Types

```typescript
interface Dashboard {
  type: 'dashboard'
  title: string
  properties: Property[]
  params: Param[]
  rows: Row[]
  includes: Include[]
  location: SourceLocation
}

interface Param {
  type: 'param'
  name: string
  paramType: 'daterange' | 'select' | 'text' | 'number'
  options: Record<string, Value>
  location: SourceLocation
}

interface Row {
  type: 'row'
  components: Component[]
  location: SourceLocation
}

interface Component {
  type: 'metric' | 'chart' | 'table' | 'text'
  title?: string
  options: ComponentOptions  // span, chart type, visible, etc.
  properties: Property[]
  columns?: ColumnConfig[]   // table column overrides
  markdownContent?: string   // text block content
  location: SourceLocation
}

interface Property {
  key: string
  value: Value
  location: SourceLocation
}

type Value =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'identifier'; value: string }
  | { type: 'array'; value: Value[] }
  | { type: 'file_ref'; path: string }
  | { type: 'expression'; expr: Expression }  // for visible conditions

interface SourceLocation {
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number
}
```

## Validator

Runs after parsing. Checks semantic correctness:

- Required properties present (e.g., `query` on chart/metric/table)
- Chart `type` is a known chart type
- Parameter references in SQL (`{{param_name}}`) match declared params
- `connection` references match defined connections (checked later at runtime, but warn if connection file doesn't exist)
- `span` values are between 1-12
- Row spans don't exceed 12
- `include` file paths exist
- `file()` references for SQL exist
- Column names in `columns` block reference columns that exist in the query (best-effort — may need runtime check)
- No duplicate param names
- No duplicate component titles within a dashboard (warning, not error)

## Error Messages

Error messages are critical for DX. Follow the Rust/Elm style:

```
error: missing required property 'query'
  --> dashboards/sales.board:14:3
   |
14 |   metric "Revenue" (span: 4) {
   |   ^^^^^^^ this metric needs a 'query' property
   |
   = help: add a SQL query, e.g.: query: "SELECT SUM(amount) FROM orders"
```

```
error: unknown chart type 'hbar'
  --> dashboards/sales.board:22:38
   |
22 |   chart "Revenue by Region" (span: 8, type: hbar) {
   |                                       ^^^^^^^^^^^
   |
   = help: valid chart types are: line, bar, area, scatter, pie, donut, heatmap
```

```
error: undefined parameter 'date_rnage' in query
  --> dashboards/sales.board:26:52
   |
26 |     WHERE created_at >= '{{date_rnage}}'
   |                          ^^^^^^^^^^^^^
   |
   = help: did you mean 'date_range'? (defined on line 4)
```

## Performance

Parsing should be fast enough for hot reload — under 10ms for a typical dashboard file (< 500 lines). The lexer should handle files up to ~10K lines without noticeable delay.

## Testing Strategy

- **Lexer tests:** Token output for each syntax construct
- **Parser tests:** AST output for valid `.board` files, one test per language feature
- **Error tests:** Snapshot tests for every error message format
- **Fixture files:** A set of `.board` files in `test/fixtures/` covering edge cases
- **Round-trip property:** Parse → serialize → parse should produce identical AST (future, not MVP)

## Acceptance Criteria

- [x] Lexer tokenizes all DSL constructs with correct source positions
- [x] Parser produces typed AST from valid `.board` files
- [x] Multi-line SQL strings (`"""..."""`) parsed correctly with indent stripping
- [x] Parameter declarations parsed with all types (daterange, select, text, number)
- [x] Validator catches missing required properties, unknown types, undefined params
- [x] Error messages include file, line, column, context, and help text
- [x] Typo suggestions for common misspellings (Levenshtein distance)
- [x] `include` directives parsed into AST nodes (runtime resolution deferred to phase 08)
- [x] `file()` references parsed into AST nodes (runtime resolution deferred to phase 08)
- [x] Parser handles comments (# line comments) and blank lines gracefully
- [x] All tests passing with >90% coverage on parser module
