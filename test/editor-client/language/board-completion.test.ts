import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  detectIntent,
  createBoardCompletionSource,
} from "../../../src/editor-client/language/board-completion.js";

function intentAt(src: string): ReturnType<typeof detectIntent> {
  const idx = src.indexOf("|");
  const doc = idx >= 0 ? src.slice(0, idx) + src.slice(idx + 1) : src;
  const cursor = idx >= 0 ? idx : doc.length;
  return detectIntent(doc.slice(0, cursor));
}

async function run(
  src: string,
  opts: Parameters<typeof createBoardCompletionSource>[0] = {},
  explicit = true,
) {
  const idx = src.indexOf("|");
  const doc = idx >= 0 ? src.slice(0, idx) + src.slice(idx + 1) : src;
  const pos = idx >= 0 ? idx : doc.length;
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, pos, explicit);
  const src2 = createBoardCompletionSource(opts);
  const res = await src2(ctx);
  return res;
}

describe("detectIntent", () => {
  it("top-level between statements", () => {
    expect(intentAt(`dash|`).kind).toBe("top-level");
    expect(intentAt(`dashboard "x" { }\nme|`).kind).toBe("top-level");
  });

  it("param type after `=`", () => {
    expect(intentAt(`param region = |`).kind).toBe("param-type");
    expect(intentAt(`param region = se|`).kind).toBe("param-type");
  });

  it("header option inside `(...)`", () => {
    expect(intentAt(`chart "a" (|)`).kind).toBe("header-option");
    expect(intentAt(`chart "a" (span: 6, |)`).kind).toBe("header-option");
  });

  it("chart type after `type:`", () => {
    expect(intentAt(`chart "a" (span: 6, type: |)`).kind).toBe("chart-type");
    expect(intentAt(`chart "a" (type: li|)`).kind).toBe("chart-type");
  });

  it("connection value after `connection:`", () => {
    expect(intentAt(`dashboard "a" {\n  connection: |\n}`).kind).toBe("connection-value");
  });

  it("format value after `format:`", () => {
    expect(intentAt(`metric "x" { format: |`).kind).toBe("format-value");
  });

  it("component property inside chart body", () => {
    const i = intentAt(`chart "a" (span: 6) {\n  qu|\n}`);
    expect(i.kind).toBe("component-property");
    expect(i.componentType).toBe("chart");
  });

  it("metric properties differ from chart properties", () => {
    const i = intentAt(`metric "x" {\n  pre|\n}`);
    expect(i.kind).toBe("component-property");
    expect(i.componentType).toBe("metric");
  });

  it("ignores keywords inside string literals", () => {
    // Cursor is after a comment; should be top-level, not confused by the
    // `type:` that sits inside the quoted string.
    const i = intentAt(`metric "x" {\n  query: "SELECT type: foo"\n  |\n}`);
    expect(i.kind).toBe("component-property");
    expect(i.componentType).toBe("metric");
  });

  it("ignores text inside comments", () => {
    const i = intentAt(`# type: line\n|`);
    expect(i.kind).toBe("top-level");
  });

  it("ignores text inside triple-quoted strings", () => {
    const src = `metric "x" {\n  query: """\n    SELECT 1\n  """\n  |\n}`;
    const i = intentAt(src);
    expect(i.kind).toBe("component-property");
    expect(i.componentType).toBe("metric");
  });
});

describe("createBoardCompletionSource", () => {
  it("returns top-level keywords at the start of a document", async () => {
    const res = await run(`dash|`);
    expect(res).not.toBeNull();
    const labels = res!.options.map((o) => o.label);
    expect(labels).toContain("dashboard");
    expect(labels).toContain("chart");
  });

  it("returns chart types after `type:`", async () => {
    const res = await run(`chart "a" (type: |)`);
    const labels = res!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["line", "bar", "area", "gauge"]));
  });

  it("returns chart body property names", async () => {
    const res = await run(`chart "a" (span: 6) {\n  |\n}`);
    const labels = res!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["query", "x", "y", "stacked"]));
  });

  it("returns metric properties (not chart) inside metric body", async () => {
    const res = await run(`metric "x" {\n  |\n}`);
    const labels = res!.options.map((o) => o.label);
    expect(labels).toContain("prefix");
    expect(labels).not.toContain("stacked");
  });

  it("suggests connection names from the injected fetcher", async () => {
    const res = await run(
      `dashboard "a" {\n  connection: |\n}`,
      { fetchConnections: async () => ["app_db", "warehouse"] },
    );
    expect(res).not.toBeNull();
    const labels = res!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining([`"app_db"`, `"warehouse"`]));
  });

  it("caches connection fetcher results across invocations", async () => {
    let calls = 0;
    const opts = {
      fetchConnections: async () => {
        calls++;
        return ["db1"];
      },
    };
    await run(`dashboard "a" { connection: |`, opts);
    await run(`dashboard "b" { connection: |`, opts);
    // The source is re-created each call in this test harness — but within
    // a single source's life it must cache. Use one source:
    const src = createBoardCompletionSource(opts);
    const mk = (doc: string) => {
      const state = EditorState.create({ doc });
      return new CompletionContext(state, doc.length, true);
    };
    await src(mk(`dashboard "a" { connection: `));
    await src(mk(`dashboard "a" { connection: `));
    // Two outer calls (new source each) + two inner calls (same source) = 3
    expect(calls).toBe(3);
  });

  it("returns null when no completions apply and not explicit", async () => {
    const res = await run(`dashboard "x" { }\n`, {}, false);
    expect(res).toBeNull();
  });
});
