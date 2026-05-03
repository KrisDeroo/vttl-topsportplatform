/**
 * parent_child_links + canActivate end-to-end — USER-01 + GDPR-02 (Plan
 * 12 Task 3 filling the Wave-0 RED stub).
 *
 * Verifies the Belgian Art. 8 parent-consent path:
 *
 *   1. Insert parent + minor users.
 *   2. Insert a parent_child_links row honouring the UNIQUE
 *      `uniq_child_user` constraint (HIGH-5: a minor has EXACTLY one
 *      consenting parent).
 *   3. Record consent on the minor's user_id with
 *      `consenting_party_user_id = parent.id`.
 *   4. `canActivate(minor.id)` returns `{ ok: true }`.
 *
 * Two negative cases:
 *   - Two parents trying to link to the same minor → second insert
 *     fails with the UNIQUE-constraint violation.
 *   - Parent link present but no parent consent row → canActivate
 *     returns `parent_consent_missing` (the branch not exercised by
 *     `tests/integration/minor-flow.test.ts`).
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

describe('parent_child_links — USER-01 + GDPR-02', () => {
  it('parent + consent → canActivate ok for the minor', async () => {
    await using h = await freshDb();
    const [parent] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'parent-pcl@vttl.test',
        name: 'Parent PCL',
        dateOfBirth: dobYearsAgo(40),
        role: 'parent',
      } as any)
      .returning();
    const [minor] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'minor-pcl@vttl.test',
        name: 'Minor PCL',
        dateOfBirth: dobYearsAgo(13),
        role: 'player',
      } as any)
      .returning();
    if (!parent || !minor) throw new Error('seed users returned no rows');

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

    await h.db
      .insert(parentChildLinks)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        parentUserId: parent.id,
        childUserId: minor.id,
        consentGivenAt: new Date(Date.now()),
        linkedBy: parent.id,
      } as any);

    const result = await canActivate(minor.id);
    expect(result).toEqual({ ok: true });
  });

  it('HIGH-5: a second parent linking to the same minor fails the UNIQUE constraint', async () => {
    await using h = await freshDb();
    const [parent1] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'parent1-high5@vttl.test',
        name: 'Parent 1',
        dateOfBirth: dobYearsAgo(40),
        role: 'parent',
      } as any)
      .returning();
    const [parent2] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'parent2-high5@vttl.test',
        name: 'Parent 2',
        dateOfBirth: dobYearsAgo(40),
        role: 'parent',
      } as any)
      .returning();
    const [child] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'child-high5@vttl.test',
        name: 'Child HIGH-5',
        dateOfBirth: dobYearsAgo(12),
        role: 'player',
      } as any)
      .returning();
    if (!parent1 || !parent2 || !child) throw new Error('seed users returned no rows');

    await h.db
      .insert(parentChildLinks)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        parentUserId: parent1.id,
        childUserId: child.id,
        consentGivenAt: new Date(Date.now()),
        linkedBy: parent1.id,
      } as any);

    // The UNIQUE constraint `uniq_child_user` on `child_user_id` alone
    // forbids a second parent linking to the same minor.
    await expect(
      h.db
        .insert(parentChildLinks)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({
          parentUserId: parent2.id,
          childUserId: child.id,
          consentGivenAt: new Date(Date.now()),
          linkedBy: parent2.id,
        } as any),
    ).rejects.toThrow();
  });

  it('parent link present without parent consent → canActivate parent_consent_missing', async () => {
    await using h = await freshDb();
    const [parent] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'parent-no-consent@vttl.test',
        name: 'Parent NoConsent',
        dateOfBirth: dobYearsAgo(40),
        role: 'parent',
      } as any)
      .returning();
    const [minor] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'minor-no-consent@vttl.test',
        name: 'Minor NoConsent',
        dateOfBirth: dobYearsAgo(12),
        role: 'player',
      } as any)
      .returning();
    if (!parent || !minor) throw new Error('seed users returned no rows');

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
    expect(r).toEqual({ ok: false, reason: 'parent_consent_missing' });
  });
});
