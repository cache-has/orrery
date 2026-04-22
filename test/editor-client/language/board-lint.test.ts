import { describe, it, expect, vi } from "vitest";
import { Text } from "@codemirror/state";
import {
  mapDiagnostics,
  createBoardLintSource,
  type ServerDiagnostic,
  type BoardLintFetch,
} from "../../../src/editor-client/language/board-lint.js";

function span(sL: number, sC: number, eL: number, eC: number) {
  return {
    start: { line: sL, column: sC, offset: 0 },
    end: { line: eL, column: eC, offset: 0 },
  };
}

describe("mapDiagnostics", () => {
  it("converts 1-based line/column into 0-based CodeMirror offsets", () => {
    const doc = Text.of(["line one", "line two", "line three"]);
    // "line one\nline two\nline three" — second line "line two" starts at 9.
    const diag: ServerDiagnostic = {
      level: "error",
      message: "boom",
      span: span(2, 1, 2, 5),
    };
    const [mapped] = mapDiagnostics(doc, [diag]);
    expect(mapped.from).toBe(9);
    expect(mapped.to).toBe(13);
    expect(mapped.severity).toBe("error");
    expect(mapped.message).toBe("boom");
  });

  it("appends hint text to the message", () => {
    const doc = Text.of(["a"]);
    const [mapped] = mapDiagnostics(doc, [
      { level: "warning", message: "nope", hint: "try X", span: span(1, 1, 1, 2) },
    ]);
    expect(mapped.severity).toBe("warning");
    expect(mapped.message).toBe("nope\ntry X");
  });

  it("maps `info` level through", () => {
    const doc = Text.of(["hi"]);
    const [mapped] = mapDiagnostics(doc, [
      { level: "info", message: "fyi", span: span(1, 1, 1, 2) },
    ]);
    expect(mapped.severity).toBe("info");
  });

  it("widens a zero-width span to the rest of the line", () => {
    const doc = Text.of(["abcdef"]);
    const [mapped] = mapDiagnostics(doc, [
      { level: "error", message: "x", span: span(1, 3, 1, 3) },
    ]);
    expect(mapped.from).toBe(2);
    expect(mapped.to).toBe(6);
  });

  it("clamps out-of-range lines and columns", () => {
    const doc = Text.of(["short"]);
    const [mapped] = mapDiagnostics(doc, [
      { level: "error", message: "x", span: span(99, 1, 99, 99) },
    ]);
    expect(mapped.from).toBeLessThanOrEqual(doc.length);
    expect(mapped.to).toBeLessThanOrEqual(doc.length);
    expect(mapped.to).toBeGreaterThanOrEqual(mapped.from);
  });

  it("falls back when span is missing", () => {
    const doc = Text.of(["abc"]);
    const [mapped] = mapDiagnostics(doc, [{ level: "error", message: "x" }]);
    expect(mapped.from).toBe(0);
    expect(mapped.to).toBeGreaterThan(0);
  });

  it("handles a span that wraps onto a later line", () => {
    const doc = Text.of(["abc", "defghi"]);
    // Starts at (1,2) → offset 1; ends at (2,4) → 4 (second line start) + 3 = 7.
    const [mapped] = mapDiagnostics(doc, [
      { level: "error", message: "x", span: span(1, 2, 2, 4) },
    ]);
    expect(mapped.from).toBe(1);
    expect(mapped.to).toBe(7);
  });
});

describe("createBoardLintSource", () => {
  function fakeView(text: string): { state: { doc: Text } } {
    return { state: { doc: Text.of(text.split("\n")) } };
  }

  it("POSTs document text to the configured endpoint and returns mapped diagnostics", async () => {
    const fetchImpl = vi.fn<BoardLintFetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        diagnostics: [
          { level: "error", message: "nope", span: span(1, 1, 1, 3) },
        ],
      }),
    }));
    const source = createBoardLintSource({
      lintEndpoint: "/custom/validate",
      fetchImpl,
    });
    const result = await source(fakeView("abc") as never);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/custom/validate");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("abc");
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("nope");
  });

  it("returns [] on non-OK responses", async () => {
    const fetchImpl = vi.fn<BoardLintFetch>(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ diagnostics: [] }),
    }));
    const source = createBoardLintSource({ fetchImpl });
    expect(await source(fakeView("abc") as never)).toEqual([]);
  });

  it("aborts the previous in-flight request when a new one arrives", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn<BoardLintFetch>((_url, init) => {
      signals.push(init.signal);
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
        // Never resolve unless aborted — second call will resolve below.
        if (signals.length === 2) {
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ diagnostics: [] }),
          });
        }
      });
    });
    const source = createBoardLintSource({ fetchImpl });
    const first = source(fakeView("abc") as never);
    const second = source(fakeView("abcd") as never);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    expect(signals[0].aborted).toBe(true);
  });
});
