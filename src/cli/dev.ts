/**
 * `openboard dev` — start the development server with hot reload.
 *
 * Discovers project structure, initializes connections, starts HTTP + WebSocket
 * servers, watches files, and pushes live updates to the browser.
 */

import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { createServer } from "http";
import open from "open";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "../server/index.js";
import { loadConfig, discoverDashboards, createLocalSource, type DiscoveredDashboard, type ProjectConfig } from "../server/discovery.js";
import { ConnectionManager } from "../connections/manager.js";
import { QueryExecutor } from "../query/executor.js";
import { loadEnvFiles } from "../connections/env.js";
import { FileWatcher, type FileChange } from "../server/watcher.js";
import { DevWebSocket } from "../server/websocket.js";
import { parse } from "../parser/parser.js";
import { loadThemeFile } from "../renderer/theme.js";
import type { DashboardSource, DashboardSourceEvent } from "../sources/types.js";
import { createSource, createConnectionSource } from "../sources/factory.js";

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

interface DevArgs {
  port?: number;
  project?: string;
  noOpen: boolean;
  source?: string;
  sourcePoll?: number;
  sourceEndpoint?: string;
  connections?: string;
}

function parseArgs(argv: string[]): DevArgs {
  let port: number | undefined;
  let project: string | undefined;
  let noOpen = false;
  let source: string | undefined;
  let sourcePoll: number | undefined;
  let sourceEndpoint: string | undefined;
  let connections: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10);
      i++;
    } else if (arg.startsWith("--port=")) {
      port = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--project" && argv[i + 1]) {
      project = argv[i + 1];
      i++;
    } else if (arg.startsWith("--project=")) {
      project = arg.split("=")[1];
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--source" && argv[i + 1]) {
      source = argv[i + 1];
      i++;
    } else if (arg.startsWith("--source=")) {
      source = arg.split("=").slice(1).join("=");
    } else if (arg === "--source-poll" && argv[i + 1]) {
      sourcePoll = parseInt(argv[i + 1], 10);
      i++;
    } else if (arg.startsWith("--source-poll=")) {
      sourcePoll = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--source-endpoint" && argv[i + 1]) {
      sourceEndpoint = argv[i + 1];
      i++;
    } else if (arg.startsWith("--source-endpoint=")) {
      sourceEndpoint = arg.split("=").slice(1).join("=");
    } else if (arg === "--connections" && argv[i + 1]) {
      connections = argv[i + 1];
      i++;
    } else if (arg.startsWith("--connections=")) {
      connections = arg.split("=").slice(1).join("=");
    }
  }

  return { port, project, noOpen, source, sourcePoll, sourceEndpoint, connections };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(3)); // skip node, script, "dev"
const projectRoot = resolve(args.project ?? ".");

// 1. Load config
const config = loadConfig(projectRoot);
const port = args.port ?? config.port;

// 2. Load env files
loadEnvFiles(projectRoot);

// 3. Discover dashboards (parse errors warn, don't crash)
const dashboardsDir = resolve(projectRoot, config.dashboards_dir);
const connectionsDir = resolve(projectRoot, config.connections_dir);
const queriesDir = resolve(projectRoot, config.queries_dir);

// Create dashboard source (remote if --source is set, otherwise local)
const sourceUri = args.source ?? config.source;
const dashboardSource: DashboardSource = sourceUri
  ? await createSource({
      uri: sourceUri,
      pollInterval: args.sourcePoll ?? config.source_poll,
      endpoint: args.sourceEndpoint ?? config.source_endpoint,
    })
  : createLocalSource(projectRoot, config);

let dashboards: DiscoveredDashboard[] = await discoverDashboards(projectRoot, config, dashboardSource);

// 4. Initialize connection manager (errors warn, don't crash)
const connManager = new ConnectionManager();
let executor: QueryExecutor;
const connectionsUri = args.connections ?? config.connections_source;
let connectionSource: DashboardSource | undefined;

try {
  if (connectionsUri) {
    connectionSource = await createConnectionSource({
      uri: connectionsUri,
      pollInterval: args.sourcePoll ?? config.source_poll,
      endpoint: args.sourceEndpoint ?? config.source_endpoint,
    });
    await connManager.initFromSource(connectionSource, projectRoot);
  } else if (existsSync(connectionsDir)) {
    await connManager.init(connectionsDir, projectRoot);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`Warning: Connection initialization failed: ${msg}`);
}
executor = new QueryExecutor(connManager);

// 5. Load theme file for branding on the index page
let cachedBranding = (() => {
  try {
    return loadThemeFile(projectRoot)?.branding;
  } catch { return undefined; }
})();

// 6. Create HTTP app
const app = createApp({
  dashboard: {
    boardDir: dashboardsDir,
    executor,
    devMode: true,
    projectRoot,
    config,
  },
  devMode: true,
  getDashboards: () => dashboards,
  getBranding: () => cachedBranding,
});

// 7. Create HTTP server and attach WebSocket
const server = createServer(getRequestListener(app.fetch));
const devWs = new DevWebSocket();
devWs.attach(server);

// 8. Start file watcher (non-dashboard files) and source watcher (dashboards)
const watcher = new FileWatcher(projectRoot, dashboardsDir, connectionsDir, queriesDir);

