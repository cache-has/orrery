import { serve } from "@hono/node-server";
import { createApp } from "../server/index.js";

const port = parseInt(process.env.PORT ?? "3000", 10);
const app = createApp();

console.log(`\n  OpenBoard dev server\n`);
console.log(`  Local:   http://localhost:${port}`);
console.log(`  Health:  http://localhost:${port}/api/health\n`);

serve({ fetch: app.fetch, port });
