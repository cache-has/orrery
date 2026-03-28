import type {
  ArrayValue,
  ColumnDef,
  ColumnsBlock,
  CompOp,
  ComponentNode,
  ComponentOpts,
  ComponentType,
  DashboardItem,
  DashboardNode,
  FileRefValue,
  IncludeNode,
  ParamNode,
  ParamType,
  PropertyNode,
  RowNode,
  Span,
  ValueNode,
  VisibilityExpr,
} from "./ast.js";
import { ParseError, createSpan } from "./errors.js";
import { Lexer, type Token, type TokenType } from "./lexer.js";

const COMPONENT_TYPES = new Set(["metric", "chart", "table", "text"]);
const PARAM_TYPES = new Set(["daterange", "select", "text", "number"]);
const COMP_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);

/**
 * Parse a .board file source string into a DashboardNode AST.
 */
export function parse(source: string, file?: string): DashboardNode {
  const parser = new Parser(source, file);
  return parser.parse();
}

class Parser {
  private lexer: Lexer;
  private current: Token;
  private source: string;
  private file?: string;

  constructor(source: string, file?: string) {
    this.source = source;
    this.file = file;
    this.lexer = new Lexer(source, file);
    this.current = this.lexer.nextToken();
  }

  parse(): DashboardNode {
    return this.parseDashboard();
  }

  // --- Grammar productions ---

  /** Dashboard := 'dashboard' STRING '{' DashboardItem* '}' */
  private parseDashboard(): DashboardNode {
    const start = this.current.span;
    this.expectIdent("dashboard", "Expected 'dashboard' keyword");
    const title = this.expect("string", "Expected dashboard title string").value;
    this.expect("lbrace", "Expected '{' after dashboard title");

    const items: DashboardItem[] = [];
    while (!this.check("rbrace") && !this.check("eof")) {
      items.push(this.parseDashboardItem());
    }

    const end = this.expect("rbrace", "Expected '}' to close dashboard block").span;

    return {
      kind: "dashboard",
      title,
      items,
      span: createSpan(start.start, end.end, this.file),
    };
  }

  /**
   * DashboardItem := Param | Row | Component | Include | Property
   *
   * Dispatch by leading token:
   *   'param'   → Param
   *   'row'     → Row
   *   'include' → Include
   *   component keyword → Component (top-level, outside row)
   *   IDENT ':'  → Property
   */
  private parseDashboardItem(): DashboardItem {
    const tok = this.current;

    if (tok.type === "ident") {
      if (tok.value === "param") return this.parseParam();
      if (tok.value === "row") return this.parseRow();
      if (tok.value === "include") return this.parseInclude();
      if (COMPONENT_TYPES.has(tok.value)) {
        return this.parseComponent(tok.value as ComponentType);
      }

      // Must be a property (IDENT ':' Value)
      return this.parseProperty();
    }

    throw this.error(`Unexpected token '${tok.value || tok.type}'`, tok.span, "Expected a dashboard item: param, row, include, a component, or a property");
  }

  /** Param := 'param' IDENT '=' ParamType '(' ParamOpts? ')' */
  private parseParam(): ParamNode {
    const start = this.current.span;
    this.expectIdent("param");
    const name = this.expect("ident", "Expected parameter name").value;
    this.expect("equals", "Expected '=' after parameter name");

    const typeTok = this.expect("ident", "Expected parameter type (daterange, select, text, number)");
    if (!PARAM_TYPES.has(typeTok.value)) {
      throw this.error(
        `Unknown parameter type '${typeTok.value}'`,
        typeTok.span,
        `Valid parameter types are: ${[...PARAM_TYPES].join(", ")}`,
      );
    }
    const paramType = typeTok.value as ParamType;

    this.expect("lparen", "Expected '(' after parameter type");
    const options: PropertyNode[] = [];
    while (!this.check("rparen") && !this.check("eof")) {
      options.push(this.parseProperty());
      // Optional comma separator
      if (this.check("comma")) this.advance();
    }
    const end = this.expect("rparen", "Expected ')' to close parameter options").span;

    return {
      kind: "param",
      name,
      paramType,
      options,
      span: createSpan(start.start, end.end, this.file),
    };
  }

  /** Row := 'row' '{' Component+ '}' */
  private parseRow(): RowNode {
    const start = this.current.span;
    this.expectIdent("row");
    this.expect("lbrace", "Expected '{' after 'row'");

    const components: ComponentNode[] = [];
    while (!this.check("rbrace") && !this.check("eof")) {
      const tok = this.current;
      if (tok.type === "ident" && COMPONENT_TYPES.has(tok.value)) {
        components.push(this.parseComponent(tok.value as ComponentType));
      } else {
        throw this.error(
          `Unexpected token '${tok.value || tok.type}' inside row`,
          tok.span,
          "Rows can only contain components: metric, chart, table, text",
        );
      }
    }

    const end = this.expect("rbrace", "Expected '}' to close row block").span;

    return {
      kind: "row",
      components,
      span: createSpan(start.start, end.end, this.file),
    };
  }

