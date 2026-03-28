/**
 * Theme system for OpenBoard.
 *
 * Provides built-in light/dark themes, loads user theme files (theme.css or
 * theme.yaml), and resolves the final CSS override string + chart palette.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeName = "light" | "dark";

export interface ThemeVariables {
  "--ob-bg": string;
  "--ob-surface": string;
  "--ob-border": string;
  "--ob-text": string;
  "--ob-text-muted": string;
  "--ob-primary": string;
  "--ob-error-bg": string;
  "--ob-error-border": string;
  "--ob-error-text": string;
  "--ob-radius": string;
  "--ob-shadow": string;
  "--ob-loading-overlay": string;
  "--ob-chart-1": string;
  "--ob-chart-2": string;
  "--ob-chart-3": string;
  "--ob-chart-4": string;
  "--ob-chart-5": string;
  "--ob-chart-6": string;
  "--ob-chart-7": string;
  "--ob-chart-8": string;
  "--ob-chart-9": string;
  "--ob-chart-10": string;
  [key: string]: string;
}

export interface ThemeFile {
  type: "css" | "yaml";
  content: string;
  /** Parsed chart palette from theme.yaml (if applicable) */
  palette?: string[];
  /** Branding config from theme.yaml (if applicable) */
  branding?: BrandingConfig;
}

export interface BrandingConfig {
  /** Path to logo image (relative to project root) */
  logo?: string;
  /** Custom title to replace "OpenBoard" in headers */
  title?: string;
  /** Path to favicon (relative to project root) */
  favicon?: string;
}

export interface ThemeYaml {
  colors?: Record<string, string>;
  typography?: Record<string, string | number>;
  chart_palette?: string[];
  branding?: BrandingConfig;
}

export interface ResolvedTheme {
  /** CSS to inject after the base stylesheet */
  css: string;
  /** Chart color palette (concrete hex values for SSR) */
  palette: string[];
  /** The resolved theme name */
  name: ThemeName;
  /** Branding config (logo, title, favicon) */
  branding?: BrandingConfig;
}

export interface ResolveThemeOptions {
  configTheme: ThemeName;
  dashboardTheme?: ThemeName;
  themeFile?: ThemeFile | null;
}

// ---------------------------------------------------------------------------
// Built-in themes
// ---------------------------------------------------------------------------

const DEFAULT_PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

export const LIGHT_THEME: ThemeVariables = {
  "--ob-bg": "#f8f9fa",
  "--ob-surface": "#ffffff",
  "--ob-border": "#e2e8f0",
  "--ob-text": "#1a202c",
  "--ob-text-muted": "#718096",
  "--ob-primary": "#3b82f6",
  "--ob-error-bg": "#fef2f2",
  "--ob-error-border": "#fecaca",
  "--ob-error-text": "#991b1b",
  "--ob-radius": "8px",
  "--ob-shadow": "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
  "--ob-loading-overlay": "rgba(255, 255, 255, 0.7)",
  "--ob-chart-1": DEFAULT_PALETTE[0],
  "--ob-chart-2": DEFAULT_PALETTE[1],
  "--ob-chart-3": DEFAULT_PALETTE[2],
  "--ob-chart-4": DEFAULT_PALETTE[3],
  "--ob-chart-5": DEFAULT_PALETTE[4],
  "--ob-chart-6": DEFAULT_PALETTE[5],
  "--ob-chart-7": DEFAULT_PALETTE[6],
  "--ob-chart-8": DEFAULT_PALETTE[7],
  "--ob-chart-9": DEFAULT_PALETTE[8],
  "--ob-chart-10": DEFAULT_PALETTE[9],
};

const DARK_PALETTE = [
  "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa",
  "#f472b6", "#22d3ee", "#a3e635", "#fb923c", "#818cf8",
];

export const DARK_THEME: ThemeVariables = {
  "--ob-bg": "#0f172a",
  "--ob-surface": "#1e293b",
  "--ob-border": "#334155",
  "--ob-text": "#f1f5f9",
  "--ob-text-muted": "#94a3b8",
  "--ob-primary": "#60a5fa",
  "--ob-error-bg": "#451a1a",
  "--ob-error-border": "#7f1d1d",
  "--ob-error-text": "#fca5a5",
  "--ob-radius": "8px",
  "--ob-shadow": "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
  "--ob-loading-overlay": "rgba(15, 23, 42, 0.7)",
  "--ob-chart-1": DARK_PALETTE[0],
  "--ob-chart-2": DARK_PALETTE[1],
  "--ob-chart-3": DARK_PALETTE[2],
  "--ob-chart-4": DARK_PALETTE[3],
  "--ob-chart-5": DARK_PALETTE[4],
  "--ob-chart-6": DARK_PALETTE[5],
  "--ob-chart-7": DARK_PALETTE[6],
  "--ob-chart-8": DARK_PALETTE[7],
  "--ob-chart-9": DARK_PALETTE[8],
  "--ob-chart-10": DARK_PALETTE[9],
};

export function getBuiltinTheme(name: ThemeName): ThemeVariables {
  return name === "dark" ? { ...DARK_THEME } : { ...LIGHT_THEME };
}

// ---------------------------------------------------------------------------
// Theme file loading
// ---------------------------------------------------------------------------

