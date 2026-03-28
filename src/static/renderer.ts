/**
 * Static HTML renderer.
 *
 * Adapts the server-side renderPage for static export:
 * - Adds snapshot metadata (<meta> tags)
 * - Inlines interactive JS for table sorting/filtering and chart tooltips
 * - Disables server-dependent features (refresh, auto-refresh, POST /api/query)
 * - Generates a dashboard index page with relative links
 * - Supports external data file references for large datasets
 */

import type { DashboardNode } from "../parser/ast.js";
import type { ResolvedLayout } from "../renderer/layout.js";
import type { DashboardData } from "../renderer/data.js";
import { renderPage } from "../renderer/html.js";
import { OPENBOARD_CSS } from "../renderer/styles.js";
import { OPENBOARD_INTERACTIVE_JS } from "../server/interactive.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaticRenderOptions {
  dashboard: DashboardNode;
  layout: ResolvedLayout;
  data: DashboardData;
  paramValues: Record<string, unknown>;
  snapshotLabel?: string;
  builtAt?: Date;
  version?: string;
  /** Component IDs whose data was split to external JSON files */
  externalDataComponents?: Map<string, string>;
  /** If true, inline all assets (CSS, JS) for single-file output */
  selfContained?: boolean;
}

export interface StaticIndexDashboard {
  slug: string;
  title: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Static page renderer
// ---------------------------------------------------------------------------

/**
 * Render a static HTML page for a dashboard.
 * Builds on renderPage() but adds static-specific modifications.
 */
export function renderStaticPage(options: StaticRenderOptions): string {
  const {
    dashboard,
    layout,
    data,
    paramValues,
    snapshotLabel,
    builtAt = new Date(),
    version = "0.1.0",
    externalDataComponents,
    selfContained,
  } = options;

  // Start with the standard server-rendered page
  let html = renderPage({ dashboard, layout, data, paramValues });

  // Add snapshot metadata to <head>
  const metaTags = buildMetaTags(builtAt, snapshotLabel, version);
  html = html.replace("</head>", `  ${metaTags}\n</head>`);

  // Add snapshot footer
  const footerHtml = buildSnapshotFooter(builtAt, snapshotLabel);
  html = html.replace("</div>\n\n  <script>", `  ${footerHtml}\n  </div>\n\n  <script>`);

  // Inject static-mode interactive JS (inline, since there's no server)
  const staticInteractiveJs = buildStaticInteractiveScript(externalDataComponents);
  html = html.replace(
    "</body>",
    `  <script>\n${staticInteractiveJs}\n  </script>\n</body>`,
  );

  // Remove refresh buttons (no server to refresh from)
  html = html.replace(
    /<button class="openboard-refresh"[^>]*>&#x21bb;<\/button>/g,
    "",
  );

  return html;
}

// ---------------------------------------------------------------------------
// Static index page renderer
// ---------------------------------------------------------------------------

/**
 * Render the dashboard index page listing all exported dashboards.
 */
export function renderStaticIndex(
  dashboards: StaticIndexDashboard[],
  snapshotLabel?: string,
  builtAt: Date = new Date(),
): string {
  const rows = dashboards
    .map((d) => {
      const desc = d.description
        ? `<p class="ob-idx-desc">${escapeHtml(d.description)}</p>`
        : "";
      return `<a href="d/${escapeHtml(d.slug)}/index.html" class="ob-idx-card">
      <h2>${escapeHtml(d.title)}</h2>
      ${desc}
    </a>`;
    })
    .join("\n    ");

  const empty =
    dashboards.length === 0
      ? `<p class="ob-idx-empty">No dashboards exported.</p>`
      : "";

  const snapshotInfo = snapshotLabel
    ? `<p class="ob-idx-snapshot">Snapshot: ${escapeHtml(snapshotLabel)} &mdash; ${formatDate(builtAt)}</p>`
    : `<p class="ob-idx-snapshot">Built ${formatDate(builtAt)}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenBoard</title>
  <meta name="openboard:built-at" content="${builtAt.toISOString()}">
  ${snapshotLabel ? `<meta name="openboard:snapshot-label" content="${escapeAttr(snapshotLabel)}">` : ""}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #1a1a1a; min-height: 100vh; }
    .ob-idx-header { padding: 2rem 2rem 1rem; max-width: 900px; margin: 0 auto; }
    .ob-idx-header h1 { font-size: 1.5rem; font-weight: 600; }
    .ob-idx-header p { color: #666; margin-top: 0.25rem; }
    .ob-idx-snapshot { font-size: 0.85rem; color: #888; margin-top: 0.5rem; }
    .ob-idx-grid { max-width: 900px; margin: 0 auto; padding: 0 2rem 2rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
    .ob-idx-card { display: block; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.25rem; text-decoration: none; color: inherit; transition: border-color 0.15s, box-shadow 0.15s; }
    .ob-idx-card:hover { border-color: #999; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .ob-idx-card h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.4rem; }
    .ob-idx-desc { font-size: 0.9rem; color: #555; line-height: 1.4; }
    .ob-idx-empty { max-width: 900px; margin: 2rem auto; padding: 0 2rem; color: #666; }
  </style>
</head>
<body>
  <div class="ob-idx-header">
    <h1>OpenBoard</h1>
    <p>${dashboards.length} dashboard${dashboards.length !== 1 ? "s" : ""}</p>
    ${snapshotInfo}
  </div>
  <div class="ob-idx-grid">
    ${rows}
  </div>
  ${empty}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetaTags(builtAt: Date, snapshotLabel?: string, version?: string): string {
  const tags = [`<meta name="openboard:built-at" content="${builtAt.toISOString()}">`];
  if (snapshotLabel) {
    tags.push(`<meta name="openboard:snapshot-label" content="${escapeAttr(snapshotLabel)}">`);
  }
  if (version) {
    tags.push(`<meta name="openboard:version" content="${escapeAttr(version)}">`);
  }
  return tags.join("\n  ");
}

function buildSnapshotFooter(builtAt: Date, snapshotLabel?: string): string {
  const label = snapshotLabel
    ? `Data snapshot: ${escapeHtml(snapshotLabel)} &mdash; Built ${formatDate(builtAt)}`
    : `Data snapshot &mdash; Built ${formatDate(builtAt)}`;

  return `<footer class="openboard-snapshot-footer" style="text-align:center; padding:1rem; font-size:0.8rem; color:#888; border-top:1px solid #e2e8f0; margin-top:1rem;">
      ${label}
    </footer>`;
}

/**
 * Build a static-mode interactive script that works without a server.
 *
 * Features that work:
 * - Table sorting and filtering (operates on embedded data)
 * - Chart tooltips (ECharts handles this client-side)
 * - Parameter filtering on pre-fetched data (client-side filtering)
 *
 * Features disabled:
 * - Live data refresh (no server)
 * - Auto-refresh
 * - POST /api/query calls
 */
function buildStaticInteractiveScript(
  externalDataComponents?: Map<string, string>,
): string {
  // Load external data files if any
  const externalLoaders = externalDataComponents?.size
    ? buildExternalDataLoaders(externalDataComponents)
    : "";

  return `(function() {
  'use strict';

  var state = window.__OPENBOARD__;
  if (!state) return;

  // Static mode flag — disables server-dependent features
  state.__static__ = true;

  ${externalLoaders}

  // Table sorting
  document.addEventListener('click', function(e) {
    var th = e.target.closest('.openboard-table th[data-sortable]');
    if (!th) return;
    var table = th.closest('.openboard-table');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    if (!tbody) return;

    var colIndex = Array.from(th.parentNode.children).indexOf(th);
    var rows = Array.from(tbody.querySelectorAll('tr'));
    var currentDir = th.getAttribute('data-sort-dir');
    var newDir = currentDir === 'asc' ? 'desc' : 'asc';

    // Reset all sort indicators
    var allTh = table.querySelectorAll('th[data-sortable]');
    for (var i = 0; i < allTh.length; i++) {
      allTh[i].removeAttribute('data-sort-dir');
      var indicator = allTh[i].querySelector('.sort-indicator');
      if (indicator) indicator.textContent = '';
    }

    th.setAttribute('data-sort-dir', newDir);
    var indicator = th.querySelector('.sort-indicator');
    if (indicator) indicator.textContent = newDir === 'asc' ? ' \\u25B2' : ' \\u25BC';

    rows.sort(function(a, b) {
      var aVal = a.children[colIndex] ? a.children[colIndex].textContent.trim() : '';
      var bVal = b.children[colIndex] ? b.children[colIndex].textContent.trim() : '';
      var aNum = parseFloat(aVal.replace(/[^0-9.\\-]/g, ''));
      var bNum = parseFloat(bVal.replace(/[^0-9.\\-]/g, ''));
      var cmp;
      if (!isNaN(aNum) && !isNaN(bNum)) {
        cmp = aNum - bNum;
      } else {
        cmp = aVal.localeCompare(bVal);
      }
      return newDir === 'asc' ? cmp : -cmp;
    });

    for (var j = 0; j < rows.length; j++) {
      tbody.appendChild(rows[j]);
    }
  });

  // Table filtering (search input)
  document.addEventListener('input', function(e) {
    var input = e.target.closest('.openboard-table-filter');
    if (!input) return;
    var table = input.closest('.openboard-component').querySelector('.openboard-table');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    if (!tbody) return;
    var filter = input.value.toLowerCase();
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var text = rows[i].textContent.toLowerCase();
      rows[i].style.display = text.indexOf(filter) >= 0 ? '' : 'none';
    }
  });
})();`;
}

function buildExternalDataLoaders(externalDataComponents: Map<string, string>): string {
  const entries: string[] = [];
  for (const [compId, filePath] of externalDataComponents) {
    entries.push(
      `  fetch('${filePath}').then(function(r){return r.json();}).then(function(d){state.data['${compId}']={result:d};});`,
    );
  }
  return `// Load external data files\n${entries.join("\n")}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
