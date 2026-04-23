/**
 * `openboard serve` — production HTTP server.
 *
 * Same Hono app as `dev`, minus the interactive/watcher plumbing: no
 * FileWatcher, no DevWebSocket, no hot-reload client JS, no browser-open.
 * Use this in containers and long-running prod deployments.
 */

import { startServer } from "../server/bootstrap.js";

interface ServeArgs {
  port?: number;
  project?: string;
  source?: string;
  sourcePoll?: number;
  sourceEndpoint?: string;
  sourceWritable?: boolean;
  connections?: string;
  editor?: boolean;
}

function parseArgs(argv: string[]): ServeArgs {
  let port: number | undefined;
  let project: string | undefined;
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
    else if (arg === "--source" && argv[i + 1]) { source = argv[i + 1]; i++; }
    else if (arg.startsWith("--source=")) source = arg.split("=").slice(1).join("=");
    else if (arg === "--source-poll" && argv[i + 1]) { sourcePoll = parseInt(argv[i + 1], 10); i++; }
    else if (arg.startsWith("--source-poll=")) sourcePoll = parseInt(arg.split("=")[1], 10);
    else if (arg === "--source-endpoint" && argv[i + 1]) { sourceEndpoint = argv[i + 1]; i++; }
    else if (arg.startsWith("--source-endpoint=")) sourceEndpoint = arg.split("=").slice(1).join("=");
    else if (arg === "--source-writable") sourceWritable = true;
    else if (arg === "--connections" && argv[i + 1]) { connections = argv[i + 1]; i++; }
    else if (arg.startsWith("--connections=")) connections = arg.split("=").slice(1).join("=");
    else if (arg === "--editor") editor = true;
  }

  return { port, project, source, sourcePoll, sourceEndpoint, sourceWritable, connections, editor };
}

const args = parseArgs(process.argv.slice(3));

const handle = await startServer({
  devMode: false,
  port: args.port,
  project: args.project,
  source: args.source,
  sourcePoll: args.sourcePoll,
  sourceEndpoint: args.sourceEndpoint,
  sourceWritable: args.sourceWritable,
  connections: args.connections,
  editor: args.editor,
});

const { port, dashboardSource, connectionSource, connManager, getDashboards, sourceWritable, editorEnabled } = handle;

console.log(`  OpenBoard serve running on port ${port}`);
console.log(`  Source: ${dashboardSource.describe()} (${sourceWritable ? "writable" : "read-only"})`);
console.log(`  Web editor: ${editorEnabled ? "enabled" : "disabled"}`);
if (connectionSource) {
  console.log(`  Connections source: ${connectionSource.describe()}`);
}
console.log(`  Dashboards: ${getDashboards().length}`);

const connections = connManager.listConnections();
if (connections.length > 0) {
  for (const conn of connections) {
    const icon = conn.connected ? "✓" : "✗";
    const status = conn.connected ? "connected" : "not connected";
    console.log(`    ${icon} ${conn.name} (${conn.type}) — ${status}`);
  }
}

function shutdown() {
  handle.shutdown().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