/**
 * Load a user's theme file from the project root.
 * Returns null if no theme file exists. Throws if both theme.css and theme.yaml exist.
 */
export function loadThemeFile(projectRoot: string): ThemeFile | null {
  const cssPath = resolve(projectRoot, "theme.css");
  const yamlPath = resolve(projectRoot, "theme.yaml");
  const ymlPath = resolve(projectRoot, "theme.yml");

  const hasCss = existsSync(cssPath);
  const hasYaml = existsSync(yamlPath) || existsSync(ymlPath);

  if (hasCss && hasYaml) {
    throw new Error(
      "Cannot have both theme.css and theme.yaml in project root. Use one or the other.",
    );
  }

  if (hasCss) {
    return { type: "css", content: readFileSync(cssPath, "utf-8") };
  }

  if (hasYaml) {
    const actualPath = existsSync(yamlPath) ? yamlPath : ymlPath;
    const raw = readFileSync(actualPath, "utf-8");
    const parsed = parseYaml(raw) as ThemeYaml | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const compiled = compileThemeYaml(parsed);
    return {
      type: "yaml",
      content: compiled.css,
      palette: compiled.palette,
      branding: compiled.branding,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// theme.yaml compilation
// ---------------------------------------------------------------------------

const YAML_COLOR_MAP: Record<string, string> = {
  bg: "--ob-bg",
  background: "--ob-bg",
  surface: "--ob-surface",
  border: "--ob-border",
  text: "--ob-text",
  text_muted: "--ob-text-muted",
  primary: "--ob-primary",
  error_bg: "--ob-error-bg",
  error_border: "--ob-error-border",
  error_text: "--ob-error-text",
};

const YAML_TYPOGRAPHY_MAP: Record<string, string> = {
  font: "--ob-font",
  font_family: "--ob-font",
  font_mono: "--ob-font-mono",
  base_size: "--ob-font-size-base",
};

/**
 * Compile a parsed theme.yaml into CSS variable declarations, a palette array, and branding config.
 */
export function compileThemeYaml(yaml: ThemeYaml): { css: string; palette?: string[]; branding?: BrandingConfig } {
  const vars: string[] = [];

  if (yaml.colors) {
    for (const [key, value] of Object.entries(yaml.colors)) {
      const cssVar = YAML_COLOR_MAP[key];
      if (cssVar && typeof value === "string") {
        vars.push(`  ${cssVar}: ${value};`);
      }
    }
  }

  if (yaml.typography) {
    for (const [key, value] of Object.entries(yaml.typography)) {
      const cssVar = YAML_TYPOGRAPHY_MAP[key];
      if (cssVar && value != null) {
        const cssValue = key === "base_size" ? `${value}px` : String(value);
        vars.push(`  ${cssVar}: ${cssValue};`);
      }
    }
  }

  let palette: string[] | undefined;
  if (yaml.chart_palette && Array.isArray(yaml.chart_palette)) {
    palette = yaml.chart_palette;
    for (let i = 0; i < yaml.chart_palette.length; i++) {
      vars.push(`  --ob-chart-${i + 1}: ${yaml.chart_palette[i]};`);
    }
  }

  // Extract branding config
  let branding: BrandingConfig | undefined;
  if (yaml.branding && typeof yaml.branding === "object") {
    branding = {};
    if (typeof yaml.branding.logo === "string") branding.logo = yaml.branding.logo;
    if (typeof yaml.branding.title === "string") branding.title = yaml.branding.title;
    if (typeof yaml.branding.favicon === "string") branding.favicon = yaml.branding.favicon;
    if (!branding.logo && !branding.title && !branding.favicon) branding = undefined;
  }

  const css = vars.length > 0 ? `:root {\n${vars.join("\n")}\n}` : "";
  return { css, palette, branding };
}

// ---------------------------------------------------------------------------
// Theme resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the final theme CSS and chart palette.
 */
export function resolveTheme(options: ResolveThemeOptions): ResolvedTheme {
  const { configTheme, dashboardTheme, themeFile } = options;
  const name = dashboardTheme ?? configTheme;
  const builtinVars = getBuiltinTheme(name);

  const parts: string[] = [];

  // For dark theme (or any non-light), emit the built-in variable overrides.
  // Light theme is already the default in OPENBOARD_CSS, so no override needed.
  if (name === "dark") {
    const varLines = Object.entries(builtinVars)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    parts.push(`:root {\n${varLines}\n}`);
  }

  // Append user theme file (either raw CSS or compiled YAML)
  if (themeFile) {
    if (themeFile.content.trim()) {
      parts.push(themeFile.content);
    }
  }

  // Determine palette: theme file palette > built-in theme palette > default
  let palette: string[];
  if (themeFile?.palette?.length) {
    palette = themeFile.palette;
  } else {
    palette = extractPalette(builtinVars);
  }

  return {
    css: parts.join("\n\n"),
    palette,
    name,
    branding: themeFile?.branding,
  };
}

/**
 * Extract the chart palette array from theme variables.
 */
export function extractPalette(vars: ThemeVariables): string[] {
  const palette: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = `--ob-chart-${i}`;
    if (vars[key]) palette.push(vars[key]);
  }
  return palette.length > 0 ? palette : DEFAULT_PALETTE;
}
