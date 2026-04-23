/**
 * Editor routes — browser-based `.board` file editor backend.
 *
 * All routes are gated on `options.enabled`; when false they return 404 as if
 * they do not exist. Auth is the operator's responsibility (upstream proxy).
 * See planning/20-web-editor-backend.md.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { parse } from "../../parser/parser.js";
import { validate, type ValidationDiagnostic } from "../../parser/validator.js";
import { ParseError } from "../../parser/errors.js";
import {
  SourceWriteError,
  type DashboardSource,
  type SourceWriteErrorCode,
} from "../../sources/types.js";
import type { ConnectionManager } from "../../connections/manager.js";
import type { DiscoveredDashboard } from "../discovery.js";
import type { BrandingConfig } from "../../renderer/theme.js";
import { bundleEditorClient } from "../editor-bundle.js";

export interface EditorRouteOptions {
  enabled: boolean;
  source?: DashboardSource;
  connManager?: ConnectionManager;
  getDashboards?: () => DiscoveredDashboard[];
  /** Resolve a bare file name (no extension) to a full source path for create. */
  resolveNewPath?: (name: string) => string;
  /**
   * Called after successful write operations so the host can invalidate caches
   * (e.g. rediscover dashboards) before the response is returned. Without this,
   * remote sources with polling watchers stay stale until the next poll.
   */
  onSourceChange?: () => Promise<void> | void;
  /** Current branding config, read each request so hot-reload is live. */
  getBranding?: () => BrandingConfig | undefined;
}

const STARTER_TEMPLATE = `dashboard "New Dashboard" {
  text {
    # New Dashboard

    Describe what this dashboard shows.
  }
}
`;

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function editorRoutes(options: EditorRouteOptions): Hono {
  const app = new Hono();

  if (!options.enabled) {
    // Register no routes so requests fall through to other handlers (or 404 by default).
    return app;
  }

  // -------------------------------------------------------------------------
  // HTML stubs (real page body arrives in doc 21)
  // -------------------------------------------------------------------------

  app.get("/edit", (c) =>
    c.html(renderEditorShell({ mode: "list", branding: options.getBranding?.() })),
  );
  app.get("/edit/:name", (c) => {
    const name = c.req.param("name");
    if (!isSafeName(name)) return c.notFound();
    return c.html(renderEditorShell({ mode: "edit", name, branding: options.getBranding?.() }));
  });

  app.get("/edit/assets/editor.js", async (c) => {
    try {
      const js = await bundleEditorClient();
      return c.body(js, 200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.text(`// Editor bundle build failed: ${msg}`, 500, {
        "Content-Type": "application/javascript; charset=utf-8",
      });
    }
  });

  // -------------------------------------------------------------------------
  // JSON APIs
  // -------------------------------------------------------------------------

  app.get("/api/dashboards/:name", async (c) => {
    const name = c.req.param("name");
    if (!isSafeName(name)) return errorResponse(c, "notfound", "Invalid name", 404);

    const source = options.source;
    if (!source) return errorResponse(c, "notfound", "No source configured", 404);

    const filePath = await findPathForName(options, name);
    if (!filePath) return errorResponse(c, "notfound", `Dashboard "${name}" not found`, 404);

    try {
      const content = await source.read(filePath);
      return c.body(content, 200, { "Content-Type": "text/plain; charset=utf-8" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(c, "notfound", msg, 404);
    }
  });

  app.post("/api/save/:name", async (c) => {
    const name = c.req.param("name");
    if (!isSafeName(name)) return errorResponse(c, "notfound", "Invalid name", 404);

    const source = options.source;
    if (!source) return errorResponse(c, "readonly", "No source configured", 409);
    if (!source.writable) return errorResponse(c, "readonly", "Source is not writable", 409);

    const content = await c.req.text();

    const diagnostics = runValidation(content, name);
    const errors = diagnostics.filter((d) => d.level === "error");
    if (errors.length > 0) {
      return c.json(
        { error: "invalid", message: "Validation failed", diagnostics, errors },
        422,
      );
    }

    const filePath = (await findPathForName(options, name)) ?? options.resolveNewPath?.(name);
    if (!filePath) return errorResponse(c, "notfound", `Cannot resolve path for "${name}"`, 404);

    try {
      await source.write!(filePath, content);
      await options.onSourceChange?.();
      return c.json({ ok: true, path: filePath });
    } catch (err) {
      return writeErrorResponse(c, err);
    }
  });

  app.post("/api/new", async (c) => {
    const source = options.source;
    if (!source) return errorResponse(c, "readonly", "No source configured", 409);
    if (!source.writable) return errorResponse(c, "readonly", "Source is not writable", 409);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, "invalid", "Request body must be JSON", 422);
    }
    const name = (body as { name?: unknown })?.name;
    if (typeof name !== "string" || !isSafeName(name)) {
      return errorResponse(
        c,
        "invalid",
        "Name must be alphanumeric with hyphens or underscores; no paths or dots",
        422,
      );
    }

    if (!options.resolveNewPath) {
      return errorResponse(c, "unknown", "No path resolver configured", 500);
    }

    const filePath = options.resolveNewPath(name);

    // If this name already maps to a discovered dashboard, it exists.
    if (await findPathForName(options, name)) {
      return errorResponse(c, "exists", `Dashboard "${name}" already exists`, 409);
    }

    try {
      await source.write!(filePath, STARTER_TEMPLATE);
      await options.onSourceChange?.();
      return c.json({ ok: true, path: filePath, name }, 201);
    } catch (err) {
      return writeErrorResponse(c, err);
    }
  });

  app.post("/api/validate", async (c) => {
    const content = await c.req.text();
    const diagnostics = runValidation(content);
    return c.json({ diagnostics });
  });

  app.get("/api/connections", (c) => {
    const cm = options.connManager;
    const list = cm?.listConnections() ?? [];
    return c.json({
      connections: list.map((conn) => ({ name: conn.name, type: conn.type })),
    });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSafeName(name: string | undefined): name is string {
  if (!name) return false;
  if (name.length > 128) return false;
  if (name.includes("\0")) return false;
  return NAME_PATTERN.test(name);
}

async function findPathForName(
  options: EditorRouteOptions,
  name: string,
): Promise<string | undefined> {
  const dashboards = options.getDashboards?.() ?? [];
  // Match by slug first (what /d/:slug uses) then by filename basename.
  const bySlug = dashboards.find((d) => d.slug === name);
  if (bySlug) return bySlug.filePath;
  const byName = dashboards.find((d) => {
    const base = d.filePath.replace(/\\/g, "/").split("/").pop() ?? "";
    return base.replace(/\.board$/, "") === name;
  });
  if (byName) return byName.filePath;

  // Defense-in-depth: the discovery cache may be stale (remote sources refresh
  // via polling). Ask the source directly before giving up.
  const source = options.source;
  if (source) {
    try {
      const files = await source.list();
      const match = files.find((f) => {
        const base = f.replace(/\\/g, "/").split("/").pop() ?? "";
        return base.replace(/\.board$/, "") === name;
      });
      if (match) return match;
    } catch {
      // Swallow — treat as "not found"; caller returns 404.
    }
  }
  return undefined;
}

function runValidation(content: string, file?: string): ValidationDiagnostic[] {
  try {
    const ast = parse(content, file);
    return validate(ast);
  } catch (err) {
    if (err instanceof ParseError) {
      return [{ level: "error", message: err.message, span: err.span, hint: err.hint }];
    }
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        level: "error",
        message: msg,
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 1, offset: 0 },
          file,
        },
      },
    ];
  }
}

