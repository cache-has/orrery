/**
 * File watcher for the dev server.
 *
 * Watches .board, .yaml, .sql, and .env files and emits typed change events.
 */

import chokidar from "chokidar";
import { extname, basename, resolve } from "path";
import { existsSync } from "fs";
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChangeType = "dashboard" | "connection" | "query" | "env" | "config" | "theme";

export interface FileChange {
  type: ChangeType;
  filePath: string;
  event: "add" | "change" | "unlink";
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

export class FileWatcher extends EventEmitter {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;

  /**
   * @param projectRoot — Project root directory
   * @param dashboardsDir — Dashboards directory (watched for non-.board files only;
   *        .board watching is handled by the DashboardSource)
   * @param connectionsDir — Connections directory
   * @param queriesDir — Queries directory
   */
  constructor(
    private projectRoot: string,
    private dashboardsDir: string,
    private connectionsDir: string,
    private queriesDir: string,
  ) {
    super();
  }

  start(): void {
    // Watch directories — dashboard .board files are watched by the DashboardSource,
    // but we still watch the dashboards dir for non-.board changes if needed.
    const paths: string[] = [];

    if (existsSync(this.connectionsDir)) paths.push(this.connectionsDir);
    if (existsSync(this.queriesDir)) paths.push(this.queriesDir);

    // Watch specific env/config/theme files in project root
    const envFile = resolve(this.projectRoot, ".env");
    const envLocalFile = resolve(this.projectRoot, ".env.local");
    const configFile = resolve(this.projectRoot, "orrery.config.yaml");
    const themeCssFile = resolve(this.projectRoot, "theme.css");
    const themeYamlFile = resolve(this.projectRoot, "theme.yaml");
    const themeYmlFile = resolve(this.projectRoot, "theme.yml");
    if (existsSync(envFile)) paths.push(envFile);
    if (existsSync(envLocalFile)) paths.push(envLocalFile);
    if (existsSync(configFile)) paths.push(configFile);
    if (existsSync(themeCssFile)) paths.push(themeCssFile);
    if (existsSync(themeYamlFile)) paths.push(themeYamlFile);
    if (existsSync(themeYmlFile)) paths.push(themeYmlFile);

    if (paths.length === 0) return;

    this.watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    });

    const handleEvent = (event: "add" | "change" | "unlink") => (filePath: string) => {
      const change = this.classifyChange(filePath, event);
      if (change) {
        this.emit("change", change);
      }
    };

    this.watcher.on("add", handleEvent("add"));
    this.watcher.on("change", handleEvent("change"));
    this.watcher.on("unlink", handleEvent("unlink"));
    this.watcher.on("error", (err: unknown) => {
      console.warn(`Watcher error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private classifyChange(filePath: string, event: "add" | "change" | "unlink"): FileChange | null {
    const ext = extname(filePath);
    const name = basename(filePath);

    if (name === "orrery.config.yaml") {
      return { type: "config", filePath, event };
    }
    if (name === ".env" || name === ".env.local") {
      return { type: "env", filePath, event };
    }
    if (name === "theme.css" || name === "theme.yaml" || name === "theme.yml") {
      return { type: "theme", filePath, event };
    }
    if (ext === ".board") {
      return { type: "dashboard", filePath, event };
    }
    if (ext === ".yaml" || ext === ".yml") {
      return { type: "connection", filePath, event };
    }
    if (ext === ".sql") {
      return { type: "query", filePath, event };
    }
    return null;
  }
}
