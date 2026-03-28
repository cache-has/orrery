import { Lexer } from "../parser/lexer.js";
import { parse } from "../parser/parser.js";
import { loadConnectionFiles } from "../connections/loader.js";
import { loadEnvFiles } from "../connections/env.js";
import { existsSync } from "fs";
import { readFileSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
const checkConnections = args.includes("--check-connections");
const files = args.filter((a) => !a.startsWith("--"));

const projectRoot = process.cwd();
let hasErrors = false;

// --- Validate .board files ---
if (files.length > 0) {
  console.log("Validating board files...");
  for (const file of files) {
    try {
      const source = readFileSync(file, "utf-8");
      // Lex to catch syntax errors, then parse the source
      new Lexer(source, file).tokenize();
      parse(source, file);
      console.log(`  \u2713 ${file}`);
    } catch (err) {
      hasErrors = true;
      console.error(`  \u2717 ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }
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
} else if (files.length === 0) {
  console.log("No board files specified and no connections/ directory found.");
  console.log("Usage: openboard validate [file.board ...] [--check-connections]");
  process.exit(1);
}

process.exit(hasErrors ? 1 : 0);
