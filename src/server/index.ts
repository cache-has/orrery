import { Hono } from "hono";
import { logger } from "hono/logger";
import { healthRoutes } from "./routes/health.js";

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", logger());
  app.route("/api", healthRoutes);

  app.get("/", (c) => {
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenBoard</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 80px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { font-size: 2rem; }
    p { color: #555; line-height: 1.6; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>OpenBoard</h1>
  <p>Dashboards as code, not clicks.</p>
  <p>The dev server is running. Dashboard rendering will be implemented in phase 06.</p>
  <p>Health check: <code>GET /api/health</code></p>
</body>
</html>`);
  });

  return app;
}
