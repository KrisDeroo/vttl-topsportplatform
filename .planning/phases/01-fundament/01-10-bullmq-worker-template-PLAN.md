---phase: 01-fundament
plan: 10
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/server/workers/queues.ts
  - src/server/workers/index.ts
  - src/server/workers/jobs/consent-version-bump.ts
  - src/server/workers/connection.ts
  - tests/unit/worker-template.test.ts
  - coolify.json
autonomous: true
requirements:
requirements_supports:  # informational — primary owners listed below
  - OPS-04
threat_refs:
  - T-01-JOB-INJECTION
tags:
  - phase-1
  - infra
  - bullmq
  - worker

must_haves:
  truths:
    - "BullMQ Queue + Worker use ioredis pointing at REDIS_URL (rediss://) — NOT @upstash/redis REST (gotcha)"
    - "Connection options: maxRetriesPerRequest=null + enableReadyCheck=false (BullMQ requirements)"
    - "Worker concurrency=5, retry 3× with exponential backoff capped at 30s"
    - "consent-notify queue exists with one example job (consent-version-bump notification)"
    - "Worker entrypoint is `tsx src/server/workers/index.ts` — runs as separate Coolify service"
    - "coolify.json (or runbook) declares two services: web and worker, sharing env vars"
    - "Job idempotency: processConsentVersionBump skips if a consent_records row already exists for this user+newVersion"
  artifacts:
    - path: "src/server/workers/connection.ts"
      provides: "Single ioredis connection with BullMQ-required flags"
      exports: ["connection"]
    - path: "src/server/workers/queues.ts"
      provides: "consentNotifyQueue + consentNotifyEvents"
      exports: ["consentNotifyQueue"]
    - path: "src/server/workers/jobs/consent-version-bump.ts"
      provides: "processConsentVersionBump(data) job handler with idempotency check"
      exports: ["processConsentVersionBump"]
    - path: "src/server/workers/index.ts"
      provides: "Coolify worker entrypoint; registers Worker on consent-notify queue"
      contains: "Worker"
    - path: "coolify.json"
      provides: "Two-service hint (web + worker) for Coolify deployment"
      contains: "worker"
  key_links:
    - from: "src/server/workers/connection.ts"
      to: "src/lib/env.ts"
      via: "env.REDIS_URL (rediss:// — TCP/TLS Upstash endpoint)"
      pattern: "REDIS_URL"
    - from: "src/server/workers/jobs/consent-version-bump.ts"
      to: "src/server/email/send.ts (Plan 06)"
      via: "sendEmailLocalized to recipient's preferred_locale"
      pattern: "sendEmailLocalized"
---

<objective>
Stand up the BullMQ async-job primitive (D-15) so Phase 5 (medical-read-audit) and Phase 6 (group-message fan-out) can add jobs without re-introducing the queue infrastructure. Per the verified gotcha (RESEARCH lines 491–492), BullMQ requires a TCP/TLS Redis connection — `@upstash/redis` REST cannot run BullMQ. We use ioredis against `REDIS_URL` while Plan 09 uses `@upstash/redis` REST against `UPSTASH_REDIS_REST_URL`.

