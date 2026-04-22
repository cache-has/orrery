import { Hono } from "hono";
import { logger } from "hono/logger";
import { healthRoutes } from "./routes/health.js";
import { dashboardRoutes, type DashboardRouteOptions } from "./routes/dashboard.js";
import { editorRoutes } from "./routes/editor.js";
import type { DiscoveredDashboard } from "./discovery.js";
import type { BrandingConfig } from "../renderer/theme.js";
import type { DashboardSource } from "../sources/types.js";
import type { ConnectionManager } from "../connections/manager.js";

export interface AppOptions {
  /** Options for dashboard rendering. When omitted, only health routes are available. */
  dashboard?: DashboardRouteOptions;
  /** Whether running in dev mode (injects hot-reload client JS). */
  devMode?: boolean;
  /** Function to get current list of discovered dashboards for the index page. */
  getDashboards?: () => DiscoveredDashboard[];
  /** Function to get current branding config (from resolved theme). */
  getBranding?: () => BrandingConfig | undefined;
  /** Web editor settings. When `enabled: false`, editor routes return 404. */
  editor?: {
    enabled: boolean;
    source?: DashboardSource;
    connManager?: ConnectionManager;
    resolveNewPath?: (name: string) => string;
  };
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  app.use("*", logger());
  app.route("/api", healthRoutes);

  // Editor routes (gated). Mount first so they take precedence over dashboard catch-alls.
  app.route(
    "/",
    editorRoutes({
      enabled: options.editor?.enabled ?? false,
      source: options.editor?.source,
      connManager: options.editor?.connManager,
      getDashboards: options.getDashboards,
      resolveNewPath: options.editor?.resolveNewPath,
    }),
  );

  if (options.dashboard) {
    const dashRoutes = dashboardRoutes({
      ...options.dashboard,
      devMode: options.devMode,
      getDashboards: options.dashboard.getDashboards ?? options.getDashboards,
    });
    app.route("/", dashRoutes);
  }

