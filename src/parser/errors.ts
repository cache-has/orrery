import type { Position, Span } from "./ast.js";

export class ParseError extends Error {
  public readonly span: Span;
  public readonly hint?: string;

  constructor(message: string, span: Span, hint?: string) {
    super(message);
    this.name = "ParseError";
    this.span = span;
    this.hint = hint;
  }

  format(source: string, filePath?: string): string {
    const lines = source.split("\n");
    const { start } = this.span;
    const lineNum = start.line;
    const lineText = lines[lineNum - 1] ?? "";
    const file = filePath ?? this.span.file ?? "<input>";

    let output = `\n  error: ${this.message}\n`;
    output += `   --> ${file}:${lineNum}:${start.column}\n`;
    output += `    |\n`;
    output += `  ${String(lineNum).padStart(3)} | ${lineText}\n`;
    output += `    | ${" ".repeat(start.column - 1)}^\n`;
    if (this.hint) {
      output += `    = hint: ${this.hint}\n`;
    }
    return output;
  }
}

export function createPosition(line: number, column: number, offset: number): Position {
  return { line, column, offset };
}

export function createSpan(start: Position, end: Position, file?: string): Span {
  return { start, end, file };
}
