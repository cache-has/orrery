import type { ConnectionManager } from "../../src/connections/manager.js";
import type { QueryResult } from "../../src/query/executor.js";

export interface FakeConnection {
  manager: ConnectionManager;
  /** Every SQL string the driver was asked to run, in order. */
  calls: string[];
  /** How many queries are executing right now, and the most seen at once. */
  active: () => number;
  peak: () => number;
  /** Finish a query started with `hold` (matched by a substring of its SQL). */
  release: (match: string, rows?: Record<string, unknown>[]) => void;
}

export interface FakeConnectionOptions {
  poolSize?: number;
  timeoutMs?: number;
  /** Milliseconds each query takes, by substring of its SQL. Default: resolves immediately. */
  delays?: Record<string, number>;
  /** Substrings of SQL whose queries stay running until `release` is called. */
  hold?: string[];
}

export function result(rows: Record<string, unknown>[] = [{ value: 1 }]): QueryResult {
  return { columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length, executionTimeMs: 1 };
}

/** A connection named "db" backed by a driver the test controls. */
export function fakeConnection(options: FakeConnectionOptions = {}): FakeConnection {
  const calls: string[] = [];
  const held = new Map<string, (rows?: Record<string, unknown>[]) => void>();
  let active = 0;
  let peak = 0;

  const query = (sql: string): Promise<QueryResult> => {
    calls.push(sql);
    active++;
    peak = Math.max(peak, active);
    const done = (rows?: Record<string, unknown>[]) => {
      active--;
      return result(rows ?? [{ value: sql }]);
    };

    const holdKey = options.hold?.find((h) => sql.includes(h));
    if (holdKey) {
      return new Promise((resolve) => held.set(holdKey, (rows) => resolve(done(rows))));
    }
    const delayKey = Object.keys(options.delays ?? {}).find((d) => sql.includes(d));
    if (delayKey) {
      return new Promise((resolve) => setTimeout(() => resolve(done()), options.delays![delayKey]));
    }
    return Promise.resolve(done());
  };

  const manager = {
    getConnection: (name: string) =>
      name === "db"
        ? {
            name,
            type: "sqlite",
            connected: true,
            sourceFile: "<test>",
            poolSize: options.poolSize,
            timeoutMs: options.timeoutMs,
          }
        : undefined,
    get: () => ({ query }),
  } as unknown as ConnectionManager;

  return {
    manager,
    calls,
    active: () => active,
    peak: () => peak,
    release: (match, rows) => {
      const finish = held.get(match);
      if (!finish) throw new Error(`No held query matching "${match}"`);
      held.delete(match);
      finish(rows);
    },
  };
}

/** Let queued microtasks and zero-delay timers run. */
export function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
