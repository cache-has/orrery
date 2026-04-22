import { linter, type Diagnostic as CMDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Server-side diagnostic shape returned by `POST /api/validate`. Matches
 *  `ValidationDiagnostic` from the runtime validator plus the `info` level
 *  used for parse notices. Positions are 1-based (line and column). */
export interface ServerDiagnostic {
  level: "error" | "warning" | "info";
  message: string;
  span?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
    file?: string;
  };
  hint?: string;
}

export type BoardLintFetch = (
  input: string,
  init: {
    method: string;
    body: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<{ diagnostics?: ServerDiagnostic[] }>;
}>;

export interface BoardLinterOptions {
  /** Endpoint to POST the document to. Defaults to `/api/validate`. */
  lintEndpoint?: string;
  /** Override fetch — used by tests. Defaults to the global `fetch`. */
  fetchImpl?: BoardLintFetch;
  /** Debounce delay in ms. Defaults to 400. */
  delay?: number;
}

/**
 * Convert 1-based server diagnostics to CodeMirror positions.
 *
 * Parser lines and columns are 1-based; CodeMirror offsets are 0-based.
 * When the end span is missing or collapses to the start, widen `to` to
 * the end of the start line so the marker is visible. Out-of-range
 * positions are clamped to the document bounds.
 */
export function mapDiagnostics(doc: Text, diagnostics: ServerDiagnostic[]): CMDiagnostic[] {
  return diagnostics.map((d) => {
    let from = d.span ? offsetFor(doc, d.span.start.line, d.span.start.column) : 0;
    let to: number;
    if (d.span) {
      to = offsetFor(doc, d.span.end.line, d.span.end.column);
    } else {
      to = Math.min(doc.length, from + 1);
    }
    from = Math.min(from, doc.length);
    to = Math.min(to, doc.length);
    // Ensure a visible non-empty range.
    if (to <= from) {
      const lineInfo = doc.line(clampLine(doc, d.span?.start.line ?? 1));
      to = Math.min(doc.length, Math.max(from + 1, lineInfo.to));
    }
    if (to < from) to = from;
    const severity: CMDiagnostic["severity"] =
      d.level === "error" ? "error" : d.level === "warning" ? "warning" : "info";
    const message = d.hint ? `${d.message}\n${d.hint}` : d.message;
    return { from, to, severity, message };
  });
}

function clampLine(doc: Text, line: number): number {
  if (line < 1) return 1;
  if (line > doc.lines) return doc.lines;
  return line;
}

function offsetFor(doc: Text, line: number, column: number): number {
  const safeLine = clampLine(doc, line);
  const info = doc.line(safeLine);
  const col = Math.max(0, column - 1);
  return Math.min(info.to, info.from + col);
}

/**
 * Build a lint source function that POSTs the current doc to `/api/validate`
 * and returns mapped diagnostics. Exposed separately from the extension so
 * it can be unit-tested without a CodeMirror view.
 */
export function createBoardLintSource(options: BoardLinterOptions = {}): (
  view: EditorView,
) => Promise<CMDiagnostic[]> {
  const endpoint = options.lintEndpoint ?? "/api/validate";
  const fetchImpl: BoardLintFetch | undefined =
    options.fetchImpl ?? (globalThis.fetch as unknown as BoardLintFetch | undefined);
  let inflight: AbortController | null = null;

  return async (view: EditorView): Promise<CMDiagnostic[]> => {
    if (!fetchImpl) return [];
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    const body = view.state.doc.toString();
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        body,
        headers: { "Content-Type": "text/plain" },
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const payload = await res.json();
      const diagnostics = Array.isArray(payload?.diagnostics) ? payload.diagnostics : [];
      return mapDiagnostics(view.state.doc, diagnostics);
    } catch (err) {
      // Aborted request is the expected path when a newer keystroke supersedes this one.
      if (controller.signal.aborted) return [];
      if (err instanceof Error && err.name === "AbortError") return [];
      return [];
    } finally {
      if (inflight === controller) inflight = null;
    }
  };
}

/**
 * CodeMirror extension wiring the live linter with debounce + abort.
 */
export function createBoardLinter(options: BoardLinterOptions = {}): Extension {
  return linter(createBoardLintSource(options), { delay: options.delay ?? 400 });
}
