import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const TEST_DIR = resolve(tmpdir(), "orrery-validate-test-" + process.pid);
const DASHBOARDS_DIR = resolve(TEST_DIR, "dashboards");

const VALID_BOARD = `dashboard "Sales" {
  description: "Revenue metrics"
  row {
    text "Intro" {
      > Hello world.
    }
  }
}`;

const INVALID_BOARD = `dashboard "Broken" {
  row {
    metric "Bad" {
    }
  }
}`;

function runValidate(args: string[] = [], cwd = TEST_DIR): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", resolve("src/cli/validate.ts"), ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

beforeEach(() => {
  mkdirSync(DASHBOARDS_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

describe("orrery validate", () => {
  it("exits 0 for valid .board files", () => {
    writeFileSync(join(DASHBOARDS_DIR, "sales.board"), VALID_BOARD);
    const result = runValidate();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Validation passed");
  });

  it("exits 1 for .board files with errors", () => {
    writeFileSync(join(DASHBOARDS_DIR, "broken.board"), INVALID_BOARD);
    const result = runValidate();
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("Validation failed");
  });

  it("validates a specific file when passed as argument", () => {
    writeFileSync(join(DASHBOARDS_DIR, "sales.board"), VALID_BOARD);
    const result = runValidate([join(DASHBOARDS_DIR, "sales.board")]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Validation passed");
  });

  it("reports no files found when project has no .board files", () => {
    // Empty dashboards dir, no connections dir
    const emptyDir = resolve(tmpdir(), "orrery-validate-empty-" + process.pid);
    mkdirSync(resolve(emptyDir, "dashboards"), { recursive: true });
    const result = runValidate([], emptyDir);
    // Should indicate no files
    expect(result.stdout).toContain("No .board files found");
    rmSync(emptyDir, { recursive: true });
  });

  it("validates connection files when present", () => {
    writeFileSync(join(DASHBOARDS_DIR, "test.board"), VALID_BOARD);
    const connDir = join(TEST_DIR, "connections");
    mkdirSync(connDir, { recursive: true });
    writeFileSync(
      join(connDir, "local.yaml"),
      'name: test_db\ntype: sqlite\ndatabase: ":memory:"\n',
    );
    const result = runValidate();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test_db");
    expect(result.stdout).toContain("Validation passed");
  });
});
