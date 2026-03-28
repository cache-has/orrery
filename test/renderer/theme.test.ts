import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBuiltinTheme,
  resolveTheme,
  compileThemeYaml,
  extractPalette,
  LIGHT_THEME,
  DARK_THEME,
  type ThemeFile,
} from "../../src/renderer/theme.js";

describe("getBuiltinTheme", () => {
  it("returns light theme with light backgrounds", () => {
    const theme = getBuiltinTheme("light");
    expect(theme["--ob-bg"]).toBe("#f8f9fa");
    expect(theme["--ob-text"]).toBe("#1a202c");
    expect(theme["--ob-surface"]).toBe("#ffffff");
  });

  it("returns dark theme with dark backgrounds", () => {
    const theme = getBuiltinTheme("dark");
    expect(theme["--ob-bg"]).toBe("#0f172a");
    expect(theme["--ob-text"]).toBe("#f1f5f9");
    expect(theme["--ob-surface"]).toBe("#1e293b");
  });

  it("returns a copy (not the same reference)", () => {
    const a = getBuiltinTheme("dark");
    const b = getBuiltinTheme("dark");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("resolveTheme", () => {
  it("returns empty CSS for light theme with no overrides", () => {
    const result = resolveTheme({ configTheme: "light" });
    expect(result.css).toBe("");
    expect(result.name).toBe("light");
  });

  it("returns dark CSS variables for dark config theme", () => {
    const result = resolveTheme({ configTheme: "dark" });
    expect(result.css).toContain(":root {");
    expect(result.css).toContain("--ob-bg: #0f172a");
    expect(result.css).toContain("--ob-text: #f1f5f9");
    expect(result.name).toBe("dark");
  });

  it("dashboard theme overrides config theme", () => {
    const result = resolveTheme({ configTheme: "light", dashboardTheme: "dark" });
    expect(result.css).toContain("--ob-bg: #0f172a");
    expect(result.name).toBe("dark");
  });

  it("appends theme file CSS after built-in theme", () => {
    const themeFile: ThemeFile = {
      type: "css",
      content: ":root { --ob-primary: #ff0000; }",
    };
    const result = resolveTheme({ configTheme: "dark", themeFile });
    expect(result.css).toContain("--ob-bg: #0f172a");
    expect(result.css).toContain("--ob-primary: #ff0000");
  });

  it("uses theme file palette when provided", () => {
    const themeFile: ThemeFile = {
      type: "yaml",
      content: ":root { --ob-chart-1: #aaa; }",
      palette: ["#aaa", "#bbb", "#ccc"],
    };
    const result = resolveTheme({ configTheme: "light", themeFile });
    expect(result.palette).toEqual(["#aaa", "#bbb", "#ccc"]);
  });

  it("falls back to built-in palette when no theme file palette", () => {
    const result = resolveTheme({ configTheme: "dark" });
    expect(result.palette.length).toBe(10);
    expect(result.palette[0]).toBe(DARK_THEME["--ob-chart-1"]);
  });
});

describe("compileThemeYaml", () => {
  it("maps color keys to CSS variables", () => {
    const result = compileThemeYaml({
      colors: {
        bg: "#111111",
        primary: "#ff0000",
        text: "#eeeeee",
      },
    });
    expect(result.css).toContain("--ob-bg: #111111");
    expect(result.css).toContain("--ob-primary: #ff0000");
    expect(result.css).toContain("--ob-text: #eeeeee");
    expect(result.css).toContain(":root {");
  });

  it("maps typography keys to CSS variables", () => {
    const result = compileThemeYaml({
      typography: {
        font: "'Inter', sans-serif",
        base_size: 16,
      },
    });
    expect(result.css).toContain("--ob-font: 'Inter', sans-serif");
    expect(result.css).toContain("--ob-font-size-base: 16px");
  });

  it("maps chart_palette to --ob-chart-N variables", () => {
    const result = compileThemeYaml({
      chart_palette: ["#aaa", "#bbb", "#ccc"],
    });
    expect(result.css).toContain("--ob-chart-1: #aaa");
    expect(result.css).toContain("--ob-chart-2: #bbb");
    expect(result.css).toContain("--ob-chart-3: #ccc");
    expect(result.palette).toEqual(["#aaa", "#bbb", "#ccc"]);
  });

  it("returns empty CSS for empty yaml", () => {
    const result = compileThemeYaml({});
    expect(result.css).toBe("");
    expect(result.palette).toBeUndefined();
  });

  it("supports background as alias for bg", () => {
    const result = compileThemeYaml({ colors: { background: "#222" } });
    expect(result.css).toContain("--ob-bg: #222");
  });
});

describe("extractPalette", () => {
  it("extracts chart colors from theme variables", () => {
    const palette = extractPalette(LIGHT_THEME);
    expect(palette.length).toBe(10);
    expect(palette[0]).toBe(LIGHT_THEME["--ob-chart-1"]);
  });

  it("returns default palette when no chart vars exist", () => {
    const palette = extractPalette({
      "--ob-bg": "#fff",
      "--ob-surface": "#fff",
      "--ob-border": "#ccc",
      "--ob-text": "#000",
      "--ob-text-muted": "#666",
      "--ob-primary": "#00f",
      "--ob-error-bg": "#fcc",
      "--ob-error-border": "#f00",
      "--ob-error-text": "#900",
      "--ob-radius": "4px",
      "--ob-shadow": "none",
      "--ob-loading-overlay": "rgba(0,0,0,0.5)",
      "--ob-chart-1": "",
      "--ob-chart-2": "",
      "--ob-chart-3": "",
      "--ob-chart-4": "",
      "--ob-chart-5": "",
      "--ob-chart-6": "",
      "--ob-chart-7": "",
      "--ob-chart-8": "",
      "--ob-chart-9": "",
      "--ob-chart-10": "",
    });
    // Empty strings for chart vars -> falls back to default
    expect(palette.length).toBe(10);
    expect(palette[0]).toBe("#3b82f6");
  });
});
