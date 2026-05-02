/**
 * Drizzle client — runtime DB access.
 *
 * Connects to `DATABASE_URL` (the Supabase pooler on port 6543). The
 * pooler does NOT support prepared statements, so `prepare: false` is
 * mandatory — passing prepared statements through the pooler raises
 * `prepared statement "X" already exists` under load.
 *
 * Connection-pool sizing is intentionally small: the pooler itself
 * fans out to the underlying Postgres, so each app instance only needs
 * a thin local pool. `idle_timeout: 20` recycles idle backends so
 * Coolify rolling deploys release server-side resources promptly.
 *
 * Migrations use `DIRECT_DATABASE_URL` (port 5432) — see drizzle.config.ts.
 *
 * `onnotice` is silenced because Postgres NOTICE lines from extension
 * checks (`CREATE EXTENSION IF NOT EXISTS pgcrypto`) are not actionable
 * at runtime — they belong in migration logs only.
 *
 * Plan 13 adds `withTiming` (OPS-04, OPS-05): an opt-in slow-query gate
 * that wraps a query function and logs at WARN when duration > 500ms,
 * DEBUG otherwise. Threshold is intentionally aligned with the
 * Supabase database setting `log_min_duration_statement = 500` so a
 * single slow query produces matching evidence at both layers
 * (documented in `docs/observability.md`).
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Drizzle query interceptor (lines 1923-1970)
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

import * as schema from './schema';

const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  prepare: false, // Supabase pooler compat (port 6543)
  onnotice: () => {
    // Suppress NOTICE chatter; migrations log notices through drizzle-kit.
  },
});

export const db = drizzle(client, { schema });
export type DbClient = typeof db;

/**
 * Slow-query gate (OPS-04, OPS-05).
 *
 * Wrap critical queries to get app-layer timing logs:
 *
 * ```ts
 * const users = await withTiming('admin.user.list', () =>
 *   db.query.users.findMany(),
 * );
 * ```
 *
 * Behaviour:
 *  - Returns whatever `fn()` resolves to — no wrapping, no shape change.
 *  - On resolution OR rejection (try/finally), logs a single line:
 *    - duration > 500ms → `log.warn({ label, durationMs }, 'db.slow_query')`
 *    - duration ≤ 500ms → `log.debug({ label, durationMs }, 'db.query_timing')`
 *  - Errors are NOT swallowed — the original rejection propagates.
 *
 * Why a wrapper instead of a Drizzle middleware: drizzle-orm's middleware
 * surface is per-query and does not give the call site control over the
 * `label` field. Tying a label to a logical call (e.g.
 * `'evaluations.list-by-player'`) is more useful in dashboards than the
 * raw SQL — especially when the same SQL is generated from many call sites.
 *
 * `performance.now()` is preferred over `Date.now()` for sub-millisecond
 * precision and monotonicity (immune to wall-clock adjustments).
 */
export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const dur = performance.now() - start;
    const rounded = Math.round(dur);
    if (dur > 500) {
      log.warn({ label, durationMs: rounded }, 'db.slow_query');
    } else {
      log.debug({ label, durationMs: rounded }, 'db.query_timing');
    }
  }
}
