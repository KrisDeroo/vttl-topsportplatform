---
phase: 01-fundament
plan: 13
type: execute
wave: 3
depends_on: [01, 02]
files_modified:
  - src/lib/log.ts
  - src/lib/sentry.ts
  - sentry.server.config.ts
  - sentry.client.config.ts
  - sentry.edge.config.ts
  - src/server/db/client.ts
  - tests/unit/log-redact-paths.test.ts
  - tests/unit/db-timing.test.ts
autonomous: true
requirements:
  - OPS-01
  - OPS-02
  - OPS-03
  - OPS-04
  - OPS-05
threat_refs:
  - T-01-06
tags:
  - phase-1
  - observability
  - pino
  - sentry

must_haves:
  truths:
    - "lib/log.ts pino instance configured with REDACT_PATHS from src/lib/log-redact-paths.ts (Plan 05) and pino-pretty in dev"
    - "Sentry config across server/client/edge runtimes uses beforeSend that strips email, ip_address, password, token, dateOfBirth, medical_* fields"
    - "Drizzle query interceptor logs slow queries (> 500ms) at WARN level — OPS-05"
    - "Log retention strategy documented: 30d app logs, 90d audit_log, 6 years medical_access_audit (OPS-02)"
    - "Optional Logflare/Axiom transport wired behind env-driven feature flag (LOGFLARE_API_KEY presence)"
  artifacts:
    - path: "src/lib/log.ts"
      provides: "pino logger instance with redact filter"
      exports: ["log"]
    - path: "src/lib/sentry.ts"
      provides: "Sentry init with PII-stripping beforeSend"
      contains: "beforeSend"
    - path: "src/server/db/client.ts"
      provides: "Updated drizzle client with slow-query timing"
      contains: "withTiming"
  key_links:
    - from: "src/lib/log.ts"
      to: "src/lib/log-redact-paths.ts (Plan 05)"
      via: "redact: { paths: REDACT_PATHS }"
      pattern: "REDACT_PATHS"
---

<objective>
Wire pino structured logging with redact filter (SEC-04, OPS-01), Sentry EU error tracking with PII-stripping beforeSend, and the Drizzle slow-query interceptor (OPS-04, OPS-05). Document log retention policy (OPS-02) and ship logs to an EU aggregator (OPS-03 — Logflare or Axiom; env-driven choice).

