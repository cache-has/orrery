import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { staticBuild } from "../../src/static/builder.js";

const TEST_DIR = resolve(tmpdir(), "orrery-build-test-" + process.pid);
const OUTPUT_DIR = resolve(TEST_DIR, "output");
const DASHBOARDS_DIR = resolve(TEST_DIR, "dashboards");
const CONNECTIONS_DIR = resolve(TEST_DIR, "connections");

const SIMPLE_BOARD = `dashboard "Test Dashboard" {
  description: "A test dashboard"
  connection: "sqlite_test"

  row {
    text "Info" {
      > Hello from **static export**.
    }
  }
}`;

const SQLITE_CONNECTION = `name: sqlite_test
type: sqlite
database: ":memory:"
`;

beforeEach(() => {
  mkdirSync(DASHBOARDS_DIR, { recursive: true });
  mkdirSync(CONNECTIONS_DIR, { recursive: true });
  writeFileSync(join(DASHBOARDS_DIR, "test.board"), SIMPLE_BOARD);
  writeFileSync(join(CONNECTIONS_DIR, "sqlite.yaml"), SQLITE_CONNECTION);
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("staticBuild", () => {
  it("produces index.html and dashboard HTML", async () => {
    const result = await staticBuild({
      projectRoot: TEST_DIR,
      outputDir: OUTPUT_DIR,
    });

    expect(result.dashboards).toHaveLength(1);
    expect(result.dashboards[0].slug).toBe("test");
    expect(result.dashboards[0].title).toBe("Test Dashboard");

    // Index page exists
    expect(existsSync(result.indexPath)).toBe(true);
    const indexHtml = readFileSync(result.indexPath, "utf-8");
    expect(indexHtml).toContain("Test Dashboard");
    expect(indexHtml).toContain('href="d/test/index.html"');

    // Dashboard page exists
    const dashPath = resolve(OUTPUT_DIR, "d", "test", "index.html");
    expect(existsSync(dashPath)).toBe(true);
    const dashHtml = readFileSync(dashPath, "utf-8");
    expect(dashHtml).toContain("Test Dashboard");
    expect(dashHtml).toContain("static export");
    expect(dashHtml).toContain("orrery:built-at");
    expect(dashHtml).toContain("state.__static__ = true");
  });

  it("filters by dashboard slug", async () => {
    // Add a second dashboard
    writeFileSync(
      join(DASHBOARDS_DIR, "other.board"),
      `dashboard "Other" { connection: "sqlite_test" }`,
    );

    const result = await staticBuild({
      projectRoot: TEST_DIR,
      outputDir: OUTPUT_DIR,
      dashboardFilter: "test",
    });

    expect(result.dashboards).toHaveLength(1);
    expect(result.dashboards[0].slug).toBe("test");
  });

  it("includes snapshot label in output", async () => {
    const result = await staticBuild({
      projectRoot: TEST_DIR,
      outputDir: OUTPUT_DIR,
      snapshotLabel: "Q1 2026 Report",
    });

    const dashPath = result.dashboards[0].outputPath;
    const html = readFileSync(dashPath, "utf-8");
    expect(html).toContain("Q1 2026 Report");
    expect(html).toContain("orrery:snapshot-label");
  });

  it("cleans output directory before build", async () => {
    // Create a stale file
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(join(OUTPUT_DIR, "stale.html"), "old content");

    await staticBuild({
      projectRoot: TEST_DIR,
      outputDir: OUTPUT_DIR,
    });

    expect(existsSync(join(OUTPUT_DIR, "stale.html"))).toBe(false);
  });

  it("throws when dashboard filter matches nothing", async () => {
    await expect(
      staticBuild({
        projectRoot: TEST_DIR,
        outputDir: OUTPUT_DIR,
        dashboardFilter: "nonexistent",
      }),
    ).rejects.toThrow('Dashboard "nonexistent" not found');
  });
});
