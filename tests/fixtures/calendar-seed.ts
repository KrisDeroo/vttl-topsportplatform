/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Shared seed helper for calendar tests. Analog: `tests/helpers/seed.ts`
 * `seedRolesMatrix`.
 *
 * Reference: 03-RESEARCH.md §Pattern 2 (polymorphic event seed);
 *            03-PATTERNS.md §calendar-seed.ts (analog: helpers/seed.ts);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * The helper throws today by design — Wave 5 implements the canonical INSERT
 * statements once Wave 2 has shipped the schema. Wave 1+ tests that import
 * this helper therefore fail loudly rather than silently green, satisfying
 * T-03-03-TEST-FALSE-POSITIVE mitigation.
 */
import type { drizzle } from 'drizzle-orm/postgres-js';

export interface SeededCalendarFixtures {
  /**
   * Keyed by event-shape code so consumer tests can look up the event id
   * they need without holding the full insert order in their head. Keys:
   *
   *   - training, tournament, meeting, stage, eval_conversation, medical
   *     (one of each type, TD as creator)
   *   - training_recurring (one weekly recurring training within +2y horizon)
   *   - training_recurring_with_exception (recurring + a cancelled
   *     occurrence row)
   *   - overlapping_pair_a, overlapping_pair_b (two events with the same
   *     participant on overlapping windows for conflict tests)
   */
  eventIds: Record<string, string>;
  /** Per-event participant id arrays (in seeding order). */
  participantsByEvent: Record<string, string[]>;
}

/**
 * Seed canonical calendar fixtures on top of `seedRolesMatrix` output.
 *
 * MUST be called AFTER `seedRolesMatrix` so the user ids exist.
 *
 * Wave 5 implements:
 *   1. one event per type (TD-created, participants per role coverage),
 *   2. one weekly recurring training within the 2y horizon,
 *   3. one cancelled exception against the recurring training,
 *   4. one overlapping pair (same participant, ±30min start delta) for
 *      conflict detection tests.
 */
export async function seedCalendarFixtures(
  _db: ReturnType<typeof drizzle>,
  _seededUsers: {
    technical_director: string;
    trainer: string;
    player: string;
    academy_manager: string;
    parent: string;
    sparring_partner: string;
    medical_staff: string;
  },
): Promise<SeededCalendarFixtures> {
  // TODO Wave 5: implement INSERT statements per RESEARCH §Pattern 2 +
  // 03-PATTERNS.md §calendar-seed.ts. The throw is intentional —
  // T-03-03-TEST-FALSE-POSITIVE: this helper must not silently green.
  throw new Error(
    'seedCalendarFixtures: Wave 1+ schema must land before implementation. ' +
      'This RED stub belongs to Phase 3 Wave 0 (03-01-PLAN.md Task 2).',
  );
}
