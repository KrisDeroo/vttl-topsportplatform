/**
 * /api/health/live — process liveness probe (D-17).
 *
 * THIS ENDPOINT MUST NEVER TOUCH AN EXTERNAL SYSTEM.
 *
 * Purpose: tell an external monitor (UptimeRobot, Coolify container check) that
 * the Node process is up and the HTTP stack answers. Whether Postgres or
 * Upstash are reachable is *deliberately* irrelevant here — that's
 * /api/health/ready's job. The two endpoints are separate so a flaky DB does
 * not cause Coolify to kill the container (which would cascade into restart
 * loops and make the outage worse).
 *
 * Threat T-01-INFO-LEAK (mitigate): the response body is intentionally minimal —
 * `status`, hardcoded `service` name, and a request-time timestamp. NO version
 * string, NO build SHA, NO env, NO host. Anything richer is in
 * /api/health/ready, which sits behind Coolify's internal network.
 *
 * Cache-Control: no-store keeps Coolify / UptimeRobot probes from being served
 * a stale 200 by an intermediate proxy after the process has actually died.
 *
 * `runtime = 'nodejs'` (not edge): we deliberately co-locate this with
 * /api/health/ready so both endpoints execute in the same runtime and can
 * never disagree about Node-vs-Edge serialization quirks. Edge would also
 * forbid pino/Sentry imports if we ever add them here.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Health Endpoints
 *            (lines 1993–2051), .planning/phases/01-fundament/01-CONTEXT.md §F (D-17).
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // ESLint rule (Plan 01) blocks zero-arg `new Date()` outside tests/. Wrap with
  // Date.now() — request-time ISO timestamp is fine; the rule's intent is to
  // catch stored timestamps, not transient response metadata.
  const timestamp = new Date(Date.now()).toISOString();

  return NextResponse.json(
    { status: 'ok', service: 'vttl-topsport-web', timestamp },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
