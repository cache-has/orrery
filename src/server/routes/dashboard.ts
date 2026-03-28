/**
 * Dashboard serving route.
 *
 * GET /d/:name — parses the .board file, resolves layout,
 * fetches data, and returns a fully rendered HTML page.
 *
 * POST /api/query — partial update endpoint for parameter changes.
 */

import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { resolve, basename } from "path";
import { parse } from "../../parser/parser.js";
import { resolveLayout } from "../../renderer/layout.js";
import { renderPage } from "../../renderer/html.js";
import { fetchDashboardData } from "../../renderer/data.js";
import type { QueryExecutor } from "../../query/executor.js";
import { OPENBOARD_CSS } from "../../renderer/styles.js";
import { OPENBOARD_CLIENT_JS } from "../client.js";

export interface DashboardRouteOptions {
  /** Root directory containing .board files */
  boardDir: string;
  /** Query executor for running SQL */
  executor: QueryExecutor;
  /** Whether to inject dev client JS for hot reload */
  devMode?: boolean;
}

export function dashboardRoutes(options: DashboardRouteOptions): Hono {
  const app = new Hono();
  const { boardDir, executor, devMode } = options;

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

  // Render a dashboard by name — support both /d/:name and /dashboard/:name
  const renderDashboard = async (c: { req: { param: (k: string) => string; query: () => Record<string, string> }; html: (body: string, status?: number) => Response }) => {
    const name = c.req.param("name");
    const boardFile = resolve(boardDir, `${name}.board`);

    if (!existsSync(boardFile)) {
      return c.html(
        `<!DOCTYPE html><html><body><h1>Dashboard not found</h1><p>No file: ${basename(boardFile)}</p></body></html>`,
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
        paramValues[key] = value;
      }

      const data = await fetchDashboardData(dashboard, executor, paramValues);

      let html = renderPage({
        dashboard,
        layout,
        data,
        paramValues,
      });

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
      }>();

      const boardFile = resolve(boardDir, `${body.dashboard}.board`);
      if (!existsSync(boardFile)) {
        return c.json({ error: "Dashboard not found" }, 404);
      }

      const source = readFileSync(boardFile, "utf-8");
      const dashboard = parse(source, boardFile);
      const data = await fetchDashboardData(dashboard, executor, body.params);

      // Filter to requested components if specified
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

function resolveDefaultParams(dashboard: DashboardNode): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const item of dashboard.items) {
    if (item.kind === "param") {
      const param = item as ParamNode;
      const defaultProp = param.options.find((o) => o.key === "default");
      if (defaultProp) {
        if (defaultProp.value.kind === "string") defaults[param.name] = defaultProp.value.value;
        else if (defaultProp.value.kind === "number") defaults[param.name] = defaultProp.value.value;
        else if (defaultProp.value.kind === "boolean") defaults[param.name] = defaultProp.value.value;
      }
    }
  }
  return defaults;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
