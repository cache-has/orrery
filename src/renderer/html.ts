/**
 * Server-side HTML renderer.
 *
 * Takes a ResolvedLayout + DashboardData and produces a complete HTML page
 * with component containers, error states, and serialized initial data.
 */

import type { DashboardNode, ComponentNode, ParamNode, PropertyNode } from "../parser/ast.js";
import type { ResolvedLayout, ResolvedRow, ResolvedComponent } from "./layout.js";
import type { ComponentData, DashboardData, ParamInfo } from "./data.js";
import { collectComponents } from "./data.js";
import { OPENBOARD_CSS } from "./styles.js";
import { getRenderer } from "../components/registry.js";
import type { ComponentRenderData } from "../components/types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderOptions {
  dashboard: DashboardNode;
  layout: ResolvedLayout;
  data: DashboardData;
  paramValues: Record<string, unknown>;
}

/**
 * Render a complete HTML page for a dashboard.
 */
export function renderPage(options: RenderOptions): string {
  const { dashboard, layout, data, paramValues } = options;

  const components = collectComponents(dashboard);
  const componentDataMap: Record<string, ComponentData> = {};
  for (const [id, d] of data.components) {
    componentDataMap[id] = d;
  }

  // Build serialized state for client-side hydration
  // Escape </script> and <!-- in JSON to prevent XSS in inline scripts
  const serializedState = JSON.stringify({
    layout: {
      title: layout.title,
      rows: layout.rows.map((row) => ({
        components: row.components.map((rc) => ({
          id: findComponentId(rc.component, components),
          type: rc.component.componentType,
          span: rc.gridColumn,
          title: rc.component.title,
        })),
      })),
    },
    data: componentDataMap,
    params: data.params,
    paramValues,
    connection: data.connection,
  }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

  const description = getDashboardDescription(dashboard);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(layout.title)}</title>
  <style>${OPENBOARD_CSS}</style>
</head>
<body>
  <div class="openboard-root" id="openboard-root">
    ${renderHeader(layout.title, description)}
    ${renderParamBar(data.params, paramValues)}
    ${renderRows(layout.rows, data, components, paramValues)}
  </div>

  <script>
    window.__OPENBOARD__ = ${serializedState};
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHeader(title: string, description?: string): string {
  return `<header class="openboard-header">
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p class="openboard-description">${escapeHtml(description)}</p>` : ""}
    </header>`;
}

function renderParamBar(params: ParamInfo[], paramValues: Record<string, unknown>): string {
  if (params.length === 0) return "";

  const controls = params.map((param) => renderParamControl(param, paramValues)).join("\n      ");

  return `<div class="openboard-params" data-openboard-params>
      ${controls}
    </div>`;
}

function renderParamControl(param: ParamInfo, paramValues: Record<string, unknown>): string {
  const currentValue = paramValues[param.name] ?? param.options.default ?? "";
  const label = param.name.replace(/_/g, " ");

  switch (param.type) {
    case "daterange": {
      const current = typeof currentValue === "object" && currentValue !== null
        ? currentValue as { start?: string; end?: string }
        : { start: "", end: "" };
      return `<div class="openboard-param" data-param-name="${escapeAttr(param.name)}" data-param-type="daterange">
        <label>${escapeHtml(label)}</label>
        <div style="display:flex;gap:0.5rem">
          <input type="date" name="${escapeAttr(param.name)}.start" value="${escapeAttr(String(current.start ?? ""))}" />
          <input type="date" name="${escapeAttr(param.name)}.end" value="${escapeAttr(String(current.end ?? ""))}" />
        </div>
      </div>`;
    }
    case "select": {
      const opts = (param.options.options as string[]) ?? [];
      const optionTags = opts
        .map((o) => `<option value="${escapeAttr(o)}"${o === String(currentValue) ? " selected" : ""}>${escapeHtml(o)}</option>`)
        .join("");
      return `<div class="openboard-param" data-param-name="${escapeAttr(param.name)}" data-param-type="select">
        <label>${escapeHtml(label)}</label>
        <select name="${escapeAttr(param.name)}">${optionTags}</select>
      </div>`;
    }
    case "text":
      return `<div class="openboard-param" data-param-name="${escapeAttr(param.name)}" data-param-type="text">
        <label>${escapeHtml(label)}</label>
        <input type="text" name="${escapeAttr(param.name)}" value="${escapeAttr(String(currentValue))}" />
      </div>`;
    case "number":
      return `<div class="openboard-param" data-param-name="${escapeAttr(param.name)}" data-param-type="number">
        <label>${escapeHtml(label)}</label>
        <input type="number" name="${escapeAttr(param.name)}" value="${escapeAttr(String(currentValue))}" />
      </div>`;
    default:
      return "";
  }
}

function renderRows(
  rows: ResolvedRow[],
  data: DashboardData,
  components: { id: string; component: ComponentNode }[],
  paramValues?: Record<string, unknown>,
): string {
  return rows
    .map((row) => {
      const cells = row.components
        .map((rc) => renderComponentContainer(rc, data, components, paramValues))
        .join("\n      ");
      return `<div class="openboard-row">
      ${cells}
    </div>`;
    })
    .join("\n    ");
}

function renderComponentContainer(
  rc: ResolvedComponent,
  data: DashboardData,
  components: { id: string; component: ComponentNode }[],
  paramValues?: Record<string, unknown>,
): string {
  const id = findComponentId(rc.component, components);
  const compData = data.components.get(id);
  const title = rc.component.title ?? "";

  const body = compData?.error
    ? renderErrorState(compData.error)
    : renderComponentBody(rc.component, compData, paramValues);

  const footer = compData?.result
    ? `<div class="openboard-component-footer">
          <span class="openboard-query-time">Loaded in ${compData.result.executionTimeMs}ms</span>
        </div>`
    : "";

  // Text components without titles get a simpler wrapper
  if (rc.component.componentType === "text" && !title) {
    return `<div class="openboard-component" style="grid-column: ${rc.gridColumn}" data-component-id="${escapeAttr(id)}" data-component-type="text">
        <div class="openboard-component-body">
          ${body}
        </div>
      </div>`;
  }

  return `<div class="openboard-component" style="grid-column: ${rc.gridColumn}" data-component-id="${escapeAttr(id)}" data-component-type="${escapeAttr(rc.component.componentType)}">
        <div class="openboard-component-header">
          <h3 class="openboard-component-title">${escapeHtml(title)}</h3>
          <div class="openboard-component-actions">
            <button class="openboard-refresh" title="Refresh" data-action="refresh">&#x21bb;</button>
          </div>
        </div>
        <div class="openboard-component-body">
          ${body}
        </div>
        ${footer}
      </div>`;
}

// ---------------------------------------------------------------------------
// Component body renderers (basic/placeholder until component library)
// ---------------------------------------------------------------------------

function renderComponentBody(
  component: ComponentNode,
  compData?: ComponentData,
  paramValues?: Record<string, unknown>,
): string {
  // Try the component registry first
  const renderer = getRenderer(component.componentType);
  if (renderer) {
    const renderData: ComponentRenderData = {
      result: compData?.result,
      trendResult: compData?.trendResult,
      error: compData?.error,
      paramValues,
    };
    return renderer.renderToString(component, renderData);
  }

  return `<div class="openboard-placeholder">${escapeHtml(component.componentType)} component</div>`;
}

// ---------------------------------------------------------------------------
// Error rendering
// ---------------------------------------------------------------------------

function renderErrorState(errorMessage: string): string {
  return `<div class="openboard-error">
    <div class="openboard-error-title">Query Error</div>
    <div class="openboard-error-message">${escapeHtml(errorMessage)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStringProp(component: ComponentNode, key: string): string | undefined {
  const prop = component.properties.find((p: PropertyNode) => p.key === key);
  if (!prop) return undefined;
  if (prop.value.kind === "string") return prop.value.value;
  return undefined;
}

function getDashboardDescription(dashboard: DashboardNode): string | undefined {
  for (const item of dashboard.items) {
    if (item.kind === "property" && item.key === "description") {
      if (item.value.kind === "string") return item.value.value;
    }
  }
  return undefined;
}

function findComponentId(
  component: ComponentNode,
  components: { id: string; component: ComponentNode }[],
): string {
  const found = components.find((c) => c.component === component);
  return found?.id ?? "unknown";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/'/g, "&#39;");
}
