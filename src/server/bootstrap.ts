/**
 * Shared server bootstrap used by both `openboard dev` and `openboard serve`.
 *
 * `dev` passes devMode: true to get FileWatcher + DevWebSocket and hot-reload
 * client injection. `serve` passes devMode: false for a lean production process
 * with no watcher, no WS, and no hot-reload code on the wire.
 */

import { resolve } from "path";
import { existsSync } from "fs";
import { createServer, type Server } from "http";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "./index.js";
import { resolveAccessConfig } from "./access.js";
import {
  loadConfig,
  discoverDashboards,
  createLocalSource,
  type DiscoveredDashboard,
  type ProjectConfig,
} from "./discovery.js";
import { ConnectionManager } from "../connections/manager.js";
import { QueryExecutor } from "../query/executor.js";
import { loadEnvFiles } from "../connections/env.js";
import { FileWatcher, type FileChange } from "./watcher.js";
import { DevWebSocket } from "./websocket.js";
import { parse } from "../parser/parser.js";
import { loadThemeFile } from "../renderer/theme.js";
import type { DashboardSource, DashboardSourceEvent } from "../sources/types.js";
import { createSource, createConnectionSource, resolveRemoteNewKey } from "../sources/factory.js";

export interface ServerOptions {
  /** Enables FileWatcher, DevWebSocket, and hot-reload client injection. */
  devMode: boolean;
  port?: number;
  project?: string;
  source?: string;
  sourcePoll?: number;
  sourceEndpoint?: string;
  sourceWritable?: boolean;
  connections?: string;
  editor?: boolean;
}

export interface ServerHandle {
  server: Server;
  port: number;
  projectRoot: string;
  config: ProjectConfig;
  dashboardsDir: string;
  dashboardSource: DashboardSource;
  connectionSource?: DashboardSource;
  connManager: ConnectionManager;
  getDashboards: () => DiscoveredDashboard[];
  sourceWritable: boolean;
  editorEnabled: boolean;
  shutdown: () => Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const projectRoot = resolve(opts.project ?? ".");

  // 1. Config + env
  const config = loadConfig(projectRoot);
  const port = opts.port ?? config.port;
  loadEnvFiles(projectRoot);

  const dashboardsDir = resolve(projectRoot, config.dashboards_dir);
  const connectionsDir = resolve(projectRoot, config.connections_dir);
  const queriesDir = resolve(projectRoot, config.queries_dir);

  // 2. Dashboard source (remote if --source is set, otherwise local)
  const sourceUri = opts.source ?? config.source;
  const sourceWritable = opts.sourceWritable ?? config.source_writable ?? false;
  const editorEnabled = opts.editor ?? config.editor?.enabled ?? false;
  const dashboardSource: DashboardSource = sourceUri
    ? await createSource({
        uri: sourceUri,
        pollInterval: opts.sourcePoll ?? config.source_poll,
        endpoint: opts.sourceEndpoint ?? config.source_endpoint,
        writable: sourceWritable,
      })
    : createLocalSource(projectRoot, config, { writable: sourceWritable });

  let dashboards: DiscoveredDashboard[] = await discoverDashboards(projectRoot, config, dashboardSource);

  // 3. Connections
  const connManager = new ConnectionManager();
  const connectionsUri = opts.connections ?? config.connections_source;
  let connectionSource: DashboardSource | undefined;

