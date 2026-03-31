import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GCSSource, type GCSSourceOptions } from "../../src/sources/gcs.js";
import type { DashboardSourceEvent } from "../../src/sources/types.js";

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage
// ---------------------------------------------------------------------------

let mockFiles: Array<{ name: string; metadata: { generation: string } }> = [];
const mockDownload = vi.fn();

vi.mock("@google-cloud/storage", () => {
  class MockFile {
    name: string;
    constructor(name: string) { this.name = name; }
    download = mockDownload;
  }

  class MockBucket {
    getFiles = vi.fn().mockImplementation(async () => {
      // Return current snapshot of mockFiles
      return [[...mockFiles]];
    });
    file = vi.fn().mockImplementation((name: string) => {
      const f = new MockFile(name);
      f.download = mockDownload;
      return f;
    });
  }

  class MockStorage {
    bucket = vi.fn().mockReturnValue(new MockBucket());
  }

  return { Storage: MockStorage };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSource(overrides?: Partial<GCSSourceOptions>): GCSSource {
  return new GCSSource({
    bucket: "test-bucket",
    prefix: "dashboards/",
    pollInterval: 0,
    ...overrides,
  });
}

function makeFile(name: string, generation = "1"): { name: string; metadata: { generation: string } } {
  return { name, metadata: { generation } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GCSSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("list()", () => {
    it("returns .board file keys from GCS", async () => {
      mockFiles = [
        makeFile("dashboards/sales.board"),
        makeFile("dashboards/ops.board"),
        makeFile("dashboards/readme.md"),
      ];

      const source = makeSource();
      const files = await source.list();

      expect(files).toEqual([
        "dashboards/sales.board",
        "dashboards/ops.board",
      ]);
    });

    it("returns empty array when no .board files exist", async () => {
      mockFiles = [makeFile("dashboards/config.yaml")];

      const source = makeSource();
      const files = await source.list();
      expect(files).toEqual([]);
    });

    it("handles empty bucket", async () => {
      mockFiles = [];

      const source = makeSource();
      const files = await source.list();
      expect(files).toEqual([]);
    });
  });

  describe("read()", () => {
    it("reads file content from GCS", async () => {
      mockDownload.mockResolvedValueOnce([Buffer.from('dashboard "Sales" {}')]);

      const source = makeSource();
      const content = await source.read("dashboards/sales.board");

      expect(content).toBe('dashboard "Sales" {}');
      expect(mockDownload).toHaveBeenCalledTimes(1);
    });
  });

  describe("describe()", () => {
    it("includes bucket and prefix", () => {
      const source = makeSource();
      expect(source.describe()).toBe("gs://test-bucket/dashboards/");
    });

    it("includes poll interval when > 0", () => {
      const source = makeSource({ pollInterval: 30 });
      expect(source.describe()).toBe(
        "gs://test-bucket/dashboards/ (polling every 30s)",
      );
    });
  });

  describe("watch()", () => {
    it("does not start polling when pollInterval is 0", () => {
      const source = makeSource({ pollInterval: 0 });
      const events: DashboardSourceEvent[] = [];
      source.watch((e) => events.push(e));

      expect(events).toHaveLength(0);
      source.unwatch();
    });

    it("emits change events when generation differs", async () => {
      mockFiles = [makeFile("dashboards/sales.board", "1")];

      const source = makeSource({ pollInterval: 0.1 });
      const events: DashboardSourceEvent[] = [];
      source.watch((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 50));

      // Change generation (simulating file modification)
      mockFiles = [makeFile("dashboards/sales.board", "2")];

      await new Promise((r) => setTimeout(r, 200));
      source.unwatch();

      const changeEvents = events.filter((e) => e.type === "change");
      expect(changeEvents.length).toBeGreaterThanOrEqual(1);
      expect(changeEvents[0].path).toBe("dashboards/sales.board");
    });

    it("emits add events for new files", async () => {
      mockFiles = [makeFile("dashboards/sales.board")];

      const source = makeSource({ pollInterval: 0.1 });
      const events: DashboardSourceEvent[] = [];
      source.watch((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 50));

      mockFiles = [
        makeFile("dashboards/sales.board"),
        makeFile("dashboards/new.board"),
      ];

      await new Promise((r) => setTimeout(r, 200));
      source.unwatch();

      const addEvents = events.filter((e) => e.type === "add");
      expect(addEvents.length).toBeGreaterThanOrEqual(1);
      expect(addEvents[0].path).toBe("dashboards/new.board");
    });

    it("emits remove events for deleted files", async () => {
      mockFiles = [
        makeFile("dashboards/sales.board"),
        makeFile("dashboards/ops.board"),
      ];

      const source = makeSource({ pollInterval: 0.1 });
      const events: DashboardSourceEvent[] = [];
      source.watch((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 50));

      mockFiles = [makeFile("dashboards/sales.board")];

      await new Promise((r) => setTimeout(r, 200));
      source.unwatch();

      const removeEvents = events.filter((e) => e.type === "remove");
      expect(removeEvents.length).toBeGreaterThanOrEqual(1);
      expect(removeEvents[0].path).toBe("dashboards/ops.board");
    });
  });

  describe("prefix normalization", () => {
    it("adds trailing slash to prefix", () => {
      const source = makeSource({ prefix: "dashboards" });
      expect(source.describe()).toContain("dashboards/");
    });

    it("preserves existing trailing slash", () => {
      const source = makeSource({ prefix: "dashboards/" });
      expect(source.describe()).toContain("dashboards/");
      expect(source.describe()).not.toContain("dashboards//");
    });

    it("handles empty prefix", () => {
      const source = makeSource({ prefix: "" });
      expect(source.describe()).toBe("gs://test-bucket/");
    });
  });
});
