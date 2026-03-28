import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveEnvVar, resolveEnvVarsInConfig, loadEnvFiles } from "../../src/connections/env.js";

describe("resolveEnvVar", () => {
  beforeEach(() => {
    process.env.TEST_HOST = "localhost";
    process.env.TEST_PORT = "5432";
  });

  afterEach(() => {
    delete process.env.TEST_HOST;
    delete process.env.TEST_PORT;
  });

  it("resolves a single env var", () => {
    expect(resolveEnvVar("${TEST_HOST}", "myconn", "host")).toBe("localhost");
  });

  it("resolves multiple env vars in one string", () => {
    expect(
      resolveEnvVar("postgres://${TEST_HOST}:${TEST_PORT}/db", "myconn", "connection_string"),
    ).toBe("postgres://localhost:5432/db");
  });

  it("passes through strings without env vars", () => {
    expect(resolveEnvVar("plain-value", "myconn", "host")).toBe("plain-value");
  });

  it("throws with clear message for missing env var", () => {
    expect(() => resolveEnvVar("${MISSING_VAR}", "warehouse", "password")).toThrow(
      "Connection 'warehouse': environment variable MISSING_VAR is not set (referenced in 'password')",
    );
  });
});

describe("resolveEnvVarsInConfig", () => {
  beforeEach(() => {
    process.env.DB_HOST = "prod-host";
    process.env.DB_PASS = "secret";
  });

  afterEach(() => {
    delete process.env.DB_HOST;
    delete process.env.DB_PASS;
  });

  it("resolves string values and passes through non-strings", () => {
    const result = resolveEnvVarsInConfig(
      { host: "${DB_HOST}", port: 5432, password: "${DB_PASS}", ssl: true },
      "prod",
    );
    expect(result).toEqual({
      host: "prod-host",
      port: 5432,
      password: "secret",
      ssl: true,
    });
  });
});

describe("loadEnvFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "openboard-env-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
    delete process.env.FROM_DOTENV;
    delete process.env.OVERRIDE_ME;
  });

  it("loads variables from .env", () => {
    writeFileSync(join(tmpDir, ".env"), "FROM_DOTENV=hello\n");
    loadEnvFiles(tmpDir);
    expect(process.env.FROM_DOTENV).toBe("hello");
  });

  it(".env.local overrides .env", () => {
    writeFileSync(join(tmpDir, ".env"), "OVERRIDE_ME=base\n");
    writeFileSync(join(tmpDir, ".env.local"), "OVERRIDE_ME=local\n");
    loadEnvFiles(tmpDir);
    // .env.local loads first, so its value wins over .env
    expect(process.env.OVERRIDE_ME).toBe("local");
  });

  it("does not overwrite existing process.env values", () => {
    process.env.FROM_DOTENV = "already-set";
    writeFileSync(join(tmpDir, ".env"), "FROM_DOTENV=from-file\n");
    loadEnvFiles(tmpDir);
    expect(process.env.FROM_DOTENV).toBe("already-set");
  });

  it("handles missing .env files gracefully", () => {
    expect(() => loadEnvFiles(tmpDir)).not.toThrow();
  });
});
