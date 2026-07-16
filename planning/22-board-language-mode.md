# 22 — CodeMirror Language Mode for `.board` DSL

## Goal

A CodeMirror 6 language package that provides syntax highlighting, autocomplete, and inline validation diagnostics for `.board` files. Makes the web editor (docs 20, 21) genuinely usable for semi-technical authors who have not memorized the DSL.

## Package shape

A single module exported from the Orrery frontend, something like:

```typescript
// src/editor/board-language.ts
import { LanguageSupport } from "@codemirror/language";

export function boardLanguage(options?: {
  fetchConnections?: () => Promise<string[]>;
  lintEndpoint?: string; // default: /api/validate
}): LanguageSupport;
```

Callers (the editor page in doc 21) use it as:

```typescript
import { EditorView } from "@codemirror/view";
import { boardLanguage } from "./editor/board-language.js";

new EditorView({
  doc: initialContent,
  extensions: [
    boardLanguage({
      fetchConnections: () => fetch("/api/connections").then(...)
    }),
    // ...other extensions
  ],
});
```

## Syntax highlighting

### Approach

Use `@lezer/generator` to produce a parser for `.board`, then map parser nodes to highlight tags via `@codemirror/language`'s `styleTags`. The Lezer parser is separate from our existing runtime parser — Lezer is incremental and designed for editors, while our DSL parser is batch-oriented for CLI/server use.

Keep the Lezer grammar aligned with the runtime parser's token set. When the runtime parser adds a new keyword, the Lezer grammar must also add it; a shared source of truth (e.g., a `tokens.ts` constants file) helps but is not strictly required for v1.

### Token → tag mapping

| Lexer token | CodeMirror tag | Meaning |
|-------------|----------------|---------|
| `dashboard`, `param`, `row`, `include` | `keyword` | Structural keywords |
| `metric`, `chart`, `table`, `text` | `typeName` | Component types |
| `select`, `daterange`, `number`, `toggle`, `multiselect` | `typeName` | Param types |
| string literals (single and triple-quoted) | `string` | String values |
| numeric literals | `number` | Numeric values |
| `true`, `false` | `bool` | Boolean values |
| `# ...` (line comments) | `comment` | Comments |
| property identifiers (LHS of `key:`) | `propertyName` | Property names |
| `{ } ( ) [ ]` | `bracket` | Structure |

Triple-quoted strings should highlight as a single multi-line string span; the grammar needs explicit support for them.

Theme coverage comes from CodeMirror's standard highlight style — no bespoke color scheme needed.

## Autocomplete

Context-aware completion via `@codemirror/autocomplete`. The completion source inspects the syntax tree node at cursor to decide what to suggest.

### Completion contexts

| Cursor position | Suggestions |
|-----------------|-------------|
| Top level (between statements) | `dashboard`, `param`, `row`, `metric`, `chart`, `table`, `text`, `include` |
| After `param NAME =` | `select`, `daterange`, `text`, `number`, `toggle`, `multiselect` |
| Inside component header `( )` before `:` | `span`, `type`, `visible`, `connection` |
| After `type:` in a `chart` header | `line`, `bar`, `area`, `donut`, `pie`, `scatter`, `heatmap`, `funnel`, `gauge` (as implemented) |
| After `connection:` | connection names from `/api/connections` |
| Inside component body `{ }` before `:` | properties valid for the containing component type (see table below) |
| After `format:` | `currency`, `percent`, `compact`, `datetime`, `badge` |

### Component property suggestions

| Component | Properties |
|-----------|-----------|
| `metric` | `query`, `format`, `prefix`, `suffix`, `trend_query`, `trend_label` |
| `chart` | `query`, `x`, `y`, `series`, `value`, `label`, `size`, `max`, `stacked`, `thresholds`, `format` |
| `table` | `query`, `sortable`, `filterable`, `page_size`, `columns` |
| `text` | (free markdown content; no structured properties) |

Chart property set is broad because different chart types use different subsets (gauge uses `value`/`max`, heatmap uses `x`/`y`/`value`, etc.). If a type check tightens the suggestions (e.g., only offer `stacked` when `type: bar`), that is a nice second pass — do not gate v1 on it.

### Dynamic completions

Connection names come from a `GET /api/connections` call (see doc 20). Cache the result for the life of the editor session; refresh on focus or after a manual "reload" action. Accept that stale entries are possible — the user can just type the name if autocomplete is behind.

## Linting (diagnostics)

Use `@codemirror/lint` with a linter source that POSTs the current document to `/api/validate` and returns `Diagnostic[]` mapped from the server's `ValidationDiagnostic[]`.

### Debounce and cost

- Debounce: 400 ms after the last keystroke. Short enough to feel live, long enough to avoid hammering the server.
- Cancel in-flight request when a newer one is issued (AbortController).
- Also run on save attempts explicitly, with no debounce.

### Mapping server diagnostics to CodeMirror

Server shape (already defined):

```typescript
interface ValidationDiagnostic {
  level: "error" | "warning" | "info";
  message: string;
  span: { line: number; column: number; endLine?: number; endColumn?: number };
}
```

CodeMirror:

```typescript
{
  from: document.line(span.line).from + span.column,
  to: span.endLine
    ? document.line(span.endLine).from + span.endColumn
    : document.line(span.line).to,
  severity: level === "info" ? "info" : level,
  message: message,
}
```

Handle off-by-one between parser columns (likely 1-based) and CodeMirror positions (0-based) — verify when wiring up, add a test.

### Parse errors vs. validation errors

Both come through the same `/api/validate` endpoint — the server runs `parse()` first and returns any parse errors as diagnostics before running `validate()`. The editor does not distinguish; both render as inline lint markers.

## Wiring with the editor page

Doc 21's editor page imports `boardLanguage()` and includes it in its extensions array along with line numbers, history, search, etc. No special coupling beyond that.

## Testing

- Unit: grammar parses known-good `.board` snippets without errors; highlighting tags are applied to the right token ranges.
- Unit: completion source returns expected items for each context (cursor after `type:`, cursor inside `chart { }`, etc.).
- Unit: diagnostic mapper converts server spans to CodeMirror positions correctly, including off-by-one boundaries.
- Integration (E2E from doc 21): typing `type: ` in a chart header shows chart type completions; invalid DSL shows inline errors within ~500 ms of typing.

## Out of scope

- Hover popups with documentation / tooltips for properties.
- Go-to-definition (e.g., jumping from `{{param_name}}` to the `param` declaration).
- Refactoring (rename param across a file).
- Query-language (SQL) awareness inside `query:` strings. The string content is SQL, but treating it as such requires a second embedded language — valuable future work, not v1.
- Snippet expansion (typing `chart` + Tab scaffolding a full block). Nice later; not v1.

## Checklist

- [x] Lezer grammar for `.board` in `src/editor-client/language/board.grammar`
- [x] `styleTags` mapping and `LanguageSupport` export
- [x] Autocomplete source covering every context in the table
- [x] Connection name completion via `/api/connections`
- [x] Linter source hitting `/api/validate` with debounce + abort
- [x] Diagnostic span → CodeMirror position mapping with tests
- [x] Integration with doc 21's editor page
- [ ] ~~E2E test: completion after `type:`; live lint markers on invalid DSL~~ — *deferred, see 16-deferred-backlog.md (Playwright E2E Tests)*
