/**
 * AST node types for the OpenBoard DSL.
 *
 * These types represent the parsed structure of a .board file.
 * The parser produces a DashboardNode as the root of the tree.
 */

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface Span {
  start: Position;
  end: Position;
  file?: string;
}

// --- Value types ---

export type ValueNode =
  | StringValue
  | NumberValue
  | BooleanValue
  | IdentValue
  | FileRefValue
  | ArrayValue;

export interface StringValue {
  kind: "string";
  value: string;
  span: Span;
}

export interface NumberValue {
  kind: "number";
  value: number;
  span: Span;
}

export interface BooleanValue {
  kind: "boolean";
  value: boolean;
  span: Span;
}

export interface IdentValue {
  kind: "ident";
  name: string;
  span: Span;
}

export interface FileRefValue {
  kind: "file_ref";
  path: string;
  span: Span;
}

export interface ArrayValue {
  kind: "array";
  elements: ValueNode[];
  span: Span;
}

// --- Properties ---

export interface PropertyNode {
  kind: "property";
  key: string;
  value: ValueNode;
  span: Span;
}

// --- Parameters ---

export type ParamType = "daterange" | "select" | "text" | "number";

export interface ParamNode {
  kind: "param";
  name: string;
  paramType: ParamType;
  options: PropertyNode[];
  span: Span;
}

// --- Visibility expression ---

export type CompOp = "==" | "!=" | "<" | ">" | "<=" | ">=";

export interface VisibilityExpr {
  kind: "visibility";
  left: string;
  op: CompOp;
  right: ValueNode;
  span: Span;
}

// --- Components ---

export type ComponentType = "metric" | "chart" | "table" | "text";

export interface ComponentOpts {
  span?: number;
  type?: string;
  visible?: VisibilityExpr;
  connection?: string;
  [key: string]: unknown;
}

export interface ColumnDef {
  kind: "column_def";
  name: string;
  properties: PropertyNode[];
  span: Span;
}

export interface ColumnsBlock {
  kind: "columns_block";
  columns: ColumnDef[];
  span: Span;
}

export interface ComponentNode {
  kind: "component";
  componentType: ComponentType;
  title?: string;
  opts: ComponentOpts;
  properties: PropertyNode[];
  columns?: ColumnsBlock;
  markdownContent?: string;
  span: Span;
}

// --- Layout ---

export interface RowNode {
  kind: "row";
  components: ComponentNode[];
  span: Span;
}

// --- Includes ---

export interface IncludeNode {
  kind: "include";
  path: string;
  span: Span;
}

// --- Dashboard ---

export type DashboardItem = ParamNode | RowNode | ComponentNode | IncludeNode | PropertyNode;

export interface DashboardNode {
  kind: "dashboard";
  title: string;
  items: DashboardItem[];
  span: Span;
}
