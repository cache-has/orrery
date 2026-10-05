import { describe, it, expect, vi } from "vitest";
import { QueryExecutor, QueryExecutionError } from "../../src/query/executor.js";
import { fakeConnection, tick } from "../helpers/fake-connection.js";

const q = (sql: string, extra: object = {}) => ({ sql, connection: "db", ...extra });

async function rejection(promise: Promise<unknown>): Promise<QueryExecutionError> {
  try {
    await promise;
  } catch (err) {
    return err as QueryExecutionError;
  }
  throw new Error("expected the query to reject");
}

describe("QueryExecutor scheduling", () => {
  it("runs at most pool_size queries at once and starts the next as one finishes", async () => {
    const db = fakeConnection({ poolSize: 2, hold: ["a", "b", "c"] });
    const executor = new QueryExecutor(db.manager);

    const all = Promise.all([executor.execute(q("a")), executor.execute(q("b")), executor.execute(q("c"))]);
    await tick();
    expect(db.calls).toEqual(["a", "b"]);

    db.release("a");
    await tick();
    expect(db.calls).toEqual(["a", "b", "c"]);

    db.release("b");
    db.release("c");
    await all;
    expect(db.peak()).toBe(2);
  });

  it("defaults to 5 concurrent queries when the connection sets no pool_size", async () => {
    const db = fakeConnection({ delays: { q: 10 } });
    const executor = new QueryExecutor(db.manager);
    await Promise.all(Array.from({ length: 12 }, (_, i) => executor.execute(q(`q${i}`))));
    expect(db.peak()).toBe(5);
  });

  it("does not count time spent queued toward the timeout", async () => {
    // One slot, 60ms timeout, three 40ms queries: the last waits 80ms before
    // it starts. Measured from submission it would time out; measured from
    // when it starts executing it does not.
    const db = fakeConnection({ poolSize: 1, timeoutMs: 60, delays: { q: 40 } });
    const executor = new QueryExecutor(db.manager);
    const results = await executor.executeAll([q("q1"), q("q2"), q("q3")]);
    for (const r of results.values()) expect(r).not.toBeInstanceOf(Error);
  });

  it("times out a query that runs longer than the connection's timeout", async () => {
    const db = fakeConnection({ timeoutMs: 20, hold: ["stuck"] });
    const log = vi.fn();
    const executor = new QueryExecutor(db.manager, { log });

    const err = await rejection(executor.execute(q("stuck", { label: "sales/total" })));
    expect(err.detail).toEqual({ type: "timeout", connectionName: "db", timeoutMs: 20 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("timed out after 20ms"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("sales/total"));
  });

  it("frees the slot when the driver throws synchronously", async () => {
    const db = fakeConnection({ poolSize: 1 });
    (db.manager as unknown as { get: () => unknown }).get = () => {
      throw new Error("driver gone");
    };
    const executor = new QueryExecutor(db.manager);
    expect((await rejection(executor.execute(q("a")))).detail.type).toBe("connection_error");
    expect((await rejection(executor.execute(q("b")))).detail.type).toBe("connection_error");
  });
});

describe("QueryExecutor cancellation", () => {
  it("never sends an abandoned query that has not started", async () => {
    const db = fakeConnection({ poolSize: 1, hold: ["running"] });
    const executor = new QueryExecutor(db.manager);
    const abort = new AbortController();

    const running = executor.execute(q("running"));
    const queued = executor.execute(q("queued", { signal: abort.signal }));
    await tick();

    abort.abort();
    expect((await rejection(queued)).detail.type).toBe("cancelled");

    db.release("running");
    await running;
    await tick();
    expect(db.calls).toEqual(["running"]);
  });

  it("keeps a shared query alive while another caller still wants it", async () => {
    const db = fakeConnection({ poolSize: 1, hold: ["running"] });
    const executor = new QueryExecutor(db.manager);
    const abort = new AbortController();

    const running = executor.execute(q("running"));
    const impatient = executor.execute(q("shared", { signal: abort.signal }));
    const patient = executor.execute(q("shared"));
    await tick();

    abort.abort();
    expect((await rejection(impatient)).detail.type).toBe("cancelled");

    db.release("running");
    await running;
    expect((await patient).rows).toEqual([{ value: "shared" }]);
    expect(db.calls).toEqual(["running", "shared"]);
  });

  it("lets a query that already started finish and caches its result", async () => {
    const db = fakeConnection({ hold: ["slow"] });
    const executor = new QueryExecutor(db.manager, { defaultCacheTtl: 60 });
    const abort = new AbortController();

    const abandoned = executor.execute(q("slow", { signal: abort.signal }));
    await tick();
    abort.abort();
    expect((await rejection(abandoned)).detail.type).toBe("cancelled");

    db.release("slow", [{ value: 42 }]);
    await tick();

    expect((await executor.execute(q("slow"))).rows).toEqual([{ value: 42 }]);
    expect(db.calls).toEqual(["slow"]);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const db = fakeConnection();
    const executor = new QueryExecutor(db.manager);
    const err = await rejection(executor.execute(q("a", { signal: AbortSignal.abort() })));
    expect(err.detail.type).toBe("cancelled");
    expect(db.calls).toEqual([]);
  });
});

describe("QueryExecutor caching", () => {
  it("does not cache unless a TTL is configured", async () => {
    const db = fakeConnection();
    const executor = new QueryExecutor(db.manager);
    await executor.execute(q("a"));
    await executor.execute(q("a"));
    expect(db.calls).toEqual(["a", "a"]);
  });

  it("applies the executor's default TTL to every query", async () => {
    const db = fakeConnection();
    const executor = new QueryExecutor(db.manager, { defaultCacheTtl: 60 });
    await executor.execute(q("a"));
    await executor.execute(q("a"));
    expect(db.calls).toEqual(["a"]);
    expect(executor.cacheSize).toBe(1);
  });

  it("lets a query override the default TTL, including turning caching off", async () => {
    const db = fakeConnection();
    const executor = new QueryExecutor(db.manager, { defaultCacheTtl: 60 });
    await executor.execute(q("a", { cacheTtl: 0 }));
    await executor.execute(q("a", { cacheTtl: 0 }));
    expect(db.calls).toEqual(["a", "a"]);
  });

  it("bypasses the cache read for a fresh query but stores the new result", async () => {
    const db = fakeConnection();
    const executor = new QueryExecutor(db.manager, { defaultCacheTtl: 60 });
    await executor.execute(q("a"));
    await executor.execute(q("a", { fresh: true }));
    expect(db.calls).toEqual(["a", "a"]);
    await executor.execute(q("a"));
    expect(db.calls).toEqual(["a", "a"]);
  });

  it("keeps the cache within maxCacheEntries", async () => {
    const db = fakeConnection();
    const executor = new QueryExecutor(db.manager, { defaultCacheTtl: 60, maxCacheEntries: 2 });
    await executor.execute(q("a"));
    await executor.execute(q("b"));
    await executor.execute(q("c"));
    expect(executor.cacheSize).toBe(2);
  });
});

describe("QueryExecutor slow query log", () => {
  it("logs a query at or above the threshold, with its label", async () => {
    const db = fakeConnection({ delays: { slow: 15 } });
    const log = vi.fn();
    const executor = new QueryExecutor(db.manager, { slowQueryMs: 5, log });

    await executor.execute(q("slow", { label: "sales/total" }));
    await executor.execute(q("fast", { label: "sales/other" }));

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/slow query \d+ms rows=1 connection=db sales\/total/);
  });

  it("can be disabled", async () => {
    const db = fakeConnection({ delays: { slow: 15 } });
    const log = vi.fn();
    const executor = new QueryExecutor(db.manager, { slowQueryMs: 0, log });
    await executor.execute(q("slow"));
    expect(log).not.toHaveBeenCalled();
  });
});
