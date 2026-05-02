/**
 * /api/health/ready — dependency readiness probe (D-17).
 *
 * Probes Postgres + Upstash Redis with a 2s per-probe timeout. Returns 200 +
 * { status: 'ok', components } when both succeed, 503 + { status: 'degraded',
 * components } when any probe fails or times out. The per-component breakdown
 * lets Coolify (or an operator inspecting the response by hand) tell *which*
 * dependency is broken.
 *
 * Used by:
 *   - Coolify deploy gate (must be 200 before traffic shifts to a new
 *     deployment; if 503, Coolify holds the previous version)
 *   - Internal Coolify network monitoring; NOT exposed publicly via UptimeRobot
 *     (UptimeRobot hits /api/health/live, which is intentionally simpler).
 *
 * Why a 2s timeout: Coolify polls health every ~5s by default; a probe that
 * takes longer than that would queue up and never give a definitive answer,
 * and a flaky upstream that hangs forever would gradually exhaust the route
 * handler's request pool. Promise.race with a setTimeout-rejection is the
 * standard primitive — we deliberately avoid AbortController here because
 * postgres-js / @upstash/redis don't both support it, and a uniform timeout
 * shape is more important than a "clean" cancellation.
 *
 * Probe choices:
 *   - Postgres: `SELECT 1` is the cheapest possible round-trip; doesn't touch
 *     any application table, so an RLS misconfiguration won't cause this probe
 *     to lie about DB health.
 *   - Redis: cache.set('healthcheck', '1', 5) — a 5-second-TTL write. We use
 *     `set` instead of `get` because `get` can return null on a healthy Redis
 *     (key didn't exist) and we'd have to disambiguate that from a connection
 *     failure. `set` either succeeds or throws; cleaner contract.
 *     The 5s TTL means probes left over from a previous deploy expire on their
 *     own and never accumulate.
 *
 * Why no caching of this response: Coolify polls infrequently (~5s), so an
 * in-memory cache would add complexity for no real load reduction. Cache-
 * Control: no-store ensures intermediate proxies never serve a stale 200.
 *
 * Threat surface: this endpoint *does* leak which dependency is degraded
 * (postgres vs redis). That's intentional — it sits inside Coolify's internal
 * network, never exposed to the public internet. If we ever decide to expose
 * it externally, the per-component breakdown should be hidden behind a header
 * check.
 *
 * Note: deliberately NOT importing from `@/lib/log` (Plan 13, sibling wave 3)
 * to keep this plan self-contained. When Plan 13 lands, swap `console.warn`
 * for `log.warn({ components }, 'health.ready.degraded')`.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Health Endpoints
 *            (lines 2014–2050), .planning/phases/01-fundament/01-CONTEXT.md §F (D-17).
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { cache } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TIMEOUT_MS = 2000;

type ComponentStatus =
  | { component: string; status: 'ok' }
  | { component: string; status: 'fail'; error: string };

/**
 * Race a promise against a timer. Rejects with `Error('timeout')` if the
 * underlying promise hasn't settled in `ms` milliseconds. The timer is
 * cleared on the success path so a slow upstream doesn't leak handles.
 */
async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const checks = await Promise.allSettled([
    withTimeout(db.execute(sql`SELECT 1 AS ping`)).then(
      () => ({ component: 'postgres', status: 'ok' as const }),
    ),
    withTimeout(cache.set('healthcheck', '1', 5)).then(
      () => ({ component: 'redis', status: 'ok' as const }),
    ),
  ]);

  const labels = ['postgres', 'redis'] as const;
  const components: ComponentStatus[] = checks.map((c, i) => {
    if (c.status === 'fulfilled') return c.value;
    return {
      component: labels[i] ?? 'unknown',
      status: 'fail',
      error: String((c as PromiseRejectedResult).reason),
    };
  });

  const overall: 'ok' | 'degraded' = components.every((c) => c.status === 'ok')
    ? 'ok'
    : 'degraded';

  if (overall !== 'ok') {
    // Plan 13 (sibling wave 3) introduces structured pino logging; until that
    // ships, console.warn keeps the readiness signal visible in container logs.
    // eslint-disable-next-line no-console
    console.warn('[health.ready.degraded]', JSON.stringify({ components }));
  }

  const timestamp = new Date(Date.now()).toISOString();
  return NextResponse.json(
    { status: overall, components, timestamp },
    { status: overall === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
