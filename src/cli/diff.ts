import { execSync } from "child_process";
import { parse } from "../parser/parser.js";
import { writeFileSync } from "fs";
import type {
  DashboardNode,
  ComponentNode,
  ParamNode,
  PropertyNode,
  ValueNode,
} from "../parser/ast.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  // Also check --name=value
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  return fallback;
}

const baseRef = getArg("base", "origin/main");
const headRef = getArg("head", "HEAD");
const outputPath = getArg("output", "");

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitListBoardFiles(ref: string): string[] {
  try {
    const output = execSync(`git ls-tree -r --name-only ${ref}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .split("\n")
      .filter((f) => f.endsWith(".board"))
      .sort();
  } catch {
    return [];
  }
}

function gitReadFile(ref: string, filePath: string): string | null {
  try {
    return execSync(`git show ${ref}:${filePath}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function tryParse(source: string, file: string): DashboardNode | null {
  try {
    return parse(source, file);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AST extraction helpers
// ---------------------------------------------------------------------------

function getComponents(ast: DashboardNode): ComponentNode[] {
  const components: ComponentNode[] = [];
  for (const item of ast.items) {
    if (item.kind === "component") components.push(item);
    if (item.kind === "row") components.push(...item.components);
  }
  return components;
}

function getParams(ast: DashboardNode): ParamNode[] {
  return ast.items.filter((i): i is ParamNode => i.kind === "param");
}

function getPropertyValue(props: PropertyNode[], key: string): string | undefined {
  const prop = props.find((p) => p.key === key);
  if (!prop) return undefined;
  return valueToString(prop.value);
}

function valueToString(val: ValueNode): string {
  switch (val.kind) {
    case "string":
      return val.value;
    case "number":
      return String(val.value);
    case "boolean":
      return String(val.value);
    case "ident":
      return val.name;
    case "file_ref":
      return `file("${val.path}")`;
    case "array":
      return `[${val.elements.map(valueToString).join(", ")}]`;
    case "object":
      return `{${val.entries.map((e) => `${e.key}: ${valueToString(e.value)}`).join(", ")}}`;
  }
}

// ---------------------------------------------------------------------------
// Diff logic
// ---------------------------------------------------------------------------

export interface DashboardDiff {
  added: string[];
  removed: string[];
  changed: ChangedDashboard[];
  parseErrors: { file: string; ref: string; error: string }[];
}

export interface ChangedDashboard {
  file: string;
  title: string;
  queryChanges: QueryChange[];
  paramChanges: ParamChange[];
  layoutChanges: LayoutChange[];
}

export interface QueryChange {
  component: string;
  oldQuery: string;
  newQuery: string;
}

export interface ParamChange {
  type: "added" | "removed" | "changed";
  name: string;
  details?: string;
}

export interface LayoutChange {
  type: "added" | "removed" | "reordered" | "resized";
  description: string;
}

export function diffDashboards(
  baseFiles: Map<string, DashboardNode>,
  headFiles: Map<string, DashboardNode>,
): DashboardDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: ChangedDashboard[] = [];

  // Find added/removed
  for (const file of headFiles.keys()) {
    if (!baseFiles.has(file)) added.push(file);
  }
  for (const file of baseFiles.keys()) {
    if (!headFiles.has(file)) removed.push(file);
  }

  // Find changed
  for (const [file, headAst] of headFiles) {
    const baseAst = baseFiles.get(file);
    if (!baseAst) continue;

    const diff = diffSingleDashboard(file, baseAst, headAst);
    if (diff) changed.push(diff);
  }

  return { added, removed, changed, parseErrors: [] };
}

function diffSingleDashboard(
  file: string,
  base: DashboardNode,
  head: DashboardNode,
): ChangedDashboard | null {
  const queryChanges = diffQueries(base, head);
  const paramChanges = diffParams(base, head);
  const layoutChanges = diffLayout(base, head);

  if (queryChanges.length === 0 && paramChanges.length === 0 && layoutChanges.length === 0) {
    return null;
  }

  return {
    file,
    title: head.title || file,
    queryChanges,
    paramChanges,
    layoutChanges,
  };
}

function diffQueries(base: DashboardNode, head: DashboardNode): QueryChange[] {
  const changes: QueryChange[] = [];
  const baseComponents = getComponents(base);
  const headComponents = getComponents(head);

  // Match components by title
  const baseByTitle = new Map<string, ComponentNode>();
  for (const c of baseComponents) {
    if (c.title) baseByTitle.set(c.title, c);
  }

  for (const hComp of headComponents) {
    if (!hComp.title) continue;
    const bComp = baseByTitle.get(hComp.title);
    if (!bComp) continue;

    const bQuery = getPropertyValue(bComp.properties, "query") ?? "";
    const hQuery = getPropertyValue(hComp.properties, "query") ?? "";

    if (bQuery !== hQuery && (bQuery || hQuery)) {
      changes.push({
        component: hComp.title,
        oldQuery: bQuery,
        newQuery: hQuery,
      });
    }
  }

  return changes;
}

function diffParams(base: DashboardNode, head: DashboardNode): ParamChange[] {
  const changes: ParamChange[] = [];
  const baseParams = new Map(getParams(base).map((p) => [p.name, p]));
  const headParams = new Map(getParams(head).map((p) => [p.name, p]));

  for (const [name] of headParams) {
    if (!baseParams.has(name)) {
      changes.push({ type: "added", name });
    }
  }

  for (const [name] of baseParams) {
    if (!headParams.has(name)) {
      changes.push({ type: "removed", name });
    }
  }

  for (const [name, headParam] of headParams) {
    const baseParam = baseParams.get(name);
    if (!baseParam) continue;

    // Compare param type
    if (baseParam.paramType !== headParam.paramType) {
      changes.push({
        type: "changed",
        name,
        details: `type changed from ${baseParam.paramType} to ${headParam.paramType}`,
      });
      continue;
    }

    // Compare options
    const baseOpts = baseParam.options.map((o) => `${o.key}=${valueToString(o.value)}`).sort().join(",");
    const headOpts = headParam.options.map((o) => `${o.key}=${valueToString(o.value)}`).sort().join(",");
    if (baseOpts !== headOpts) {
      changes.push({
        type: "changed",
        name,
        details: "options changed",
      });
    }
  }

  return changes;
}

function diffLayout(base: DashboardNode, head: DashboardNode): LayoutChange[] {
  const changes: LayoutChange[] = [];
  const baseComponents = getComponents(base);
  const headComponents = getComponents(head);

  const baseTitles = baseComponents.map((c) => c.title ?? "(untitled)");
  const headTitles = headComponents.map((c) => c.title ?? "(untitled)");

  // Detect added/removed components
  const baseSet = new Set(baseTitles);
  const headSet = new Set(headTitles);

  for (const t of headTitles) {
    if (!baseSet.has(t)) {
      changes.push({ type: "added", description: `Component "${t}" added` });
    }
  }
  for (const t of baseTitles) {
    if (!headSet.has(t)) {
      changes.push({ type: "removed", description: `Component "${t}" removed` });
    }
  }

  // Detect reordering (only for components present in both)
  const commonBase = baseTitles.filter((t) => headSet.has(t));
  const commonHead = headTitles.filter((t) => baseSet.has(t));
  if (commonBase.join(",") !== commonHead.join(",") && commonBase.length > 0) {
    changes.push({ type: "reordered", description: "Component order changed" });
  }

  // Detect span changes
  const baseByTitle = new Map(baseComponents.filter((c) => c.title).map((c) => [c.title!, c]));
  for (const hComp of headComponents) {
    if (!hComp.title) continue;
    const bComp = baseByTitle.get(hComp.title);
    if (!bComp) continue;
    if ((bComp.opts.span ?? 0) !== (hComp.opts.span ?? 0)) {
      changes.push({
        type: "resized",
        description: `"${hComp.title}" span changed from ${bComp.opts.span ?? "auto"} to ${hComp.opts.span ?? "auto"}`,
      });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Markdown output
// ---------------------------------------------------------------------------

export function formatDiffMarkdown(diff: DashboardDiff, baseRef: string, headRef: string): string {
  const lines: string[] = [];
  lines.push("## Dashboard Diff");
  lines.push("");
  lines.push(`Comparing \`${baseRef}\` → \`${headRef}\``);
  lines.push("");

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    lines.push("No dashboard changes detected.");
    return lines.join("\n");
  }

  // Added dashboards
  if (diff.added.length > 0) {
    lines.push("### New Dashboards");
    lines.push("");
    for (const f of diff.added) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  // Removed dashboards
  if (diff.removed.length > 0) {
    lines.push("### Removed Dashboards");
    lines.push("");
    for (const f of diff.removed) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  // Changed dashboards
  for (const change of diff.changed) {
    lines.push(`### ${change.title} (\`${change.file}\`)`);
    lines.push("");

    if (change.queryChanges.length > 0) {
      lines.push("**Query Changes:**");
      lines.push("");
      for (const qc of change.queryChanges) {
        lines.push(`<details><summary>${qc.component}</summary>`);
        lines.push("");
        lines.push("```diff");
        // Simple line-based diff
        const oldLines = qc.oldQuery.split("\n");
        const newLines = qc.newQuery.split("\n");
        for (const line of oldLines) {
          if (!newLines.includes(line)) lines.push(`- ${line}`);
        }
        for (const line of newLines) {
          if (!oldLines.includes(line)) lines.push(`+ ${line}`);
        }
        lines.push("```");
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    }

    if (change.paramChanges.length > 0) {
      lines.push("**Parameter Changes:**");
      lines.push("");
      for (const pc of change.paramChanges) {
        const icon = pc.type === "added" ? "+" : pc.type === "removed" ? "-" : "~";
        const detail = pc.details ? ` — ${pc.details}` : "";
        lines.push(`- \`${icon}\` **${pc.name}**${detail}`);
      }
      lines.push("");
    }

    if (change.layoutChanges.length > 0) {
      lines.push("**Layout Changes:**");
      lines.push("");
      for (const lc of change.layoutChanges) {
        lines.push(`- ${lc.description}`);
      }
      lines.push("");
    }
  }

  // Parse errors
  if (diff.parseErrors.length > 0) {
    lines.push("### Parse Errors");
    lines.push("");
    for (const pe of diff.parseErrors) {
      lines.push(`- \`${pe.file}\` at \`${pe.ref}\`: ${pe.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main (only runs when executed as CLI)
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("diff.js") || process.argv[1]?.endsWith("diff.ts")) {
  const baseBoardFiles = gitListBoardFiles(baseRef);
  const headBoardFiles = gitListBoardFiles(headRef);

  const baseAsts = new Map<string, DashboardNode>();
  const headAsts = new Map<string, DashboardNode>();
  const parseErrors: DashboardDiff["parseErrors"] = [];

  for (const file of baseBoardFiles) {
    const source = gitReadFile(baseRef, file);
    if (source === null) continue;
    const ast = tryParse(source, file);
    if (ast) {
      baseAsts.set(file, ast);
    } else {
      parseErrors.push({ file, ref: baseRef, error: "Failed to parse" });
    }
  }

  for (const file of headBoardFiles) {
    const source = gitReadFile(headRef, file);
    if (source === null) continue;
    const ast = tryParse(source, file);
    if (ast) {
      headAsts.set(file, ast);
    } else {
      parseErrors.push({ file, ref: headRef, error: "Failed to parse" });
    }
  }

  const diff = diffDashboards(baseAsts, headAsts);
  diff.parseErrors = parseErrors;

  const markdown = formatDiffMarkdown(diff, baseRef, headRef);

  if (outputPath) {
    writeFileSync(outputPath, markdown, "utf-8");
    console.log(`Diff report written to ${outputPath}`);
  } else {
    console.log(markdown);
  }
}
