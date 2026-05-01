/**
 * Unit tests for the BullMQ worker template (D-15).
 *
 * Plan 01-10 stands up the async-job primitive so Phase 5 (medical-read-audit)
 * and Phase 6 (group-message fan-out) can attach jobs without re-introducing
 * queue infrastructure.
 *
 * Verified gotcha (RESEARCH.md §Critical Upstash + BullMQ pitfall, lines
 * 491-492): BullMQ requires a persistent TCP/TLS Redis connection — `@upstash/redis`
 * REST cannot drive BullMQ. Use ioredis against `REDIS_URL` (rediss://) while
 * Plan 09 uses `@upstash/redis` REST against `UPSTASH_REDIS_REST_URL`.
 *
 * BullMQ requirements verified against BullMQ docs:
 *  - maxRetriesPerRequest=null  → BullMQ handles retries internally
 *  - enableReadyCheck=false     → avoids ready-check blocking on graceful shutdown
 *
 * Tests use vi.mock to stub ioredis + bullmq + db so the module under test loads
 * without a live Redis or Postgres instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const VALID_SERVER_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://u:p@host:6543/db',
  DIRECT_DATABASE_URL: 'postgres://u:p@host:5432/db',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  UPSTASH_REDIS_REST_URL: 'https://upstash.example/api',
  UPSTASH_REDIS_REST_TOKEN: 'b'.repeat(20),
  REDIS_URL: 'rediss://default:pw@example.upstash.io:6379',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'noreply@vttl.be',
  MEDICAL_ENCRYPTION_KEY: 'c'.repeat(32),
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_DEFAULT_LOCALE: 'nl',
};

describe('BullMQ worker template — D-15', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const [k, v] of Object.entries(VALID_SERVER_ENV)) process.env[k] = v;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock('ioredis');
    vi.doUnmock('bullmq');
    vi.doUnmock('@/server/db/client');
    vi.doUnmock('@/server/db/schema');
    vi.doUnmock('@/server/email/send');
    vi.doUnmock('@/lib/log');
  });

  it('connection.ts uses ioredis with maxRetriesPerRequest=null + enableReadyCheck=false against REDIS_URL', async () => {
    const ioredisCtor = vi.fn((_url: string, opts: unknown) => ({
      opts,
      on: vi.fn(),
      quit: vi.fn(),
    }));
    vi.doMock('ioredis', () => ({ default: ioredisCtor }));

    await import('@/server/workers/connection');

    expect(ioredisCtor).toHaveBeenCalledTimes(1);
    const [url, opts] = ioredisCtor.mock.calls[0] ?? [];
    expect(url).toBe(VALID_SERVER_ENV.REDIS_URL);
    expect(opts).toMatchObject({
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  });

  it('queues.ts exposes consentNotifyQueue with attempts=3 and the expected queue name', async () => {
    vi.doMock('ioredis', () => ({
      default: vi.fn(() => ({ on: vi.fn(), quit: vi.fn() })),
    }));
    const queueCtor = vi.fn();
    const queueEventsCtor = vi.fn();
    vi.doMock('bullmq', () => ({
      Queue: queueCtor,
      QueueEvents: queueEventsCtor,
      Worker: vi.fn(),
    }));

    const mod = await import('@/server/workers/queues');

    expect(mod.QUEUES.CONSENT_NOTIFY).toBe('consent-notify');
    expect(queueCtor).toHaveBeenCalledTimes(1);
    const [name, opts] = queueCtor.mock.calls[0] ?? [];
    expect(name).toBe('consent-notify');
    expect((opts as { defaultJobOptions?: { attempts?: number } } | undefined)?.defaultJobOptions?.attempts).toBe(3);
    expect(queueEventsCtor).toHaveBeenCalledTimes(1);
  });

  it('worker concurrency=5 and backoff strategy caps at 30000ms', async () => {
    vi.doMock('ioredis', () => ({
      default: vi.fn(() => ({ on: vi.fn(), quit: vi.fn() })),
    }));
    const workerCtor = vi.fn(() => ({ on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('bullmq', () => ({
      Queue: vi.fn(),
      QueueEvents: vi.fn(),
      Worker: workerCtor,
    }));
    vi.doMock('@/lib/log', () => ({ log: { info: vi.fn(), error: vi.fn() } }));
    vi.doMock('@/server/workers/jobs/consent-version-bump', () => ({
      processConsentVersionBump: vi.fn(),
    }));

    await import('@/server/workers/index');

    expect(workerCtor).toHaveBeenCalledTimes(1);
    const call = workerCtor.mock.calls[0] as unknown as unknown[];
    const opts = call?.[2] as
      | {
          concurrency?: number;
          settings?: { backoffStrategy?: (n: number) => number };
        }
      | undefined;
    expect(opts?.concurrency).toBe(5);

    const backoff = opts?.settings?.backoffStrategy;
    expect(typeof backoff).toBe('function');
    if (backoff) {
      // Exponential growth, capped at 30_000ms
      expect(backoff(1)).toBe(2_000);
      expect(backoff(2)).toBe(4_000);
      expect(backoff(5)).toBe(30_000); // 2^5 * 1000 = 32000 → capped
      expect(backoff(10)).toBe(30_000);
    }
  });

  it('worker entrypoint registers SIGTERM + SIGINT handlers for graceful shutdown', async () => {
    const onSpy = vi.spyOn(process, 'on');
    vi.doMock('ioredis', () => ({
      default: vi.fn(() => ({ on: vi.fn(), quit: vi.fn() })),
    }));
    vi.doMock('bullmq', () => ({
      Queue: vi.fn(),
      QueueEvents: vi.fn(),
      Worker: vi.fn(() => ({ on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) })),
    }));
    vi.doMock('@/lib/log', () => ({ log: { info: vi.fn(), error: vi.fn() } }));
    vi.doMock('@/server/workers/jobs/consent-version-bump', () => ({
      processConsentVersionBump: vi.fn(),
    }));

    await import('@/server/workers/index');

    const signals = onSpy.mock.calls.map(([s]) => s);
    expect(signals).toContain('SIGTERM');
    expect(signals).toContain('SIGINT');

    onSpy.mockRestore();
  });
});

describe('processConsentVersionBump idempotency', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const [k, v] of Object.entries(VALID_SERVER_ENV)) process.env[k] = v;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
    vi.doUnmock('@/server/db/client');
    vi.doUnmock('@/server/db/schema');
    vi.doUnmock('@/server/email/send');
  });

  it('skips when consent_records row already exists for user+newVersion+category', async () => {
    const findFirstUser = vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.c', preferredLocale: 'nl' });
    const findFirstConsent = vi.fn().mockResolvedValue({ id: 'existing-row-id' });
    const sendEmailLocalized = vi.fn();

    vi.doMock('@/server/db/client', () => ({
      db: {
        query: {
          consentRecords: { findFirst: findFirstConsent },
          users: { findFirst: findFirstUser },
        },
      },
    }));
    vi.doMock('@/server/db/schema', () => ({
      consentRecords: { userId: 'consentRecords.userId', policyVersion: 'consentRecords.policyVersion', consentCategory: 'consentRecords.consentCategory' },
      users: { id: 'users.id' },
    }));
    vi.doMock('drizzle-orm', () => ({
      eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
      and: (...parts: unknown[]) => ({ op: 'and', parts }),
    }));
    vi.doMock('@/server/email/send', () => ({ sendEmailLocalized }));

    const { processConsentVersionBump } = await import('@/server/workers/jobs/consent-version-bump');
    const result = await processConsentVersionBump({
      userId: 'u1',
      category: 'operational',
      oldVersion: '1.0.0',
      newVersion: '1.0.1',
    });

    expect(result).toEqual({ skipped: true, reason: 'consent_row_exists' });
    expect(findFirstConsent).toHaveBeenCalledTimes(1);
    // Must short-circuit before fetching the user or sending the email
    expect(findFirstUser).not.toHaveBeenCalled();
    expect(sendEmailLocalized).not.toHaveBeenCalled();
  });

  it('skips when target user is not found (defence in depth)', async () => {
    const findFirstUser = vi.fn().mockResolvedValue(undefined);
    const findFirstConsent = vi.fn().mockResolvedValue(undefined);
    const sendEmailLocalized = vi.fn();

    vi.doMock('@/server/db/client', () => ({
      db: {
        query: {
          consentRecords: { findFirst: findFirstConsent },
          users: { findFirst: findFirstUser },
        },
      },
    }));
    vi.doMock('@/server/db/schema', () => ({
      consentRecords: { userId: 'consentRecords.userId', policyVersion: 'consentRecords.policyVersion', consentCategory: 'consentRecords.consentCategory' },
      users: { id: 'users.id' },
    }));
    vi.doMock('drizzle-orm', () => ({
      eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
      and: (...parts: unknown[]) => ({ op: 'and', parts }),
    }));
    vi.doMock('@/server/email/send', () => ({ sendEmailLocalized }));

    const { processConsentVersionBump } = await import('@/server/workers/jobs/consent-version-bump');
    const result = await processConsentVersionBump({
      userId: 'ghost',
      category: 'medical_processing',
      oldVersion: '1.0.0',
      newVersion: '2.0.0',
    });

    expect(result).toEqual({ skipped: true, reason: 'user_not_found' });
    expect(sendEmailLocalized).not.toHaveBeenCalled();
  });

  it('sends localized email when no prior consent and user exists', async () => {
    const findFirstConsent = vi.fn().mockResolvedValue(undefined);
    const findFirstUser = vi
      .fn()
      .mockResolvedValue({ id: 'u2', email: 'fr@vttl.be', preferredLocale: 'fr' });
    const sendEmailLocalized = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/server/db/client', () => ({
      db: {
        query: {
          consentRecords: { findFirst: findFirstConsent },
          users: { findFirst: findFirstUser },
        },
      },
    }));
    vi.doMock('@/server/db/schema', () => ({
      consentRecords: { userId: 'consentRecords.userId', policyVersion: 'consentRecords.policyVersion', consentCategory: 'consentRecords.consentCategory' },
      users: { id: 'users.id' },
    }));
    vi.doMock('drizzle-orm', () => ({
      eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
      and: (...parts: unknown[]) => ({ op: 'and', parts }),
    }));
    vi.doMock('@/server/email/send', () => ({ sendEmailLocalized }));

    const { processConsentVersionBump } = await import('@/server/workers/jobs/consent-version-bump');
    const result = await processConsentVersionBump({
      userId: 'u2',
      category: 'photo_video',
      oldVersion: '1.0.0',
      newVersion: '1.1.0',
    });

    expect(result).toEqual({ sent: true });
    expect(sendEmailLocalized).toHaveBeenCalledTimes(1);
    const arg = sendEmailLocalized.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      to: 'fr@vttl.be',
      locale: 'fr',
      template: 'consent-version-bump',
      data: { oldVersion: '1.0.0', newVersion: '1.1.0', category: 'photo_video' },
    });
  });
});
