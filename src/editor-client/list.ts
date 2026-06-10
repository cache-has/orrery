import { listDashboards, listFolders, newDashboard } from "./api.js";
import { promptNewDashboard } from "./modal.js";

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
    items.sort((a, b) => a.slug.localeCompare(b.slug));
    const rows = items
      .map((d) => {
        const modified = new Date(d.lastModified).toLocaleString();
        return `<li>
          <a class="ob-ed-row" href="/edit/${encodeURIComponent(d.slug)}">
            <span class="ob-ed-name">${escapeHtml(d.title || d.slug)}</span>
            <span class="ob-ed-modified">${escapeHtml(modified)}</span>
          </a>
        </li>`;
      })
      .join("");
    body.innerHTML = `<ul class="ob-ed-list">${rows}</ul>`;
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
