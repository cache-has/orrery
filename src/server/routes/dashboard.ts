/**
 * Dashboard serving route.
 *
 * GET /d/:name — parses the .board file, resolves layout,
 * fetches data, and returns a fully rendered HTML page.
 *
 * POST /api/query — partial update endpoint for parameter changes.
 */

import { Hono } from "hono";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, basename, extname, relative } from "path";
import { parse } from "../../parser/parser.js";
import { resolveLayout } from "../../renderer/layout.js";
import { renderPage, renderComponentFragment } from "../../renderer/html.js";
import { fetchDashboardData, collectComponents } from "../../renderer/data.js";
import type { QueryExecutor } from "../../query/executor.js";
import { OPENBOARD_CSS } from "../../renderer/styles.js";
import { OPENBOARD_CLIENT_JS } from "../client.js";
import { OPENBOARD_INTERACTIVE_JS } from "../interactive.js";
import { resolveDateRange } from "../../query/daterange.js";
import { loadThemeFile, resolveTheme, type ThemeFile, type ThemeName } from "../../renderer/theme.js";
import type { ProjectConfig } from "../discovery.js";

export interface DashboardRouteOptions {
  /** Root directory containing .board files */
  boardDir: string;
  /** Query executor for running SQL */
  executor: QueryExecutor;
  /** Whether to inject dev client JS for hot reload */
  devMode?: boolean;
  /** Project root directory (for theme file loading) */
  projectRoot?: string;
  /** Project config (for global theme setting) */
  config?: ProjectConfig;
}

