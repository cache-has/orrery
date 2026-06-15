/**
 * `orrery dev` — start the development server with hot reload.
 *
 * Thin wrapper over `startServer({ devMode: true })`. Adds the interactive
 * concerns: startup banner with dashboard URLs, "open browser" behavior, and
 * signal-handler wiring.
 */

import open from "open";
import { startServer } from "../server/bootstrap.js";

interface DevArgs {
  port?: number;
  project?: string;
  noOpen: boolean;
  source?: string;
  sourcePoll?: number;
  sourceEndpoint?: string;
  sourceWritable?: boolean;
  connections?: string;
  editor?: boolean;
}

function parseArgs(argv: string[]): DevArgs {
  let port: number | undefined;
  let project: string | undefined;
  let noOpen = false;
  let source: string | undefined;
  let sourcePoll: number | undefined;
  let sourceEndpoint: string | undefined;
  let sourceWritable: boolean | undefined;
  let connections: string | undefined;
  let editor: boolean | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1]) { port = parseInt(argv[i + 1], 10); i++; }
    else if (arg.startsWith("--port=")) port = parseInt(arg.split("=")[1], 10);
    else if (arg === "--project" && argv[i + 1]) { project = argv[i + 1]; i++; }
    else if (arg.startsWith("--project=")) project = arg.split("=")[1];
    else if (arg === "--no-open") noOpen = true;
    else if (arg === "--source" && argv[i + 1]) { source = argv[i + 1]; i++; }
    else if (arg.startsWith("--source=")) source = arg.split("=").slice(1).join("=");
    else if (arg === "--source-poll" && argv[i + 1]) { sourcePoll = parseInt(argv[i + 1], 10); i++; }
    else if (arg.startsWith("--source-poll=")) sourcePoll = parseInt(arg.split("=")[1], 10);
    else if (arg === "--source-endpoint" && argv[i + 1]) { sourceEndpoint = argv[i + 1]; i++; }
    else if (arg.startsWith("--source-endpoint=")) sourceEndpoint = arg.split("=").slice(1).join("=");
    else if (arg === "--source-writable") sourceWritable = true;
    else if (arg === "--no-source-writable") sourceWritable = false;
    else if (arg === "--connections" && argv[i + 1]) { connections = argv[i + 1]; i++; }
    else if (arg.startsWith("--connections=")) connections = arg.split("=").slice(1).join("=");
    else if (arg === "--editor") editor = true;
    else if (arg === "--no-editor") editor = false;
  }

  return { port, project, noOpen, source, sourcePoll, sourceEndpoint, sourceWritable, connections, editor };
}

const args = parseArgs(process.argv.slice(3));

const handle = await startServer({
  devMode: true,
  port: args.port,
  project: args.project,
  source: args.source,
  sourcePoll: args.sourcePoll,
  sourceEndpoint: args.sourceEndpoint,
  sourceWritable: args.sourceWritable,
  connections: args.connections,
  editor: args.editor,
});

const { port, dashboardsDir, dashboardSource, connectionSource, connManager, getDashboards, sourceWritable, editorEnabled } = handle;
const dashboards = getDashboards();

console.log(`\n  Orrery dev server running`);
console.log(`  Source: ${dashboardSource.describe()} (${sourceWritable ? "writable" : "read-only"})`);
console.log(`  Web editor: ${editorEnabled ? "enabled" : "disabled"}`);
if (connectionSource) {
  console.log(`  Connections source: ${connectionSource.describe()}`);
}
console.log("");

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

const connections = connManager.listConnections();
if (connections.length > 0) {
  console.log(`\n  Connections:`);
  for (const conn of connections) {
    const icon = conn.connected ? "✓" : "✗";
    const status = conn.connected ? "connected" : "not connected";
    console.log(`    ${icon} ${conn.name} (${conn.type}) — ${status}`);
  }
}

console.log(`\n  Watching for changes...\n`);

if (!args.noOpen) {
  open(`http://localhost:${port}`).catch(() => {
    /* browser open is best-effort */
  });
}

function shutdown() {
  console.log("\n  Shutting down...");
  handle.shutdown().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
