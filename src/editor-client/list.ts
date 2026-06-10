import { listDashboards, listFolders, newDashboard } from "./api.js";
import { promptNewDashboard } from "./modal.js";
import { groupDashboardsByFolder } from "./grouping.js";

export async function renderListPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="ob-ed-list-wrap">
      <div class="ob-ed-list-head">
        <h1>Edit dashboards</h1>
        <div class="ob-ed-nav">
          <a href="/">Viewer home</a>
          <button type="button" class="ob-ed-btn" data-action="new">New dashboard</button>
        </div>
      </div>
      <div class="ob-ed-list-body"></div>
    </div>
  `;
  const body = root.querySelector<HTMLDivElement>(".ob-ed-list-body")!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-action="new"]')!;

  newBtn.addEventListener("click", async () => {
    // Fetch the caller's folder options first so the modal can require/scope
    // the picker. Fall back to a folderless prompt if the lookup fails.
    let folderOpts = { folders: [] as string[], required: false };
    try {
      folderOpts = await listFolders();
    } catch {
      /* ignore — render the basic prompt */
    }
    promptNewDashboard(async (name, folder) => {
      const res = await newDashboard(name, folder || undefined);
      if ("ok" in res) {
        window.location.href = `/edit/${encodeURIComponent(name)}`;
        return null;
      }
      return res.message || res.error;
    }, folderOpts);
  });

  try {
    const items = await listDashboards();
    if (items.length === 0) {
      body.innerHTML = `<p class="ob-ed-empty">No dashboards yet. Click <strong>New dashboard</strong> to create your first.</p>`;
      return;
    }

    const renderRow = (d: (typeof items)[number]) => {
      const modified = new Date(d.lastModified).toLocaleString();
      return `<li>
        <a class="ob-ed-row" href="/edit/${encodeURIComponent(d.slug)}">
          <span class="ob-ed-name">${escapeHtml(d.title || d.slug)}</span>
          <span class="ob-ed-modified">${escapeHtml(modified)}</span>
        </a>
      </li>`;
    };

    // Group by folder (mirrors the viewer's folder-grouped index). Falls back to
    // a flat list when nothing has a folder — see groupDashboardsByFolder.
    const { grouped, groups } = groupDashboardsByFolder(items);
    if (!grouped) {
      body.innerHTML = `<ul class="ob-ed-list">${groups[0].items.map(renderRow).join("")}</ul>`;
      return;
    }

    body.innerHTML = groups
      .map(({ folder, items: groupItems }) => {
        const rows = groupItems.map(renderRow).join("");
        const label = folder || "Uncategorized";
        return `<div class="ob-ed-section">
          <h2 class="ob-ed-folder">${escapeHtml(label)}</h2>
          <ul class="ob-ed-list">${rows}</ul>
        </div>`;
      })
      .join("");
  } catch (err) {
    body.innerHTML = `<p class="ob-ed-empty">Failed to load dashboards: ${escapeHtml(String(err))}</p>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
