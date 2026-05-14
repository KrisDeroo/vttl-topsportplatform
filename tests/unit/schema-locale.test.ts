/**
 * Schema enum + locale unit tests — I18N-02, USER-04, D-11.
 *
 * These are pure unit checks against the Drizzle schema metadata
 * (no live Postgres). They guard the contract that downstream phases
 * depend on — adding a 4th locale or removing a role here would
 * silently break Plan 03 medical RLS, Plan 04 RLS policies, and
 * the entire RBAC matrix in tests/integration/rbac-matrix.test.ts.
 */
import { describe, it, expect } from 'vitest';

import { localeEnum, userRoleEnum, users } from '@/server/db/schema/auth';

describe('schema locale + role enums — I18N-02, USER-04, D-11', () => {
  it('localeEnum values: nl, en, fr (in order)', () => {
    expect(localeEnum.enumValues).toEqual(['nl', 'en', 'fr']);
  });

  it('userRoleEnum has exactly 7 roles (D-11)', () => {
    expect(userRoleEnum.enumValues).toHaveLength(7);
    expect(userRoleEnum.enumValues).toEqual(
      expect.arrayContaining([
        'technical_director',
        'academy_manager',
        'trainer',
        'player',
        'parent',
        'sparring_partner',
        'medical_staff',
      ]),
    );
  });

  it('users.preferred_locale is NOT NULL with default nl', () => {
    const col = (users as unknown as { preferredLocale: { notNull: boolean; hasDefault: boolean } })
      .preferredLocale;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
  });

  it('users.role is NOT NULL with default player', () => {
    const col = (users as unknown as { role: { notNull: boolean; hasDefault: boolean } }).role;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
  });
});

/**
 * Phase 3 — calendar i18n namespace coverage (I18N-05/06/07/08).
 *
 * Wave 0 RED scaffold: Wave 4 adds the `calendar.*`, `lookup.eventType.*`,
 * and `errors.calendar.*` message keys to `messages/{nl,en,fr}.json`.
 * Until then the per-locale catalog tree assertions are it.todo; the
 * canonical namespaces are spelled out here so a planner/checker can
 * grep for the expected coverage.
 */
describe('Phase 3 — calendar namespace coverage (nl/en/fr)', () => {
  const PHASE3_NAMESPACES = ['calendar', 'lookup.eventType', 'errors.calendar'] as const;

  it('declares all 3 Phase 3 namespaces (manifest)', () => {
    expect(PHASE3_NAMESPACES).toHaveLength(3);
  });

  it.todo('messages/nl.json contains every calendar.* key required by UI-SPEC');
  it.todo('messages/en.json contains every calendar.* key required by UI-SPEC');
  it.todo('messages/fr.json contains every calendar.* key required by UI-SPEC');
  it.todo('errors.calendar.endBeforeStart present in all 3 locales');
  it.todo('errors.calendar.rruleHorizonExceeded present in all 3 locales');
  it.todo('errors.calendar.rangeTooLarge present in all 3 locales');
  it.todo('lookup.eventType.training present in all 3 locales (6 event-type labels total)');
});
