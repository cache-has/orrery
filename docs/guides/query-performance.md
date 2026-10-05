<!--
Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
SPDX-License-Identifier: MIT OR Apache-2.0
-->

# Diagnosing and Fixing Slow Dashboards

A task-focused guide for when dashboards take seconds (or tens of seconds) to
load: how to find out where the time goes, how to recognise the common causes,
and which fixes pay off, in order.

The examples use PostgreSQL because it is the most common Orrery backend and
has the best diagnostic tooling. The principles apply to any SQL database: the
syntax for plans and materialized tables differs, the reasoning does not.

## The short version

1. **Measure before changing anything.** Time every query on the slow board and
   read one query plan. Ten minutes of measurement usually overturns the first
   guess.
2. **A dashboard multiplies cost.** One board is 10 to 25 queries, all issued at
   once. A query that is "a bit slow" alone becomes a page that takes a minute.
3. **Almost all slow boards have the same root cause:** each component makes
   the database redo expensive work (flattening raw data, re-aggregating, or
   scanning wide rows) that could have been done once, ahead of time.
4. **Fix the shape of the data first**, then the SQL, then database settings
   and sizing. Caching comes last: it hides a slow query from the second
   visitor, it does nothing for the first.

## How Orrery runs a dashboard

Knowing the execution model tells you which numbers matter.

| Behaviour | Detail |
|---|---|
| One query per component | Every `query:` and `trend_query:` is a separate SQL statement. A 20-component board is at least 20 statements. |
| Bounded concurrency | At most `pool_size` queries (connection YAML, default `5`) run at once per connection. The rest wait their turn. |
| Timeout | `timeout` in the connection YAML, default 30 seconds, measured from when a query starts executing. Waiting for a slot does not count. |
| Row limit | A query returning more than 10,000 rows fails rather than rendering. |
| Identical queries are shared | Two requests for the same SQL and parameters share one execution while it is in flight. |
| Progressive loading | The page is sent after at most `render_deadline_ms` (default 300). Finished components are in the page; the rest show a loading state and fill in as their queries complete. |
| Filters re-query only what they affect | Changing a parameter re-runs the components that use it, not the whole board. |
| Abandoned work is dropped | If a request is superseded or the browser leaves, queries that have not started are never sent. Queries already running finish and are cached. |
| Result cache | Results are cached for `cache_ttl` seconds (default 300), capped at the board's `refresh` interval. The per-component refresh button bypasses it. |
| Auto-refresh | `refresh: N` re-runs the board every `N` seconds in each visible browser tab. Hidden tabs skip refreshes and catch up when shown. |
| Slow query log | Queries slower than `slow_query_ms` (default 1000) are logged with their dashboard and component. |

Two consequences follow directly:

- **Total load time is not the slowest query.** With more queries than
  `pool_size`, the last component arrives after roughly the sum of all query
  times divided by `pool_size`, and often later, because concurrent queries
  compete for the same disk and CPU. Progressive loading means the page is
  usable sooner; it does not make the last component arrive sooner.
- **Queries get slower in company.** A query that takes 10 seconds alone can
  take 30 when four others are running beside it on a database that is already
  resource-bound.

The slow query log is the quickest way to see which components to look at:

```
[orrery] slow query 15624ms rows=4 connection=warehouse sales/revenue_by_region
```

## Step 1: Measure

### Time every query on the board

Run each of the board's queries by hand, one at a time, substituting the
default parameter values, and record the time. You are looking for the
distribution, not just the worst case: a board where 12 queries each take 15
seconds has a different problem from one where a single query takes 60.

Then run them the way Orrery does (several at once) and compare. If queries get
much slower under concurrency, the database is resource-bound, and adding
parallelism will not help.

### Read one plan properly

