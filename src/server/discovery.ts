/**
 * Project discovery: find config, dashboards, connections, and queries directories.
 *
 * Discovery order:
 *  1. orrery.config.yaml in projectRoot (explicit config)
 *  2. dashboards/ directory in projectRoot
 *  3. Any .board files directly in projectRoot
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, extname, relative } from "path";
import { parse as parseYaml } from "yaml";
import { parse, parsePartial } from "../parser/parser.js";
import type { DashboardNode } from "../parser/ast.js";
import type { DashboardSource } from "../sources/types.js";
import { LocalSource } from "../sources/local.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  dashboards_dir: string;
  connections_dir: string;
  queries_dir: string;
  port: number;
  theme: "light" | "dark";
  cache_ttl: number;
  /** Remote source URI (e.g. "s3://bucket/prefix/"). Omit for local filesystem. */
  source?: string;
  /** Polling interval in seconds for remote sources. Default: 30. */
  source_poll?: number;
  /** Custom endpoint for S3-compatible stores (MinIO, R2). */
  source_endpoint?: string;
  /** Enable write() on the dashboard source (used by the web editor). Defaults to false. */
  source_writable?: boolean;
  /** Remote connections source URI (e.g. "s3://bucket/connections/"). Omit for local filesystem. */
  connections_source?: string;
  /** Web editor settings. */
  editor?: EditorConfig;
  /**
   * Header-based access control. Structural subset of the server's AccessConfig
   * (typed inline to avoid a discovery↔access import cycle); env vars can
   * override these at runtime. Omit for unrestricted access.
   */
  access?: {
    enabled?: boolean;
    foldersHeader?: string;
    canEditHeader?: string;
    requireFolder?: boolean;
  };
}

export interface EditorConfig {
  /** Enable the web editor routes (/edit/*, /api/save, /api/new, /api/validate, /api/connections). Default: false. */
  enabled: boolean;
}

const DEFAULT_CONFIG: ProjectConfig = {
  dashboards_dir: "./dashboards",
  connections_dir: "./connections",
  queries_dir: "./queries",
  port: 3000,
  theme: "light",
  cache_ttl: 300,
};

export function loadConfig(projectRoot: string): ProjectConfig {
  const configPath = resolve(projectRoot, "orrery.config.yaml");
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = parseYaml(raw) as Partial<ProjectConfig> | null;
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_CONFIG };
    }
    return {
      dashboards_dir: parsed.dashboards_dir ?? DEFAULT_CONFIG.dashboards_dir,
      connections_dir: parsed.connections_dir ?? DEFAULT_CONFIG.connections_dir,
      queries_dir: parsed.queries_dir ?? DEFAULT_CONFIG.queries_dir,
      port: parsed.port ?? DEFAULT_CONFIG.port,
      theme: parsed.theme ?? DEFAULT_CONFIG.theme,
      cache_ttl: parsed.cache_ttl ?? DEFAULT_CONFIG.cache_ttl,
      source: parsed.source ?? undefined,
      source_poll: parsed.source_poll ?? undefined,
      source_endpoint: parsed.source_endpoint ?? undefined,
      source_writable: parsed.source_writable ?? undefined,
      connections_source: parsed.connections_source ?? undefined,
      editor: parseEditorConfig(parsed.editor),
      access: parseAccessConfig(parsed.access),
    };
  } catch {
    console.warn(`Warning: Failed to parse ${configPath}, using defaults`);
    return { ...DEFAULT_CONFIG };
  }
}

function parseEditorConfig(raw: unknown): EditorConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const enabled = (raw as { enabled?: unknown }).enabled;
  return { enabled: enabled === true };
}

// The full set of recognized snake_case keys under `access:`.
const KNOWN_ACCESS_KEYS = ["enabled", "require_folder", "folders_header", "can_edit_header"];

