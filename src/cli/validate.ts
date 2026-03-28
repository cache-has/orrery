import { parse } from "../parser/parser.js";
import { validate } from "../parser/validator.js";
import { loadConnectionFiles } from "../connections/loader.js";
import { loadEnvFiles } from "../connections/env.js";
import { loadConfig, discoverDashboards } from "../server/discovery.js";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, extname } from "path";

const args = process.argv.slice(2);
const checkConnections = args.includes("--check-connections");
const files = args.filter((a) => !a.startsWith("--"));

const projectRoot = process.cwd();
let hasErrors = false;

// --- Discover .board files if none specified ---
let boardFiles = files;
if (boardFiles.length === 0) {
  const config = loadConfig(projectRoot);
  const dashboardsDir = resolve(projectRoot, config.dashboards_dir);
  if (existsSync(dashboardsDir)) {
    boardFiles = findBoardFilesRecursive(dashboardsDir);
  } else {
    // Fallback: look for .board files in project root
    boardFiles = findBoardFilesRecursive(projectRoot, false);
  }
}

// --- Validate .board files ---
if (boardFiles.length > 0) {
  console.log(`Validating ${boardFiles.length} board file(s)...`);
  for (const file of boardFiles) {
    try {
      const source = readFileSync(file, "utf-8");
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
const connectionsDir = resolve(projectRoot, "connections");
if (existsSync(connectionsDir)) {
  console.log("Validating connection files...");
  try {
    loadEnvFiles(projectRoot);
    const connections = loadConnectionFiles(connectionsDir);
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
  console.log("Usage: openboard validate [file.board ...] [--check-connections]");
  process.exit(1);
}

if (hasErrors) {
  console.log("\nValidation failed.");
} else {
  console.log("\nValidation passed.");
}

process.exit(hasErrors ? 1 : 0);

// --- Helpers ---

function findBoardFilesRecursive(dir: string, recursive = true): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      results.push(...findBoardFilesRecursive(fullPath, true));
    } else if (entry.isFile() && extname(entry.name) === ".board") {
      results.push(fullPath);
    }
  }
  return results;
}
