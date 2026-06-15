import type { DashboardListItem } from "./api.js";

export interface FolderGroup {
  /** Folder name; "" for the flat / uncategorized bucket. */
  folder: string;
  items: DashboardListItem[];
}

export interface GroupedDashboards {
  /**
   * Whether to render folder section headings. False when no dashboard has a
   * folder (access control off, or a flat layout) — the caller renders the
   * single group as a plain list. This keeps Orrery general: folders are an
   * optional organizational layer, not a requirement.
   */
  grouped: boolean;
  groups: FolderGroup[];
}

/**
 * Group the dashboard list by folder for the editor index.
 *
 * Operates purely on the items it is given — it never fetches or filters — so
 * it inherently respects whatever access scoping the server already applied to
 * `GET /api/dashboards` (a caller only ever receives the folders they may see).
 *
 * Folders sort alphabetically with the root/uncategorized bucket last. When
 * nothing has a folder, returns a single ungrouped bucket so the list renders
 * flat exactly as it did before folders existed.
 */
export function groupDashboardsByFolder(items: DashboardListItem[]): GroupedDashboards {
  const byTitle = (a: DashboardListItem, b: DashboardListItem) =>
    (a.title || a.slug).localeCompare(b.title || b.slug);

  const map = new Map<string, DashboardListItem[]>();
  for (const d of items) {
    const folder = d.folder || "";
    if (!map.has(folder)) map.set(folder, []);
    map.get(folder)!.push(d);
  }

  const folders = [...map.keys()].sort((a, b) => {
    if (a === "" && b !== "") return 1; // root sinks to the bottom
    if (a !== "" && b === "") return -1;
    return a.localeCompare(b);
  });

  const grouped = folders.some((f) => f !== "");
  if (!grouped) {
    return { grouped: false, groups: [{ folder: "", items: [...items].sort(byTitle) }] };
  }
  return {
    grouped: true,
    groups: folders.map((folder) => ({ folder, items: map.get(folder)!.sort(byTitle) })),
  };
}
