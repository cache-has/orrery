/**
 * Integration test: S3Source against a real MinIO container.
 *
 * Verifies the full write path end-to-end:
 *   1. write() persists content to MinIO
 *   2. read() round-trips it back
 *   3. ETag cache is updated so the poller does NOT re-report the self-write
 *
 * Skipped by default. Run explicitly (requires docker) with:
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "child_process";
import { S3Source } from "../../src/sources/s3.js";
import type { DashboardSourceEvent } from "../../src/sources/types.js";

const CONTAINER_NAME = `orrery-minio-test-${process.pid}`;
const PORT = 9100 + (process.pid % 500); // random-ish to avoid collisions
const ACCESS_KEY = "minioadmin";
const SECRET_KEY = "minioadmin";
const BUCKET = "orrery-test";
const ENDPOINT = `http://127.0.0.1:${PORT}`;

function dockerAvailable(): boolean {
  try {
    const r = spawnSync("docker", ["info"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

// Opt-in only. Hosted CI runners HAVE docker, so a docker check alone won't
// skip this — and pulling/starting MinIO in CI is slow and flaky. Run it
// explicitly via `npm run test:integration` (which sets RUN_INTEGRATION_TESTS).
const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === "1" && dockerAvailable();
const describeIf = integrationEnabled ? describe : describe.skip;

async function waitForMinio(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ENDPOINT}/minio/health/live`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`MinIO did not become ready within ${timeoutMs}ms: ${String(lastErr)}`);
}

async function createBucket(): Promise<void> {
  // Use AWS SDK directly against MinIO to create the bucket.
  // Setting env before dynamic import so the default credential chain picks them up.
  process.env.AWS_ACCESS_KEY_ID = ACCESS_KEY;
  process.env.AWS_SECRET_ACCESS_KEY = SECRET_KEY;
  const sdk = await import("@aws-sdk/client-s3");
  const client = new sdk.S3Client({
    endpoint: ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  try {
    await client.send(new sdk.CreateBucketCommand({ Bucket: BUCKET }));
  } catch (err: any) {
    // Ignore BucketAlreadyOwnedByYou / BucketAlreadyExists
    const name = err?.name ?? err?.Code;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      throw err;
    }
  }
}

describeIf("S3Source + MinIO integration", () => {
  beforeAll(async () => {
    // Pull and start MinIO. Use the quay.io image to match MinIO's canonical distribution.
    execSync(
      `docker run -d --rm --name ${CONTAINER_NAME} ` +
        `-p ${PORT}:9000 ` +
        `-e MINIO_ROOT_USER=${ACCESS_KEY} ` +
        `-e MINIO_ROOT_PASSWORD=${SECRET_KEY} ` +
        `quay.io/minio/minio server /data`,
      { stdio: "ignore" },
    );
    await waitForMinio();
    await createBucket();
  }, 90_000);

  afterAll(() => {
    try {
      execSync(`docker stop ${CONTAINER_NAME}`, { stdio: "ignore", timeout: 15_000 });
    } catch {
      // Container may already be gone
    }
  });

  it("round-trips write → read", async () => {
    const source = new S3Source({
      bucket: BUCKET,
      prefix: "dashboards/",
      endpoint: ENDPOINT,
      region: "us-east-1",
      pollInterval: 0,
      writable: true,
    });

    const key = "dashboards/roundtrip.board";
    await source.write!(key, 'dashboard "Hello" {}');
    const content = await source.read(key);
    expect(content).toBe('dashboard "Hello" {}');

    const list = await source.list();
    expect(list).toContain(key);
  }, 30_000);

  it("rejects writes when writable is false", async () => {
    const source = new S3Source({
      bucket: BUCKET,
      prefix: "dashboards/",
      endpoint: ENDPOINT,
      region: "us-east-1",
      pollInterval: 0,
      // writable omitted -> defaults to false
    });
    await expect(source.write!("dashboards/x.board", "c")).rejects.toMatchObject({
      code: "readonly",
    });
  });

  it("self-write does not emit a spurious change event on the next poll", async () => {
    // Seed a file so the source has known state
    const seedSource = new S3Source({
      bucket: BUCKET,
      prefix: "selfwrite/",
      endpoint: ENDPOINT,
      region: "us-east-1",
      pollInterval: 0,
      writable: true,
    });
    await seedSource.write!("selfwrite/a.board", "v1");

    // Fresh source with polling enabled
    const source = new S3Source({
      bucket: BUCKET,
      prefix: "selfwrite/",
      endpoint: ENDPOINT,
      region: "us-east-1",
      pollInterval: 0.2, // 200ms
      writable: true,
    });

    const events: DashboardSourceEvent[] = [];
    source.watch((e) => events.push(e));

    // Wait for initial seed of knownObjects
    await new Promise((r) => setTimeout(r, 300));

    // Self-write — this should update the ETag cache and suppress the next poll event.
    await source.write!("selfwrite/a.board", "v2");

    // Wait for a couple of poll cycles
    await new Promise((r) => setTimeout(r, 600));

    source.unwatch();

    const changes = events.filter((e) => e.type === "change" && e.path === "selfwrite/a.board");
    expect(changes).toHaveLength(0);
  }, 30_000);
});
