/**
 * Integration test: DOM-CAT-02 Brussels-anchored snapshot (CR-09).
 *
 * Probes:
 *   - Tournament starting 2026-01-01 02:00 Brussels (= 2025-12-31 23:00 UTC).
 *     getAgeCategoryAt MUST return the 2026 age category, NOT 2025.
 *     Player has an age_category_history transition on 2026-01-01.
 *   - Tournament starting 2025-12-31 14:00 Brussels (well within 2025).
 *     getAgeCategoryAt returns the 2025 age category.
 *   - Summer evening 2026-06-15 22:30 CEST — both UTC slice and Brussels
 *     slice agree on '2026-06-15', so no drift, sanity-check.
 *   - CR-09 regression block: documents the OLD vs NEW behaviour at the
 *     day boundary.
 *
 * Codes: uses `age_junior` (2025) and `age_senior` (2026). Both are seeded
 * by drizzle/0008_phase2_lookup_seed.sql (codes have NULL boundaries
 * pending TD confirmation; the test doesn't care about deriveAgeCategory —
 * it plants explicit history rows and probes getAgeCategoryAt).
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md gaps[8]
 *            .planning/phases/04-kerndomein/04-REVIEW.md CR-09
 *            tests/integration/age-category-snapshot.test.ts (precedent;
 *              uses age_cadet/age_junior/age_senior history fixtures).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getAgeCategoryAt } from '@/lib/players';
import { db as rawDb } from '@/server/db/client';

import {
  seedPhase4,
  type Phase4SeededFixtures,
} from '../fixtures/phase4-seed';
import { canConnect, freshDb } from './_helpers';

const dbReady = await canConnect();
const d = describe.skipIf(!dbReady);

d('DOM-CAT-02 Brussels-anchored snapshot (CR-09)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let fixtures: Phase4SeededFixtures | undefined;

  beforeAll(async () => {
    dbHandle = await freshDb();
    fixtures = await seedPhase4(dbHandle.db, {});

    // Plant a `players` row explicitly (with every NOT NULL column) so
    // age_category_history's FK to players.user_id resolves. This mirrors
    // tests/integration/age-category-snapshot.test.ts:94 — the calendar
    // fixture's 5-column INSERT is missing several NOT NULL fields.
    await dbHandle.db.execute(sql`
      INSERT INTO players (
        user_id, first_name, last_name, date_of_birth, gender,
        street, postal_code, city, province, country,
        status_code, academy_code, age_category, category_year,
        is_minor
      )
      VALUES (
        ${fixtures.users.player}::uuid, 'Phase4', 'CR09Probe',
        '2007-06-15', 'male',
        'Test St', '2000', 'Antwerpen', 'Antwerpen', 'BE',
        'status_a', ${fixtures.academyA},
        'age_senior', 2026, false
      )
      ON CONFLICT (user_id) DO NOTHING
    `);

    // Plant a deterministic age_category_history transition on 2026-01-01.
    // Pre-2026: 'age_junior'. From 2026-01-01 onwards: 'age_senior'.
    // (Codes are seeded by drizzle/0008_phase2_lookup_seed.sql.)
    //
    // Plan 04-16 instruction: route fixture writes through the rawDb
    // singleton so reads and writes share the same connection pool the
    // getAgeCategoryAt helper uses; getAgeCategoryAt defaults to `db` from
    // @/server/db/client.
    await rawDb.execute(sql`
      DELETE FROM age_category_history WHERE player_id = ${fixtures.users.player}::uuid
    `);
    await rawDb.execute(sql`
      INSERT INTO age_category_history
        (player_id, age_category_code, category_year, effective_from, effective_to)
      VALUES
        (${fixtures.users.player}::uuid, 'age_junior', 2025, '2025-01-01'::date, '2025-12-31'::date),
        (${fixtures.users.player}::uuid, 'age_senior', 2026, '2026-01-01'::date, NULL)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('evening tournament 2026-01-01 02:00 Brussels (= 2025-12-31 23:00 UTC) snapshots 2026 age_senior', async () => {
    if (!fixtures) return;
    // 2026-01-01 00:30 Brussels CET = 2025-12-31 23:30 UTC.
    // Document the pre-fix bug: .toISOString().slice(0,10) returns the UTC day.
    const eveningInstant = new Date('2025-12-31T23:30:00Z');
    expect(eveningInstant.toISOString().slice(0, 10)).toBe('2025-12-31');

    // After Plan 04-16 Task 1, getAgeCategoryAt uses formatOccurrenceDate
    // (Brussels). The Brussels day for 2025-12-31T23:30Z is 2026-01-01 →
    // age_senior (the 2026 row).
    const result = await getAgeCategoryAt(fixtures.users.player, eveningInstant);
    expect(result).not.toBeNull();
    expect(result?.code).toBe('age_senior');
    expect(result?.year).toBe(2026);
  });

  it('afternoon tournament 2025-12-31 14:00 Brussels stays in 2025 age_junior', async () => {
    if (!fixtures) return;
    // CET = UTC+1 → 14:00 Brussels CET = 13:00 UTC. Within 2025 calendar.
    const afternoonInstant = new Date('2025-12-31T13:00:00Z');
    const result = await getAgeCategoryAt(
      fixtures.users.player,
      afternoonInstant,
    );
    expect(result).not.toBeNull();
    expect(result?.code).toBe('age_junior');
    expect(result?.year).toBe(2025);
  });

  it('summer evening tournament 2026-06-15 22:30 Brussels CEST stays in 2026 age_senior', async () => {
    if (!fixtures) return;
    // CEST = UTC+2 → 2026-06-15 22:30 Brussels = 2026-06-15 20:30 UTC.
    // UTC slice = '2026-06-15', Brussels slice = '2026-06-15' — same day.
    // The CR-09 drift only fires at the day boundary. This case asserts
    // no false-positive — within a calendar day, getAgeCategoryAt gives
    // the consistent 2026 row.
    const summerEvening = new Date('2026-06-15T20:30:00Z');
    const result = await getAgeCategoryAt(
      fixtures.users.player,
      summerEvening,
    );
    expect(result).not.toBeNull();
    expect(result?.code).toBe('age_senior');
    expect(result?.year).toBe(2026);
  });

  it('CR-09 regression: a UTC-slice-based comparison would have returned age_junior for the evening case', async () => {
    if (!fixtures) return;
    // Reproduce the pre-fix bug to document the regression:
    // The OLD code did: dateIso = new Date('2025-12-31T23:00:00Z').toISOString().slice(0,10) = '2025-12-31'
    // → query age_category_history where effective_from <= '2025-12-31' AND
    //   (effective_to IS NULL OR effective_to >= '2025-12-31')
    // → matches the 2025 row → age_junior.
    //
    // The NEW code (post-Task-1) uses formatOccurrenceDate (Brussels):
    // → '2026-01-01' → matches the 2026 row → age_senior.
    //
    // This test asserts the FIX is in place (the new behaviour). If a
    // future revert restores the UTC slice, this assertion fails.
    const drift = new Date('2025-12-31T23:00:00Z'); // = 2026-01-01 00:00 Brussels CET
    const result = await getAgeCategoryAt(fixtures.users.player, drift);
    expect(result?.code).toBe('age_senior'); // FIXED — would have been age_junior pre-fix
    expect(result?.year).toBe(2026);
  });
});
