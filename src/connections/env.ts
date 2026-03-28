import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseDotenv } from "dotenv";

/**
 * Load .env and .env.local files into process.env.
 * Resolution order (later files override earlier):
 * 1. .env
 * 2. .env.local
 *
 * Existing process.env values are never overwritten.
 */
export function loadEnvFiles(projectRoot: string): void {
  // Load .env.local first so it takes precedence over .env.
  // Neither overwrites existing process.env values.
  const envFiles = [".env.local", ".env"];

  for (const file of envFiles) {
    const filePath = resolve(projectRoot, file);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const parsed = parseDotenv(content);

    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Resolve all `${VAR}` references in a string using process.env.
 * Throws with a clear message if any referenced variable is not set.
 */
export function resolveEnvVar(
  value: string,
  connectionName: string,
  fieldName: string,
): string {
  return value.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const resolved = process.env[varName];
    if (resolved === undefined) {
      throw new Error(
        `Connection '${connectionName}': environment variable ${varName} is not set (referenced in '${fieldName}')`,
      );
    }
    return resolved;
  });
}

/**
 * Resolve all string values in a connection config object.
 * Non-string values are passed through unchanged.
 */
export function resolveEnvVarsInConfig(
  config: Record<string, unknown>,
  connectionName: string,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") {
      resolved[key] = resolveEnvVar(value, connectionName, key);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
