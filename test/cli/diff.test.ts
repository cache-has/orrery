import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser.js";
import { diffDashboards, formatDiffMarkdown } from "../../src/cli/diff.js";
import type { DashboardNode } from "../../src/parser/ast.js";

function parseDashboard(source: string): DashboardNode {
  return parse(source, "test.board");
}

describe("diffDashboards", () => {
  it("detects added dashboards", () => {
    const base = new Map<string, DashboardNode>();
    const head = new Map<string, DashboardNode>();
    head.set(
      "dashboards/new.board",
      parseDashboard('dashboard "New" {}'),
    );

    const diff = diffDashboards(base, head);
    expect(diff.added).toEqual(["dashboards/new.board"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("detects removed dashboards", () => {
    const base = new Map<string, DashboardNode>();
    base.set(
      "dashboards/old.board",
      parseDashboard('dashboard "Old" {}'),
    );
    const head = new Map<string, DashboardNode>();

    const diff = diffDashboards(base, head);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["dashboards/old.board"]);
  });

  it("detects query changes in a component", () => {
    const base = new Map<string, DashboardNode>();
    base.set(
      "dashboards/sales.board",
      parseDashboard(`dashboard "Sales" {
        row {
          chart "Revenue" {
            query: "SELECT date, amount FROM orders"
          }
        }
      }`),
    );

    const head = new Map<string, DashboardNode>();
    head.set(
      "dashboards/sales.board",
      parseDashboard(`dashboard "Sales" {
        row {
          chart "Revenue" {
            query: "SELECT date, SUM(amount) FROM orders GROUP BY date"
          }
        }
      }`),
    );

    const diff = diffDashboards(base, head);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].queryChanges).toHaveLength(1);
    expect(diff.changed[0].queryChanges[0].component).toBe("Revenue");
    expect(diff.changed[0].queryChanges[0].oldQuery).toContain("SELECT date, amount");
    expect(diff.changed[0].queryChanges[0].newQuery).toContain("SUM(amount)");
  });

  it("detects added parameters", () => {
    const base = new Map<string, DashboardNode>();
    base.set("d.board", parseDashboard('dashboard "D" {}'));

    const head = new Map<string, DashboardNode>();
    head.set(
      "d.board",
      parseDashboard(`dashboard "D" {
        param region = select(default: "US", options: ["US", "EU"])
      }`),
    );

    const diff = diffDashboards(base, head);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].paramChanges).toEqual([
      { type: "added", name: "region" },
    ]);
  });

  it("detects removed parameters", () => {
    const base = new Map<string, DashboardNode>();
    base.set(
      "d.board",
      parseDashboard(`dashboard "D" {
        param region = select(default: "US", options: ["US", "EU"])
      }`),
    );

    const head = new Map<string, DashboardNode>();
    head.set("d.board", parseDashboard('dashboard "D" {}'));

    const diff = diffDashboards(base, head);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].paramChanges).toEqual([
      { type: "removed", name: "region" },
    ]);
  });

  it("detects added components", () => {
    const base = new Map<string, DashboardNode>();
    base.set(
      "d.board",
      parseDashboard(`dashboard "D" {
        row {
          metric "Revenue" {
            query: "SELECT SUM(amount) as value FROM orders"
          }
        }
      }`),
    );

    const head = new Map<string, DashboardNode>();
    head.set(
      "d.board",
      parseDashboard(`dashboard "D" {
        row {
          metric "Revenue" {
            query: "SELECT SUM(amount) as value FROM orders"
          }
          metric "Orders" {
            query: "SELECT COUNT(*) as value FROM orders"
          }
        }
      }`),
    );

    const diff = diffDashboards(base, head);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].layoutChanges.some((l) => l.type === "added")).toBe(true);
  });

  it("detects removed components", () => {
    const base = new Map<string, DashboardNode>();
    base.set(
      "d.board",
      parseDashboard(`dashboard "D" {
        row {
          metric "Revenue" {
            query: "SELECT 1 as value"
          }
          metric "Orders" {
            query: "SELECT 1 as value"
          }
        }
      }`),
    );

    const head = new Map<string, DashboardNode>();
    head.set(
      "d.board",
      parseDashboard(`dashboard "D" {
        row {
          metric "Revenue" {
            query: "SELECT 1 as value"
          }
        }
      }`),
    );

    const diff = diffDashboards(base, head);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].layoutChanges.some((l) => l.type === "removed")).toBe(true);
  });

  it("reports no changes for identical dashboards", () => {
    const source = `dashboard "D" {
      param region = select(default: "US", options: ["US", "EU"])
      row {
        chart "Revenue" {
          query: "SELECT 1"
        }
      }
    }`;
    const base = new Map<string, DashboardNode>();
    base.set("d.board", parseDashboard(source));
    const head = new Map<string, DashboardNode>();
    head.set("d.board", parseDashboard(source));

    const diff = diffDashboards(base, head);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});

describe("formatDiffMarkdown", () => {
  it("produces valid markdown for a diff with changes", () => {
    const diff = diffDashboards(
      new Map([["d.board", parseDashboard('dashboard "D" {}')]]),
      new Map([
        ["d.board", parseDashboard(`dashboard "D" { param x = text() }`)],
        ["new.board", parseDashboard('dashboard "New" {}')],
      ]),
    );

    const md = formatDiffMarkdown(diff, "main", "HEAD");
    expect(md).toContain("## Dashboard Diff");
    expect(md).toContain("### New Dashboards");
    expect(md).toContain("`new.board`");
    expect(md).toContain("**Parameter Changes:**");
  });

  it("reports no changes cleanly", () => {
    const md = formatDiffMarkdown(
      { added: [], removed: [], changed: [], parseErrors: [] },
      "main",
      "HEAD",
    );
    expect(md).toContain("No dashboard changes detected");
  });
});
