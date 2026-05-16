/**
 * Phase 4 Wave 0 — RED test stub for ranking-entry split-column XOR (D-86).
 *
 * Covers RANK-01 AMENDED: `ranking_entries` uses split-column schema
 * (value_numeric + value_classification_code) with a CHECK constraint
 * enforcing exactly one of the two columns is populated. The Zod schema
 * `rankingAddEntryInput` mirrors this via discriminated union on
 * `value.kind` ('numeric' | 'classification').
 *
 * Analog: tests/unit/calendar-schemas.test.ts (eventCreateInput
 *         discriminated union safeParse assertions).
 *
 * RED: this test is intentionally failing until Plan 04-05 ships
 * `rankingAddEntryInput` in `src/server/trpc/schemas/ranking.ts`.
 */
import { describe, it, expect } from 'vitest';

describe('rankingAddEntryInput — split-column XOR (D-86)', () => {
  it('exposes rankingAddEntryInput Zod schema from @/server/trpc/schemas/ranking', async () => {
    // Runtime-built path: TS can't statically resolve a module that hasn't shipped.
    const modulePath = ['@', '/server/trpc/schemas/ranking'].join('');
    let rankingAddEntryInput: unknown;
    try {
      const mod = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
      rankingAddEntryInput = mod.rankingAddEntryInput;
    } catch {
      rankingAddEntryInput = undefined;
    }
    expect(
      rankingAddEntryInput,
      'rankingAddEntryInput must be exported from @/server/trpc/schemas/ranking (Plan 04-05)',
    ).toBeDefined();
  });

  it.todo('safeParse accepts {kind: "numeric", value: 12} for an international ranking type');
  it.todo('safeParse accepts {kind: "classification", code: "A12"} for ranking_belgium');
  it.todo('safeParse rejects when both value and code provided (discriminated-union mismatch)');
  it.todo('safeParse rejects when neither value nor code provided');
  it.todo('DB CHECK constraint rejects INSERT with both value_numeric AND value_classification_code populated');
});
