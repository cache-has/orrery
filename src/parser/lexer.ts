import type { Position, Span } from "./ast.js";
import { ParseError, createPosition, createSpan } from "./errors.js";

export type TokenType =
  | "string"
  | "number"
  | "boolean"
  | "ident"
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "colon"
  | "comma"
  | "equals"
  | "eq"
  | "neq"
  | "lt"
  | "gt"
  | "lte"
  | "gte"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  span: Span;
}

export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private file?: string;

  constructor(source: string, file?: string) {
    this.source = source;
    this.file = file;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;

      const token = this.readToken();
      tokens.push(token);
    }

    tokens.push({
      type: "eof",
      value: "",
      span: this.spanHere(),
    });

    return tokens;
  }

  private readToken(): Token {
    const ch = this.source[this.pos];
    const start = this.currentPosition();

    // Triple-quoted string
    if (ch === '"' && this.source.slice(this.pos, this.pos + 3) === '"""') {
      return this.readTripleQuotedString(start);
    }

    // Single-quoted string
    if (ch === '"') {
      return this.readString(start);
    }

    // Number
    if (ch >= "0" && ch <= "9") {
      return this.readNumber(start);
    }

    // Identifier or keyword
    if (this.isIdentStart(ch)) {
      return this.readIdentOrKeyword(start);
    }

    // Single-character tokens
    const singleTokens: Record<string, TokenType> = {
      "{": "lbrace",
      "}": "rbrace",
      "(": "lparen",
      ")": "rparen",
      "[": "lbracket",
      "]": "rbracket",
      ":": "colon",
      ",": "comma",
    };

    if (ch in singleTokens) {
      this.advance();
      return {
        type: singleTokens[ch],
        value: ch,
        span: createSpan(start, this.currentPosition(), this.file),
      };
    }

    // Comparison operators
    if (ch === "=" && this.peek(1) === "=") {
      this.advance();
      this.advance();
      return {
        type: "eq",
        value: "==",
        span: createSpan(start, this.currentPosition(), this.file),
      };
    }

    if (ch === "=") {
      this.advance();
      return {
        type: "equals",
        value: "=",
        span: createSpan(start, this.currentPosition(), this.file),
      };
    }

    if (ch === "!" && this.peek(1) === "=") {
      this.advance();
      this.advance();
      return {
        type: "neq",
        value: "!=",
        span: createSpan(start, this.currentPosition(), this.file),
      };
    }

    if (ch === "<" && this.peek(1) === "=") {
      this.advance();
      this.advance();
      return {
        type: "lte",
        value: "<=",
        span: createSpan(start, this.currentPosition(), this.file),
      };
    }

    if (ch === "<") {
      this.advance();
      return { type: "lt", value: "<", span: createSpan(start, this.currentPosition(), this.file) };
    }

    if (ch === ">" && this.peek(1) === "=") {
      this.advance();
      this.advance();
      return {
        type: "gte",
        value: ">=",
        span: createSpan(start, this.currentPosition(), this.file),
      };
    }

    if (ch === ">") {
      this.advance();
      return { type: "gt", value: ">", span: createSpan(start, this.currentPosition(), this.file) };
    }

    throw new ParseError(
      `Unexpected character '${ch}'`,
      createSpan(start, this.currentPosition(), this.file),
    );
  }

  private readTripleQuotedString(start: Position): Token {
    this.pos += 3; // skip """
    this.column += 3;
    let value = "";

    while (this.pos < this.source.length) {
      if (this.source.slice(this.pos, this.pos + 3) === '"""') {
        this.pos += 3;
        this.column += 3;
        return {
          type: "string",
          value: value.trim(),
          span: createSpan(start, this.currentPosition(), this.file),
        };
      }
      if (this.source[this.pos] === "\n") {
        value += "\n";
        this.pos++;
        this.line++;
        this.column = 1;
      } else {
        value += this.source[this.pos];
        this.pos++;
        this.column++;
      }
    }

    throw new ParseError(
      "Unterminated triple-quoted string",
      createSpan(start, this.currentPosition(), this.file),
      'Triple-quoted strings must end with """',
    );
  }

  private readString(start: Position): Token {
    this.advance(); // skip opening "
    let value = "";

    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      if (this.source[this.pos] === "\n") {
        throw new ParseError(
          "Unterminated string",
          createSpan(start, this.currentPosition(), this.file),
          "Single-line strings cannot contain newlines. Use triple-quoted strings for multiline content.",
        );
      }
      if (this.source[this.pos] === "\\" && this.pos + 1 < this.source.length) {
        this.advance();
        const escaped = this.source[this.pos];
        switch (escaped) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case '"':
            value += '"';
            break;
          case "\\":
            value += "\\";
            break;
          default:
            value += "\\" + escaped;
        }
      } else {
        value += this.source[this.pos];
      }
      this.advance();
    }

    if (this.pos >= this.source.length) {
      throw new ParseError(
        "Unterminated string",
        createSpan(start, this.currentPosition(), this.file),
        'Strings must end with a closing "',
      );
    }

    this.advance(); // skip closing "
    return { type: "string", value, span: createSpan(start, this.currentPosition(), this.file) };
  }

  private readNumber(start: Position): Token {
    let value = "";
    while (
      this.pos < this.source.length &&
      this.source[this.pos] >= "0" &&
      this.source[this.pos] <= "9"
    ) {
      value += this.source[this.pos];
      this.advance();
    }
    if (this.pos < this.source.length && this.source[this.pos] === ".") {
      value += ".";
      this.advance();
      while (
        this.pos < this.source.length &&
        this.source[this.pos] >= "0" &&
        this.source[this.pos] <= "9"
      ) {
        value += this.source[this.pos];
        this.advance();
      }
    }
    return { type: "number", value, span: createSpan(start, this.currentPosition(), this.file) };
  }

  private readIdentOrKeyword(start: Position): Token {
    let value = "";
    while (this.pos < this.source.length && this.isIdentChar(this.source[this.pos])) {
      value += this.source[this.pos];
      this.advance();
    }

    if (value === "true" || value === "false") {
      return { type: "boolean", value, span: createSpan(start, this.currentPosition(), this.file) };
    }

    return { type: "ident", value, span: createSpan(start, this.currentPosition(), this.file) };
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
      } else if (ch === "\n") {
        this.pos++;
        this.line++;
        this.column = 1;
      } else if (ch === "#") {
        while (this.pos < this.source.length && this.source[this.pos] !== "\n") {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  private advance(): void {
    this.pos++;
    this.column++;
  }

  private peek(offset: number): string | undefined {
    return this.source[this.pos + offset];
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || (ch >= "0" && ch <= "9");
  }

  private currentPosition(): Position {
    return createPosition(this.line, this.column, this.pos);
  }

  private spanHere(): Span {
    const pos = this.currentPosition();
    return createSpan(pos, pos, this.file);
  }
}
