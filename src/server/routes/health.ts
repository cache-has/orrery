import { Hono } from "hono";
import { VERSION } from "../../version.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => {
  return c.json({ status: "ok", version: VERSION });
});