function errorResponse(
  c: Context,
  code: string,
  message: string,
  status: StatusCode,
) {
  return c.json({ error: code, message }, status as any);
}

function writeErrorResponse(c: Context, err: unknown) {
  if (err instanceof SourceWriteError) {
    const status = statusForCode(err.code);
    return c.json({ error: err.code, message: err.message }, status as any);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return c.json({ error: "unknown", message: msg }, 500);
}

function statusForCode(code: SourceWriteErrorCode): StatusCode {
  switch (code) {
    case "readonly":
      return 409;
    case "permission":
      return 403;
    case "notfound":
      return 404;
    case "transient":
      return 502;
    default:
      return 500;
  }
}

function renderEditorShell(
  opts: ({ mode: "list" } | { mode: "edit"; name: string }) & { branding?: BrandingConfig },
): string {
  const title = opts.mode === "list" ? "Dashboards" : opts.name;
  const safeTitle = escapeAttr(title);
  const brandName = opts.branding?.title ?? "OpenBoard";
  const safeBrand = escapeAttr(brandName);
  const brandAttr = opts.branding?.title ? ` data-brand-title="${safeBrand}"` : "";
  const mountAttrs =
    opts.mode === "list"
      ? `data-mode="list"`
      : `data-mode="edit" data-name="${escapeAttr(opts.name)}"`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeBrand} Editor — ${safeTitle}</title>
</head>
<body>
  <div id="openboard-editor" ${mountAttrs}${brandAttr}></div>
  <script src="/edit/assets/editor.js" defer></script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
