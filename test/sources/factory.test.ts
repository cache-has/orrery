import { describe, it, expect } from "vitest";
import { parseSourceUri, resolveRemoteNewKey } from "../../src/sources/factory.js";

describe("parseSourceUri", () => {
  it("parses s3:// URIs", () => {
    const result = parseSourceUri("s3://my-bucket/dashboards/");
    expect(result).toEqual({
      scheme: "s3",
      bucket: "my-bucket",
      prefix: "dashboards/",
    });
  });

  it("parses s3:// with nested prefix", () => {
    const result = parseSourceUri("s3://my-bucket/team/prod/dashboards");
    expect(result).toEqual({
      scheme: "s3",
      bucket: "my-bucket",
      prefix: "team/prod/dashboards",
    });
  });

  it("parses s3:// with bucket only", () => {
    const result = parseSourceUri("s3://my-bucket");
    expect(result).toEqual({
      scheme: "s3",
      bucket: "my-bucket",
      prefix: "",
    });
  });

  it("parses gs:// URIs", () => {
    const result = parseSourceUri("gs://gcs-bucket/path/");
    expect(result).toEqual({
      scheme: "gs",
      bucket: "gcs-bucket",
      prefix: "path/",
    });
  });

  it("parses https:// URIs", () => {
    const result = parseSourceUri("https://dashboards.internal.co/boards/");
    expect(result).toEqual({
      scheme: "https",
      path: "https://dashboards.internal.co/boards/",
    });
  });

  it("parses http:// URIs", () => {
    const result = parseSourceUri("http://localhost:9000/boards/");
    expect(result).toEqual({
      scheme: "http",
      path: "http://localhost:9000/boards/",
    });
  });

  it("parses file:// URIs as local", () => {
    const result = parseSourceUri("file:///tmp/dashboards");
    expect(result).toEqual({
      scheme: "local",
      path: "/tmp/dashboards",
    });
  });

  it("parses bare paths as local", () => {
    const result = parseSourceUri("./my-dashboards");
    expect(result).toEqual({
      scheme: "local",
      path: "./my-dashboards",
    });
  });

  it("parses absolute paths as local", () => {
    const result = parseSourceUri("/opt/openboard/dashboards");
    expect(result).toEqual({
      scheme: "local",
      path: "/opt/openboard/dashboards",
    });
  });
});

describe("resolveRemoteNewKey", () => {
  it("writes to bucket root when URI has no prefix", () => {
    // Existing files live at bucket root — new files must join them there,
    // not a dashboards_dir subfolder. See planning/issue-editor-create-flow.md Bug B.
    expect(resolveRemoteNewKey("s3://bucket", "carts")).toBe("carts.board");
    expect(resolveRemoteNewKey("s3://bucket/", "carts")).toBe("carts.board");
  });

  it("writes inside the URI prefix when one is present", () => {
    expect(resolveRemoteNewKey("s3://bucket/dashboards/", "carts")).toBe("dashboards/carts.board");
    expect(resolveRemoteNewKey("s3://bucket/team/prod", "carts")).toBe("team/prod/carts.board");
  });

  it("handles gs:// the same way", () => {
    expect(resolveRemoteNewKey("gs://bucket/", "x")).toBe("x.board");
    expect(resolveRemoteNewKey("gs://bucket/d", "x")).toBe("d/x.board");
  });

  it("nests the file in the given folder under the prefix", () => {
    expect(resolveRemoteNewKey("s3://bucket", "carts", "revenue")).toBe("revenue/carts.board");
    expect(resolveRemoteNewKey("s3://bucket/dashboards/", "carts", "revenue")).toBe(
      "dashboards/revenue/carts.board",
    );
    // Empty folder is a no-op (back-compat with the 2-arg form).
    expect(resolveRemoteNewKey("s3://bucket/dashboards", "carts", "")).toBe("dashboards/carts.board");
  });
});
