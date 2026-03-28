import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "http";
import { WebSocket } from "ws";
import { DevWebSocket, type ServerMessage } from "../../src/server/websocket.js";

describe("DevWebSocket", () => {
  let server: ReturnType<typeof createServer>;
  let devWs: DevWebSocket;

  afterEach(async () => {
    devWs?.close();
    await new Promise<void>((resolve) => {
      if (server?.listening) server.close(() => resolve());
      else resolve();
    });
  });

  function startServer(): Promise<number> {
    server = createServer();
    devWs = new DevWebSocket();
    devWs.attach(server);
    return new Promise((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });
  }

  it("sends connected message on connection", async () => {
    const port = await startServer();
    const ws = new WebSocket(`ws://localhost:${port}/ws`);

    const msg = await new Promise<ServerMessage>((resolve) => {
      ws.on("message", (data) => resolve(JSON.parse(data.toString())));
    });

    expect(msg.type).toBe("connected");
    ws.close();
  });

  it("broadcasts messages to all clients", async () => {
    const port = await startServer();
    const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${port}/ws`);

    // Wait for both to connect
    await Promise.all([
      new Promise<void>((r) => ws1.on("message", () => r())),
      new Promise<void>((r) => ws2.on("message", () => r())),
    ]);

    const messages: ServerMessage[] = [];
    ws1.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws2.on("message", (data) => messages.push(JSON.parse(data.toString())));

    devWs.broadcast({ type: "reload", dashboard: "test" });

    await new Promise((r) => setTimeout(r, 100));

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: "reload", dashboard: "test" });
    expect(messages[1]).toEqual({ type: "reload", dashboard: "test" });

    ws1.close();
    ws2.close();
  });

  it("tracks client count", async () => {
    const port = await startServer();
    expect(devWs.clientCount).toBe(0);

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    // Small delay for server to process
    await new Promise((r) => setTimeout(r, 50));
    expect(devWs.clientCount).toBe(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(devWs.clientCount).toBe(0);
  });

  it("broadcasts error and error-clear messages", async () => {
    const port = await startServer();
    const ws = new WebSocket(`ws://localhost:${port}/ws`);

    // Wait for connected message
    await new Promise<void>((r) => ws.on("message", () => r()));

    const messages: ServerMessage[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));

    devWs.broadcast({
      type: "error",
      error: { message: "Unexpected token", file: "test.board", line: 5, column: 10 },
    });
    devWs.broadcast({ type: "error-clear" });

    await new Promise((r) => setTimeout(r, 100));

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe("error");
    expect(messages[1].type).toBe("error-clear");

    ws.close();
  });
});
