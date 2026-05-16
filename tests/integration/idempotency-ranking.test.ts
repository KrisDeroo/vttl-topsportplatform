/**
 * Phase 4 Wave 0 — RED test stub for ranking.addEntry idempotency (VALID-08).
 *
 * Covers VALID-08 on the ranking path. Same shape as
 * idempotency-tournament.test.ts — distinct route, distinct cache key
 * namespace.
 *
 * Analog: NO existing analog (see RESEARCH §Pitfall 5).
 *
 * RED: this test is intentionally failing until Plan 04-05 wires
 * `withIdempotency` middleware to ranking.addEntry.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('ranking.addEntry idempotency (VALID-08)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('first call commits + returns body; second call with same key returns same body without re-insert', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (withIdempotency wiring on addEntry)');
  });
  it('replay emits audit code idempotency_replay', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (idempotency_replay audit)');
  });

  it.todo('mismatched payload for same key → CONFLICT (replay-with-different-body guard)');
});
