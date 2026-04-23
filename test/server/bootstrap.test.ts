import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import WebSocket from "ws";
import { startServer, type ServerHandle } from "../../src/server/bootstrap.js";

const BASE = resolve(tmpdir(), "openboard-bootstrap-" + process.pid);

const BOARD = `dashboard "Serve Parity" {
  description: "parity test"

  row {
    text "hello" {
      > hi
    }
  }
}`;

function setupProject(dir: string) {
  mkdirSync(resolve(dir, "dashboards"), { recursive: true });
  mkdirSync(resolve(dir, "connections"), { recursive: true });
  mkdirSync(resolve(dir, "queries"), { recursive: true });
  writeFileSync(resolve(dir, "dashboards", "parity.board"), BOARD);
}

async function fetchText(port: number, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.text() };
}

describe("bootstrap startServer — dev vs serve", () => {
  let devHandle: ServerHandle;
  let serveHandle: ServerHandle;

  beforeAll(async () => {
    const devDir = resolve(BASE, "dev");
    const serveDir = resolve(BASE, "serve");
    setupProject(devDir);
    setupProject(serveDir);

    devHandle = await startServer({ devMode: true, project: devDir, port: 0 });
    serveHandle = await startServer({ devMode: false, project: serveDir, port: 0 });
  });

  afterAll(async () => {
    await devHandle?.shutdown();
    await serveHandle?.shutdown();
    rmSync(BASE, { recursive: true, force: true });
  });

  it("dev mode accepts WebSocket upgrades on /ws", async () => {
    const addr = devHandle.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const opened = await new Promise<boolean>((res) => {
      ws.once("open", () => res(true));
      ws.once("error", () => res(false));
      setTimeout(() => res(false), 2000);
    });
    ws.close();
    expect(opened).toBe(true);
  });

  it("serve mode rejects /ws upgrades (no DevWebSocket attached)", async () => {
    const addr = serveHandle.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const opened = await new Promise<boolean>((res) => {
      ws.once("open", () => res(true));
      ws.once("error", () => res(false));
      ws.once("unexpected-response", () => res(false));
      setTimeout(() => res(false), 2000);
    });
    ws.close();
    expect(opened).toBe(false);
  });

  it("serve mode returns 404 for /ws over plain HTTP", async () => {
    const addr = serveHandle.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const { status } = await fetchText(port, "/ws");
    expect(status).toBe(404);
  });

  it("both modes serve the same dashboard HTML for /d/:slug", async () => {
    const devPort = (devHandle.server.address() as { port: number }).port;
    const servePort = (serveHandle.server.address() as { port: number }).port;

    const devRes = await fetchText(devPort, "/d/parity");
    const serveRes = await fetchText(servePort, "/d/parity");

    expect(devRes.status).toBe(200);
    expect(serveRes.status).toBe(200);

    // Both must render the dashboard title
    expect(devRes.body).toContain("Serve Parity");
    expect(serveRes.body).toContain("Serve Parity");

    // Dev mode injects the hot-reload client script; serve must not.
    expect(devRes.body).toContain("/openboard/client.js");
    expect(serveRes.body).not.toContain("/openboard/client.js");
  });
});
