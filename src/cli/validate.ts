import { parse } from "../parser/parser.js";
import { validate } from "../parser/validator.js";
import { loadConnectionFiles, loadConnectionFilesFromSource } from "../connections/loader.js";
import { loadEnvFiles } from "../connections/env.js";
import { loadConfig, createLocalSource } from "../server/discovery.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { DashboardSource } from "../sources/types.js";
import { createSource, createConnectionSource } from "../sources/factory.js";

// --- Parse args ---
const rawArgs = process.argv.slice(2);
const checkConnections = rawArgs.includes("--check-connections");

let sourceUri: string | undefined;
let sourceEndpoint: string | undefined;
let connectionsUri: string | undefined;
const files: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === "--check-connections") continue;
  if (arg === "--source" && rawArgs[i + 1]) {
    sourceUri = rawArgs[++i];
  } else if (arg.startsWith("--source=")) {
    sourceUri = arg.split("=").slice(1).join("=");
  } else if (arg === "--source-endpoint" && rawArgs[i + 1]) {
    sourceEndpoint = rawArgs[++i];
  } else if (arg.startsWith("--source-endpoint=")) {
    sourceEndpoint = arg.split("=").slice(1).join("=");
  } else if (arg === "--connections" && rawArgs[i + 1]) {
    connectionsUri = rawArgs[++i];
  } else if (arg.startsWith("--connections=")) {
    connectionsUri = arg.split("=").slice(1).join("=");
  } else if (!arg.startsWith("--")) {
    files.push(arg);
  }
}

const projectRoot = process.cwd();
const config = loadConfig(projectRoot);
let hasErrors = false;

// --- Discover .board files if none specified ---
let boardFiles = files;
let dashboardSource: DashboardSource | undefined;

if (boardFiles.length === 0) {
  const resolvedUri = sourceUri ?? config.source;
  dashboardSource = resolvedUri
    ? await createSource({
        uri: resolvedUri,
        endpoint: sourceEndpoint ?? config.source_endpoint,
        pollInterval: 0, // no polling needed for validate
      })
    : createLocalSource(projectRoot, config);
  boardFiles = await dashboardSource.list();
}

// --- Validate .board files ---
if (boardFiles.length > 0) {
  console.log(`Validating ${boardFiles.length} board file(s)...`);
  for (const file of boardFiles) {
    try {
      const source = dashboardSource
        ? await dashboardSource.read(file)
        : readFileSync(file, "utf-8");
      const ast = parse(source, file);
      const diagnostics = validate(ast);

      const errors = diagnostics.filter((d) => d.level === "error");
      const warnings = diagnostics.filter((d) => d.level === "warning");

      if (errors.length > 0) {
        hasErrors = true;
        console.error(`  \u2717 ${file}`);
        for (const e of errors) {
          console.error(`    error: ${e.message} (line ${e.span.start.line})`);
          if (e.hint) console.error(`    hint: ${e.hint}`);
        }
      } else {
        console.log(`  \u2713 ${file}`);
      }

      for (const w of warnings) {
        console.warn(`    warning: ${w.message} (line ${w.span.start.line})`);
      }
    } catch (err) {
      hasErrors = true;
      console.error(`  \u2717 ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }
} else {
  console.log("No .board files found to validate.");
}

// --- Validate connection files ---
const resolvedConnectionsUri = connectionsUri ?? config.connections_source;
const connectionsDir = resolve(projectRoot, "connections");

if (resolvedConnectionsUri || existsSync(connectionsDir)) {
  console.log("Validating connection files...");
  try {
    loadEnvFiles(projectRoot);
    const connections = resolvedConnectionsUri
      ? await (async () => {
          const connSource = await createConnectionSource({
            uri: resolvedConnectionsUri,
            pollInterval: 0,
            endpoint: sourceEndpoint ?? config.source_endpoint,
          });
          console.log(`  Source: ${connSource.describe()}`);
          return loadConnectionFilesFromSource(connSource);
        })()
      : loadConnectionFiles(connectionsDir);

    for (const conn of connections) {
      console.log(`  \u2713 ${conn.name} (${conn.config.type}) from ${conn.sourceFile}`);
    }

    if (checkConnections) {
      console.log("Checking connection health...");
      const { ConnectionManager } = await import("../connections/manager.js");
      const manager = new ConnectionManager();
      for (const conn of connections) {
        try {
          await manager.register(conn.name, conn.config, conn.sourceFile);
          const driver = manager.get(conn.name);
          await driver.query("SELECT 1");
          console.log(`  \u2713 ${conn.name}: reachable`);
        } catch (err) {
          console.error(
            `  \u2717 ${conn.name}: ${err instanceof Error ? err.message : err}`,
          );
          hasErrors = true;
        }
      }
      await manager.disconnectAll();
    }
  } catch (err) {
    hasErrors = true;
    console.error(`  \u2717 ${err instanceof Error ? err.message : err}`);
  }
} else if (boardFiles.length === 0) {
  console.log("No board files specified and no connections/ directory found.");
  console.log("Usage: orrery validate [file.board ...] [--check-connections]");
  process.exit(1);
}

if (hasErrors) {
  console.log("\nValidation failed.");
} else {
  console.log("\nValidation passed.");
}

process.exit(hasErrors ? 1 : 0);

