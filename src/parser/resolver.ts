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
import { posix as pathPosix } from "path";
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

/**
 * Async variant of {@link resolveIncludes} that reads included files and
 * `file()` references through a user-supplied reader. Used by source-backed
 * dashboards (S3/GCS) so remote `.board`/`.sql` siblings resolve correctly.
 *
 * `readFile` receives a path resolved relative to the file that referenced it
 * (by joining with {@link Path.resolve}). For remote sources, the caller is
 * responsible for mapping the absolute path back into the source's key space.
 */
export async function resolveIncludesAsync(
  dashboard: DashboardNode,
  boardFilePath: string,
  readFile: (path: string) => Promise<string>,
): Promise<DashboardNode> {
  const baseDir = pathPosix.dirname(boardFilePath.replace(/\\/g, "/"));
  const seen = new Set<string>();
  seen.add(boardFilePath);

  const resolvedItems = await resolveItemsAsync(dashboard.items, baseDir, seen, readFile);
  return { ...dashboard, items: resolvedItems };
}

async function resolveItemsAsync(
  items: DashboardItem[],
  baseDir: string,
  seen: Set<string>,
  readFile: (path: string) => Promise<string>,
): Promise<DashboardItem[]> {
  const result: DashboardItem[] = [];

  for (const item of items) {
    if (item.kind === "include") {
      const includePath = pathPosix.join(baseDir, item.path.replace(/\\/g, "/"));

      if (seen.has(includePath)) {
        console.warn(`Warning: Circular include detected: ${item.path}`);
        continue;
      }
      seen.add(includePath);

      try {
        const source = await readFile(includePath);
        const includeDir = pathPosix.dirname(includePath);
        const parsedItems = parsePartial(source, includePath);
        const resolved = await resolveItemsAsync(parsedItems, includeDir, seen, readFile);
        result.push(...resolved);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: Failed to read/parse include file ${item.path}: ${msg}`);
      }
    } else if (item.kind === "row") {
      result.push({
        ...item,
        components: await Promise.all(
          item.components.map((c) => resolveComponentAsync(c, baseDir, readFile)),
        ),
      });
    } else if (item.kind === "component") {
      result.push(await resolveComponentAsync(item, baseDir, readFile));
    } else {
      result.push(item);
    }
  }

  return result;
}

async function resolveComponentAsync(
  component: ComponentNode,
  baseDir: string,
  readFile: (path: string) => Promise<string>,
): Promise<ComponentNode> {
  const resolvedProps = await Promise.all(
    component.properties.map((prop) => resolvePropertyAsync(prop, baseDir, readFile)),
  );
  return { ...component, properties: resolvedProps };
}

async function resolvePropertyAsync(
  prop: PropertyNode,
  baseDir: string,
  readFile: (path: string) => Promise<string>,
): Promise<PropertyNode> {
  if (prop.value.kind === "file_ref") {
    const filePath = pathPosix.join(baseDir, prop.value.path.replace(/\\/g, "/"));
    try {
      const content = await readFile(filePath);
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
