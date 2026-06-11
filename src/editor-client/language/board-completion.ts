import type { CompletionContext, CompletionResult, CompletionSource, Completion } from "@codemirror/autocomplete";

/**
 * Context-aware autocomplete for the `.board` DSL.
 *
 * The Lezer grammar (board.grammar) is deliberately flat — it tags tokens
 * for highlighting but does not model nested structure. Instead of relying
 * on the syntax tree, we inspect the raw text before the cursor to decide
 * which completion list applies. Heuristics are good enough because the
 * DSL's context cues (`type:`, `connection:`, param headers, the enclosing
 * `{` / `(` bracket, etc.) are all visible within a small local window.
 */

const TOP_LEVEL = [
  "dashboard",
  "param",
  "row",
  "metric",
  "chart",
  "table",
  "text",
  "include",
];

const PARAM_TYPES = ["select", "daterange", "text", "number", "toggle", "multiselect"];

const CHART_TYPES = [
  "line",
  "bar",
  "area",
  "donut",
  "pie",
  "scatter",
  "heatmap",
  "funnel",
  "gauge",
];

const FORMAT_NAMES = ["currency", "percent", "compact", "datetime", "badge"];

const HEADER_OPTIONS = ["span", "type", "visible", "connection"];

const COMPONENT_PROPERTIES: Record<string, string[]> = {
  metric: ["query", "format", "prefix", "suffix", "trend_query", "trend_label"],
  chart: [
    "query",
    "x",
    "y",
    "series",
    "value",
    "label",
    "size",
    "max",
    "stacked",
    "thresholds",
    "format",
  ],
  table: ["query", "sortable", "filterable", "page_size", "columns"],
  // `text` intentionally omitted — body is free markdown.
};

const COMPONENT_TYPES = new Set(["metric", "chart", "table", "text"]);

export interface BoardCompletionOptions {
  fetchConnections?: () => Promise<string[]>;
}

/** Strip string literals and line comments from text so heuristics don't
 * match tokens inside them. Replaces content with spaces to preserve
 * offsets so line-level regexes still line up with the cursor position. */
function stripStringsAndComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // triple-quoted string
    if (ch === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      const end = src.indexOf('"""', i + 3);
      const stop = end === -1 ? src.length : end + 3;
      for (let j = i; j < stop; j++) out += src[j] === "\n" ? "\n" : " ";
      i = stop;
      continue;
    }
    if (ch === '"') {
      out += " ";
      i++;
      while (i < src.length && src[i] !== '"' && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < src.length) {
          out += "  ";
          i += 2;
          continue;
        }
        out += " ";
        i++;
      }
      if (i < src.length && src[i] === '"') {
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "#") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

interface EnclosingContext {
  // nearest unclosed opener scanning backwards: "{", "(", or null for top-level
  opener: "{" | "(" | null;
  openerPos: number;
  // when opener is "{", this is the component keyword (metric/chart/table/text)
  // preceding the "{". Undefined if not a component body (e.g. dashboard {}, row {}).
  componentType?: string;
}

function findEnclosing(stripped: string, cursor: number): EnclosingContext {
  let depthBrace = 0;
  let depthParen = 0;
  for (let i = cursor - 1; i >= 0; i--) {
    const c = stripped[i];
    if (c === "}") depthBrace++;
    else if (c === ")") depthParen++;
    else if (c === "{") {
      if (depthBrace === 0) {
        // found an open `{` — what precedes it?
        const component = findComponentBefore(stripped, i);
        return { opener: "{", openerPos: i, componentType: component };
      }
      depthBrace--;
    } else if (c === "(") {
      if (depthParen === 0) {
        return { opener: "(", openerPos: i };
      }
      depthParen--;
    }
  }
  return { opener: null, openerPos: -1 };
}

/** Given position of an `{`, find the component keyword that began the
 * block. Matches `<component> "name" (...)? {` with any whitespace. */
function findComponentBefore(stripped: string, bracePos: number): string | undefined {
  // Look back past optional `(...)` header and a string name to find the
  // keyword. Our stripper replaced strings with spaces, so the "name" is
  // already whitespace.
  let i = bracePos - 1;
  // skip whitespace
  while (i >= 0 && /\s/.test(stripped[i])) i--;
  // skip a balanced (...)
  if (stripped[i] === ")") {
    let depth = 1;
    i--;
    while (i >= 0 && depth > 0) {
      if (stripped[i] === ")") depth++;
      else if (stripped[i] === "(") depth--;
      i--;
    }
    while (i >= 0 && /\s/.test(stripped[i])) i--;
  }
  // Name was a string → already spaces; just skip whitespace more.
  while (i >= 0 && /\s/.test(stripped[i])) i--;
  // Read an identifier ending here
  const end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_]/.test(stripped[i])) i--;
  const ident = stripped.slice(i + 1, end);
  if (COMPONENT_TYPES.has(ident)) return ident;
  if (ident === "row" || ident === "dashboard" || ident === "param") return ident;
  return undefined;
}

