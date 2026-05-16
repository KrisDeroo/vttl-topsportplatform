/**
 * Phase 4 Wave 0 — RED test stub for ranking_entries XOR CHECK (D-86).
 *
 * Covers D-86: DB-level CHECK constraint enforces
 *   (value_numeric IS NOT NULL AND value_classification_code IS NULL)
 *   OR
 *   (value_numeric IS NULL AND value_classification_code IS NOT NULL)
 *
 * Defense-in-depth alongside the Zod discriminated union schema.
 *
 * Analog: tests/integration/calendar-exceptions.test.ts (CHECK violation
 * shape — error code 23514).
 *
 * RED: this test is intentionally failing until Plan 04-05 ships the
 * ranking_entries table with the XOR CHECK in migration 0016.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('ranking_entries XOR CHECK constraint (D-86)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('INSERT with both value_numeric AND value_classification_code violates CHECK (23514)', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (ranking_entries XOR CHECK)');
  });
  it('INSERT with neither value column populated violates CHECK (23514)', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (ranking_entries XOR CHECK)');
  });
  it('INSERT with only value_numeric succeeds for ranking_senior_world', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (ranking_entries valid INSERT)');
  });
  it('INSERT with only value_classification_code succeeds for ranking_belgium', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (ranking_entries valid INSERT)');
  });

  it.todo('ranking_type.value_shape mismatch (e.g., classification for ranking_senior_world) rejected by trigger or app layer');
});