Take a representative slow query and run it under `EXPLAIN`:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT device, count(*) FROM reporting.sessions
WHERE session_date BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY 1;
```

Enable `track_io_timing` on the server first so the plan reports time spent
reading from disk. Then read these fields, in this order:

| Field | What it tells you |
|---|---|
| `Execution Time` | The total. Compare against the timings you took above. |
| `Buffers: shared read=N` | Pages fetched from disk (8 kB each). Large values mean the data was not in memory. |
| `Buffers: shared hit=N` | Pages found in memory. A healthy analytical query is mostly hits. |
| `I/O Timings: shared read=` | Milliseconds spent waiting on disk. If this is most of the execution time, the query is I/O-bound. |
| `temp read= / written=` | A sort or hash did not fit in `work_mem` and spilled to disk. |
| `Seq Scan` + `Rows Removed by Filter` | The whole table was read and most of it thrown away: a missing or unusable index. |
| The gap between row counts | A node that reads 300,000 rows to produce 4 is doing work that belongs in a precomputed table. |

The single most useful comparison is **how much was read versus how much was
needed**. If a query reads 500 MB to produce a four-row chart, the fix is not a
faster disk.

### Find the expensive queries across the whole system

`pg_stat_statements` records cumulative cost per statement. It must be in
`shared_preload_libraries` (it is by default on most managed services) and then
created once per database:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT calls,
       round(total_exec_time / 1000)       AS total_s,
       round(mean_exec_time)               AS mean_ms,
       shared_blks_read * 8 / 1024         AS read_mb,
       temp_blks_written * 8 / 1024        AS temp_mb,
       left(query, 100)                    AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Create it before you need it. Without it there is no history, and every
investigation starts from zero.

### Check whether the working set fits in memory

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size,
       current_setting('shared_buffers')                    AS shared_buffers;

SELECT relname,
       pg_size_pretty(pg_relation_size(oid))        AS heap,
       pg_size_pretty(pg_total_relation_size(oid))  AS total
FROM pg_class
WHERE relkind IN ('r', 'm')
ORDER BY pg_total_relation_size(oid) DESC
LIMIT 15;
```

Compare the tables your dashboards actually scan against the server's RAM. A
database that "is only a few gigabytes" is small in absolute terms and still
several times larger than the memory of the smallest instance classes. When the
scanned tables do not fit in memory, nothing stays cached, and every query pays
full disk cost every time, including the same query run twice in a row.

## Step 2: Recognise the pattern

Most slow boards match one or more of these.

### Raw data behind a flattening view

The most common cause. An ingest pipeline lands source records as JSON (one
`jsonb` column per row), and a plain view exposes them as columns:

```sql
CREATE VIEW reporting.tickets AS
SELECT id,
       data ->> 'status'                     AS status,
       (data ->> 'created_at')::timestamptz  AS created_at
FROM raw.tickets;
```

This is convenient and it is slow, for three separate reasons:

- **Rows are wide.** To read two fields the database fetches the whole
  document, often from out-of-line (TOAST) storage. A table with a few thousand
  rows can cost hundreds of megabytes to scan.
- **The work repeats.** A view stores no data. Every query that references it
  re-parses the JSON for every row.
- **Filters cannot use indexes.** See the next section.

### Predicates that cannot use an index

An index on `created_at` is only used if the query compares `created_at`
itself. Wrapping the column in a cast or function defeats it:

```sql
-- Cannot use an index on created_at: the cast is applied to the column
WHERE created_at::timestamptz >= {{date_range.start}}::timestamp

-- Can use it: the column is bare, the cast is on the parameter
WHERE created_at >= {{date_range.start}}::timestamptz
```

The usual reason people write the first form is that the column is text when it
should be a timestamp. Fix the column type rather than casting in every query.

For expressions over JSON there is a second trap. An index can only be built on
an `IMMUTABLE` expression, and casting text to `timestamptz` is not immutable
(it depends on session settings). `((data ->> 'created_at')::timestamptz)`
therefore cannot be indexed at all. Either index an immutable equivalent, for
example `to_timestamp((data ->> 'created_unix')::double precision)`, and make
the view use exactly the same expression, or store a real typed column.

### An index is used and the query is still slow

An index finds the matching rows quickly. The database then still fetches each
row from the table. If rows are wide, that fetch dominates: a plan can show an
index scan and still read hundreds of megabytes. When the plan shows an index
scan with a large `shared read`, the answer is a narrower table, not another
index.

### The same expensive result recomputed by every component

A board with twelve components over one view runs that view twelve times.
If the view sessionizes events, deduplicates records, or joins and aggregates
several tables, each component pays the full cost independently. The telltale
sign is a board where every query takes about the same time and reads about the
same number of pages.

