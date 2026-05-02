/**
 * Belgian minor-consent activation gate — GDPR-02 (Plan 12).
 *
 * Verifies the four-state decision tree of `canActivate(userId)`:
 *
 *   1. user not found                  → not_found
 *   2. minor without parent_child_link → parent_link_missing
 *   3. adult without consent           → consent_missing
 *   4. adult WITH consent              → ok
 *   5. minor WITH parent link AND parent consent → ok
 *
 * The `parent_consent_missing` branch (minor with link but no parent
 * consent row) is exercised by `tests/integration/parent-child.test.ts`
 * because that scenario also requires the parent_child_links insert path
 * which is the parent-child plan's primary surface.
 *
 * Birthdate arithmetic uses simple millisecond math — accurate enough
 * for the platform's "is the user under 16 today" question. Edge cases
 * around the exact birthday boundary are deferred to Phase 2 (UI shows
 * "your account becomes adult tomorrow" copy) and not relevant for the
 * activation guard.
 */
import { describe, expect, it } from 'vitest';

import {
  CURRENT_POLICY,
  getConsentText,
  recordConsent,
} from '@/lib/consent';
import { canActivate } from '@/server/auth/activate';
import { users } from '@/server/db/schema/auth';
import { parentChildLinks } from '@/server/db/schema/memberships';

import { freshDb } from '../helpers/db';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const dobYearsAgo = (years: number) =>
  new Date(Date.now() - years * ONE_YEAR_MS).toISOString().slice(0, 10);

describe('GDPR-02 minor-consent activation gate', () => {
  it('returns not_found for an unknown user id', async () => {
    await using _h = await freshDb();
    const r = await canActivate('00000000-0000-0000-0000-000000000000');
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });

  it('under-16 without parent link → parent_link_missing', async () => {
    await using h = await freshDb();
    // Cast pattern follows `src/server/trpc/middleware/audit.ts` —
    // Drizzle 0.45 inference flags `defaultNow` columns as required.
    const [u] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'minor@vttl.test',
        name: 'Minor User',
        // 14 years old — well under the BE-16 threshold.
        dateOfBirth: dobYearsAgo(14),
      } as any)
      .returning();
    if (!u) throw new Error('seed user insert returned no row');
    const r = await canActivate(u.id);
    expect(r).toEqual({ ok: false, reason: 'parent_link_missing' });
  });

  it('adult without operational consent → consent_missing', async () => {
    await using h = await freshDb();
    const [u] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'adult-noconsent@vttl.test',
        name: 'Adult NoConsent',
        dateOfBirth: dobYearsAgo(30),
      } as any)
      .returning();
    if (!u) throw new Error('seed user insert returned no row');
    const r = await canActivate(u.id);
    expect(r).toEqual({ ok: false, reason: 'consent_missing' });
  });

  it('adult with active operational consent → ok', async () => {
    await using h = await freshDb();
    const [u] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'adult-ok@vttl.test',
        name: 'Adult OK',
        dateOfBirth: dobYearsAgo(30),
      } as any)
      .returning();
    if (!u) throw new Error('seed user insert returned no row');
    const text = await getConsentText(
      'operational',
      CURRENT_POLICY.operational.version,
      'nl',
    );
    await recordConsent({
      userId: u.id,
      category: 'operational',
      version: CURRENT_POLICY.operational.version,
      locale: 'nl',
      textShown: text,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: h.db as any,
    });
    const r = await canActivate(u.id);
    expect(r).toEqual({ ok: true });
  });

  it('minor with parent link AND parent consent → ok', async () => {
    await using h = await freshDb();
    // Seed parent + child users in one batch so the FK from
    // parent_child_links resolves regardless of insert ordering.
    const [parent] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'parent-of-minor@vttl.test',
        name: 'Consenting Parent',
        dateOfBirth: dobYearsAgo(40),
      } as any)
      .returning();
    const [minor] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'consented-minor@vttl.test',
        name: 'Consented Minor',
        dateOfBirth: dobYearsAgo(13),
      } as any)
      .returning();
    if (!parent || !minor) throw new Error('seed users returned no rows');

    // The parent has consented for the minor under Belgian Art. 8;
    // `consentingPartyUserId = parent.id` is the legally-binding marker.
    const text = await getConsentText(
      'operational',
      CURRENT_POLICY.operational.version,
      'nl',
    );
    await recordConsent({
      userId: minor.id,
      category: 'operational',
      version: CURRENT_POLICY.operational.version,
      locale: 'nl',
      textShown: text,
      consentingPartyUserId: parent.id,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: h.db as any,
    });

    // Then the parent_child_link is established (the link's
    // `consent_given_at` duplicates the timestamp for fast RLS predicates;
    // the consent_records row is the legal source of truth).
    await h.db
      .insert(parentChildLinks)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        parentUserId: parent.id,
        childUserId: minor.id,
        consentGivenAt: new Date(Date.now()),
        linkedBy: parent.id,
      } as any);

    const r = await canActivate(minor.id);
    expect(r).toEqual({ ok: true });
  });
});
