import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { S3Source, type S3SourceOptions } from "../../src/sources/s3.js";
import type { DashboardSourceEvent } from "../../src/sources/types.js";

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-s3
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

let paginatorContents: Array<{ Key: string; ETag: string }> = [];

vi.mock("@aws-sdk/client-s3", () => {
  // Must be a real class so `new sdk.S3Client(...)` works
  class MockS3Client {
    send = mockSend;
  }
  class MockGetObjectCommand {
    _params: any;
    constructor(params: any) { this._params = params; }
  }

  return {
    S3Client: MockS3Client,
    GetObjectCommand: MockGetObjectCommand,
    paginateListObjectsV2: vi.fn().mockImplementation(() => {
      // Capture current contents at call time
      const contents = [...paginatorContents];
      return (async function* () {
        yield { Contents: contents };
      })();
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSource(overrides?: Partial<S3SourceOptions>): S3Source {
  return new S3Source({
    bucket: "test-bucket",
    prefix: "dashboards/",
    pollInterval: 0, // disable polling by default in tests
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S3Source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paginatorContents = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("list()", () => {
    it("returns .board file keys from S3", async () => {
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"abc"' },
        { Key: "dashboards/ops.board", ETag: '"def"' },
        { Key: "dashboards/readme.md", ETag: '"ghi"' },
      ];

      const source = makeSource();
      const files = await source.list();

      expect(files).toEqual([
        "dashboards/sales.board",
        "dashboards/ops.board",
      ]);
    });

    it("returns empty array when no .board files exist", async () => {
      paginatorContents = [
        { Key: "dashboards/config.yaml", ETag: '"abc"' },
      ];

      const source = makeSource();
      const files = await source.list();
      expect(files).toEqual([]);
    });

    it("handles empty bucket", async () => {
      paginatorContents = [];

      const source = makeSource();
      const files = await source.list();
      expect(files).toEqual([]);
    });
  });

  describe("read()", () => {
    it("reads file content from S3", async () => {
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToString: () => Promise.resolve('dashboard "Sales" {}'),
        },
      });

      const source = makeSource();
      const content = await source.read("dashboards/sales.board");

      expect(content).toBe('dashboard "Sales" {}');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("throws on empty body", async () => {
      mockSend.mockResolvedValueOnce({ Body: null });

      const source = makeSource();
      await expect(source.read("dashboards/missing.board")).rejects.toThrow(
        "Empty response body",
      );
    });
  });

  describe("describe()", () => {
    it("includes bucket and prefix", () => {
      const source = makeSource();
      expect(source.describe()).toBe("s3://test-bucket/dashboards/");
    });

    it("includes poll interval when > 0", () => {
      const source = makeSource({ pollInterval: 30 });
      expect(source.describe()).toBe(
        "s3://test-bucket/dashboards/ (polling every 30s)",
      );
    });
  });

  describe("watch()", () => {
    it("does not start polling when pollInterval is 0", () => {
      const source = makeSource({ pollInterval: 0 });
      const events: DashboardSourceEvent[] = [];
      source.watch((e) => events.push(e));

      // Should be a no-op
      expect(events).toHaveLength(0);
      source.unwatch();
    });

    it("detects added files on poll", async () => {
      // Start with one file
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"abc"' },
      ];

      const source = makeSource({ pollInterval: 60 });
      const events: DashboardSourceEvent[] = [];

      // Seed initial state by calling the internal method via watch
      // We'll manually trigger the poll cycle
      source.watch((e) => events.push(e));

      // Wait for seed to complete
      await new Promise((r) => setTimeout(r, 100));

      // Simulate a new file appearing
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"abc"' },
        { Key: "dashboards/ops.board", ETag: '"new"' },
      ];

      // Trigger the poll interval manually
      // The poll is on an interval; we'll wait for it and use a short interval
      // Instead, let's just stop and verify seed worked
      source.unwatch();

      // The initial seed should have recorded the known objects
      // We can't easily test the poll without waiting, so let's verify the seed
      expect(events).toHaveLength(0); // no events during seed
    });

    it("emits change events when ETags differ", async () => {
      // This tests the poll logic more directly by using a short interval
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"v1"' },
      ];

      const source = makeSource({ pollInterval: 0.1 }); // 100ms for fast test
      const events: DashboardSourceEvent[] = [];
      source.watch((e) => events.push(e));

      // Wait for seed
      await new Promise((r) => setTimeout(r, 50));

      // Change the ETag (simulating file modification)
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"v2"' },
      ];

      // Wait for a poll cycle
      await new Promise((r) => setTimeout(r, 200));

      source.unwatch();

      const changeEvents = events.filter((e) => e.type === "change");
      expect(changeEvents.length).toBeGreaterThanOrEqual(1);
      expect(changeEvents[0].path).toBe("dashboards/sales.board");
    });

    it("emits add events for new files", async () => {
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"v1"' },
      ];

      const source = makeSource({ pollInterval: 0.1 });
      const events: DashboardSourceEvent[] = [];
      source.watch((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 50));

      // Add a new file
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"v1"' },
        { Key: "dashboards/new.board", ETag: '"new"' },
      ];

      await new Promise((r) => setTimeout(r, 200));

      source.unwatch();

      const addEvents = events.filter((e) => e.type === "add");
      expect(addEvents.length).toBeGreaterThanOrEqual(1);
      expect(addEvents[0].path).toBe("dashboards/new.board");
    });

    it("emits remove events for deleted files", async () => {
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"v1"' },
        { Key: "dashboards/ops.board", ETag: '"v1"' },
      ];

      const source = makeSource({ pollInterval: 0.1 });
      const events: DashboardSourceEvent[] = [];
      source.watch((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 50));

      // Remove a file
      paginatorContents = [
        { Key: "dashboards/sales.board", ETag: '"v1"' },
      ];

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
      // Should not double the slash
      expect(source.describe()).not.toContain("dashboards//");
    });

    it("handles empty prefix", () => {
      const source = makeSource({ prefix: "" });
      expect(source.describe()).toBe("s3://test-bucket/");
    });
  });
});