  /**
   * Component := ComponentType STRING? ComponentOpts? '{' ComponentBody '}'
   * ComponentBody := (Property | ColumnsBlock | MarkdownContent)*
   */
  private parseComponent(componentType: ComponentType): ComponentNode {
    const start = this.current.span;
    this.advance(); // consume the component type keyword

    // Optional title string
    let title: string | undefined;
    if (this.check("string")) {
      title = this.current.value;
      this.advance();
    }

    // Optional opts: (span: 4, type: line, visible: ...)
    let opts: ComponentOpts = {};
    if (this.check("lparen")) {
      opts = this.parseComponentOpts();
    }

    // Text blocks use raw markdown content — we must NOT advance the lexer
    // past '{' because that would try to tokenize markdown as DSL tokens.
    if (componentType === "text") {
      if (!this.check("lbrace")) {
        throw this.error(`Expected '{' to open ${componentType} body`, this.current.span);
      }
      // Lexer position is already past '{'. Read raw until matching '}'.
      const raw = this.lexer.readRawUntilCloseBrace();
      // Sync parser state — next token from lexer should be '}'
      this.current = this.lexer.nextToken();
      const end = this.expect("rbrace", "Expected '}' to close text block").span;
      return {
        kind: "component",
        componentType,
        title,
        opts,
        properties: [],
        markdownContent: raw.content,
        span: createSpan(start.start, end.end, this.file),
      };
    }

    // Non-text components: parse '{' normally, then properties/columns
    this.expect("lbrace", `Expected '{' to open ${componentType} body`);
    const properties: PropertyNode[] = [];
    let columns: ColumnsBlock | undefined;

    while (!this.check("rbrace") && !this.check("eof")) {
      if (this.current.type === "ident" && this.current.value === "columns") {
        columns = this.parseColumnsBlock();
      } else {
        properties.push(this.parseProperty());
      }
    }

    const end = this.expect("rbrace", `Expected '}' to close ${componentType} block`).span;

    return {
      kind: "component",
      componentType,
      title,
      opts,
      properties,
      columns,
      span: createSpan(start.start, end.end, this.file),
    };
  }

  /** ComponentOpts := '(' OptPair (',' OptPair)* ')' */
  private parseComponentOpts(): ComponentOpts {
    this.expect("lparen");
    const opts: ComponentOpts = {};

    while (!this.check("rparen") && !this.check("eof")) {
      const key = this.expect("ident", "Expected option name").value;
      this.expect("colon", `Expected ':' after option '${key}'`);

      if (key === "visible") {
        opts.visible = this.parseVisibilityExpr();
      } else if (key === "span") {
        const val = this.parseValue();
        if (val.kind === "number") {
          opts.span = val.value;
        } else {
          throw this.error("'span' must be a number", val.span);
        }
      } else if (key === "type") {
        const val = this.parseValue();
        if (val.kind === "ident") {
          opts.type = val.name;
        } else if (val.kind === "string") {
          opts.type = val.value;
        } else {
          throw this.error("'type' must be an identifier or string", val.span);
        }
      } else if (key === "connection") {
        const val = this.parseValue();
        if (val.kind === "string") {
          opts.connection = val.value;
        } else {
          throw this.error("'connection' must be a string", val.span);
        }
      } else {
        // Store unknown opts as-is
        const val = this.parseValue();
        opts[key] = val.kind === "string" ? val.value : val.kind === "number" ? val.value : val.kind === "boolean" ? val.value : val;
      }

      if (this.check("comma")) this.advance();
    }

    this.expect("rparen", "Expected ')' to close component options");
    return opts;
  }

  /** VisibilityExpr := IDENT CompOp Value */
  private parseVisibilityExpr(): VisibilityExpr {
    const leftTok = this.expect("ident", "Expected parameter name in visibility expression");
    const opTok = this.current;

    const opValue = opTok.value;
    if (!COMP_OPS.has(opValue)) {
      throw this.error(
        `Expected comparison operator, got '${opValue}'`,
        opTok.span,
        "Valid operators: ==, !=, <, >, <=, >=",
      );
    }
    this.advance(); // consume operator

    const right = this.parseValue();

    return {
      kind: "visibility",
      left: leftTok.value,
      op: opValue as CompOp,
      right,
      span: createSpan(leftTok.span.start, right.span.end, this.file),
    };
  }

  /** Property := IDENT ':' Value */
  private parseProperty(): PropertyNode {
    const keyTok = this.expect("ident", "Expected property name");
    this.expect("colon", `Expected ':' after property '${keyTok.value}'`);
    const value = this.parseValue();

    return {
      kind: "property",
      key: keyTok.value,
      value,
      span: createSpan(keyTok.span.start, value.span.end, this.file),
    };
  }