### Sorts and aggregations spilling to disk

`temp written` in a plan means an operation exceeded `work_mem`. Raising
`work_mem` helps, but check the multiplication first: it applies per sort or
hash node, per query, per connection. On a small server a generous value
combined with a full connection pool can exhaust memory. Reducing the number of
rows being sorted is the more durable fix.

### Refreshing faster than the data changes

If the pipeline loads data every six hours, `refresh: 300` re-runs every query
72 times per load for identical results, in every open tab. That background
load competes directly with the person actively waiting on a page.

### Concurrency on a database that is already saturated

Five queries at once is not five times the throughput on a database with two
cores and a single volume. When the measurements in Step 1 show queries slowing
sharply under concurrency, a larger pool makes things worse. Reduce the work
per query first.

## Step 3: Fix, in order of leverage

### 1. Build a reporting layer shaped for the dashboards

Put a set of real, typed, narrow, indexed tables between the raw data and the
boards. In PostgreSQL the simplest form is a materialized view:

```sql
CREATE MATERIALIZED VIEW reporting.tickets AS
SELECT id,
       data ->> 'status'                     AS status,
       data ->> 'priority'                   AS priority,
       (data ->> 'created_at')::timestamptz  AS created_at
FROM raw.tickets;

-- A unique index is required for REFRESH ... CONCURRENTLY
CREATE UNIQUE INDEX tickets_pk         ON reporting.tickets (id);
CREATE INDEX        tickets_created_at ON reporting.tickets (created_at);
```

Guidelines:

- **Keep only the columns dashboards use.** Narrow rows are the point. Leave
  large text and nested JSON in the raw table.
- **Store real types.** Timestamps as `timestamptz`, amounts as `numeric`,
  flags as `boolean`. Board SQL then needs no casts, and plain indexes work.
- **Index what the boards filter and join on.** Usually one date column and the
  join keys.
- **Pre-aggregate to the grain the boards need.** If every component wants
  sessions, materialize sessions, not events. If every component wants daily
  totals, materialize daily totals.
- **Refresh at the end of the load job**, not on a timer, so the reporting
  layer is rebuilt exactly when the underlying data changes:

  ```sql
  REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.tickets;
  ```

  `CONCURRENTLY` keeps the view readable during the refresh. Refresh dependent
  views in dependency order.

Because the refresh happens when the data changes, this costs nothing in
freshness. The dashboards see the same data they would have seen from the plain
view, and they see it from a table that is a small fraction of the size.

If a full materialized view is too heavy to rebuild, the same idea works as an
ordinary table maintained incrementally by the load job.

Keep plain views for genuinely small tables (a few thousand narrow rows). The
goal is not to materialize everything, it is to materialize what the
measurements show is expensive.

### 2. Write board SQL that can use those indexes

- Compare bare columns against parameters; put casts on the parameter side.
- Filter on the indexed date column directly rather than on an expression
  derived from it.
- Avoid `SELECT *` from wide relations inside CTEs. Name the columns you need.
- When several components need the same intermediate result, do not copy the
  same CTE into each one. Promote it to a materialized view and have each
  component run a cheap query against it.

### 3. Match refresh and load to the data

- Set `refresh:` no more often than the data changes. Omit it for boards over
  data that loads a few times a day.
- Set `pool_size` in the connection YAML to what the database can run
  concurrently, not to the number of components. On a small instance that may
  be lower than the default.

  ```yaml
  name: warehouse
  type: postgres
  host: ${DB_HOST}
  database: analytics
  username: ${DB_USER}
  password: ${DB_PASSWORD}
  pool_size: 5
  ```

- Split very large boards. Twenty-five components on one page is twenty-five
  queries on every visit and every filter change.

### 4. Tune and size the database

Do this after the data is the right shape. Tuning a database that scans
gigabytes per page load buys little; tuning one that scans megabytes may be
unnecessary.

- **Memory.** The tables dashboards scan should fit in RAM, with room for
  `shared_buffers` and the operating system's cache. Once the reporting layer
  is narrow this is often satisfied by a small instance. If measurements show
  queries dominated by disk reads even then, more memory is the direct fix.
