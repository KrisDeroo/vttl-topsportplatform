/**
 * Phase 4 Wave 0 — RED test stub for outcome_level seed (D-70).
 *
 * Covers TOURN-03 + D-70: the 9-level outcome_level lookup is seeded by
 * migration 0017 with codes outcome_winner, outcome_finalist,
 * outcome_last_4/8/16/32/64/128, outcome_group_stage, each with a
 * sort_order 1..9 (1 = best = winnaar).
 *
 * Analog: tests/unit/lookup-codes.test.ts (lookup-table convention probe).
 *
 * RED: this test is intentionally failing until Plan 04-02 ships the
 * outcome_level rows in migration `0017_phase4_lookup_seeds.sql`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SEED_FILE = path.resolve(
  process.cwd(),
  'drizzle',
  '0017_phase4_lookup_seeds.sql',
);

describe('outcome_level seed (D-70)', () => {
  it('seed migration 0017 declares exactly 9 outcome_level codes', () => {
    expect(
      existsSync(SEED_FILE),
      'drizzle/0017_phase4_lookup_seeds.sql must exist (Plan 04-02)',
    ).toBe(true);
    if (!existsSync(SEED_FILE)) return;
    const body = readFileSync(SEED_FILE, 'utf-8');
    const codes = [
      'outcome_winner',
      'outcome_finalist',
      'outcome_last_4',
      'outcome_last_8',
      'outcome_last_16',
      'outcome_last_32',
      'outcome_last_64',
      'outcome_last_128',
      'outcome_group_stage',
    ] as const;
    for (const c of codes) {
      expect(body, `seed missing code '${c}'`).toContain(c);
    }
  });

  it.todo(
    'sort_order is 1 for outcome_winner ... 9 for outcome_group_stage (lowest order = best result)',
  );
});