  try {
    if (connectionsUri) {
      connectionSource = await createConnectionSource({
        uri: connectionsUri,
        pollInterval: opts.sourcePoll ?? config.source_poll,
        endpoint: opts.sourceEndpoint ?? config.source_endpoint,
      });
      await connManager.initFromSource(connectionSource, projectRoot);
    } else if (existsSync(connectionsDir)) {
      await connManager.init(connectionsDir, projectRoot);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: Connection initialization failed: ${msg}`);
  }
  const executor = new QueryExecutor(connManager);

  // 4. Theme / branding
  let cachedBranding = (() => {
    try {
      return loadThemeFile(projectRoot)?.branding;
    } catch {
      return undefined;
    }
  })();

  // 5. Hono app
  const app = createApp({
    dashboard: {
      boardDir: dashboardsDir,
      executor,
      devMode: opts.devMode,
      projectRoot,
      config,
      source: dashboardSource,
      getDashboards: () => dashboards,
    },
    devMode: opts.devMode,
    getDashboards: () => dashboards,
    getBranding: () => cachedBranding,
    editor: {
      enabled: editorEnabled,
      source: dashboardSource,
      connManager,
      resolveNewPath: (name: string, folder?: string) => {
        if (sourceUri) return resolveRemoteNewKey(sourceUri, name, folder ?? "");
        return resolve(dashboardsDir, folder ?? "", `${name}.board`);
      },
      onSourceChange: async () => {
        dashboards = await discoverDashboards(projectRoot, config, dashboardSource);
      },
    },
    // Header-based access control — resolved from the config file (`access:`)
    // with env overrides. Disabled unless explicitly turned on.
    access: resolveAccessConfig(config.access),
  });

  // 6. HTTP server
  const server = createServer(getRequestListener(app.fetch));

  // 7. Dev-only: WebSocket + FileWatcher
  let devWs: DevWebSocket | undefined;
  let watcher: FileWatcher | undefined;

  if (opts.devMode) {
    devWs = new DevWebSocket();
    devWs.attach(server);

    watcher = new FileWatcher(projectRoot, dashboardsDir, connectionsDir, queriesDir);

    dashboardSource.watch?.(async (event: DashboardSourceEvent) => {
      const start = Date.now();
      const filePath = event.path;
      try {
        const content = await dashboardSource.read(filePath);
        parse(content, filePath);
        dashboards = await discoverDashboards(projectRoot, config, dashboardSource);
        devWs!.broadcast({ type: "error-clear" });
        const slug = dashboards.find((d) => d.filePath === filePath)?.slug ?? "unknown";
        devWs!.broadcast({ type: "reload", dashboard: slug });
        console.log(`  Dashboard updated: ${filePath} (${Date.now() - start}ms)`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const sourceContext = await getSourceContextAsync(filePath, error, dashboardSource);
        devWs!.broadcast({
          type: "error",
          error: {
            message: error.message,
            file: filePath,
            line: extractLine(error),
            column: extractColumn(error),
            source: sourceContext,
          },
        });
        console.log(`  Parse error in ${filePath}: ${error.message}`);
      }
    });

    connectionSource?.watch?.(async (event: DashboardSourceEvent) => {
      const start = Date.now();
      console.log(`  Connection config changed (remote): ${event.path}`);
      try {
        await connManager.disconnectAll();
        await connManager.initFromSource(connectionSource!, projectRoot);
        executor.clearCache();
        devWs!.broadcast({ type: "reload", dashboard: "*" });
        console.log(`  Connections reloaded from ${connectionSource!.describe()} (${Date.now() - start}ms)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  Warning: Remote connection reload failed: ${msg}`);
      }
    });

    watcher.on("change", async (change: FileChange) => {
      const start = Date.now();
      switch (change.type) {
        case "dashboard":
          break;
        case "connection": {
          if (connectionSource) break;
          console.log(`  Connection config changed: ${change.filePath}`);
          try {
            await connManager.disconnectAll();
            if (existsSync(connectionsDir)) await connManager.init(connectionsDir, projectRoot);
            executor.clearCache();
            devWs!.broadcast({ type: "reload", dashboard: "*" });
            console.log(`  Connections reloaded (${Date.now() - start}ms)`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`  Warning: Connection reload failed: ${msg}`);
          }
          break;
        }
        case "query":
          console.log(`  Query file changed: ${change.filePath}`);
          executor.clearCache();
          devWs!.broadcast({ type: "reload", dashboard: "*" });
          break;
        case "env":
          console.log(`  Environment file changed: ${change.filePath}`);
          loadEnvFiles(projectRoot);
          try {
            await connManager.disconnectAll();
            if (connectionSource) {
              await connManager.initFromSource(connectionSource, projectRoot);
            } else if (existsSync(connectionsDir)) {
              await connManager.init(connectionsDir, projectRoot);
            }
            executor.clearCache();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`  Warning: Reconnection failed after env change: ${msg}`);
          }
          devWs!.broadcast({ type: "reload", dashboard: "*" });
          break;
        case "theme":
          console.log(`  Theme file changed: ${change.filePath}`);
          try {
            cachedBranding = loadThemeFile(projectRoot)?.branding;
          } catch {
            /* theme reload handled by dashboard route */
          }
          devWs!.broadcast({ type: "reload", dashboard: "*" });
          break;
        case "config":
          console.log(`  Config changed — restart recommended`);
          break;
      }
    });

    watcher.start();
  }

  // 8. Listen
  await new Promise<void>((res) => server.listen(port, () => res()));
  // Resolve actual port when 0 was passed (OS-assigned).
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;

  // 9. Shutdown handle
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    dashboardSource.unwatch?.();
    connectionSource?.unwatch?.();
    watcher?.stop();
    devWs?.close();
    try {
      await connManager.disconnectAll();
    } catch {
      /* best effort */
    }
    await new Promise<void>((res) => server.close(() => res()));
  };

  return {
    server,
    port: boundPort,
    projectRoot,
    config,
    dashboardsDir,
    dashboardSource,
    connectionSource,
    connManager,
    getDashboards: () => dashboards,
    sourceWritable,
    editorEnabled,
    shutdown,
  };
}

// ---------------------------------------------------------------------------
// Helpers (copied from previous dev.ts location)
// ---------------------------------------------------------------------------

async function getSourceContextAsync(
  filePath: string,
  error: Error,
  source: DashboardSource,
): Promise<string | undefined> {
  try {
    const content = await source.read(filePath);
    const lines = content.split("\n");
    const errorLine = extractLine(error);
    if (!errorLine) return undefined;
    const start = Math.max(0, errorLine - 3);
    const end = Math.min(lines.length, errorLine + 2);
    return lines
      .slice(start, end)
      .map((line, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === errorLine ? ">" : " ";
        return `${marker} ${String(lineNum).padStart(4)} | ${line}`;
      })
      .join("\n");
  } catch {
    return undefined;
  }
}

function extractLine(error: Error): number | undefined {
  const match = error.message.match(/line\s+(\d+)/i);
  if (match) return parseInt(match[1], 10);
  if ("span" in error && typeof (error as { span?: unknown }).span === "object") {
    const span = (error as { span?: { start?: { line?: number } } }).span;
    if (span?.start?.line) return span.start.line;
  }
  return undefined;
}

function extractColumn(error: Error): number | undefined {
  const match = error.message.match(/col(?:umn)?\s+(\d+)/i);
  if (match) return parseInt(match[1], 10);
  if ("span" in error && typeof (error as { span?: unknown }).span === "object") {
    const span = (error as { span?: { start?: { column?: number } } }).span;
    if (span?.start?.column) return span.start.column;
  }
  return undefined;
}

