import type { DashboardNode } from "./ast.js";
import { Lexer } from "./lexer.js";

/**
 * Parse a .board file source string into a DashboardNode AST.
 *
 * This is a stub that will be fully implemented in phase 03 (DSL Parser).
 * Currently only tokenizes the input to validate lexer integration.
 */
export function parse(source: string, file?: string): DashboardNode {
  const lexer = new Lexer(source, file);
  const _tokens = lexer.tokenize();

  // TODO: Implement recursive descent parser in phase 03
  throw new Error("Parser not yet implemented — see planning/03-dsl-parser.md");
}
