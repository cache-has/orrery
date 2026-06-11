import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => {
  return c.json({ status: "ok", version: "1.0.0" });
});