// Dashboard watching via source
dashboardSource.watch?.(async (event: DashboardSourceEvent) => {
  const start = Date.now();
  const filePath = event.path;

  try {
    const content = await dashboardSource.read(filePath);
    parse(content, filePath); // validate parse succeeds

    // Update dashboard list
    const updated = await discoverDashboards(projectRoot, config, dashboardSource);
    dashboards = updated;

    // Clear any previous error overlay and trigger reload
    devWs.broadcast({ type: "error-clear" });

    const slug = dashboards.find((d) => d.filePath === filePath)?.slug ?? "unknown";
    devWs.broadcast({ type: "reload", dashboard: slug });

    console.log(`  Dashboard updated: ${filePath} (${Date.now() - start}ms)`);
  } catch (err) {
    // Send parse error to browser as overlay
    const error = err instanceof Error ? err : new Error(String(err));
    const sourceContext = await getSourceContextAsync(filePath, error, dashboardSource);
    devWs.broadcast({
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

// Remote connection source watching (polling-based reload)
connectionSource?.watch?.(async (event: DashboardSourceEvent) => {
  const start = Date.now();
  console.log(`  Connection config changed (remote): ${event.path}`);
  try {
    await connManager.disconnectAll();
    await connManager.initFromSource(connectionSource!, projectRoot);
    executor.clearCache();
    devWs.broadcast({ type: "reload", dashboard: "*" });
    console.log(`  Connections reloaded from ${connectionSource!.describe()} (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: Remote connection reload failed: ${msg}`);
  }
});

watcher.on("change", async (change: FileChange) => {
  const start = Date.now();

  switch (change.type) {
    case "dashboard": {
      // Dashboard changes handled by source watcher above — skip
      break;
    }

    case "connection": {
      // Skip local file watcher events if connections are loaded from a remote source
      if (connectionSource) break;
      console.log(`  Connection config changed: ${change.filePath}`);
      try {
        await connManager.disconnectAll();
        if (existsSync(connectionsDir)) {
          await connManager.init(connectionsDir, projectRoot);
        }
        executor.clearCache();
        devWs.broadcast({ type: "reload", dashboard: "*" });
        console.log(`  Connections reloaded (${Date.now() - start}ms)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  Warning: Connection reload failed: ${msg}`);
      }
      break;
    }

    case "query": {
      console.log(`  Query file changed: ${change.filePath}`);
      executor.clearCache();
      devWs.broadcast({ type: "reload", dashboard: "*" });
      break;
    }

    case "env": {
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
      devWs.broadcast({ type: "reload", dashboard: "*" });
      break;
    }

    case "theme": {
      console.log(`  Theme file changed: ${change.filePath}`);
      try {
        cachedBranding = loadThemeFile(projectRoot)?.branding;
      } catch { /* theme reload handled by dashboard route */ }
      devWs.broadcast({ type: "reload", dashboard: "*" });
      break;
    }

    case "config": {
      console.log(`  Config changed — restart recommended`);
      break;
    }
  }
});

watcher.start();

// 9. Start server
server.listen(port, () => {
  // 10. Print startup summary
  console.log(`\n  OpenBoard dev server running`);
  console.log(`  Source: ${dashboardSource.describe()}`);
  if (connectionSource) {
    console.log(`  Connections source: ${connectionSource.describe()}`);
  }
  console.log("");

  // Dashboard URLs
  if (dashboards.length > 0) {
    console.log(`  Dashboard index:  http://localhost:${port}`);
    for (const d of dashboards) {
      const pad = " ".repeat(Math.max(0, 18 - d.title.length));
      console.log(`  ${d.title}:${pad}http://localhost:${port}/d/${d.slug}`);
    }
  } else {
    console.log(`  No dashboards found`);
    console.log(`  Create .board files in ${dashboardsDir}`);
  }

  // Connection status
  const connections = connManager.listConnections();
  if (connections.length > 0) {
    console.log(`\n  Connections:`);
    for (const conn of connections) {
      const icon = conn.connected ? "\u2713" : "\u2717";
      const status = conn.connected ? "connected" : "not connected";
      console.log(`    ${icon} ${conn.name} (${conn.type}) — ${status}`);
    }
  }

  console.log(`\n  Watching for changes...\n`);

  // 11. Open browser (unless --no-open)
  if (!args.noOpen) {
    open(`http://localhost:${port}`).catch(() => {
      // Silently ignore if browser can't be opened
    });
  }
});

// Graceful shutdown
function shutdown() {
  console.log("\n  Shutting down...");
  dashboardSource.unwatch?.();
  connectionSource?.unwatch?.();
  watcher.stop();
  devWs.close();
  connManager.disconnectAll().finally(() => {
    server.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------------------------------------------------------------------------
// Helpers
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
  // ParseError objects typically have line info in the message like "line 5"
  const match = error.message.match(/line\s+(\d+)/i);
  if (match) return parseInt(match[1], 10);
  // Or check for span property
  if ("span" in error && typeof (error as any).span === "object") {
    const span = (error as any).span;
    if (span?.start?.line) return span.start.line;
  }
  return undefined;
}

function extractColumn(error: Error): number | undefined {
  const match = error.message.match(/col(?:umn)?\s+(\d+)/i);
  if (match) return parseInt(match[1], 10);
  if ("span" in error && typeof (error as any).span === "object") {
    const span = (error as any).span;
    if (span?.start?.column) return span.start.column;
  }
  return undefined;
}