// Maps the snake_case `access:` YAML block to the camelCase config the server
// consumes. Env vars (handled in access.ts) take precedence over these.
//
// This block gates the entire access-control feature, so a misspelled or
// mistyped key that silently falls back to a default is a security footgun
// (e.g. `requirefolder:` would leave root dashboards exposed). We can't fail
// hard — loadConfig's catch would drop the whole config and disable access
// control, which is worse — so we surface problems as warnings and keep the
// secure defaults.
function parseAccessConfig(raw: unknown): ProjectConfig["access"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  const warn = (msg: string) => console.warn(`Warning: orrery.config.yaml \`access.${msg}`);
  const checkType = (key: string, expected: "boolean" | "string") => {
    if (key in r && typeof r[key] !== expected) {
      warn(`${key}\` should be a ${expected}; got ${typeof r[key]} — ignored, using default.`);
    }
  };

  for (const key of Object.keys(r)) {
    if (!KNOWN_ACCESS_KEYS.includes(key)) {
      warn(`${key}\` is not a recognized key — ignored. Valid keys: ${KNOWN_ACCESS_KEYS.join(", ")}.`);
    }
  }
  checkType("enabled", "boolean");
  checkType("require_folder", "boolean");
  checkType("folders_header", "string");
  checkType("can_edit_header", "string");

  return {
    enabled: r.enabled === true,
    foldersHeader: typeof r.folders_header === "string" ? r.folders_header : undefined,
    canEditHeader: typeof r.can_edit_header === "string" ? r.can_edit_header : undefined,
    requireFolder: typeof r.require_folder === "boolean" ? r.require_folder : undefined,
  };
}

// ---------------------------------------------------------------------------
// Dashboard discovery
// ---------------------------------------------------------------------------

export interface DiscoveredDashboard {
  /** Slug used in URL: /d/:slug */
  slug: string;
  /** Absolute path to the .board file */
  filePath: string;
  /** Dashboard title from parsed AST */
  title: string;
  /** Dashboard description if present */
  description?: string;
  /** Relative folder path from dashboards dir (empty string for root) */
  folder: string;
  /** Last modified time */
  lastModified: Date;
}

/**
 * Discover all .board files, parse them, and return metadata.
 * Parse errors are captured — they never crash discovery.
 *
 * When a DashboardSource is provided, files are listed and read through it.
 * Otherwise falls back to direct filesystem access (legacy path).
 */