  // Dashboard index at /
  app.get("/", (c) => {
    if (options.getDashboards) {
      const dashboards = options.getDashboards();
      const branding = options.getBranding?.();
      return c.html(renderDashboardIndex(dashboards, branding, options.editor?.enabled ?? false));
    }

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenBoard</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 80px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { font-size: 2rem; }
    p { color: #555; line-height: 1.6; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>OpenBoard</h1>
  <p>Dashboards as code, not clicks.</p>
  <p>Health check: <code>GET /api/health</code></p>
</body>
</html>`);
  });

  // API endpoint to list dashboards
  app.get("/api/dashboards", (c) => {
    if (options.getDashboards) {
      const dashboards = options.getDashboards();
      return c.json(dashboards.map((d) => ({
        slug: d.slug,
        title: d.title,
        description: d.description,
        lastModified: d.lastModified.toISOString(),
        url: `/d/${d.slug}`,
      })));
    }
    return c.json([]);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Dashboard index HTML
// ---------------------------------------------------------------------------

function renderDashboardIndex(dashboards: DiscoveredDashboard[], branding?: BrandingConfig, editorEnabled = false): string {
  // Group dashboards by folder
  const groups = new Map<string, DiscoveredDashboard[]>();
  for (const d of dashboards) {
    const folder = d.folder || "";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(d);
  }

  // Sort folders: root first, then alphabetical
  const sortedFolders = [...groups.keys()].sort((a, b) => {
    if (a === "" && b !== "") return -1;
    if (a !== "" && b === "") return 1;
    return a.localeCompare(b);
  });

  const hasFolders = sortedFolders.length > 1 || (sortedFolders.length === 1 && sortedFolders[0] !== "");

  function renderCard(d: DiscoveredDashboard): string {
    const desc = d.description ? `<p class="ob-idx-desc">${escapeHtml(d.description)}</p>` : "";
    const modified = d.lastModified.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    return `<a href="/d/${escapeHtml(d.slug)}" class="ob-idx-card">
      <h2>${escapeHtml(d.title)}</h2>
      ${desc}
      <span class="ob-idx-meta">${escapeHtml(modified)}</span>
    </a>`;
  }

  let content: string;
  if (hasFolders) {
    content = sortedFolders.map((folder) => {
      const items = groups.get(folder)!;
      const folderLabel = folder || "Dashboards";
      const cards = items.map(renderCard).join("\n      ");
      return `<div class="ob-idx-section">
      <h2 class="ob-idx-folder">${escapeHtml(folderLabel)}</h2>
      <div class="ob-idx-grid">${cards}</div>
    </div>`;
    }).join("\n    ");
  } else {
    const cards = dashboards.map(renderCard).join("\n    ");
    content = `<div class="ob-idx-grid">${cards}</div>`;
  }

  const empty = dashboards.length === 0
    ? `<p class="ob-idx-empty">No dashboards found. Create a <code>.board</code> file in your dashboards directory to get started.</p>`
    : "";

  const indexTitle = branding?.title ? escapeHtml(branding.title) : "OpenBoard";
  const pageTitle = branding?.title ? `${escapeHtml(branding.title)} — Dashboards` : "OpenBoard — Dashboards";
  const faviconLink = branding?.favicon ? `\n  <link rel="icon" href="/openboard/assets/${escapeHtml(branding.favicon)}" />` : "";
  const logoHtml = branding?.logo
    ? `<img src="/openboard/assets/${escapeHtml(branding.logo)}" alt="${indexTitle}" style="height:32px;width:auto;object-fit:contain;margin-right:0.5rem;vertical-align:middle;" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>${faviconLink}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #1a1a1a; min-height: 100vh; }
    .ob-idx-header { padding: 2rem 2rem 1rem; max-width: 900px; margin: 0 auto; }
    .ob-idx-header h1 { font-size: 1.5rem; font-weight: 600; display: flex; align-items: center; }
    .ob-idx-header p { color: #666; margin-top: 0.25rem; }
    .ob-idx-header-actions { margin-top: 0.75rem; }
    .ob-idx-edit-link { display: inline-block; padding: 0.4rem 0.85rem; background: #1a1a1a; color: #fff; border-radius: 6px; text-decoration: none; font-size: 0.85rem; font-weight: 500; }
    .ob-idx-edit-link:hover { background: #333; }
    .ob-idx-section { max-width: 900px; margin: 0 auto; padding: 0 2rem 1.5rem; }
    .ob-idx-folder { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 0.75rem; padding-bottom: 0.4rem; border-bottom: 1px solid #e0e0e0; }
    .ob-idx-grid { max-width: 900px; margin: 0 auto; padding: 0 2rem 2rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
    .ob-idx-section .ob-idx-grid { padding: 0; margin: 0; }
    .ob-idx-card { display: block; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.25rem; text-decoration: none; color: inherit; transition: border-color 0.15s, box-shadow 0.15s; }
    .ob-idx-card:hover { border-color: #999; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .ob-idx-card h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.4rem; }
    .ob-idx-desc { font-size: 0.9rem; color: #555; line-height: 1.4; margin-bottom: 0.6rem; }
    .ob-idx-meta { font-size: 0.8rem; color: #999; }
    .ob-idx-empty { max-width: 900px; margin: 2rem auto; padding: 0 2rem; color: #666; }
    .ob-idx-empty code { background: #e8e8e8; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="ob-idx-header">
    <h1>${logoHtml}${indexTitle}</h1>
    <p>${dashboards.length} dashboard${dashboards.length !== 1 ? "s" : ""}</p>
    ${editorEnabled ? `<div class="ob-idx-header-actions"><a class="ob-idx-edit-link" href="/edit">Edit dashboards</a></div>` : ""}
  </div>
  ${content}
  ${empty}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
