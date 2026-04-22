import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { loadConfig, discoverDashboards, type ProjectConfig } from "../../src/server/discovery.js";

const TMP = resolve(__dirname, "../.tmp-discovery");

const VALID_BOARD = `dashboard "Test Dashboard" {
  description: "A test dashboard"
  connection: test

  row {
    chart "Sales" {
      query: "SELECT 1"
    }
  }
}`;

const VALID_BOARD_2 = `dashboard "Ops Dashboard" {
  connection: test

  row {
    metric "Uptime" {
      query: "SELECT 1"
    }
  }
}`;

beforeEach(() => {
  mkdirSync(resolve(TMP, "dashboards"), { recursive: true });
  mkdirSync(resolve(TMP, "connections"), { recursive: true });
  mkdirSync(resolve(TMP, "queries"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadConfig(TMP);
    expect(config.port).toBe(3000);
    expect(config.dashboards_dir).toBe("./dashboards");
    expect(config.connections_dir).toBe("./connections");
    expect(config.theme).toBe("light");
  });

  it("loads config from openboard.config.yaml", () => {
    writeFileSync(resolve(TMP, "openboard.config.yaml"), `
port: 4000
dashboards_dir: ./boards
theme: dark
cache_ttl: 600
`);
    const config = loadConfig(TMP);
    expect(config.port).toBe(4000);
    expect(config.dashboards_dir).toBe("./boards");
    expect(config.theme).toBe("dark");
    expect(config.cache_ttl).toBe(600);
    // Defaults for unset fields
    expect(config.connections_dir).toBe("./connections");
  });

  it("handles invalid YAML gracefully", () => {
    writeFileSync(resolve(TMP, "openboard.config.yaml"), `{{{invalid`);
    const config = loadConfig(TMP);
    expect(config.port).toBe(3000); // falls back to defaults
  });

  it("editor is undefined by default (disabled)", () => {
    const config = loadConfig(TMP);
    expect(config.editor).toBeUndefined();
  });

  it("reads editor.enabled from config", () => {
    writeFileSync(resolve(TMP, "openboard.config.yaml"), `
editor:
  enabled: true
`);
    expect(loadConfig(TMP).editor).toEqual({ enabled: true });
  });

  it("treats non-true editor.enabled as disabled", () => {
    writeFileSync(resolve(TMP, "openboard.config.yaml"), `
editor:
  enabled: "yes"
`);
    expect(loadConfig(TMP).editor).toEqual({ enabled: false });
  });
});

describe("discoverDashboards", () => {
  const defaultConfig: ProjectConfig = {
    dashboards_dir: "./dashboards",
    connections_dir: "./connections",
    queries_dir: "./queries",
    port: 3000,
    theme: "light",
    cache_ttl: 300,
  };

  it("discovers .board files in dashboards directory", async () => {
    writeFileSync(resolve(TMP, "dashboards/test.board"), VALID_BOARD);
    writeFileSync(resolve(TMP, "dashboards/ops.board"), VALID_BOARD_2);

    const dashboards = await discoverDashboards(TMP, defaultConfig);
    expect(dashboards).toHaveLength(2);
    expect(dashboards.map((d) => d.slug)).toContain("test");
    expect(dashboards.map((d) => d.slug)).toContain("ops");
  });

  it("extracts title and description", async () => {
    writeFileSync(resolve(TMP, "dashboards/test.board"), VALID_BOARD);

    const dashboards = await discoverDashboards(TMP, defaultConfig);
    expect(dashboards[0].title).toBe("Test Dashboard");
    expect(dashboards[0].description).toBe("A test dashboard");
  });

  it("falls back to root directory if dashboards dir is empty", async () => {
    writeFileSync(resolve(TMP, "test.board"), VALID_BOARD);

    const config = { ...defaultConfig, dashboards_dir: "./nonexistent" };
    const dashboards = await discoverDashboards(TMP, config);
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].title).toBe("Test Dashboard");
  });

  it("skips files with parse errors without crashing", async () => {
    writeFileSync(resolve(TMP, "dashboards/good.board"), VALID_BOARD);
    writeFileSync(resolve(TMP, "dashboards/bad.board"), "this is not valid board syntax {{{");

    const dashboards = await discoverDashboards(TMP, defaultConfig);
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].title).toBe("Test Dashboard");
  });

  it("returns empty array when no dashboards found", async () => {
    const dashboards = await discoverDashboards(TMP, defaultConfig);
    expect(dashboards).toHaveLength(0);
  });

  it("discovers dashboards in subdirectories", async () => {
    mkdirSync(resolve(TMP, "dashboards/team"), { recursive: true });
    writeFileSync(resolve(TMP, "dashboards/team/sales.board"), VALID_BOARD);

    const dashboards = await discoverDashboards(TMP, defaultConfig);
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].slug).toBe("team-sales");
  });
});
