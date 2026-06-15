/**
 * `orrery build` — generate static HTML export of dashboards.
 *
 * Usage:
 *   orrery build --output ./dist
 *   orrery build --dashboard sales --output ./dist
 *   orrery build --output ./dist --snapshot-label "Q1 2026 Report"
 *   orrery build --output ./dist --self-contained
 */

import { resolve } from "path";
import { staticBuild } from "../static/builder.js";

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

interface BuildArgs {
  output: string;
  dashboard?: string;
  snapshotLabel?: string;
  selfContained: boolean;
  project: string;
  source?: string;
  sourcePoll?: number;
  sourceEndpoint?: string;
  connections?: string;
}

function parseArgs(argv: string[]): BuildArgs {
  let output = "./dist";
  let dashboard: string | undefined;
  let snapshotLabel: string | undefined;
  let selfContained = false;
  let project = ".";
  let source: string | undefined;
  let sourcePoll: number | undefined;
  let sourceEndpoint: string | undefined;
  let connections: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--output" || arg === "-o") && argv[i + 1]) {
      output = argv[i + 1];
      i++;
    } else if (arg.startsWith("--output=")) {
      output = arg.split("=").slice(1).join("=");
    } else if (arg === "--dashboard" && argv[i + 1]) {
      dashboard = argv[i + 1];
      i++;
    } else if (arg.startsWith("--dashboard=")) {
      dashboard = arg.split("=").slice(1).join("=");
    } else if (arg === "--snapshot-label" && argv[i + 1]) {
      snapshotLabel = argv[i + 1];
      i++;
    } else if (arg.startsWith("--snapshot-label=")) {
      snapshotLabel = arg.split("=").slice(1).join("=");
    } else if (arg === "--self-contained") {
      selfContained = true;
    } else if (arg === "--project" && argv[i + 1]) {
      project = argv[i + 1];
      i++;
    } else if (arg.startsWith("--project=")) {
      project = arg.split("=").slice(1).join("=");
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

  return { output, dashboard, snapshotLabel, selfContained, project, source, sourcePoll, sourceEndpoint, connections };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(3)); // skip node, script, "build"
const projectRoot = resolve(args.project);

console.log("Orrery — Static Build");
console.log(`  Project: ${projectRoot}`);
console.log(`  Output:  ${resolve(args.output)}`);
if (args.dashboard) console.log(`  Dashboard: ${args.dashboard}`);
if (args.snapshotLabel) console.log(`  Snapshot: ${args.snapshotLabel}`);
if (args.selfContained) console.log(`  Mode: self-contained (single-file)`);
console.log("");

try {
  const result = await staticBuild({
    projectRoot,
    outputDir: args.output,
    dashboardFilter: args.dashboard,
    snapshotLabel: args.snapshotLabel,
    selfContained: args.selfContained,
    sourceUri: args.source,
    sourcePoll: args.sourcePoll,
    sourceEndpoint: args.sourceEndpoint,
    connectionsUri: args.connections,
  });

  console.log("");
  console.log(`Built ${result.dashboards.length} dashboard(s)`);
  for (const d of result.dashboards) {
    console.log(`  ${d.title} → ${d.outputPath}`);
  }
  console.log(`  Index → ${result.indexPath}`);
  console.log(`  Total size: ${formatBytes(result.totalSize)}`);
  console.log(`  Built at: ${result.builtAt.toISOString()}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nBuild failed: ${msg}`);
  process.exit(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