export async function discoverDashboards(
  projectRoot: string,
  config: ProjectConfig,
  source?: DashboardSource,
): Promise<DiscoveredDashboard[]> {
  const dashboardsDir = resolve(projectRoot, config.dashboards_dir);

  if (source) {
    return discoverFromSource(source, dashboardsDir);
  }

  // Legacy path: direct filesystem (used when no source is supplied)
  const results: DiscoveredDashboard[] = [];

  // Strategy 1: Look in configured dashboards directory
  if (existsSync(dashboardsDir)) {
    const files = findBoardFiles(dashboardsDir);
    for (const filePath of files) {
      const info = parseDashboardInfo(filePath, dashboardsDir);
      if (info) results.push(info);
    }
  }

  // Strategy 2: If no dashboards dir, look for .board files in project root
  if (results.length === 0) {
    const rootFiles = findBoardFiles(projectRoot, false);
    for (const filePath of rootFiles) {
      const info = parseDashboardInfo(filePath, projectRoot);
      if (info) results.push(info);
    }
  }

  return results.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Discover dashboards through a DashboardSource.
 */
async function discoverFromSource(
  source: DashboardSource,
  baseDir: string,
): Promise<DiscoveredDashboard[]> {
  const files = await source.list();
  const results: DiscoveredDashboard[] = [];

  for (const filePath of files) {
    try {
      const content = await source.read(filePath);
      const info = parseDashboardInfoFromContent(content, filePath, baseDir);
      if (info) results.push(info);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Failed to read ${filePath}: ${msg}`);
    }
  }

  return results.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Create a LocalSource for the given project config.
 * Falls back to projectRoot if the configured dashboards dir doesn't exist.
 */
export function createLocalSource(
  projectRoot: string,
  config: ProjectConfig,
  options?: { writable?: boolean },
): LocalSource {
  const opts = { writable: options?.writable };
  const dashboardsDir = resolve(projectRoot, config.dashboards_dir);
  if (existsSync(dashboardsDir)) {
    return new LocalSource(dashboardsDir, undefined, opts);
  }
  return new LocalSource(projectRoot, undefined, opts);
}

/**
 * Re-parse a single dashboard file and return updated metadata.
 * Returns null on parse error.
 */
export function parseDashboardInfo(
  filePath: string,
  baseDir: string,
): DiscoveredDashboard | null {
  try {
    const source = readFileSync(filePath, "utf-8");
    const dashboard = parse(source, filePath);
    const stat = statSync(filePath);
    const slug = fileToSlug(filePath, baseDir);
    const rel = relative(baseDir, filePath);
    const folder = rel.includes("/") || rel.includes("\\")
      ? rel.replace(/[\\/][^\\/]+$/, "")
      : "";

    return {
      slug,
      filePath,
      title: dashboard.title || slug,
      description: getDashboardDescription(dashboard),
      folder,
      lastModified: stat.mtime,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Expected 'dashboard' keyword")) {
      // Likely a partial/include file. Validate it parses as a partial —
      // if that also fails, warn so malformed includes aren't silently ignored.
      try {
        const source = readFileSync(filePath, "utf-8");
        parsePartial(source, filePath);
      } catch (partialErr) {
        const partialMsg = partialErr instanceof Error ? partialErr.message : String(partialErr);
        console.warn(`Warning: ${filePath} is not a dashboard and failed to parse as an include: ${partialMsg}`);
      }
      return null;
    }
    console.warn(`Warning: Failed to parse ${filePath}: ${msg}`);
    return null;
  }
}

/**
 * Parse dashboard metadata from already-read content.
 * Used by source-based discovery where the source provides the content.
 */
export function parseDashboardInfoFromContent(
  content: string,
  filePath: string,
  baseDir: string,
): DiscoveredDashboard | null {
  try {
    const dashboard = parse(content, filePath);
    // For source-backed discovery (S3/GCS) filePath is a source-relative key
    // such as "customer/foo.board". Resolve it against baseDir before deriving
    // the relative path, otherwise relative() walks up a level and prepends
    // "../" — which surfaced as "../customer" folder labels in the launcher.
    const abs = resolve(baseDir, filePath);
    const slug = fileToSlug(abs, baseDir);
    const rel = relative(baseDir, abs);
    const folder = rel.includes("/") || rel.includes("\\")
      ? rel.replace(/[\\/][^\\/]+$/, "")
      : "";

    // Try to get mtime, but it may not exist for remote sources
    let lastModified = new Date();
    try {
      lastModified = statSync(filePath).mtime;
    } catch { /* remote files won't have local stat */ }

    return {
      slug,
      filePath,
      title: dashboard.title || slug,
      description: getDashboardDescription(dashboard),
      folder,
      lastModified,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Expected 'dashboard' keyword")) {
      try {
        parsePartial(content, filePath);
      } catch (partialErr) {
        const partialMsg = partialErr instanceof Error ? partialErr.message : String(partialErr);
        console.warn(`Warning: ${filePath} is not a dashboard and failed to parse as an include: ${partialMsg}`);
      }
      return null;
    }
    console.warn(`Warning: Failed to parse ${filePath}: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBoardFiles(dir: string, recursive = true): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      results.push(...findBoardFiles(fullPath, true));
    } else if (entry.isFile() && extname(entry.name) === ".board") {
      results.push(fullPath);
    }
  }
  return results;
}

function fileToSlug(filePath: string, baseDir: string): string {
  const rel = relative(baseDir, filePath);
  return rel
    .replace(/\.board$/, "")
    .replace(/[\\/]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getDashboardDescription(dashboard: DashboardNode): string | undefined {
  for (const item of dashboard.items) {
    if (item.kind === "property" && item.key === "description") {
      if (item.value.kind === "string") return item.value.value;
    }
  }
  return undefined;
}
