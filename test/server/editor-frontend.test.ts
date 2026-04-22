import { describe, it, expect } from "vitest";
import { createApp } from "../../src/server/index.js";

describe("editor frontend — HTML shell", () => {
  it("renders list mount point on /edit", async () => {
    const app = createApp({ editor: { enabled: true } });
    const res = await app.request("/edit");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="openboard-editor"');
    expect(html).toContain('data-mode="list"');
    expect(html).toContain('src="/edit/assets/editor.js"');
  });

  it("renders edit mount point on /edit/:name", async () => {
    const app = createApp({ editor: { enabled: true } });
    const res = await app.request("/edit/sales");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-mode="edit"');
    expect(html).toContain('data-name="sales"');
  });

  it("returns 404 for bundle when editor disabled", async () => {
    const app = createApp({ editor: { enabled: false } });
    const res = await app.request("/edit/assets/editor.js");
    expect(res.status).toBe(404);
  });
});

describe("editor frontend — bundle serving", () => {
  it("serves a javascript bundle at /edit/assets/editor.js", async () => {
    const app = createApp({ editor: { enabled: true } });
    const res = await app.request("/edit/assets/editor.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const js = await res.text();
    expect(js.length).toBeGreaterThan(1000);
    // Should reference one of the APIs used in the client.
    expect(js).toContain("/api/dashboards");
  }, 30000);
});
