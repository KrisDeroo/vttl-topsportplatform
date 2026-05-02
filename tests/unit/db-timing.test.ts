/**
 * Unit tests for OPS-04 / OPS-05 — Drizzle slow-query interceptor.
 *
 * Asserts the contract of `withTiming(label, fn)` exported from
 * src/server/db/client.ts:
 *   1) The awaited value of `fn()` is returned unchanged (no wrapping).
 *   2) Duration > 500ms emits a WARN log with tag `db.slow_query`.
 *   3) Duration ≤ 500ms emits a DEBUG log with tag `db.query_timing`.
 *
 * MAJOR-10 fix: tests do NOT busy-wait the event loop or call setTimeout to
 * fake elapsed time — they spy on `performance.now` and feed it the start +
 * end values directly. Busy-waits block the event loop and cause flaky CI
 * runs; setTimeout can drift on overloaded runners. Spying is deterministic.
 *
 * The 500ms threshold is the same value that Supabase will be configured
 * with on `log_min_duration_statement` so the application-layer log and the
 * database-layer log are evidentially aligned for a single slow query
 * (documented in docs/observability.md).
 *
 * Reference: .planning/phases/01-fundament/01-13-observability-pino-sentry-PLAN.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const warn = vi.fn();
const debug = vi.fn();

vi.mock('@/lib/log', () => ({
  log: {
    warn,
    debug,
    info: () => {},
    error: () => {},
  },
}));

// Stub Postgres + Drizzle so the SUT module loads without a live DB. The
// constructors are read at module-init time; we don't actually exercise them.
vi.mock('postgres', () => ({ default: vi.fn(() => ({})) }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn(() => ({})) }));

beforeEach(() => {
  warn.mockReset();
  debug.mockReset();
});

describe('OPS-04 / OPS-05 — withTiming', () => {
  it('returns the awaited result unchanged', async () => {
    const { withTiming } = await import('@/server/db/client');
    const result = await withTiming('test.fast', async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
  });

  it('logs WARN with db.slow_query tag when duration > 500ms', async () => {
    const { withTiming } = await import('@/server/db/client');
    const perfSpy = vi.spyOn(performance, 'now');
    perfSpy.mockReturnValueOnce(0); // start
    perfSpy.mockReturnValueOnce(510); // end → 510ms duration
    await withTiming('test.slow', async () => null);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'test.slow', durationMs: 510 }),
      'db.slow_query',
    );
    expect(debug).not.toHaveBeenCalled();
    perfSpy.mockRestore();
  });

  it('logs DEBUG with db.query_timing tag when duration <= 500ms', async () => {
    const { withTiming } = await import('@/server/db/client');
    const perfSpy = vi.spyOn(performance, 'now');
    perfSpy.mockReturnValueOnce(0); // start
    perfSpy.mockReturnValueOnce(120); // end → 120ms duration
    await withTiming('test.fast', async () => null);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'test.fast', durationMs: 120 }),
      'db.query_timing',
    );
    expect(warn).not.toHaveBeenCalled();
    perfSpy.mockRestore();
  });

  it('still logs and propagates the error if fn() rejects', async () => {
    const { withTiming } = await import('@/server/db/client');
    const perfSpy = vi.spyOn(performance, 'now');
    perfSpy.mockReturnValueOnce(0);
    perfSpy.mockReturnValueOnce(700);
    const boom = new Error('boom');
    await expect(
      withTiming('test.error', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    // Duration measured even on rejection (try/finally) — > 500ms → WARN.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'test.error', durationMs: 700 }),
      'db.slow_query',
    );
    perfSpy.mockRestore();
  });
});
