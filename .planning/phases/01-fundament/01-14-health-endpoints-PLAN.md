---
phase: 01-fundament
plan: 14
type: execute
wave: 3
depends_on: [01, 02]
files_modified:
  - src/app/api/health/live/route.ts
  - src/app/api/health/ready/route.ts
  - tests/integration/health.test.ts
autonomous: true
requirements:
  - OPS-06
threat_refs:
  - T-01-INFO-LEAK
tags:
  - phase-1
  - ops
  - health

must_haves:
  truths:
    - "/api/health/live returns 200 with { status: 'ok' } and runs no external probes (D-17)"
    - "/api/health/ready probes Postgres + Upstash Redis with 1–2s timeouts; returns 503 + component status JSON when any dependency fails"
    - "Both endpoints are runtime: 'nodejs' (NOT edge) and Cache-Control: no-store"
    - "Both endpoints are exempt from next-intl middleware (matcher excludes /api in Plan 07)"
  artifacts:
    - path: "src/app/api/health/live/route.ts"
      provides: "GET handler — process check only"
      contains: "force-dynamic"
    - path: "src/app/api/health/ready/route.ts"
      provides: "GET handler — DB + Redis probes with timeout"
      contains: "Promise.allSettled"
  key_links:
    - from: "src/app/api/health/ready/route.ts"
      to: "src/lib/cache.ts (Plan 09)"
      via: "cache.set('healthcheck', ...) probe"
      pattern: "cache.set"
    - from: "src/app/api/health/ready/route.ts"
      to: "src/server/db/client.ts (Plan 02)"
      via: "db.execute(sql`SELECT 1`)"
      pattern: "SELECT 1"
---

<objective>
Per D-17, two health endpoints with separate concerns:
- `/api/health/live` — process-only check; never fails because of external systems; UptimeRobot-friendly.
- `/api/health/ready` — probes Postgres and Upstash Redis; Coolify uses this as the deploy gate.

