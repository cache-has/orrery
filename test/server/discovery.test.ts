import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { loadConfig, discoverDashboards, type ProjectConfig } from "../../src/server/discovery.js";
import { resolveAccessConfig } from "../../src/server/access.js";

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

  it("loads config from orrery.config.yaml", () => {
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `
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
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `{{{invalid`);
    const config = loadConfig(TMP);
    expect(config.port).toBe(3000); // falls back to defaults
  });

  it("editor is undefined by default (disabled)", () => {
    const config = loadConfig(TMP);
    expect(config.editor).toBeUndefined();
  });

  it("reads editor.enabled from config", () => {
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `
editor:
  enabled: true
`);
    expect(loadConfig(TMP).editor).toEqual({ enabled: true });
  });

  it("treats non-true editor.enabled as disabled", () => {
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `
editor:
  enabled: "yes"
`);
    expect(loadConfig(TMP).editor).toEqual({ enabled: false });
  });

  it("access is undefined by default", () => {
    expect(loadConfig(TMP).access).toBeUndefined();
  });

  it("maps the snake_case access: block to camelCase", () => {
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `
access:
  enabled: true
  require_folder: true
  folders_header: x-my-folders
  can_edit_header: x-my-edit
`);
    expect(loadConfig(TMP).access).toEqual({
      enabled: true,
      requireFolder: true,
      foldersHeader: "x-my-folders",
      canEditHeader: "x-my-edit",
    });
  });

  it("honors require_folder: false (not silently coerced to true)", () => {
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `
access:
  enabled: true
  require_folder: false
`);
    const access = loadConfig(TMP).access;
    expect(access?.requireFolder).toBe(false);
    // …and the effective config preserves it through resolveAccessConfig.
    expect(resolveAccessConfig(access).requireFolder).toBe(false);
  });

  it("defaults requireFolder to true when the access block omits it", () => {
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `
access:
  enabled: true
`);
    const access = loadConfig(TMP).access;
    expect(access?.requireFolder).toBeUndefined();
    // resolveAccessConfig fills the secure default.
    expect(resolveAccessConfig(access).requireFolder).toBe(true);
  });

  it("warns on an unrecognized key in the access block (e.g. a typo)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `
access:
  enabled: true
  requirefolder: true
`);
    const access = loadConfig(TMP).access;
    // The typo is ignored, so the secure default still applies…
    expect(access?.requireFolder).toBeUndefined();
    // …but the operator is warned rather than left guessing.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("requirefolder"));
    spy.mockRestore();
  });

  it("warns when a known key has the wrong type", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(resolve(TMP, "orrery.config.yaml"), `
access:
  enabled: true
  require_folder: "false"
`);
    const access = loadConfig(TMP).access;
    // Quoted "false" is a string, not a boolean — ignored (default true), warned.
    expect(access?.requireFolder).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("require_folder"));
    spy.mockRestore();
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
