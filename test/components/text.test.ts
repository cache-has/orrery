import { describe, it, expect } from "vitest";
import { textRenderer } from "../../src/components/text.js";
import type { ComponentNode, Span } from "../../src/parser/ast.js";
import type { ComponentRenderData } from "../../src/components/types.js";

const span: Span = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function makeText(markdown?: string, title?: string): ComponentNode {
  return {
    kind: "component",
    componentType: "text",
    title,
    opts: {},
    properties: [],
    markdownContent: markdown,
    span,
  };
}

describe("textRenderer", () => {
  it("renders basic markdown paragraphs", () => {
    const component = makeText("Hello world");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("orrery-text");
    expect(html).toContain("<p>Hello world</p>");
  });

  it("renders headings", () => {
    const component = makeText("## Revenue Notes\n\nSome text");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("<h2>Revenue Notes</h2>");
    expect(html).toContain("<p>Some text</p>");
  });

  it("renders bold and italic", () => {
    const component = makeText("**bold** and *italic* text");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders inline code", () => {
    const component = makeText("Use `warehouse.orders` table");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("<code>warehouse.orders</code>");
  });

  it("renders lists", () => {
    const component = makeText("- Item one\n- Item two\n- Item three");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item one</li>");
    expect(html).toContain("<li>Item three</li>");
  });

  it("renders blockquotes", () => {
    const component = makeText("> Important note here");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("<blockquote>");
    expect(html).toContain("Important note here");
  });

  it("renders links", () => {
    const component = makeText("[Orrery](https://example.com)");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("Orrery</a>");
  });

  it("renders code blocks", () => {
    const component = makeText("```\nSELECT * FROM orders\n```");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("<pre>");
    expect(html).toContain("<code>");
    expect(html).toContain("SELECT * FROM orders");
  });

  it("interpolates simple parameter values", () => {
    const component = makeText("Current region: {{region}}");
    const data: ComponentRenderData = {
      paramValues: { region: "US-East" },
    };
    const html = textRenderer.renderToString(component, data);

    expect(html).toContain("Current region: US-East");
    expect(html).not.toContain("{{region}}");
  });

  it("interpolates dotted parameter values", () => {
    const component = makeText("From {{date_range.start}} to {{date_range.end}}");
    const data: ComponentRenderData = {
      paramValues: { date_range: { start: "2024-01-01", end: "2024-12-31" } },
    };
    const html = textRenderer.renderToString(component, data);

    expect(html).toContain("2024-01-01");
    expect(html).toContain("2024-12-31");
  });

  it("leaves unresolved parameters as literal text", () => {
    const component = makeText("Value: {{unknown_param}}");
    const data: ComponentRenderData = { paramValues: {} };
    const html = textRenderer.renderToString(component, data);

    expect(html).toContain("{{unknown_param}}");
  });

  it("escapes HTML in parameter values to prevent XSS", () => {
    const component = makeText("Input: {{user_input}}");
    const data: ComponentRenderData = {
      paramValues: { user_input: '<script>alert("xss")</script>' },
    };
    const html = textRenderer.renderToString(component, data);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders empty state when markdownContent is missing", () => {
    const component = makeText(undefined);
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("orrery-text-empty");
    expect(html).toContain("Empty text block");
  });

  it("renders without paramValues (no interpolation needed)", () => {
    const component = makeText("Plain text with no params");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("Plain text with no params");
  });

  it("handles horizontal rules", () => {
    const component = makeText("Above\n\n---\n\nBelow");
    const html = textRenderer.renderToString(component, {});

    expect(html).toContain("<hr");
  });
});