function optsFor(list: string[], type?: Completion["type"]): Completion[] {
  return list.map((label) => ({ label, type: type ?? "keyword" }));
}

/** Derive the completion intent at the cursor. */
export interface CompletionIntent {
  kind:
    | "top-level"
    | "param-type"
    | "header-option"
    | "chart-type"
    | "connection-value"
    | "component-property"
    | "format-value"
    | "none";
  componentType?: string;
}

export function detectIntent(docBefore: string): CompletionIntent {
  const stripped = stripStringsAndComments(docBefore);
  const cursor = stripped.length;

  // Nearest `key:` preceded-only-by-whitespace on the current line (inside the
  // current scope). This yields completions for values: type: / connection: /
  // format:.
  const lineStart = stripped.lastIndexOf("\n", cursor - 1) + 1;
  const line = stripped.slice(lineStart, cursor);
  const keyMatch = /(^|[\s(,])([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_]*)$/.exec(line);
  if (keyMatch) {
    const key = keyMatch[2];
    if (key === "type") return { kind: "chart-type" };
    if (key === "connection") return { kind: "connection-value" };
    if (key === "format") return { kind: "format-value" };
  }

  const enc = findEnclosing(stripped, cursor);

  // Inside `(...)` header — suggest header option names (only at name
  // position, not after `:` which was handled above).
  if (enc.opener === "(") {
    return { kind: "header-option" };
  }

  // Inside `{...}` body
  if (enc.opener === "{") {
    const comp = enc.componentType;
    if (comp && COMPONENT_PROPERTIES[comp]) {
      return { kind: "component-property", componentType: comp };
    }
    // Inside `dashboard { }` or `row { }` — top-level-ish contents
    return { kind: "top-level" };
  }

  // Not inside any bracket. Special case: after `param NAME =` expect a
  // param type.
  const paramMatch = /\bparam\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*([A-Za-z0-9_]*)$/.exec(stripped);
  if (paramMatch) {
    return { kind: "param-type" };
  }

  return { kind: "top-level" };
}

/**
 * Build the CodeMirror completion source. The `fetchConnections` option,
 * when provided, is called on demand and its result is cached for the life
 * of the editor; stale entries are acceptable per the design doc.
 */
export function createBoardCompletionSource(
  options: BoardCompletionOptions = {},
): CompletionSource {
  let connectionsCache: string[] | null = null;
  let connectionsPromise: Promise<string[]> | null = null;

  async function getConnections(): Promise<string[]> {
    if (connectionsCache) return connectionsCache;
    if (!options.fetchConnections) return [];
    if (!connectionsPromise) {
      connectionsPromise = options
        .fetchConnections()
        .then((list) => {
          connectionsCache = list;
          return list;
        })
        .catch(() => {
          connectionsPromise = null;
          return [];
        });
    }
    return connectionsPromise;
  }

  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // Match an in-progress identifier prefix (or an empty slot explicitly
    // requested).
    const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    const from = word ? word.from : ctx.pos;
    const to = ctx.pos;
    if (!word && !ctx.explicit) return null;

    const docBefore = ctx.state.doc.sliceString(0, ctx.pos);
    const intent = detectIntent(docBefore);

    let items: Completion[];
    switch (intent.kind) {
      case "top-level":
        items = optsFor(TOP_LEVEL, "keyword");
        break;
      case "param-type":
        items = optsFor(PARAM_TYPES, "type");
        break;
      case "header-option":
        items = optsFor(HEADER_OPTIONS, "property");
        break;
      case "chart-type":
        items = optsFor(CHART_TYPES, "type");
        break;
      case "format-value":
        items = optsFor(FORMAT_NAMES, "enum");
        break;
      case "component-property": {
        const props = intent.componentType
          ? COMPONENT_PROPERTIES[intent.componentType]
          : undefined;
        items = props ? optsFor(props, "property") : [];
        break;
      }
      case "connection-value": {
        const names = await getConnections();
        items = names.map((label) => ({ label: `"${label}"`, displayLabel: label, type: "constant" }));
        break;
      }
      default:
        return null;
    }

    if (items.length === 0) return null;
    return {
      from,
      to,
      options: items,
      validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
    };
  };
}

/**
 * Default connection fetcher that hits `/api/connections`. Returns an
 * empty list on any failure so autocomplete degrades gracefully.
 */
export async function defaultFetchConnections(): Promise<string[]> {
  try {
    const res = await fetch("/api/connections");
    if (!res.ok) return [];
    const body = (await res.json()) as { connections?: Array<{ name: string }> };
    return (body.connections ?? []).map((c) => c.name);
  } catch {
    return [];
  }
}
