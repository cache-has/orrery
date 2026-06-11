/**
 * Static build engine.
 *
 * Orchestrates the full static export pipeline:
 * 1. Discover dashboards
 * 2. Initialize connections and query executor
 * 3. Parse each .board file
 * 4. Execute queries with default parameter values
 * 5. Render static HTML pages
 * 6. Split large datasets to external JSON files
 * 7. Write output to disk
 */

import { resolve } from "path";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { parse } from "../parser/parser.js";
import { resolveIncludes } from "../parser/resolver.js";
import type { DashboardNode, ParamNode } from "../parser/ast.js";
import { resolveLayout } from "../renderer/layout.js";
import { fetchDashboardData } from "../renderer/data.js";
import { ConnectionManager } from "../connections/manager.js";
import { QueryExecutor } from "../query/executor.js";
import { loadEnvFiles } from "../connections/env.js";
import {
  loadConfig,
  discoverDashboards,
  createLocalSource,
  type DiscoveredDashboard,
  type ProjectConfig,
} from "../server/discovery.js";
import type { DashboardSource } from "../sources/types.js";
import { createSource, createConnectionSource } from "../sources/factory.js";
import { resolveDateRange } from "../query/daterange.js";
import {
  renderStaticPage,
  renderStaticIndex,
  type StaticIndexDashboard,
} from "./renderer.js";
import { loadThemeFile, resolveTheme, type ThemeFile } from "../renderer/theme.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaticBuildOptions {
  /** Project root directory */
  projectRoot: string;
  /** Output directory for static files */
  outputDir: string;
  /** Only export this specific dashboard slug */
  dashboardFilter?: string;
  /** Label for the data snapshot (e.g., "Q1 2026 Report") */
  snapshotLabel?: string;
  /** Produce single-file HTML per dashboard (all assets inlined) */
  selfContained?: boolean;
  /** Threshold in bytes before splitting component data to external file (default 500KB) */
  splitThreshold?: number;
  /** Remote source URI (e.g. "s3://bucket/prefix/") */
  sourceUri?: string;
  /** Polling interval in seconds for remote sources */
  sourcePoll?: number;
  /** Custom S3-compatible endpoint */
  sourceEndpoint?: string;
  /** Remote connections source URI (e.g. "s3://bucket/connections/") */
  connectionsUri?: string;
}

export interface StaticBuildResult {
  dashboards: { slug: string; title: string; outputPath: string }[];
  indexPath: string;
  totalSize: number;
  builtAt: Date;
}

// Default split threshold: 500KB per component
const DEFAULT_SPLIT_THRESHOLD = 500 * 1024;

// ---------------------------------------------------------------------------
// Main build function
// ---------------------------------------------------------------------------

export async function staticBuild(options: StaticBuildOptions): Promise<StaticBuildResult> {
  const {
    projectRoot,
    outputDir,
    dashboardFilter,
    snapshotLabel,
    selfContained = false,
    splitThreshold = DEFAULT_SPLIT_THRESHOLD,
    sourceUri,
    sourcePoll,
    sourceEndpoint,
    connectionsUri,
  } = options;

  const builtAt = new Date();
  const absOutput = resolve(outputDir);

  // 1. Clean output directory
  if (existsSync(absOutput)) {
    rmSync(absOutput, { recursive: true });
  }
  mkdirSync(absOutput, { recursive: true });

  // 2. Load config & env
  const config = loadConfig(projectRoot);
  loadEnvFiles(projectRoot);

  // 3. Discover dashboards
  const resolvedSourceUri = sourceUri ?? config.source;
  const source: DashboardSource = resolvedSourceUri
    ? await createSource({
        uri: resolvedSourceUri,
        pollInterval: sourcePoll ?? config.source_poll,
        endpoint: sourceEndpoint ?? config.source_endpoint,
      })
    : createLocalSource(projectRoot, config);
  let dashboards = await discoverDashboards(projectRoot, config, source);
  if (dashboardFilter) {
    dashboards = dashboards.filter((d) => d.slug === dashboardFilter);
    if (dashboards.length === 0) {
      throw new Error(`Dashboard "${dashboardFilter}" not found`);
    }
  }

  // 4. Initialize connections
  const connManager = new ConnectionManager();
  const resolvedConnectionsUri = connectionsUri ?? config.connections_source;
  if (resolvedConnectionsUri) {
    const connSource = await createConnectionSource({
      uri: resolvedConnectionsUri,
      pollInterval: 0, // no polling needed for build
      endpoint: sourceEndpoint ?? config.source_endpoint,
    });
    await connManager.initFromSource(connSource, projectRoot);
  } else {
    const connectionsDir = resolve(projectRoot, config.connections_dir);
    if (existsSync(connectionsDir)) {
      await connManager.init(connectionsDir, projectRoot);
    }
  }

  const executor = new QueryExecutor(connManager);

  // 4b. Load theme file
  let themeFile: ThemeFile | null = null;
  try {
    themeFile = loadThemeFile(projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: Failed to load theme file: ${msg}`);
  }

  // 5. Build each dashboard
  const results: StaticBuildResult["dashboards"] = [];
  let totalSize = 0;

  for (const discovered of dashboards) {
    console.log(`  Building: ${discovered.title} (${discovered.slug})`);

    try {
      const { html, externalFiles } = await buildDashboard({
        discovered,
        executor,
        source,
        snapshotLabel,
        builtAt,
        selfContained,
        splitThreshold,
        config,
        themeFile,
      });

      // Write dashboard HTML
      const dashDir = resolve(absOutput, "d", discovered.slug);
      mkdirSync(dashDir, { recursive: true });
      const outputPath = resolve(dashDir, "index.html");
      writeFileSync(outputPath, html, "utf-8");
      totalSize += Buffer.byteLength(html, "utf-8");

      // Write external data files if any
      for (const [fileName, jsonContent] of externalFiles) {
        const dataDir = resolve(dashDir, "data");
        mkdirSync(dataDir, { recursive: true });
        const filePath = resolve(dataDir, fileName);
        writeFileSync(filePath, jsonContent, "utf-8");
        totalSize += Buffer.byteLength(jsonContent, "utf-8");
      }

      results.push({
        slug: discovered.slug,
        title: discovered.title,
        outputPath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error building ${discovered.slug}: ${msg}`);
    }
  }

  // 6. Generate index page
  const indexDashboards: StaticIndexDashboard[] = results.map((r) => ({
    slug: r.slug,
    title: r.title,
    description: dashboards.find((d) => d.slug === r.slug)?.description,
  }));
  const indexHtml = renderStaticIndex(indexDashboards, snapshotLabel, builtAt, themeFile?.branding);
  const indexPath = resolve(absOutput, "index.html");
  writeFileSync(indexPath, indexHtml, "utf-8");
  totalSize += Buffer.byteLength(indexHtml, "utf-8");

  // 7. Cleanup connections
  await connManager.disconnectAll();

  return { dashboards: results, indexPath, totalSize, builtAt };
}

