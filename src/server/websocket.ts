/**
 * WebSocket server for dev hot reload.
 *
 * Manages client connections and broadcasts typed messages
 * for dashboard updates, data pushes, and error overlays.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
// ---------------------------------------------------------------------------
// Message types (Server → Client)
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: "reload"; dashboard: string }
  | { type: "update"; componentId: string; data: unknown }
  | { type: "error"; error: { message: string; file?: string; line?: number; column?: number; source?: string } }
  | { type: "error-clear" }
  | { type: "connected" };

// ---------------------------------------------------------------------------
// WebSocket Manager
// ---------------------------------------------------------------------------

export class DevWebSocket {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      this.send(ws, { type: "connected" });

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });
  }

  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
