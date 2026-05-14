/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Scope-filtered type-ahead — `calendar.filterOptions.list` must respect the
 * caller's role-scope so a trainer cannot enumerate players outside their
 * academies. Server enforces a 50-option max; the 200 ms debounce is
 * a client-side concern.
 *
 * Reference: CAL-04 (filter UI);
 *            D-50 (sparring no-op);
 *            03-PATTERNS.md analog: admin-user.test.ts (TD admin list with role-scoping);
 *            03-VALIDATION.md Wave 0 Requirements.
 *
 * RED until Wave 3 tRPC `calendar.filterOptions.list` lands.
 */
import { describe, it, expect } from 'vitest';

describe('calendar.filterOptions.list — scope-filtered type-ahead', () => {
  it.todo('trainer-as-caller for kind=player returns only own-academy players');
  it.todo('player-as-caller for kind=player returns at most themselves');
  it.todo('sparring_partner-as-caller for kind=player returns empty array');
  it.todo('TD-as-caller for kind=academy returns ALL academy lookups');
  it.todo(
    'respects 50-option max + 200ms debounce contract (debounce is client-side; server enforces limit)',
  );
});
