/**
 * Phase 4 Wave 0 — RED test stub for idempotency middleware wiring (VALID-08).
 *
 * Covers VALID-08: POST mutations accept a client-provided UUID
 * `idempotencyKey`; duplicate keys within 24h short-circuit and return
 * the cached responseBody (HTTP 200, not 409). Wave 1 ships the middleware
 * and wires it into:
 *   - tournament.enterResult  (Plan 04-04)
 *   - ranking.addEntry         (Plan 04-05)
 *   - training.markAttendanceAndScore  (Plan 04-03; depends on planner discretion
 *                                       — atomic upsert path)
 *
 * Analog: tests/integration/idempotency-tournament.test.ts (e2e probe).
 *
 * RED: this test is intentionally failing until Plan 04-02/04-03 ships
 * the middleware factory at `@/server/trpc/middleware/idempotency`.
 */
import { describe, it, expect } from 'vitest';

describe('idempotency middleware — VALID-08', () => {
  it('exposes withIdempotency middleware factory from @/server/trpc/middleware/idempotency', async () => {
    // Runtime-built path: TS can't statically resolve a module that hasn't shipped.
    const modulePath = ['@', '/server/trpc/middleware/idempotency'].join('');
    let withIdempotency: unknown;
    try {
      const mod = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
      withIdempotency = mod.withIdempotency;
    } catch {
      withIdempotency = undefined;
    }
    expect(
      withIdempotency,
      'withIdempotency must be exported from @/server/trpc/middleware/idempotency (Plan 04-02/04-03)',
    ).toBeDefined();
  });

  it.todo(
    'short-circuits replay within 24h and returns cached responseBody (audit code: idempotency_replay)',
  );
  it.todo('writes idempotency_keys row with (key, user_id, response_body, expires_at)');
  it.todo('rejects mismatched payload for the same key with CONFLICT (replay-with-different-body guard)');
});
