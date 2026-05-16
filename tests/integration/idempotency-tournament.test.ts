/**
 * Phase 4 Wave 0 — RED test stub for tournament.enterResult idempotency (VALID-08).
 *
 * Covers VALID-08: client-provided UUID `idempotencyKey` deduplicates
 * repeated POST submissions within 24h. Replay returns the cached
 * responseBody + emits audit code 'idempotency_replay'.
 *
 * Analog: NO existing analog — Phase 4 first user of the middleware on
 * a mutation path. RESEARCH §Pitfall 5 ("Idempotency middleware wiring").
 *
 * RED: this test is intentionally failing until Plan 04-04 wires
 * `withIdempotency` middleware to tournament.enterResult.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('tournament.enterResult idempotency (VALID-08)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('first call commits + returns body; second call with same key returns same body without re-insert', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (withIdempotency wiring on enterResult)');
  });
  it('replay emits audit code idempotency_replay (one row per replay hit)', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (idempotency_replay audit)');
  });

  it.todo('mismatched payload for same key → CONFLICT (replay-with-different-body guard)');
  it.todo('expires after 24h — same key reusable for a new submission');
});
