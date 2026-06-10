import { describe, it, expect } from "vitest";
import { groupDashboardsByFolder } from "../../src/editor-client/grouping.js";
import type { DashboardListItem } from "../../src/editor-client/api.js";

function item(slug: string, folder: string, title = slug): DashboardListItem {
  return { slug, title, folder, lastModified: "2026-01-01T00:00:00.000Z", url: `/d/${slug}` };
}

describe("groupDashboardsByFolder", () => {
  it("does NOT group when no dashboard has a folder (generalized / flat layout)", () => {
    const items = [item("b", ""), item("a", "")];
    const { grouped, groups } = groupDashboardsByFolder(items);
    expect(grouped).toBe(false);
    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBe("");
    // single flat bucket, title-sorted
    expect(groups[0].items.map((d) => d.slug)).toEqual(["a", "b"]);
  });

  it("handles an empty list without throwing", () => {
    const { grouped, groups } = groupDashboardsByFolder([]);
    expect(grouped).toBe(false);
    expect(groups[0].items).toEqual([]);
  });

  it("groups by folder, sorted alphabetically", () => {
    const items = [item("mrr", "revenue"), item("spend", "marketing"), item("ops", "reliability")];
    const { grouped, groups } = groupDashboardsByFolder(items);
    expect(grouped).toBe(true);
    expect(groups.map((g) => g.folder)).toEqual(["marketing", "reliability", "revenue"]);
  });

  it("sorts dashboards within a folder by title", () => {
    const items = [item("z", "revenue", "Zeta"), item("a", "revenue", "Alpha")];
    const { groups } = groupDashboardsByFolder(items);
    expect(groups[0].items.map((d) => d.title)).toEqual(["Alpha", "Zeta"]);
  });

  it("sinks the root/uncategorized bucket to the bottom when folders exist", () => {
    const items = [item("loose", ""), item("mrr", "revenue")];
    const { grouped, groups } = groupDashboardsByFolder(items);
    expect(grouped).toBe(true);
    expect(groups.map((g) => g.folder)).toEqual(["revenue", ""]);
  });

  it("only reflects the items it is given (so it respects server-side folder filtering)", () => {
    // Simulate a scoped caller: the server already filtered to just 'revenue'.
    const items = [item("mrr", "revenue")];
    const { groups } = groupDashboardsByFolder(items);
    expect(groups.map((g) => g.folder)).toEqual(["revenue"]);
    // No other folder can appear — the function never invents data.
  });
});
