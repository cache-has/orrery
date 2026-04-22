import { describe, it, expect } from "vitest";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import type { Tree } from "@lezer/common";
import { boardLanguageData } from "../../../src/editor-client/language/board-language.js";

function parse(src: string): Tree {
  return boardLanguageData.parser.parse(src);
}

// Map Lezer highlight tags to plain strings so tests assert on names rather
// than opaque tag identities. Mirrors how CodeMirror themes bind classes.
const highlighter = tagHighlighter([
  { tag: t.keyword, class: "keyword" },
  { tag: t.typeName, class: "type" },
  { tag: t.atom, class: "atom" },
  { tag: t.propertyName, class: "property" },
  { tag: t.bool, class: "bool" },
  { tag: t.string, class: "string" },
  { tag: t.number, class: "number" },
  { tag: t.lineComment, class: "comment" },
  { tag: t.brace, class: "brace" },
  { tag: t.paren, class: "paren" },
  { tag: t.punctuation, class: "punct" },
  { tag: t.operator, class: "op" },
]);

function tagOfSpan(src: string, from: number, to: number): string | null {
  const tree = parse(src);
  let found: string | null = null;
  highlightTree(tree, highlighter, (start, end, cls) => {
    if (start <= from && end >= to) found = cls;
  });
  return found;
}

describe("boardLanguage grammar", () => {
  it("parses a minimal dashboard without error nodes", () => {
    const src = `dashboard "Hi" {\n  param x = select(options: ["a"], default: "a")\n}`;
    const tree = parse(src);
    // Walk the tree and fail if we encounter an error node (Lezer names them "⚠").
    tree.iterate({
      enter(node) {
        if (node.type.isError) {
          throw new Error(`error node at ${node.from}..${node.to}`);
        }
      },
    });
  });

  it("tags top-level keywords as keyword", () => {
    const src = `dashboard "t" { }`;
    expect(tagOfSpan(src, 0, "dashboard".length)).toBe("keyword");
  });

  it("tags component types as typeName", () => {
    const src = `metric "x" (span: 3) { }`;
    expect(tagOfSpan(src, 0, "metric".length)).toBe("type");
  });

  it("tags strings (single and triple quoted)", () => {
    const src1 = `"hello"`;
    expect(tagOfSpan(src1, 0, src1.length)).toBe("string");

    const src2 = `"""multi\nline"""`;
    expect(tagOfSpan(src2, 0, src2.length)).toBe("string");
  });

  it("tags numbers, booleans, and comments", () => {
    expect(tagOfSpan(`42`, 0, 2)).toBe("number");
    expect(tagOfSpan(`3.14`, 0, 4)).toBe("number");
    expect(tagOfSpan(`true`, 0, 4)).toBe("bool");
    expect(tagOfSpan(`# a comment`, 0, 11)).toBe("comment");
  });

  it("tags header options and format names distinctly", () => {
    // Header option: property-like
    expect(tagOfSpan(`span`, 0, 4)).toBe("property");
    // Format names render as atoms (e.g. after `format:`)
    expect(tagOfSpan(`currency`, 0, 8)).toBe("atom");
  });

  it("exposes parser-recognized chart types", () => {
    for (const ct of ["line", "bar", "area", "donut", "pie", "scatter", "heatmap", "funnel", "gauge"]) {
      expect(tagOfSpan(ct, 0, ct.length)).toBe("type");
    }
  });

  it("parses a representative slice of a real dashboard", () => {
    const src = `# SaaS Metrics
dashboard "SaaS" {
  connection: "app_db"
  param plan = select(options: ["All", "Pro"], default: "All")
  row {
    metric "MRR" (span: 3) {
      query: """
        SELECT SUM(amount) FROM subs WHERE ({{plan}} = 'All' OR plan = {{plan}})
      """
      format: currency
      prefix: "$"
    }
    chart "Signups" (span: 9, type: line) {
      query: "SELECT day, count(*) FROM events GROUP BY 1"
      x: "day"
      y: "count"
    }
  }
}`;
    const tree = parse(src);
    let errors = 0;
    tree.iterate({
      enter(node) {
        if (node.type.isError) errors++;
      },
    });
    expect(errors).toBe(0);
  });
});
