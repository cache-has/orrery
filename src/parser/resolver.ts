/**
 * AST resolver: processes `include` directives and `file()` references.
 *
 * - `include "path.board"` reads the file, parses it as partial items,
 *   and splices them into the parent dashboard's items array.
 * - `file("path.sql")` reads the file and replaces the file_ref node
 *   with a string value containing the file contents.
 *
 * Paths are resolved relative to the directory of the file that
 * contains the directive.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { parsePartial } from "./parser.js";
import type {
  DashboardNode,
  DashboardItem,
  ComponentNode,
  RowNode,
  PropertyNode,
  StringValue,
} from "./ast.js";

/**
 * Resolve all `include` directives and `file()` references in a dashboard AST.
 * Mutates nothing — returns a new DashboardNode with resolved items.
 *
 * @param dashboard - Parsed dashboard AST
 * @param boardFilePath - Absolute path to the .board file (for relative path resolution)
 */
export function resolveIncludes(
  dashboard: DashboardNode,
  boardFilePath: string,
): DashboardNode {
  const baseDir = dirname(boardFilePath);
  const seen = new Set<string>(); // guard against circular includes
  seen.add(boardFilePath);

  const resolvedItems = resolveItems(dashboard.items, baseDir, seen);
  return { ...dashboard, items: resolvedItems };
}

function resolveItems(
  items: DashboardItem[],
  baseDir: string,
  seen: Set<string>,
): DashboardItem[] {
  const result: DashboardItem[] = [];

  for (const item of items) {
    if (item.kind === "include") {
      const includePath = resolve(baseDir, item.path);

      if (!existsSync(includePath)) {
        console.warn(`Warning: Include file not found: ${item.path} (resolved to ${includePath})`);
        continue;
      }

      if (seen.has(includePath)) {
        console.warn(`Warning: Circular include detected: ${item.path}`);
        continue;
      }

      seen.add(includePath);

      try {
        const source = readFileSync(includePath, "utf-8");
        const includeDir = dirname(includePath);
        const parsedItems = parsePartial(source, includePath);
        // Recursively resolve any nested includes
        const resolved = resolveItems(parsedItems, includeDir, seen);
        result.push(...resolved);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: Failed to parse include file ${item.path}: ${msg}`);
      }
    } else if (item.kind === "row") {
      result.push(resolveRow(item, baseDir));
    } else if (item.kind === "component") {
      result.push(resolveComponent(item, baseDir));
    } else {
      result.push(item);
    }
  }

  return result;
}

function resolveRow(row: RowNode, baseDir: string): RowNode {
  return {
    ...row,
    components: row.components.map((c) => resolveComponent(c, baseDir)),
  };
}

function resolveComponent(component: ComponentNode, baseDir: string): ComponentNode {
  const resolvedProps = component.properties.map((prop) =>
    resolveProperty(prop, baseDir),
  );
  return { ...component, properties: resolvedProps };
}

function resolveProperty(prop: PropertyNode, baseDir: string): PropertyNode {
  if (prop.value.kind === "file_ref") {
    const filePath = resolve(baseDir, prop.value.path);

    if (!existsSync(filePath)) {
      console.warn(`Warning: Referenced file not found: ${prop.value.path} (resolved to ${filePath})`);
      return prop;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const stringValue: StringValue = {
        kind: "string",
        value: content,
        span: prop.value.span,
      };
      return { ...prop, value: stringValue };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Failed to read file ${prop.value.path}: ${msg}`);
      return prop;
    }
  }
  return prop;
}