- **`random_page_cost`.** The default of `4` assumes spinning disks. On SSD or
  network SSD storage set it near `1.1`, or the planner will prefer sequential
  scans over indexes that would be faster.
- **`effective_cache_size`.** Set to roughly the memory available for caching
  (commonly 50 to 75 percent of RAM) so the planner's estimates are realistic.
- **`work_mem`.** Raise cautiously, with the per-node, per-connection
  multiplication in mind.
- **Statistics.** Make sure materialized views are analyzed after refresh.
  Run `ANALYZE` on them in the load job if autovacuum has not caught up.
- **Unused indexes.** Large indexes that are never scanned (general-purpose
  indexes over whole JSON documents are a frequent example) cost memory and
  slow every write. `pg_stat_user_indexes` shows which have `idx_scan = 0`.
  Check what an index is for before dropping it: a unique index that exists to
  support concurrent refresh or a constraint can show zero scans and still be
  required.

### 5. Then cache

Result caching makes a repeat view of the same board with the same parameters
fast. It is worth having, and it is not a substitute for the steps above:

- It does not help the first visitor after the cache expires or the server
  restarts.
- It does not help any parameter combination nobody has requested yet.
- A low-traffic deployment rarely hits a warm cache at all, and slow first
  loads are exactly what keeps traffic low.

The effective pattern is caching plus warming, so the first real visitor gets
a cached result regardless of traffic. Set both in `orrery.config.yaml`:

```yaml
cache_ttl: 3600     # how stale data may be; match it to your load schedule
cache_warm: true    # re-run default-parameter queries before they expire
```

The warmer runs one query at a time so it never occupies the connection pool,
and skips a cycle if the previous one is still running. Two cautions:

- Warming re-runs every board's queries once per cycle. With a short
  `cache_ttl` and slow queries that is continuous load on the database. Fix
  the queries first and choose a TTL that matches how often the data changes.
- Only default parameter values are warmed. A visitor who changes a filter
  still pays for that query once.
- A board's `refresh: N` caps its cache TTL at `N` seconds. A board that
  auto-refreshes every five minutes over data that loads every six hours both
  wastes queries and expires its warmed results early. Remove `refresh` or set
  it to the data's real cadence.

## What this looks like in practice

Numbers from one production deployment, before any fixes, to calibrate
expectations. The database was 16 GB on an instance with 1 GB of RAM, loaded
every six hours, with most reporting relations defined as plain views over JSON
tables.

- One sequential pass over every board's queries read 41 GB from disk, more
  than twice the size of the database, because the same wide tables were
  re-read by every query. About 97 percent of total query time was disk reads.
- A 14-query board took 46 seconds to load. Twelve of its queries each
  re-derived the same intermediate result from the same view, reading about
  500 MB each to produce a result set of a few rows.
- For a representative query, 15.6 seconds of execution broke down as 13.8
  seconds fetching wide rows through an index that was being used correctly,
  and about 10 milliseconds computing the answer.
- Queries that completed in 10 seconds alone exceeded the 30 second timeout
  when run alongside the rest of their board.
- Boards in the same deployment that read from indexed materialized views ran
  their queries in under 100 milliseconds each.

The last point is the one to remember. The slow and fast boards shared a
database, an instance, and a network. The difference was the shape of the
tables they queried.

## Checklist

- [ ] Timed every query on the slow board, alone and concurrently
- [ ] Read an `EXPLAIN (ANALYZE, BUFFERS)` plan and compared pages read against
      rows returned
- [ ] `pg_stat_statements` created and `track_io_timing` enabled
- [ ] Compared the size of scanned tables against server memory
- [ ] Expensive views materialized as narrow, typed, indexed tables, refreshed
      by the load job
- [ ] No casts or functions wrapped around filtered columns in board SQL
- [ ] `refresh:` no more frequent than the data changes
- [ ] `pool_size` matched to what the database can run at once
- [ ] Slow query log reviewed for the components that still take seconds
- [ ] `random_page_cost` and `effective_cache_size` set for the actual hardware
- [ ] `cache_ttl` matched to the load schedule and `cache_warm` enabled, after
      the above, not instead of it