Output: complete observability pipeline; tests green for redact paths and slow-query timing.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: pino instance + Sentry init + log retention doc</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §pino setup (lines 1850–1887)
    - .planning/phases/01-fundament/01-RESEARCH.md §Sentry init (lines 1889–1921)
    - .planning/phases/01-fundament/01-RESEARCH.md §Log shipping (lines 1972–1990)
    - src/lib/log-redact-paths.ts (Plan 05) — REDACT_PATHS constant
  </read_first>
  <files>
    src/lib/log.ts
    src/lib/sentry.ts
    sentry.server.config.ts
    sentry.client.config.ts
    sentry.edge.config.ts
    docs/observability.md
    tests/unit/log-redact-paths.test.ts
  </files>
  <behavior>
    - Test 1 (unit): pino instance redact paths === REDACT_PATHS constant
    - Test 2 (unit): pino base includes service: 'vttl-topsport'
    - Test 3 (unit): Sentry beforeSend strips event.user.email and event.user.ip_address
    - Test 4 (unit): Sentry beforeSend strips authorization + cookie request headers
  </behavior>
  <action>
    Create `src/lib/log.ts`:
    ```ts
    import pino, { type Logger } from 'pino';
    import { env } from './env';
    import { REDACT_PATHS } from './log-redact-paths';

    const isProd = env.NODE_ENV === 'production';

    const transports = (() => {
      const targets: any[] = [];
      if (!isProd) targets.push({ target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } });
      if (env.LOGFLARE_API_KEY && env.LOGFLARE_SOURCE) {
        targets.push({
          target: '@logflare/pino-logflare',
          options: { apiKey: env.LOGFLARE_API_KEY, sourceToken: env.LOGFLARE_SOURCE },
        });
      }
      return targets.length > 0 ? pino.transport({ targets }) : undefined;
    })();

    export const log: Logger = pino({
      level: env.LOG_LEVEL,
      base: { service: 'vttl-topsport', env: env.NODE_ENV },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [...REDACT_PATHS],
        censor: '[REDACTED]',
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
    }, transports);
    ```

    Create `src/lib/sentry.ts`:
    ```ts
    import * as Sentry from '@sentry/nextjs';
    import { env } from './env';

    /** Centralised Sentry init — imported by sentry.server.config.ts / client / edge.
     *  EU region selected via DSN host (`*.ingest.de.sentry.io`). */
    export function initSentry() {
      if (!env.SENTRY_DSN) return;  // Sentry optional in dev
      Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
        beforeSend(event) {
          // Strip user PII — keep only opaque user.id (pseudonymous identifier)
          if (event.user) {
            delete event.user.email;
            delete event.user.ip_address;
            delete (event.user as any).username;
            delete (event.user as any).name;
          }
          if (event.request?.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
            delete (event.request.headers as any)['set-cookie'];
            delete (event.request.headers as any).Authorization;
            delete (event.request.headers as any).Cookie;
          }
          if (event.request?.data && typeof event.request.data === 'object' && !Array.isArray(event.request.data)) {
            const data = event.request.data as Record<string, unknown>;
            for (const k of ['password', 'token', 'email', 'phone', 'dateOfBirth', 'consentTextSnapshot']) delete data[k];
            for (const k of Object.keys(data)) {
              if (k.startsWith('medical_') || k.endsWith('Cipher')) delete data[k];
            }
          }
          return event;
        },
      });
    }
    ```

    Create `sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`:
    ```ts
    // sentry.server.config.ts (and same for client/edge)
    import { initSentry } from '@/lib/sentry';
    initSentry();
    ```

    Create `docs/observability.md`:
    ```markdown
    # Observability — Phase 1

    ## Log retention (OPS-02)

    | Source | Retention | Storage |
    |--------|-----------|---------|
    | Application logs (pino → Logflare/Axiom EU) | 30 days | External aggregator (OPS-03) |
    | `audit_log` table | 90 days | Postgres; `pg_cron` purge job in Phase 8 |
    | `medical_access_audit` table | 6 years (Belgian Patient Rights Act) | Postgres; archive to encrypted offsite in Phase 8 |
    | Sentry error events | 90 days (Sentry default) | Sentry EU region |

    ## PII redaction

    Single source of truth: `src/lib/log-redact-paths.ts`. pino + Sentry beforeSend both consume this list. Any new sensitive field MUST be added here.

    ## Slow-query log

    - App layer: `withTiming(label, fn)` in `src/server/db/client.ts` logs queries > 500ms at WARN.
    - DB layer: Supabase setting `log_min_duration_statement = 500` (manual configuration; documented as a Phase 8 release-gate task).

    ## Alert rules (Plan 14 health endpoints feed these)

    - Error rate > 1% over 5 min — Better Stack alert (Phase 8 polish)
    - p95 latency > 1s on calendar/dashboard — Phase 3+ scope (no calendar yet in Phase 1)
    - Database connection saturation > 80% — Supabase metrics; alert in Phase 8

    ## Backend logs are English (I18N-11)

    pino logs and source code remain English regardless of UI locale. ESLint custom rule (Plan 01 + 18) prevents accidental NL/FR strings in code; Plan 17 manual gate spot-checks via grep.
    ```

    Write `tests/unit/log-redact-paths.test.ts`:
    ```ts
    import { describe, it, expect, vi } from 'vitest';

    let pinoOptsCaptured: any = null;
    vi.mock('pino', () => {
      const fn: any = (opts: any) => {
        pinoOptsCaptured = opts;
        const child = (b: any): any => ({
          info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child,
        });
        return child(opts.base);
      };
      fn.stdTimeFunctions = { isoTime: () => Date.now() };
      fn.transport = (..._a: unknown[]) => undefined;
      fn.default = fn;
      return { default: fn, ...fn };
    });

    describe('OPS-01 — pino redact wires REDACT_PATHS', () => {
      it('configures every REDACT_PATHS entry', async () => {
        const { REDACT_PATHS } = await import('@/lib/log-redact-paths');
        await import('@/lib/log');
        const paths: string[] = pinoOptsCaptured.redact.paths;
        for (const p of REDACT_PATHS) {
          expect(paths).toContain(p);
        }
        expect(pinoOptsCaptured.redact.censor).toBe('[REDACTED]');
        expect(pinoOptsCaptured.base.service).toBe('vttl-topsport');
      });
    });

    describe('Sentry beforeSend strips PII', () => {
      it('strips event.user.email and ip_address', async () => {
        process.env.SENTRY_DSN = 'https://abc@oXXXX.ingest.de.sentry.io/1';
        let captured: any = null;
        vi.doMock('@sentry/nextjs', () => ({
          init: vi.fn((opts: any) => { captured = opts; }),
        }));
        const { initSentry } = await import('@/lib/sentry');
        initSentry();
        const result = captured.beforeSend({
          user: { email: 'a@b.test', ip_address: '1.2.3.4', id: 'u1' },
          request: { headers: { authorization: 'Bearer x', cookie: 'sid=y', accept: 'application/json' }, data: { password: 'p', medical_x: 'sensitive' } },
        });
        expect(result.user.email).toBeUndefined();
        expect(result.user.ip_address).toBeUndefined();
        expect(result.user.id).toBe('u1');
        expect(result.request.headers.authorization).toBeUndefined();
        expect(result.request.headers.cookie).toBeUndefined();
        expect(result.request.headers.accept).toBe('application/json');
        expect(result.request.data.password).toBeUndefined();
        expect(result.request.data.medical_x).toBeUndefined();
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/lib/log.ts && test -f src/lib/sentry.ts && test -f sentry.server.config.ts && test -f sentry.client.config.ts && test -f sentry.edge.config.ts && test -f docs/observability.md && grep -q "REDACT_PATHS" src/lib/log.ts && grep -q "service: 'vttl-topsport'" src/lib/log.ts && grep -q "beforeSend" src/lib/sentry.ts && grep -q "delete event.user.email" src/lib/sentry.ts && grep -q "medical_" src/lib/sentry.ts && grep -q "30 days" docs/observability.md && grep -q "6 years" docs/observability.md && grep -q "log_min_duration_statement" docs/observability.md && npx vitest run tests/unit/log-redact-paths.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/lib/log.ts` imports REDACT_PATHS and passes it to pino.redact.paths
    - Sentry beforeSend deletes user.email, user.ip_address, user.username, user.name, headers.authorization, headers.cookie, body keys (password, token, email, phone, dateOfBirth, medical_*, *Cipher)
    - 3 sentry config files exist (server/client/edge)
    - docs/observability.md documents OPS-02 retention table
    - Tests in `tests/unit/log-redact-paths.test.ts` GREEN
  </acceptance_criteria>
  <done>pino + Sentry wired with PII redaction; retention policy documented.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Drizzle slow-query interceptor (OPS-04 / OPS-05)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Drizzle query interceptor (lines 1923–1970)
    - src/server/db/client.ts (Plan 02) — extend, do not replace
  </read_first>
  <files>
    src/server/db/client.ts
    tests/unit/db-timing.test.ts
  </files>
  <behavior>
    - Test 1 (unit): withTiming returns the awaited result unchanged
    - Test 2 (unit): withTiming logs at WARN if duration > 500ms
    - Test 3 (unit): withTiming logs at DEBUG if duration <= 500ms
  </behavior>
  <action>
    Update `src/server/db/client.ts` (Plan 02 created the basic version; ADD the slow-query helper):
    ```ts
    import { drizzle } from 'drizzle-orm/postgres-js';
    import postgres from 'postgres';
    import { env } from '@/lib/env';
    import * as schema from './schema';
    import { log } from '@/lib/log';

    const client = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      prepare: false,
      onnotice: () => {},
    });

    export const db = drizzle(client, { schema });
    export type DbClient = typeof db;

    /** OPS-04 / OPS-05 — slow-query gate.
     *  Wrap critical queries: `await withTiming('admin.user.list', () => db.query.users.findMany())`. */
    export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        const dur = performance.now() - start;
        const rounded = Math.round(dur);
        if (dur > 500) log.warn({ label, durationMs: rounded }, 'db.slow_query');
        else log.debug({ label, durationMs: rounded }, 'db.query_timing');
      }
    }
    ```

    Write `tests/unit/db-timing.test.ts`:
    ```ts
    import { describe, it, expect, vi } from 'vitest';

    const warn = vi.fn();
    const debug = vi.fn();

    vi.mock('@/lib/log', () => ({ log: { warn, debug, info: () => {}, error: () => {} } }));
    vi.mock('postgres', () => ({ default: vi.fn(() => ({})) }));
    vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn(() => ({})) }));

    describe('OPS-04/OPS-05 — withTiming', () => {
      beforeEach(() => { warn.mockReset(); debug.mockReset(); });

      it('returns the awaited result unchanged', async () => {
        const { withTiming } = await import('@/server/db/client');
        const r = await withTiming('test.fast', async () => ({ ok: true }));
        expect(r).toEqual({ ok: true });
      });

      it('logs WARN when duration > 500ms', async () => {
        const { withTiming } = await import('@/server/db/client');
        // Mock performance.now so we don't busy-wait the event loop (MAJOR-10 fix).
        const perfSpy = vi.spyOn(performance, 'now');
        perfSpy.mockReturnValueOnce(0);     // start
        perfSpy.mockReturnValueOnce(510);   // end → 510ms duration
        await withTiming('test.slow', async () => null);
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ label: 'test.slow' }), 'db.slow_query');
        perfSpy.mockRestore();
      });

      it('logs DEBUG when duration ≤ 500ms', async () => {
        const { withTiming } = await import('@/server/db/client');
        const perfSpy = vi.spyOn(performance, 'now');
        perfSpy.mockReturnValueOnce(0);     // start
        perfSpy.mockReturnValueOnce(120);   // end → 120ms duration
        await withTiming('test.fast', async () => null);
        expect(debug).toHaveBeenCalledWith(expect.objectContaining({ label: 'test.fast' }), 'db.query_timing');
        perfSpy.mockRestore();
      });
    });
    ```
  </action>
  <verify>
    <automated>grep -q "export async function withTiming" src/server/db/client.ts && grep -q "performance.now" src/server/db/client.ts && grep -q "db.slow_query" src/server/db/client.ts && grep -q "db.query_timing" src/server/db/client.ts && grep -q "dur > 500" src/server/db/client.ts && npx vitest run tests/unit/db-timing.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/db/client.ts` exports `withTiming<T>(label, fn)`
    - Threshold is exactly 500ms (matches Supabase log_min_duration_statement, OPS-05)
    - WARN path uses tag `db.slow_query`; DEBUG path uses `db.query_timing`
    - 3 tests in `tests/unit/db-timing.test.ts` pass — slow-query test uses `vi.spyOn(performance, 'now')` (MAJOR-10: no busy-wait, no event-loop blocking)
  </acceptance_criteria>
  <done>Slow-query interceptor wired; matches DB-level threshold for unified telemetry.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Application ↔ External log aggregator | Logflare / Axiom EU; payload pre-redacted by pino REDACT_PATHS |
| Application ↔ Sentry EU | DSN routes to `*.ingest.de.sentry.io`; beforeSend strips PII |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-06 | Information Disclosure | PII leakage via logs | mitigate | pino REDACT_PATHS + Sentry beforeSend; both consume same source-of-truth list; log retention bounded per OPS-02 |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npx vitest run tests/unit/log-redact-paths.test.ts tests/unit/db-timing.test.ts` GREEN
- Sentry config files compile
- docs/observability.md committed
</verification>

<success_criteria>
- pino instance with REDACT_PATHS + service base + Logflare transport (env-gated)
- Sentry across 3 runtimes (server/client/edge) with PII-stripping beforeSend
- Drizzle slow-query helper at 500ms threshold
- OPS-02 retention strategy documented
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-13-SUMMARY.md` documenting:
- Confirmation that Logflare or Axiom dataset can be selected at signup (A9 verification — note in summary which was chosen, or "deferred to Phase 8")
- Sentry DSN points to EU region
- Plan 11 (CallerContext) attaches `requestId` + `userId` to log child instance
</output>
