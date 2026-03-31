import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { LocalSource } from "../../src/sources/local.js";
import type { DashboardSourceEvent } from "../../src/sources/types.js";

const TMP = resolve(__dirname, "../.tmp-local-source");

beforeEach(() => {
  mkdirSync(resolve(TMP, "dashboards"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("LocalSource", () => {
  it("lists .board files recursively", async () => {
    writeFileSync(resolve(TMP, "dashboards/a.board"), "content");
    writeFileSync(resolve(TMP, "dashboards/b.board"), "content");
    writeFileSync(resolve(TMP, "dashboards/readme.md"), "not a board");

    const source = new LocalSource(resolve(TMP, "dashboards"));
    const files = await source.list();

    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".board"))).toBe(true);
  });

  it("lists files in subdirectories", async () => {
    mkdirSync(resolve(TMP, "dashboards/team"), { recursive: true });
    writeFileSync(resolve(TMP, "dashboards/team/sales.board"), "content");
    writeFileSync(resolve(TMP, "dashboards/overview.board"), "content");

    const source = new LocalSource(resolve(TMP, "dashboards"));
    const files = await source.list();

    expect(files).toHaveLength(2);
  });

  it("returns empty array for nonexistent directory", async () => {
    const source = new LocalSource(resolve(TMP, "nonexistent"));
    const files = await source.list();
    expect(files).toHaveLength(0);
  });

  it("reads file content", async () => {
    writeFileSync(resolve(TMP, "dashboards/test.board"), "hello world");

    const source = new LocalSource(resolve(TMP, "dashboards"));
    const content = await source.read(resolve(TMP, "dashboards/test.board"));
    expect(content).toBe("hello world");
  });

  it("returns a human-readable description", () => {
    const dir = resolve(TMP, "dashboards");
    const source = new LocalSource(dir);
    expect(source.describe()).toBe(`local: ${dir}`);
  });

  it("detects .board file changes via watch", async () => {
    writeFileSync(resolve(TMP, "dashboards/test.board"), "initial");

    const source = new LocalSource(resolve(TMP, "dashboards"));
    const events: DashboardSourceEvent[] = [];
    source.watch!((event) => events.push(event));

    // Wait for watcher to initialize
    await new Promise((r) => setTimeout(r, 500));

    // Modify file
    writeFileSync(resolve(TMP, "dashboards/test.board"), "modified");

    // Wait for change detection
    await new Promise((r) => setTimeout(r, 1000));

    source.unwatch!();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe("change");
    expect(events[0].path).toContain("test.board");
  });

  it("detects new .board files via watch", async () => {
    const source = new LocalSource(resolve(TMP, "dashboards"));
    const events: DashboardSourceEvent[] = [];
    source.watch!((event) => events.push(event));

    await new Promise((r) => setTimeout(r, 500));

    writeFileSync(resolve(TMP, "dashboards/new.board"), "new dashboard");

    await new Promise((r) => setTimeout(r, 1000));

    source.unwatch!();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe("add");
    expect(events[0].path).toContain("new.board");
  });

  it("ignores non-.board file changes in watch", async () => {
    writeFileSync(resolve(TMP, "dashboards/readme.md"), "initial");

    const source = new LocalSource(resolve(TMP, "dashboards"));
    const events: DashboardSourceEvent[] = [];
    source.watch!((event) => events.push(event));

    await new Promise((r) => setTimeout(r, 500));

    writeFileSync(resolve(TMP, "dashboards/readme.md"), "updated");

    await new Promise((r) => setTimeout(r, 1000));

    source.unwatch!();

    expect(events).toHaveLength(0);
  });
});
