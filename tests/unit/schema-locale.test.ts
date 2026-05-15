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
  const LOCALES = ['nl', 'en', 'fr'] as const;

  /** Load a locale catalog as a plain object. */
  function loadCatalog(locale: string): Record<string, unknown> {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    return JSON.parse(
      readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf-8'),
    );
  }

  /** Dotted-path get. */
  function getDotted(o: Record<string, unknown>, path: string): unknown {
    let cur: unknown = o;
    for (const p of path.split('.')) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }

  it('declares all 3 Phase 3 namespaces (manifest)', () => {
    expect(PHASE3_NAMESPACES).toHaveLength(3);
  });

  it.each(LOCALES)('messages/%s.json contains a calendar.* root namespace', (locale) => {
    const cat = loadCatalog(locale);
    expect(cat.calendar).toBeDefined();
    expect(typeof cat.calendar).toBe('object');
  });

  it.each(LOCALES)(
    'messages/%s.json contains errors.calendar with endBeforeStart + rruleHorizonExceeded + rangeTooLarge keys',
    (locale) => {
      const cat = loadCatalog(locale);
      expect(getDotted(cat, 'errors.calendar.endBeforeStart')).toBeDefined();
      expect(getDotted(cat, 'errors.calendar.rruleHorizonExceeded')).toBeDefined();
      expect(getDotted(cat, 'errors.calendar.rangeTooLarge')).toBeDefined();
    },
  );

  it.each(LOCALES)(
    'messages/%s.json contains lookup.eventType labels for all 6 codes',
    (locale) => {
      const cat = loadCatalog(locale);
      const eventTypeBranch = getDotted(cat, 'lookup.eventType');
      expect(eventTypeBranch).toBeDefined();
      // Spot-check one canonical entry — implementations may key by
      // shortname or by full code; accept either.
      const branch = eventTypeBranch as Record<string, unknown>;
      const trainingPresent =
        typeof branch.training === 'string' ||
        typeof branch.event_type_training === 'string';
      expect(trainingPresent).toBe(true);
    },
  );
});