// ---------------------------------------------------------------------------
// Per-dashboard build
// ---------------------------------------------------------------------------

interface BuildDashboardOptions {
  discovered: DiscoveredDashboard;
  executor: QueryExecutor;
  source: DashboardSource;
  snapshotLabel?: string;
  builtAt: Date;
  selfContained: boolean;
  splitThreshold: number;
  config: ProjectConfig;
  themeFile: ThemeFile | null;
}

async function buildDashboard(
  options: BuildDashboardOptions,
): Promise<{ html: string; externalFiles: Map<string, string> }> {
  const { discovered, executor, source, snapshotLabel, builtAt, selfContained, splitThreshold, config, themeFile } = options;

  // Parse — read through the source abstraction for remote compatibility
  const fileContent = await source.read(discovered.filePath);
  const dashboard = resolveIncludes(parse(fileContent, discovered.filePath), discovered.filePath);
  const layout = resolveLayout(dashboard);

  // Resolve default parameter values
  const paramValues = resolveDefaultParams(dashboard);

  // Execute queries
  const data = await fetchDashboardData(dashboard, executor, paramValues);

  // Determine which components need external data files
  const externalDataComponents = new Map<string, string>();
  const externalFiles = new Map<string, string>();

  if (!selfContained) {
    for (const [compId, compData] of data.components) {
      if (!compData.result) continue;
      const json = JSON.stringify(compData.result);
      if (Buffer.byteLength(json, "utf-8") > splitThreshold) {
        const fileName = `${compId}.json`;
        externalDataComponents.set(compId, `data/${fileName}`);
        externalFiles.set(fileName, json);
      }
    }
  }

  // Resolve theme
  const dashboardTheme = getDashboardThemeFromAST(dashboard);
  const resolved = resolveTheme({
    configTheme: config.theme,
    dashboardTheme,
    themeFile,
  });

  // Render static page
  const html = renderStaticPage({
    dashboard,
    layout,
    data,
    paramValues,
    snapshotLabel,
    builtAt,
    externalDataComponents: externalDataComponents.size > 0 ? externalDataComponents : undefined,
    selfContained,
    themeCSS: resolved.css || undefined,
    themeName: resolved.name,
    palette: resolved.palette,
  });

  return { html, externalFiles };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDashboardThemeFromAST(dashboard: DashboardNode): "light" | "dark" | undefined {
  for (const item of dashboard.items) {
    if (item.kind === "property" && item.key === "theme") {
      if (item.value.kind === "string" || item.value.kind === "ident") {
        const val = item.value.kind === "string" ? item.value.value : item.value.name;
        if (val === "light" || val === "dark") return val;
      }
    }
  }
  return undefined;
}

function resolveDefaultParams(dashboard: DashboardNode): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const item of dashboard.items) {
    if (item.kind === "param") {
      const param = item as ParamNode;
      const defaultProp = param.options.find((o) => o.key === "default");
      if (defaultProp) {
        if (defaultProp.value.kind === "string") {
          if (param.paramType === "daterange") {
            const resolved = resolveDateRange(defaultProp.value.value);
            defaults[param.name] = {
              ...resolved,
              preset: defaultProp.value.value.toLowerCase().replace(/[\s-]+/g, "_"),
            };
          } else {
            defaults[param.name] = defaultProp.value.value;
          }
        } else if (defaultProp.value.kind === "number") {
          defaults[param.name] = defaultProp.value.value;
        } else if (defaultProp.value.kind === "boolean") {
          defaults[param.name] = defaultProp.value.value;
        }
      }
    }
  }
  return defaults;
}