export function dashboardRoutes(options: DashboardRouteOptions): Hono {
  const app = new Hono();
  const { boardDir, executor, devMode, projectRoot, config } = options;

  // Load theme file once at startup (re-loaded via watcher in dev mode)
  let cachedThemeFile: ThemeFile | null = null;
  if (projectRoot) {
    try {
      cachedThemeFile = loadThemeFile(projectRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Failed to load theme file: ${msg}`);
    }
  }

  /** Reload the cached theme file (called from dev watcher) */
  (app as any).__reloadTheme = () => {
    if (projectRoot) {
      try {
        cachedThemeFile = loadThemeFile(projectRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: Failed to reload theme file: ${msg}`);
      }
    }
  };

  // Serve the raw CSS stylesheet
  app.get("/openboard/styles.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(OPENBOARD_CSS);
  });

  // Serve the client-side JavaScript (dev mode)
  app.get("/openboard/client.js", (c) => {
    c.header("Content-Type", "application/javascript; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    return c.body(OPENBOARD_CLIENT_JS);
  });

  // Serve the interactive script (always — interactivity is core)
  app.get("/openboard/interactive.js", (c) => {
    c.header("Content-Type", "application/javascript; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(OPENBOARD_INTERACTIVE_JS);
  });

  // Serve branding assets (logo, favicon) from project root
  // Only serves image files to prevent path traversal / arbitrary file reads
  const ALLOWED_ASSET_EXTENSIONS: Record<string, string> = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };

  app.get("/openboard/assets/*", (c) => {
    if (!projectRoot) return c.text("Not found", 404);
    const rawPath = c.req.path.replace("/openboard/assets/", "");
    // Prevent path traversal
    if (rawPath.includes("..") || rawPath.startsWith("/")) {
      return c.text("Forbidden", 403);
    }
    const ext = extname(rawPath).toLowerCase();
    const mime = ALLOWED_ASSET_EXTENSIONS[ext];
    if (!mime) return c.text("Forbidden", 403);

    const filePath = resolve(projectRoot, rawPath);
    // Ensure resolved path is still under project root
    if (!filePath.startsWith(resolve(projectRoot))) {
      return c.text("Forbidden", 403);
    }
    if (!existsSync(filePath)) return c.text("Not found", 404);

    const content = readFileSync(filePath);
    c.header("Content-Type", mime);
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(content);
  });

  // Render a dashboard by name — support both /d/:name and /dashboard/:name
  const renderDashboard = async (c: { req: { param: (k: string) => string; query: () => Record<string, string> }; html: (body: string, status?: number) => Response }) => {
    const name = c.req.param("name");
    const boardFile = resolveBoardFile(boardDir, name);

    if (!boardFile) {
      return c.html(
        `<!DOCTYPE html><html><body><h1>Dashboard not found</h1><p>No dashboard matching: ${escapeHtml(name)}</p></body></html>`,
        404,
      );
    }

    try {
      const source = readFileSync(boardFile, "utf-8");
      const dashboard = parse(source, boardFile);
      const layout = resolveLayout(dashboard);

      // Collect param defaults as current values
      const paramValues = resolveDefaultParams(dashboard);

      // Merge query string overrides
      const queryParams = c.req.query();
      for (const [key, value] of Object.entries(queryParams)) {
        // Handle dotted daterange params: date_range.start, date_range.end
        if (key.includes(".")) {
          const [paramName, subKey] = key.split(".", 2);
          const existing = paramValues[paramName];
          if (existing && typeof existing === "object") {
            (existing as Record<string, unknown>)[subKey] = value;
          } else {
            paramValues[paramName] = { [subKey]: value };
          }
        } else {
          paramValues[key] = value;
        }
      }

      // Resolve daterange params (presets → concrete dates)
      const resolvedParams = resolveParamsWithDateRanges(dashboard, paramValues);
      Object.assign(paramValues, resolvedParams);

      const data = await fetchDashboardData(dashboard, executor, paramValues);

      // Resolve theme
      const dashboardTheme = getDashboardTheme(dashboard);
      const configTheme = config?.theme ?? "light";
      const resolved = resolveTheme({
        configTheme,
        dashboardTheme,
        themeFile: cachedThemeFile,
      });

      let html = renderPage({
        dashboard,
        layout,
        data,
        paramValues,
        themeCSS: resolved.css || undefined,
        themeName: resolved.name,
        palette: resolved.palette,
        branding: resolved.branding,
        devMode,
      });

      // Always inject interactive script (interactivity is core)
      html = html.replace("</body>", `  <script src="/openboard/interactive.js"></script>\n</body>`);

      // Inject dev client script
      if (devMode) {
        html = html.replace("</body>", `  <script src="/openboard/client.js"></script>\n</body>`);
      }

      return c.html(html);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.html(
        `<!DOCTYPE html><html><body><h1>Error rendering dashboard</h1><pre>${escapeHtml(message)}</pre></body></html>`,
        500,
      );
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get("/d/:name", renderDashboard as any);
  // Keep legacy route for backwards compatibility
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get("/dashboard/:name", renderDashboard as any);

  // Partial update: re-execute specific queries with new params
  app.post("/api/query", async (c) => {
    try {
      const body = await c.req.json<{
        dashboard: string;
        params: Record<string, unknown>;
        components?: string[];
        format?: "json" | "html";
      }>();

      const boardFile = resolveBoardFile(boardDir, body.dashboard);
      if (!boardFile) {
        return c.json({ error: "Dashboard not found" }, 404);
      }

      const source = readFileSync(boardFile, "utf-8");
      const dashboard = parse(source, boardFile);

      // Resolve daterange params
      const resolvedParams = resolveParamsWithDateRanges(dashboard, body.params);
      const data = await fetchDashboardData(dashboard, executor, resolvedParams);

      const components = collectComponents(dashboard);

      if (body.format === "html") {
        // Resolve theme palette for chart rendering
        const dashTheme = getDashboardTheme(dashboard);
        const resolved = resolveTheme({
          configTheme: config?.theme ?? "light",
          dashboardTheme: dashTheme,
          themeFile: cachedThemeFile,
        });

        // Return rendered HTML fragments for each component
        const html: Record<string, string> = {};
        for (const [id, compData] of data.components) {
          if (!body.components || body.components.includes(id)) {
            const comp = components.find((c) => c.id === id);
            if (comp) {
              html[id] = renderComponentFragment(comp.component, compData, resolvedParams, resolved.palette);
            }
          }
        }
        return c.json({ html });
      }

      // JSON format (default)
      const result: Record<string, unknown> = {};
      for (const [id, compData] of data.components) {
        if (!body.components || body.components.includes(id)) {
          result[id] = compData;
        }
      }

      return c.json({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { DashboardNode, ParamNode } from "../../parser/ast.js";

function getDashboardTheme(dashboard: DashboardNode): ThemeName | undefined {
  for (const item of dashboard.items) {
    if (item.kind === "property" && item.key === "theme") {
      if (item.value.kind === "string" || item.value.kind === "ident") {
        const val = item.value.kind === "string" ? item.value.value : item.value.name;
        if (val === "light" || val === "dark") return val;
      }
    }
  }
  return undefined;
}

function resolveDefaultParams(dashboard: DashboardNode): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const item of dashboard.items) {
    if (item.kind === "param") {
      const param = item as ParamNode;
      const defaultProp = param.options.find((o) => o.key === "default");
      if (defaultProp) {
        if (defaultProp.value.kind === "string") {
          if (param.paramType === "daterange") {
            // Resolve preset string to { start, end, previous, preset }
            const resolved = resolveDateRange(defaultProp.value.value);
            defaults[param.name] = { ...resolved, preset: defaultProp.value.value.toLowerCase().replace(/[\s-]+/g, "_") };
          } else {
            defaults[param.name] = defaultProp.value.value;
          }
        } else if (defaultProp.value.kind === "number") defaults[param.name] = defaultProp.value.value;
        else if (defaultProp.value.kind === "boolean") defaults[param.name] = defaultProp.value.value;
      }
    }
  }
  return defaults;
}

/**
 * Resolve daterange params in a params object by looking at the AST
 * to know which params are daterange type.
 */
function resolveParamsWithDateRanges(
  dashboard: DashboardNode,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = { ...params };
  for (const item of dashboard.items) {
    if (item.kind === "param" && item.paramType === "daterange") {
      const val = resolved[item.name];
      if (typeof val === "string") {
        // Preset string from client
        const dr = resolveDateRange(val);
        resolved[item.name] = { ...dr, preset: val };
      } else if (val && typeof val === "object" && "start" in val) {
        // Custom range — ensure previous is computed
        const dr = resolveDateRange(val);
        resolved[item.name] = dr;
      }
    }
  }
  return resolved;
}

/**
 * Resolve a slug to a .board file path. Supports both flat files and
 * subdirectories (e.g. slug "finance-revenue" → "finance/revenue.board").
 */
function resolveBoardFile(boardDir: string, slug: string): string | null {
  // Try direct match first: {slug}.board
  const direct = resolve(boardDir, `${slug}.board`);
  if (existsSync(direct)) return direct;

  // Search recursively for a file whose slug matches
  const match = findBoardBySlug(boardDir, boardDir, slug);
  return match;
}

function findBoardBySlug(baseDir: string, dir: string, targetSlug: string): string | null {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBoardBySlug(baseDir, fullPath, targetSlug);
      if (found) return found;
    } else if (entry.isFile() && extname(entry.name) === ".board") {
      const rel = relative(baseDir, fullPath);
      const slug = rel
        .replace(/\.board$/, "")
        .replace(/[\\/]/g, "-")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/(^-|-$)/g, "");
      if (slug === targetSlug) return fullPath;
    }
  }
  return null;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
