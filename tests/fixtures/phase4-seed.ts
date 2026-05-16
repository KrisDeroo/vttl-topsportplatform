/**
 * tests/fixtures/phase4-seed.ts — Phase 4 test fixture seeder.
 *
 * Extends `tests/fixtures/calendar-seed.ts` (Phase 3) with the operational
 * tables Phase 4 ships:
 *   - session_participants (PK: event_id, occurrence_date, user_id)
 *   - session_sparring_partners (event_id, sparring_partner_id)
 *   - tournament_results (PK: tournament_event_id, player_user_id)
 *   - match_results
 *   - ranking_entries (XOR value_numeric vs value_classification_code)
 *   - belgium_classification lookup rows (subset)
 *
 * Also adds a `sparring_partner` test user (filling the placeholder in the
 * Phase 3 RLS UNION branch for CAL-04).
 *
 * Phase 0 RED scaffold: this file imports types/schemas that ship in
 * Plan 04-02 (Wave 1). Until then, the seeder is a thin stub that delegates
 * to `seedRolesMatrix` (Phase 1) and returns the role-fixture matrix as-is.
 * Wave 2 will extend the body with the schema-aware inserts.
 *
 * Each future insert will be idempotent (`ON CONFLICT DO NOTHING`) so the
 * seeder can be re-called within a single test run without duplicate-key
 * errors. Mirrors `seedCalendarFixtures` (Phase 3 — Plan 03-08).
 *
 * Reference: 04-CONTEXT.md §A..D · 04-PATTERNS.md §"Test files" · 04-VALIDATION.md
 *            §Wave 0 Requirements.
 */
import type { drizzle } from 'drizzle-orm/postgres-js';

import { seedRolesMatrix, type SeededRolesMatrix } from '../helpers/seed';

export interface Phase4SeedOptions {
  /** Plant a sparring_partner user + a session_sparring_partners row.
   *  Wave 2 wires this up; Wave 0 it's a no-op flag. */
  includeSparring?: boolean;
  /** Plant the `belgium_classification` lookup rows (A1..A50, B0..B6, etc.).
   *  Wave 2 ships the lookup table; Wave 0 the seeder ignores this flag. */
  includeBelgiumClassifications?: boolean;
  /** Plant the `outcome_level` lookup rows (9 entries).
   *  Wave 2 ships the seed migration 0017; Wave 0 ignores this flag. */
  includeOutcomeLevels?: boolean;
}

export interface Phase4SeededFixtures extends SeededRolesMatrix {
  /** Pre-existing role-fixture map carried over from `seedRolesMatrix`.
   *  Phase 4 inserts will hang additional ids on this struct in Wave 2. */
  phase4Ready: boolean;
}

/**
 * Seed Phase 4 fixtures on top of `seedRolesMatrix`.
 *
 * MUST be called AFTER `seedRolesMatrix` so the user ids exist. The
 * function is idempotent — repeated calls return the same shape and use
 * `ON CONFLICT DO NOTHING` for the per-table inserts that ship in Wave 2.
 *
 * RLS-bypass: like every fixture seeder in this repo, inserts use the
 * schema-owner client. Production code paths never import this module
 * (T-04-FIXTURE-LEAK is mitigated the same way Phase 3 mitigated it).
 *
 * Wave 0 scaffold: the body is intentionally minimal. The signature is
 * stable so Wave 0 RED tests can import `seedPhase4` and `Phase4SeededFixtures`
 * without typecheck failures. Wave 2 plans 04-02..04-07 extend the body
 * to plant session_participants / tournament_results / ranking_entries
 * rows etc.
 */
export async function seedPhase4(
  db: ReturnType<typeof drizzle>,
  // Acknowledged Phase4SeedOptions reserved for Wave 2 extensions — typed
  // here so the call site is stable.
  _opts: Phase4SeedOptions = {},
): Promise<Phase4SeededFixtures> {
  // Phase 1 fixtures: roles (7 users), academies (A + B), parent-child
  // links. These are the only prerequisites Wave 0 RED tests can rely on.
  const matrix = await seedRolesMatrix(db);

  // TODO(04-02): once the schemas land, INSERT the Phase 4 fixture rows
  // here using `db.execute(sql\`INSERT … ON CONFLICT DO NOTHING\`)` to
  // mirror `seedCalendarFixtures` shape (Phase 3, Plan 03-08).

  return {
    ...matrix,
    phase4Ready: true,
  };
}
