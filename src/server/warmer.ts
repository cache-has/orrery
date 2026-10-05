/**
 * Cache warmer.
 *
 * A result cache only helps a visitor who arrives after someone else already
 * paid for the query. On a low-traffic deployment that is almost nobody. The
 * warmer closes that gap: on an interval shorter than the cache TTL it re-runs
 * every dashboard's queries with their default parameters, so the first
 * visitor to a dashboard gets a cached result.
 *
 * It runs one query at a time so that warming never occupies the connection
 * pool, and it skips a cycle if the previous one is still going.
 */

import { parse } from "../parser/parser.js";
import { resolveIncludes, resolveIncludesAsync } from "../parser/resolver.js";
import { fetchDashboardData } from "../renderer/data.js";
import type { QueryExecutor } from "../query/executor.js";
import type { DashboardSource } from "../sources/types.js";
import type { DiscoveredDashboard, ProjectConfig } from "./discovery.js";
import {
  loadBoardContent,
  resolveDefaultParams,
  resolveParamsWithDateRanges,
  dashboardCacheTtl,
} from "./routes/dashboard.js";

export interface CacheWarmerOptions {
  executor: QueryExecutor;
  config: ProjectConfig;
  boardDir: string;
  source?: DashboardSource;
  getDashboards: () => DiscoveredDashboard[];
  log?: (message: string) => void;
}

export interface WarmResult {
  dashboards: number;
  failed: number;
  durationMs: number;
}

export interface CacheWarmer {
  /** Warm every dashboard once. Resolves when the pass is complete. */
  runOnce: () => Promise<WarmResult>;
  stop: () => void;
}

// Re-warm before entries expire, so default-parameter results never go cold.
const INTERVAL_FRACTION = 0.8;
const MIN_INTERVAL_SECONDS = 30;

/** Seconds between warm passes for a given cache TTL. */
export function warmIntervalSeconds(cacheTtl: number): number {
  return Math.max(MIN_INTERVAL_SECONDS, Math.floor(cacheTtl * INTERVAL_FRACTION));
}

export function startCacheWarmer(options: CacheWarmerOptions): CacheWarmer {
  const { executor, config, boardDir, source, getDashboards } = options;
  const log = options.log ?? ((message: string) => console.log(message));
  let running: Promise<WarmResult> | null = null;

  const warmDashboard = async (slug: string): Promise<void> => {
    const loaded = await loadBoardContent(slug, { source, getDashboards, boardDir });
    if (!loaded) return;
    const parsed = parse(loaded.content, loaded.filePath);
    const dashboard = source
      ? await resolveIncludesAsync(parsed, loaded.filePath, (p) => source.read(p))
      : resolveIncludes(parsed, loaded.filePath);
    const params = resolveParamsWithDateRanges(dashboard, resolveDefaultParams(dashboard));
    await fetchDashboardData(dashboard, executor, params, {
      // Replace the cached result rather than read it back.
      fresh: true,
      cacheTtl: dashboardCacheTtl(dashboard, config),
      label: `warm:${slug}`,
      concurrency: 1,
    });
  };

  const pass = async (): Promise<WarmResult> => {
    const started = Date.now();
    const dashboards = getDashboards();
    let failed = 0;
    for (const { slug } of dashboards) {
      try {
        await warmDashboard(slug);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        log(`  Cache warm failed for ${slug}: ${msg}`);
      }
    }
    const result = { dashboards: dashboards.length, failed, durationMs: Date.now() - started };
    log(
      `  Cache warmed: ${result.dashboards - failed}/${result.dashboards} dashboards in ` +
        `${(result.durationMs / 1000).toFixed(1)}s`,
    );
    return result;
  };

  const runOnce = (): Promise<WarmResult> => {
    // A pass that outlasts the interval is not stacked on top of itself.
    if (!running) {
      running = pass().finally(() => {
        running = null;
      });
    }
    return running;
  };

  const kick = () => {
    runOnce().catch(() => {});
  };

  // First pass right after startup, without delaying it.
  const first = setTimeout(kick, 0);
  const timer = setInterval(kick, warmIntervalSeconds(config.cache_ttl) * 1000);
  first.unref();
  timer.unref();

  return {
    runOnce,
    stop: () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
