/**
 * Unit tests for OPS-01 (pino redact wiring) + T-01-06 (PII-stripping Sentry beforeSend).
 *
 * Two concerns, two test groups:
 *   1) Pino must consume every entry from `src/lib/log-redact-paths.ts` (single
 *      source of truth shared with Plan 05's CSRF/log-redact integration test).
 *      We mock the `pino` module so the SUT can load without a real pino runtime
 *      and we capture the options object pino is called with.
 *   2) Sentry's beforeSend must strip user PII (email, ip_address, name,
 *      username), authorization + cookie headers, and dangerous body fields
 *      (password, token, email, dateOfBirth, medical_*, *Cipher).
 *
 * Both tests run in a single vitest invocation; the second test sets
 * `process.env.SENTRY_DSN` so `initSentry()` actually calls `Sentry.init`
 * (otherwise it short-circuits, which is the dev/test default).
 *
 * Reference: .planning/phases/01-fundament/01-13-observability-pino-sentry-PLAN.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let pinoOptsCaptured: Record<string, unknown> | null = null;

vi.mock('pino', () => {
  const fn = ((opts: Record<string, unknown>) => {
    pinoOptsCaptured = opts;
    const child = (_b: unknown): unknown => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      child,
    });
    return child(opts.base);
  }) as unknown as Record<string, unknown> & ((opts: Record<string, unknown>) => unknown);
  fn.stdTimeFunctions = { isoTime: () => Date.now() };
  fn.transport = (..._a: unknown[]) => undefined;
  fn.default = fn;
  return { default: fn, ...fn };
});

beforeEach(() => {
  pinoOptsCaptured = null;
  vi.resetModules();
});

describe('OPS-01 — pino redact wires REDACT_PATHS', () => {
  it('configures every REDACT_PATHS entry on the pino instance', async () => {
    const { REDACT_PATHS } = await import('@/lib/log-redact-paths');
    await import('@/lib/log');

    expect(pinoOptsCaptured).not.toBeNull();
    const opts = pinoOptsCaptured as {
      redact: { paths: string[]; censor: string };
      base: { service: string };
    };
    for (const p of REDACT_PATHS) {
      expect(opts.redact.paths).toContain(p);
    }
    expect(opts.redact.censor).toBe('[REDACTED]');
    expect(opts.base.service).toBe('vttl-topsport');
  });
});

describe('T-01-06 — Sentry beforeSend strips PII', () => {
  it('strips event.user.email, ip_address, username, name; auth + cookie headers; dangerous body fields', async () => {
    process.env.SENTRY_DSN = 'https://abc@oXXXX.ingest.de.sentry.io/1';
    let captured: { beforeSend?: (event: unknown) => unknown } | null = null;
    vi.doMock('@sentry/nextjs', () => ({
      init: vi.fn((opts: unknown) => {
        captured = opts as { beforeSend?: (event: unknown) => unknown };
      }),
    }));
    const { initSentry } = await import('@/lib/sentry');
    initSentry();

    expect(captured).not.toBeNull();
    const beforeSend = captured!.beforeSend!;
    const result = beforeSend({
      user: {
        email: 'a@b.test',
        ip_address: '1.2.3.4',
        username: 'someone',
        name: 'Some One',
        id: 'u1',
      },
      request: {
        headers: {
          authorization: 'Bearer x',
          cookie: 'sid=y',
          'set-cookie': 'sid=z',
          accept: 'application/json',
        },
        data: {
          password: 'p',
          token: 't',
          email: 'a@b.test',
          phone: '+32...',
          dateOfBirth: '2000-01-01',
          consentTextSnapshot: 'long text',
          medical_diagnosis: 'sensitive',
          eventDescriptionCipher: 'cipher',
          safe: 'keep me',
        },
      },
    }) as {
      user: { email?: string; ip_address?: string; id?: string };
      request: {
        headers: Record<string, string | undefined>;
        data: Record<string, unknown>;
      };
    };

    // user PII gone, but pseudonymous id retained
    expect(result.user.email).toBeUndefined();
    expect(result.user.ip_address).toBeUndefined();
    expect((result.user as Record<string, unknown>).username).toBeUndefined();
    expect((result.user as Record<string, unknown>).name).toBeUndefined();
    expect(result.user.id).toBe('u1');

    // auth + cookie headers gone, accept retained
    expect(result.request.headers.authorization).toBeUndefined();
    expect(result.request.headers.cookie).toBeUndefined();
    expect(result.request.headers['set-cookie']).toBeUndefined();
    expect(result.request.headers.accept).toBe('application/json');

    // dangerous body fields gone
    expect(result.request.data.password).toBeUndefined();
    expect(result.request.data.token).toBeUndefined();
    expect(result.request.data.email).toBeUndefined();
    expect(result.request.data.phone).toBeUndefined();
    expect(result.request.data.dateOfBirth).toBeUndefined();
    expect(result.request.data.consentTextSnapshot).toBeUndefined();
    expect(result.request.data.medical_diagnosis).toBeUndefined();
    expect(result.request.data.eventDescriptionCipher).toBeUndefined();

    // unrelated body field preserved
    expect(result.request.data.safe).toBe('keep me');
  });
});
