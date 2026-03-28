import { describe, it, expect } from "vitest";
import { Lexer } from "../../src/parser/lexer.js";
import { ParseError } from "../../src/parser/errors.js";

describe("Lexer", () => {
  it("tokenizes a simple dashboard declaration", () => {
    const tokens = new Lexer('dashboard "My Dashboard" {').tokenize();
    expect(tokens[0]).toMatchObject({ type: "ident", value: "dashboard" });
    expect(tokens[1]).toMatchObject({ type: "string", value: "My Dashboard" });
    expect(tokens[2]).toMatchObject({ type: "lbrace", value: "{" });
    expect(tokens[3]).toMatchObject({ type: "eof" });
  });

  it("tokenizes keywords and properties", () => {
    const tokens = new Lexer('connection: "my_db"').tokenize();
    expect(tokens.map((t) => t.type)).toEqual(["ident", "colon", "string", "eof"]);
  });

  it("tokenizes numbers", () => {
    const tokens = new Lexer("refresh: 300").tokenize();
    expect(tokens[2]).toMatchObject({ type: "number", value: "300" });
  });

  it("tokenizes decimal numbers", () => {
    const tokens = new Lexer("value: 3.14").tokenize();
    expect(tokens[2]).toMatchObject({ type: "number", value: "3.14" });
  });

  it("tokenizes booleans", () => {
    const tokens = new Lexer("sortable: true").tokenize();
    expect(tokens[2]).toMatchObject({ type: "boolean", value: "true" });
  });

  it("tokenizes triple-quoted strings", () => {
    const tokens = new Lexer('query: """SELECT 1"""').tokenize();
    expect(tokens[2]).toMatchObject({ type: "string", value: "SELECT 1" });
  });

  it("tokenizes multiline triple-quoted strings", () => {
    const input = `query: """\n  SELECT *\n  FROM users\n"""`;
    const tokens = new Lexer(input).tokenize();
    const queryToken = tokens.find((t) => t.type === "string" && t.value.includes("SELECT"));
    expect(queryToken).toBeDefined();
    expect(queryToken!.value).toContain("SELECT *");
    expect(queryToken!.value).toContain("FROM users");
  });

  it("tokenizes comparison operators", () => {
    const tests: [string, string][] = [
      ["==", "eq"],
      ["!=", "neq"],
      ["<", "lt"],
      [">", "gt"],
      ["<=", "lte"],
      [">=", "gte"],
    ];
    for (const [input, expectedType] of tests) {
      const tokens = new Lexer(`a ${input} b`).tokenize();
      expect(tokens[1].type).toBe(expectedType);
    }
  });

  it("tokenizes param declarations", () => {
    const tokens = new Lexer('param region = select(options: ["North", "South"])').tokenize();
    const types = tokens.map((t) => t.type);
    expect(types).toContain("ident");
    expect(types).toContain("equals");
    expect(types).toContain("lparen");
    expect(types).toContain("lbracket");
    expect(types).toContain("rbracket");
    expect(types).toContain("rparen");
  });

  it("skips line comments", () => {
    const tokens = new Lexer("# this is a comment\nrefresh: 60").tokenize();
    expect(tokens[0]).toMatchObject({ type: "ident", value: "refresh" });
  });

  it("tracks line and column positions", () => {
    const tokens = new Lexer("a\nb").tokenize();
    expect(tokens[0].span.start.line).toBe(1);
    expect(tokens[1].span.start.line).toBe(2);
  });

  it("throws on unterminated string", () => {
    expect(() => new Lexer('"hello').tokenize()).toThrow(ParseError);
  });

  it("throws on unexpected character", () => {
    expect(() => new Lexer("@").tokenize()).toThrow(ParseError);
  });

  it("tokenizes escape sequences in strings", () => {
    const tokens = new Lexer('"hello\\nworld"').tokenize();
    expect(tokens[0]).toMatchObject({ type: "string", value: "hello\nworld" });
  });

  it("tokenizes tab escape in strings", () => {
    const tokens = new Lexer('"col1\\tcol2"').tokenize();
    expect(tokens[0]).toMatchObject({ type: "string", value: "col1\tcol2" });
  });

  it("tokenizes escaped quote in strings", () => {
    const tokens = new Lexer('"say \\"hi\\""').tokenize();
    expect(tokens[0]).toMatchObject({ type: "string", value: 'say "hi"' });
  });

  it("tokenizes escaped backslash in strings", () => {
    const tokens = new Lexer('"path\\\\to"').tokenize();
    expect(tokens[0]).toMatchObject({ type: "string", value: "path\\to" });
  });

  it("passes through unknown escape sequences", () => {
    const tokens = new Lexer('"hello\\xworld"').tokenize();
    expect(tokens[0]).toMatchObject({ type: "string", value: "hello\\xworld" });
  });

  it("throws on unterminated triple-quoted string", () => {
    expect(() => new Lexer('"""hello').tokenize()).toThrow(ParseError);
  });

  it("throws on string with newline", () => {
    expect(() => new Lexer('"hello\nworld"').tokenize()).toThrow(ParseError);
  });

  it("handles carriage returns in whitespace", () => {
    const tokens = new Lexer("a\r\nb").tokenize();
    expect(tokens[0]).toMatchObject({ type: "ident", value: "a" });
    expect(tokens[1]).toMatchObject({ type: "ident", value: "b" });
  });

  it("tokenizes a complete fixture file", () => {
    const source = `dashboard "Test" {
  description: "A test"
  connection: "db"
  row {
    metric "Revenue" (span: 6) {
      query: "SELECT SUM(amount) FROM orders"
    }
  }
}`;
    const tokens = new Lexer(source).tokenize();
    expect(tokens.at(-1)!.type).toBe("eof");
    expect(tokens.length).toBeGreaterThan(10);
  });
});