Output: working Queue + Worker template with one example job (consent-version-bump).
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
  <name>Task 1: Connection + queues.ts + worker entrypoint (consentNotifyQueue)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §BullMQ worker template (lines 1262–1306) — exact connection options and Coolify service pattern
    - .planning/phases/01-fundament/01-RESEARCH.md §Project Setup → Critical Upstash + BullMQ pitfall (lines 491–492)
    - .planning/phases/01-fundament/01-CONTEXT.md §E (D-15, D-16)
  </read_first>
  <files>
    src/server/workers/connection.ts
    src/server/workers/queues.ts
    src/server/workers/index.ts
    src/server/workers/jobs/consent-version-bump.ts
    tests/unit/worker-template.test.ts
  </files>
  <behavior>
    - Test 1 (unit): connection options has maxRetriesPerRequest === null and enableReadyCheck === false
    - Test 2 (unit): worker concurrency === 5
    - Test 3 (unit): backoff strategy returns capped exponential (n=10 returns 30000)
    - Test 4 (unit): processConsentVersionBump skips if existing consent row found
  </behavior>
  <action>
    Create `src/server/workers/connection.ts`:
    ```ts
    import IORedis from 'ioredis';
    import { env } from '@/lib/env';

    /** BullMQ requires persistent TCP/TLS Redis connection.
     *  Upstash provides this via rediss://default:<password>@<host>:6379 (different endpoint than REST URL).
     *  Both options below are MANDATORY per BullMQ docs:
     *  - maxRetriesPerRequest=null  → BullMQ handles retries internally; ioredis must not preempt
     *  - enableReadyCheck=false     → Avoids BullMQ blocking on ready-check during graceful shutdown
     */
    export const connection = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    ```

    Create `src/server/workers/queues.ts`:
    ```ts
    import { Queue, QueueEvents } from 'bullmq';
    import { connection } from './connection';

    /** Single source of truth for queue names. Phase 5 + Phase 6 add to this list. */
    export const QUEUES = {
      CONSENT_NOTIFY: 'consent-notify',
    } as const;

    export const consentNotifyQueue = new Queue(QUEUES.CONSENT_NOTIFY, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'custom' },          // see backoffStrategy in worker
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });

    export const consentNotifyEvents = new QueueEvents(QUEUES.CONSENT_NOTIFY, { connection });
    ```

    Create `src/server/workers/jobs/consent-version-bump.ts`:
    ```ts
    import { db } from '@/server/db/client';
    import { consentRecords, users } from '@/server/db/schema';
    import { eq, and } from 'drizzle-orm';
    import type { Locale } from '@/i18n/routing';

    export interface ConsentVersionBumpData {
      userId: string;
      category: 'operational' | 'medical_processing' | 'photo_video';
      oldVersion: string;
      newVersion: string;
    }

    /** Idempotent: skips if a consent_records row already exists for this user+newVersion+category.
     *  This is the sole Phase-1 example job; real production jobs come in Phase 5 (medical audit) + Phase 6 (group send). */
    export async function processConsentVersionBump(data: ConsentVersionBumpData) {
      const existing = await db.query.consentRecords.findFirst({
        where: and(
          eq(consentRecords.userId, data.userId),
          eq(consentRecords.policyVersion, data.newVersion),
          eq(consentRecords.consentCategory, data.category),
        ),
      });
      if (existing) return { skipped: true, reason: 'consent_row_exists' };

      const user = await db.query.users.findFirst({ where: eq(users.id, data.userId) });
      if (!user) return { skipped: true, reason: 'user_not_found' };

      // Plan 06 provides sendEmailLocalized; lazy import to break the worker→email circular dep
      const { sendEmailLocalized } = await import('@/server/email/send');
      await sendEmailLocalized({
        to: user.email,
        locale: user.preferredLocale as Locale,
        template: 'consent-version-bump',
        data: { oldVersion: data.oldVersion, newVersion: data.newVersion, category: data.category },
      });

      return { sent: true };
    }
    ```

    Create `src/server/workers/index.ts`:
    ```ts
    import { Worker } from 'bullmq';
    import { connection } from './connection';
    import { QUEUES } from './queues';
    import { processConsentVersionBump } from './jobs/consent-version-bump';
    // Plan 13 wires real pino instance; Worker imports it directly
    import { log } from '@/lib/log';

    const consentWorker = new Worker(
      QUEUES.CONSENT_NOTIFY,
      async (job) => processConsentVersionBump(job.data),
      {
        connection,
        concurrency: 5,
        autorun: true,
        settings: {
          backoffStrategy: (attemptsMade) => Math.min(Math.pow(2, attemptsMade) * 1000, 30_000),
        },
      },
    );

    consentWorker.on('failed', (job, err) => {
      log.error({ jobId: job?.id, queue: QUEUES.CONSENT_NOTIFY, err: err.message }, 'job.failed');
    });
    consentWorker.on('completed', (job) => {
      log.info({ jobId: job.id, queue: QUEUES.CONSENT_NOTIFY }, 'job.completed');
    });

    process.on('SIGTERM', async () => {
      log.info({}, 'worker.shutdown');
      await consentWorker.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      log.info({}, 'worker.shutdown.sigint');
      await consentWorker.close();
      process.exit(0);
    });
    ```

    Create `coolify.json` (hint file — Coolify ignores when configured manually, but documents intent):
    ```json
    {
      "services": [
        {
          "name": "web",
          "command": "npm run start",
          "port": 3000,
          "healthcheck": "/api/health/ready"
        },
        {
          "name": "worker",
          "command": "npm run worker",
          "healthcheck": null,
          "env_required": ["DATABASE_URL", "REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "RESEND_API_KEY", "EMAIL_FROM", "MEDICAL_ENCRYPTION_KEY"]
        }
      ]
    }
    ```

    Write `tests/unit/worker-template.test.ts`:
    ```ts
    import { describe, it, expect, vi } from 'vitest';

    vi.mock('ioredis', () => ({
      default: vi.fn((_url: string, opts: any) => ({ opts, on: vi.fn(), quit: vi.fn() })),
    }));
    vi.mock('bullmq', () => ({
      Queue: vi.fn(),
      QueueEvents: vi.fn(),
      Worker: vi.fn(),
    }));

    describe('BullMQ worker template — D-15', () => {
      it('connection has maxRetriesPerRequest=null + enableReadyCheck=false', async () => {
        process.env.REDIS_URL = 'rediss://default:pw@example.upstash.io:6379';
        const IORedis = (await import('ioredis')).default as any;
        await import('@/server/workers/connection');
        const callArgs = (IORedis as any).mock.calls[0]?.[1];
        expect(callArgs.maxRetriesPerRequest).toBeNull();
        expect(callArgs.enableReadyCheck).toBe(false);
      });

      it('backoff strategy caps at 30000ms', async () => {
        // The backoff fn is inline in worker/index.ts; replicate to test.
        const backoff = (n: number) => Math.min(Math.pow(2, n) * 1000, 30_000);
        expect(backoff(1)).toBe(2000);
        expect(backoff(5)).toBe(30000);
        expect(backoff(10)).toBe(30000);
      });
    });

    describe('processConsentVersionBump idempotency', () => {
      it('skips if consent row already exists for user+version+category', async () => {
        vi.doMock('@/server/db/client', () => ({
          db: {
            query: {
              consentRecords: { findFirst: vi.fn().mockResolvedValue({ id: 'existing' }) },
              users: { findFirst: vi.fn() },
            },
          },
        }));
        const { processConsentVersionBump } = await import('@/server/workers/jobs/consent-version-bump');
        const r = await processConsentVersionBump({
          userId: 'u1', category: 'operational', oldVersion: '1.0.0', newVersion: '1.0.1',
        });
        expect(r).toEqual({ skipped: true, reason: 'consent_row_exists' });
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/server/workers/connection.ts && test -f src/server/workers/queues.ts && test -f src/server/workers/index.ts && test -f src/server/workers/jobs/consent-version-bump.ts && test -f coolify.json && grep -q "maxRetriesPerRequest: null" src/server/workers/connection.ts && grep -q "enableReadyCheck: false" src/server/workers/connection.ts && grep -q "env.REDIS_URL" src/server/workers/connection.ts && grep -q "concurrency: 5" src/server/workers/index.ts && grep -q "backoffStrategy" src/server/workers/index.ts && grep -q "30_000\|30000" src/server/workers/index.ts && grep -q "consent_row_exists" src/server/workers/jobs/consent-version-bump.ts && grep -q "skipped: true" src/server/workers/jobs/consent-version-bump.ts && grep -q "QUEUES.CONSENT_NOTIFY\|consent-notify" src/server/workers/queues.ts && grep -q '"name": "worker"' coolify.json && grep -q "REDIS_URL" coolify.json && npx vitest run tests/unit/worker-template.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `connection.ts` uses `IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false })`
    - `queues.ts` exports `consentNotifyQueue` with `attempts: 3` + custom backoff
    - `worker/index.ts` registers Worker with `concurrency: 5` and exponential backoff capped at 30_000
    - `jobs/consent-version-bump.ts` returns `{ skipped: true, reason: 'consent_row_exists' }` when an existing row is found
    - `coolify.json` documents two services (web + worker) and required env vars
    - Test suite for worker template passes (idempotency test GREEN)
  </acceptance_criteria>
  <done>BullMQ infrastructure ready for Phase 5/6 to extend; Coolify two-service pattern documented.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Web service ↔ Worker service | Separate Coolify service; same codebase, different entrypoint; same env including DATABASE_URL and REDIS_URL |
| Job payload ↔ Sensitive data | Avoid passing raw medical data in job payloads — use IDs and re-fetch with RLS context (Phase 5 pattern) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-JOB-INJECTION | Tampering / Elevation of Privilege | BullMQ job names + payloads on `consent-notify` queue | mitigate | Queue names enumerated in `QUEUES` const (allowlist); only typed enqueue functions exposed (no string-name `Queue.add` from request handlers). Job processor revalidates payload shape before any DB mutation; idempotency check on `consent_records` rejects re-played jobs. |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npx vitest run tests/unit/worker-template.test.ts` GREEN
- BullMQ + ioredis versions match RESEARCH locked versions
- Worker can be started via `npm run worker` (entrypoint resolves)
</verification>

<success_criteria>
- ioredis connection with BullMQ-required flags
- 1 example queue + 1 example job with idempotency
- 2-service Coolify hint
- Worker template extensible for Phase 5 + Phase 6
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-10-SUMMARY.md` documenting:
- BullMQ + ioredis versions installed
- Confirmation that REDIS_URL accepts `rediss://` (TLS) — verified against Upstash documentation
- Note: Plan 12's consent-version-bump trigger calls `consentNotifyQueue.add(...)` once a major version bump is signalled
</output>