Output: 2 route files + integration test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: live + ready route handlers + integration test</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Health Endpoints (lines 1993–2051)
    - .planning/phases/01-fundament/01-CONTEXT.md §F (D-17)
    - tests/e2e/health.spec.ts (Plan 17 — RED until this plan)
  </read_first>
  <files>
    src/app/api/health/live/route.ts
    src/app/api/health/ready/route.ts
    tests/integration/health.test.ts
  </files>
  <behavior>
    - Test 1 (integration): GET /api/health/live returns 200 with { status: 'ok' }
    - Test 2 (integration): GET /api/health/ready returns 200 when DB + Redis OK
    - Test 3 (integration): GET /api/health/ready returns 503 when DB probe times out
    - Test 4 (integration): GET /api/health/ready returns 503 when Redis probe times out
  </behavior>
  <action>
    Create `src/app/api/health/live/route.ts` per RESEARCH lines 1997–2010:
    ```ts
    import { NextResponse } from 'next/server';

    export const dynamic = 'force-dynamic';
    export const runtime = 'nodejs';

    export async function GET() {
      return NextResponse.json(
        { status: 'ok', service: 'vttl-topsport-web', timestamp: new Date().toISOString() },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    ```

    Note: Plan 01 ESLint rule blocks zero-arg `new Date()` outside `tests/`. Use `Date.now()` and `new Date(Date.now()).toISOString()`, or add an eslint-disable-next-line comment with rationale: ISO timestamp at request time is acceptable; the rule's intent is to flag stored timestamps. Use:
    ```ts
    timestamp: new Date(Date.now()).toISOString(),
    ```

    Create `src/app/api/health/ready/route.ts` per RESEARCH lines 2014–2050:
    ```ts
    import { NextResponse } from 'next/server';
    import { db } from '@/server/db/client';
    import { sql } from 'drizzle-orm';
    import { cache } from '@/lib/cache';
    import { log } from '@/lib/log';

    export const dynamic = 'force-dynamic';
    export const runtime = 'nodejs';

    const TIMEOUT_MS = 2000;

    async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
      return Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
      ]);
    }

    export async function GET() {
      const checks = await Promise.allSettled([
        withTimeout(db.execute(sql`SELECT 1 AS ping`)).then(() => ({ component: 'postgres', status: 'ok' as const })),
        withTimeout(cache.set('healthcheck', '1', 5)).then(() => ({ component: 'redis', status: 'ok' as const })),
      ]);

      const components = checks.map((c, i) =>
        c.status === 'fulfilled'
          ? c.value
          : { component: i === 0 ? 'postgres' : 'redis', status: 'fail' as const, error: String((c as PromiseRejectedResult).reason) },
      );
      const overall = components.every((c) => c.status === 'ok') ? 'ok' : 'degraded';

      if (overall !== 'ok') log.warn({ components }, 'health.ready.degraded');

      return NextResponse.json(
        { status: overall, components, timestamp: new Date(Date.now()).toISOString() },
        { status: overall === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    ```

    Write `tests/integration/health.test.ts`:
    ```ts
    import { describe, it, expect, vi } from 'vitest';

    describe('OPS-06 health endpoints', () => {
      it('/api/health/live returns 200 always', async () => {
        const { GET } = await import('@/app/api/health/live/route');
        const res = await GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.service).toBe('vttl-topsport-web');
      });

      it('/api/health/ready returns 200 when DB + Redis OK', async () => {
        vi.doMock('@/server/db/client', () => ({ db: { execute: vi.fn().mockResolvedValue([]) } }));
        vi.doMock('@/lib/cache', () => ({ cache: { set: vi.fn().mockResolvedValue(undefined) } }));
        vi.doMock('@/lib/log', () => ({ log: { warn: vi.fn() } }));
        const { GET } = await import('@/app/api/health/ready/route');
        const res = await GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.components).toEqual(expect.arrayContaining([
          { component: 'postgres', status: 'ok' },
          { component: 'redis', status: 'ok' },
        ]));
      });

      it('/api/health/ready returns 503 when DB times out', async () => {
        vi.resetModules();
        vi.doMock('@/server/db/client', () => ({ db: { execute: () => new Promise(() => {}) } }));  // never resolves
        vi.doMock('@/lib/cache', () => ({ cache: { set: vi.fn().mockResolvedValue(undefined) } }));
        vi.doMock('@/lib/log', () => ({ log: { warn: vi.fn() } }));
        const { GET } = await import('@/app/api/health/ready/route');
        const res = await GET();
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.status).toBe('degraded');
        expect(body.components.find((c: any) => c.component === 'postgres').status).toBe('fail');
      }, 5_000);

      it('/api/health/ready returns 503 when Redis times out', async () => {
        vi.resetModules();
        vi.doMock('@/server/db/client', () => ({ db: { execute: vi.fn().mockResolvedValue([]) } }));
        vi.doMock('@/lib/cache', () => ({ cache: { set: () => new Promise(() => {}) } }));
        vi.doMock('@/lib/log', () => ({ log: { warn: vi.fn() } }));
        const { GET } = await import('@/app/api/health/ready/route');
        const res = await GET();
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.components.find((c: any) => c.component === 'redis').status).toBe('fail');
      }, 5_000);
    });
    ```
  </action>
  <verify>
    <automated>test -f src/app/api/health/live/route.ts && test -f src/app/api/health/ready/route.ts && grep -q "runtime = 'nodejs'" src/app/api/health/live/route.ts && grep -q "force-dynamic" src/app/api/health/live/route.ts && grep -q "Cache-Control.*no-store" src/app/api/health/live/route.ts && grep -q "Promise.allSettled" src/app/api/health/ready/route.ts && grep -q "withTimeout" src/app/api/health/ready/route.ts && grep -q "TIMEOUT_MS = 2000" src/app/api/health/ready/route.ts && grep -q "SELECT 1" src/app/api/health/ready/route.ts && grep -q "cache.set('healthcheck'" src/app/api/health/ready/route.ts && grep -q "503" src/app/api/health/ready/route.ts && npx vitest run tests/integration/health.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `/api/health/live` returns 200 unconditionally with `status: 'ok'`
    - `/api/health/ready` runs DB + Redis probes inside `withTimeout(2000ms)`
    - Returns HTTP 503 when any probe fails or times out
    - JSON body always includes `components: [{ component, status, error? }]`
    - `Cache-Control: no-store` header set on both responses
    - 4 integration tests GREEN
  </acceptance_criteria>
  <done>Health endpoints serve UptimeRobot (live) and Coolify deploy gate (ready).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| External monitor ↔ /live | Public unauthenticated; reveals only `service` name (no secrets) |
| Coolify deployer ↔ /ready | Internal Coolify network; exposes which dependency is degraded |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-INFO-LEAK | Information Disclosure | Public `/api/health/live` response body | mitigate | Response includes ONLY `{ status: "ok", service: "vttl-topsport-web", timestamp }`. NO version string, NO env, NO host info, NO build SHA. Anything richer that an operator might want is in `/api/health/ready` (Coolify-internal, not public). |
</threat_model>

<verification>
- `npx vitest run tests/integration/health.test.ts` GREEN
- `npx tsc --noEmit` exits 0
- `tests/e2e/health.spec.ts` (Plan 17) succeeds once dev server is up
</verification>

<success_criteria>
- 2 route handlers, both Node runtime, both Cache-Control: no-store
- D-17 separation enforced (live = process; ready = DB + Redis)
- Timeout 2s on both probes; degraded responses include component-level status
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-14-SUMMARY.md` documenting:
- Confirmation that `/api/health/live` runs zero external dependencies
- Coolify configuration note: set `healthcheck` to `/api/health/ready` for deploy gate, NOT `/live`
</output>