  /**
   * Value := STRING | NUMBER | BOOLEAN | FileRef | Array | IDENT
   * FileRef := 'file' '(' STRING ')'
   */
  private parseValue(): ValueNode {
    const tok = this.current;

    if (tok.type === "string") {
      this.advance();
      return { kind: "string", value: tok.value, span: tok.span };
    }

    if (tok.type === "number") {
      this.advance();
      return { kind: "number", value: Number(tok.value), span: tok.span };
    }

    if (tok.type === "boolean") {
      this.advance();
      return { kind: "boolean", value: tok.value === "true", span: tok.span };
    }

    if (tok.type === "lbracket") {
      return this.parseArray();
    }

    if (tok.type === "ident") {
      // file("path") reference
      if (tok.value === "file") {
        return this.parseFileRef();
      }
      // Plain identifier value
      this.advance();
      return { kind: "ident", name: tok.value, span: tok.span };
    }

    throw this.error(
      `Expected a value, got '${tok.value || tok.type}'`,
      tok.span,
      "Values can be strings, numbers, booleans, identifiers, arrays, or file() references",
    );
  }

  /** Array := '[' (Value (',' Value)*)? ']' */
  private parseArray(): ArrayValue {
    const start = this.expect("lbracket").span;
    const elements: ValueNode[] = [];

    while (!this.check("rbracket") && !this.check("eof")) {
      elements.push(this.parseValue());
      if (this.check("comma")) this.advance();
    }

    const end = this.expect("rbracket", "Expected ']' to close array").span;

    return {
      kind: "array",
      elements,
      span: createSpan(start.start, end.end, this.file),
    };
  }

  /** FileRef := 'file' '(' STRING ')' */
  private parseFileRef(): FileRefValue {
    const start = this.current.span;
    this.expectIdent("file");
    this.expect("lparen", "Expected '(' after 'file'");
    const path = this.expect("string", "Expected file path string").value;
    const end = this.expect("rparen", "Expected ')' to close file() reference").span;

    return {
      kind: "file_ref",
      path,
      span: createSpan(start.start, end.end, this.file),
    };
  }

  /** ColumnsBlock := 'columns' '{' ColumnDef+ '}' */
  private parseColumnsBlock(): ColumnsBlock {
    const start = this.current.span;
    this.expectIdent("columns");
    this.expect("lbrace", "Expected '{' after 'columns'");

    const columns: ColumnDef[] = [];
    while (!this.check("rbrace") && !this.check("eof")) {
      columns.push(this.parseColumnDef());
    }

    const end = this.expect("rbrace", "Expected '}' to close columns block").span;

    return {
      kind: "columns_block",
      columns,
      span: createSpan(start.start, end.end, this.file),
    };
  }

  /** ColumnDef := IDENT '{' Property+ '}' */
  private parseColumnDef(): ColumnDef {
    const nameTok = this.expect("ident", "Expected column name");
    this.expect("lbrace", `Expected '{' after column name '${nameTok.value}'`);

    const properties: PropertyNode[] = [];
    while (!this.check("rbrace") && !this.check("eof")) {
      properties.push(this.parseProperty());
      if (this.check("comma")) this.advance();
    }

    const end = this.expect("rbrace", "Expected '}' to close column definition").span;

    return {
      kind: "column_def",
      name: nameTok.value,
      properties,
      span: createSpan(nameTok.span.start, end.end, this.file),
    };
  }

  /** Include := 'include' STRING */
  private parseInclude(): IncludeNode {
    const start = this.current.span;
    this.expectIdent("include");
    const pathTok = this.expect("string", "Expected file path after 'include'");

    return {
      kind: "include",
      path: pathTok.value,
      span: createSpan(start.start, pathTok.span.end, this.file),
    };
  }

  // --- Token helpers ---

  private advance(): Token {
    const prev = this.current;
    this.current = this.lexer.nextToken();
    return prev;
  }

  private check(type: TokenType): boolean {
    return this.current.type === type;
  }

  private expect(type: TokenType, message?: string): Token {
    if (this.current.type === type) {
      return this.advance();
    }
    throw this.error(
      message ?? `Expected ${type}, got '${this.current.value || this.current.type}'`,
      this.current.span,
    );
  }

  private expectIdent(value: string, message?: string): Token {
    if (this.current.type === "ident" && this.current.value === value) {
      return this.advance();
    }
    throw this.error(
      message ?? `Expected '${value}', got '${this.current.value || this.current.type}'`,
      this.current.span,
    );
  }

  private error(message: string, span: Span, hint?: string): ParseError {
    return new ParseError(message, span, hint);
  }
}
