import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { FileWatcher, type FileChange } from "../../src/server/watcher.js";

const TMP = resolve(__dirname, "../.tmp-watcher");

beforeEach(() => {
  mkdirSync(resolve(TMP, "dashboards"), { recursive: true });
  mkdirSync(resolve(TMP, "connections"), { recursive: true });
  mkdirSync(resolve(TMP, "queries"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("FileWatcher", () => {
  it("detects dashboard file changes", async () => {
    // Create initial file
    writeFileSync(resolve(TMP, "dashboards/test.board"), "initial");

    const watcher = new FileWatcher(
      TMP,
      resolve(TMP, "dashboards"),
      resolve(TMP, "connections"),
      resolve(TMP, "queries"),
    );

    const changes: FileChange[] = [];
    watcher.on("change", (change: FileChange) => changes.push(change));
    watcher.start();

    // Wait for watcher to initialize
    await new Promise((r) => setTimeout(r, 500));

    // Modify file
    writeFileSync(resolve(TMP, "dashboards/test.board"), "modified");

    // Wait for change detection (awaitWriteFinish adds delay)
    await new Promise((r) => setTimeout(r, 1000));

    await watcher.stop();

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0].type).toBe("dashboard");
    expect(changes[0].event).toBe("change");
  });

  it("detects connection file changes", async () => {
    writeFileSync(resolve(TMP, "connections/db.yaml"), "name: test\ntype: sqlite");

    const watcher = new FileWatcher(
      TMP,
      resolve(TMP, "dashboards"),
      resolve(TMP, "connections"),
      resolve(TMP, "queries"),
    );

    const changes: FileChange[] = [];
    watcher.on("change", (change: FileChange) => changes.push(change));
    watcher.start();

    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(resolve(TMP, "connections/db.yaml"), "name: test\ntype: postgres");
    await new Promise((r) => setTimeout(r, 1000));

    await watcher.stop();

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0].type).toBe("connection");
  });

  it("detects query file changes", async () => {
    writeFileSync(resolve(TMP, "queries/report.sql"), "SELECT 1");

    const watcher = new FileWatcher(
      TMP,
      resolve(TMP, "dashboards"),
      resolve(TMP, "connections"),
      resolve(TMP, "queries"),
    );

    const changes: FileChange[] = [];
    watcher.on("change", (change: FileChange) => changes.push(change));
    watcher.start();

    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(resolve(TMP, "queries/report.sql"), "SELECT 2");
    await new Promise((r) => setTimeout(r, 1000));

    await watcher.stop();

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0].type).toBe("query");
  });
});
