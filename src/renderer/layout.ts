import type { DashboardNode, RowNode, ComponentNode } from "../parser/ast.js";

export interface ResolvedComponent {
  component: ComponentNode;
  gridColumn: string;
}

export interface ResolvedRow {
  components: ResolvedComponent[];
}

export interface ResolvedLayout {
  title: string;
  rows: ResolvedRow[];
}

const GRID_COLUMNS = 12;

/**
 * Resolve a dashboard AST into a layout with CSS Grid column assignments.
 * Components without explicit spans are divided equally across the row.
 */
export function resolveLayout(dashboard: DashboardNode): ResolvedLayout {
  const rows = dashboard.items
    .filter((item): item is RowNode => item.kind === "row")
    .map(resolveRow);

  return { title: dashboard.title, rows };
}

function resolveRow(row: RowNode): ResolvedRow {
  const components = row.components;
  const explicitSpans = components.map((c) => c.opts.span);
  const unassigned = explicitSpans.filter((s) => s === undefined).length;
  const usedSpan = explicitSpans.reduce<number>((sum, s) => sum + (s ?? 0), 0);
  const autoSpan = unassigned > 0 ? Math.floor((GRID_COLUMNS - usedSpan) / unassigned) : 0;

  let col = 1;
  const resolved: ResolvedComponent[] = components.map((component) => {
    const span = component.opts.span ?? autoSpan;
    const gridColumn = `${col} / span ${span}`;
    col += span;
    return { component, gridColumn };
  });

  return { components: resolved };
}
