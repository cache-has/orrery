/**
 * Header-based access control.
 *
 * Orrery itself has no notion of users — auth is the operator's
 * responsibility (an upstream proxy). This module lets that proxy scope what a
 * request may see by passing two trusted headers:
 *
 *   x-orrery-folders   "*" (all) | "revenue,marketing" (csv) | "" (none)
 *   x-orrery-can-edit  "1" | "true"  → may use the editor
 *
 * Enforcement is OFF unless explicitly enabled (so local dev and unproxied
 * deployments are unaffected). When ON it is fail-closed: a missing folders
 * header means "no folders". The proxy is responsible for stripping any
 * client-supplied copy of these headers before injecting the trusted values.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { DiscoveredDashboard } from "./discovery.js";

export interface AccessConfig {
  /** Master switch. When false, no enforcement happens anywhere. */
  enabled: boolean;
  /** Header carrying the allowed folders. */
  foldersHeader: string;
  /** Header carrying the edit capability. */
  canEditHeader: string;
  /** Treat root (folder === "") dashboards as nonexistent. */
  requireFolder: boolean;
}

export interface RequestAccess {
  /** Allowed folders, or null for all folders ("*"). */
  folders: Set<string> | null;
  /** Whether the caller may use the editor. */
  canEdit: boolean;
}

const ACCESS_KEY = "obAccess";

const DEFAULT_FOLDERS_HEADER = "x-orrery-folders";
const DEFAULT_CANEDIT_HEADER = "x-orrery-can-edit";

/**
 * Resolve the effective access config. Values may come from the project config
 * file (`access:` block) and be overridden by environment variables, so the
 * feature works whether Orrery is embedded as a library, run from a config
 * file, or configured purely via env in a container.
 */
export function resolveAccessConfig(fromConfig?: Partial<AccessConfig>): AccessConfig {
  const envEnabled =
    process.env.ORRERY_ACCESS_CONTROL === "header" ||
    process.env.ORRERY_ACCESS_CONTROL === "true";
  const envRequireFolder = process.env.ORRERY_REQUIRE_FOLDER;
  return {
    enabled: envEnabled || fromConfig?.enabled === true,
    foldersHeader:
      process.env.ORRERY_FOLDERS_HEADER || fromConfig?.foldersHeader || DEFAULT_FOLDERS_HEADER,
    canEditHeader:
      process.env.ORRERY_CANEDIT_HEADER || fromConfig?.canEditHeader || DEFAULT_CANEDIT_HEADER,
    requireFolder:
      envRequireFolder != null ? envRequireFolder !== "false" : (fromConfig?.requireFolder ?? true),
  };
}

export function resolveAccess(c: Context, cfg: AccessConfig): RequestAccess {
  const raw = (c.req.header(cfg.foldersHeader) || "").trim();
  // "*" → all folders (null sentinel); "" → none (fail closed); else the set.
  const folders =
    raw === "*"
      ? null
      : new Set(
          raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
  const canEditRaw = (c.req.header(cfg.canEditHeader) || "").trim().toLowerCase();
  const canEdit = canEditRaw === "1" || canEditRaw === "true";
  return { folders, canEdit };
}

/** Whether a dashboard in `folder` is visible under this request's access. */
export function isFolderAllowed(access: RequestAccess, folder: string, cfg: AccessConfig): boolean {
  if (cfg.requireFolder && !folder) return false; // root dashboards are never served
  if (access.folders === null) return true; // "*"
  return access.folders.has(folder);
}

/** Filter a dashboard list to those the request may see. */
export function filterDashboards(
  dashboards: DiscoveredDashboard[],
  access: RequestAccess,
  cfg: AccessConfig,
): DiscoveredDashboard[] {
  return dashboards.filter((d) => isFolderAllowed(access, d.folder, cfg));
}

export function getRequestAccess(c: Context): RequestAccess | undefined {
  return c.get(ACCESS_KEY) as RequestAccess | undefined;
}

function isEditorPath(path: string, method: string): boolean {
  return (
    path === "/edit" ||
    path.startsWith("/edit/") ||
    path.startsWith("/api/save") ||
    path === "/api/new" ||
    path === "/api/folders" ||
    path === "/api/validate" ||
    path === "/api/connections" ||
    // Editor's per-dashboard source read (GET /api/dashboards/:name). The plural
    // launcher list (/api/dashboards, no name) is filtered separately.
    (path.startsWith("/api/dashboards/") && method === "GET")
  );
}

/**
 * Enforce access on the routes that serve dashboard content or the editor.
 * Stores the resolved access on the context so the launcher/list handlers can
 * filter their output. No-ops entirely when access control is disabled.
 */
export function accessMiddleware(
  cfg: AccessConfig,
  getDashboards: () => DiscoveredDashboard[],
): MiddlewareHandler {
  return async (c, next) => {
    if (!cfg.enabled) return next();

    const access = resolveAccess(c, cfg);
    c.set(ACCESS_KEY, access);

    const path = c.req.path;
    const method = c.req.method;

    // The editor is gated by the edit capability, not by folder.
    if (isEditorPath(path, method)) {
      if (!access.canEdit) return c.text("Forbidden", 403);
      return next();
    }

    // Dashboard render: /d/:name and /dashboard/:name. Treat a disallowed (or
    // root) dashboard as nonexistent so we don't leak that it exists.
    const renderMatch = path.match(/^\/(?:d|dashboard)\/(.+)$/);
    if (renderMatch) {
      const slug = decodeURIComponent(renderMatch[1]);
      const dash = getDashboards().find((d) => d.slug === slug);
      if (dash && !isFolderAllowed(access, dash.folder, cfg)) {
        return c.html("<!DOCTYPE html><html><body><h1>Dashboard not found</h1></body></html>", 404);
      }
    }

    // Partial-update query: POST /api/query { dashboard: <slug>, ... }. Hono
    // caches the parsed body, so the route handler can still read it.
    if (path === "/api/query" && method === "POST") {
      const body = (await c.req.json().catch(() => ({}))) as { dashboard?: string };
      const slug = body?.dashboard;
      const dash = slug ? getDashboards().find((d) => d.slug === slug) : undefined;
      if (dash && !isFolderAllowed(access, dash.folder, cfg)) {
        return c.json({ error: "Dashboard not found" }, 404);
      }
    }

    return next();
  };
}
