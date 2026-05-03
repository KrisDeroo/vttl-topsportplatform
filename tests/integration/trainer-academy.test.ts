/**
 * academy_memberships contract — USER-02 (Plan 12 Task 3 filling the
 * Wave-0 RED stub).
 *
 * Verifies the trainer-to-academy link primitive: a trainer can be
 * linked to one or more academies via `academy_memberships`. Composite
 * primary key on `(user_id, academy_code, role)` lets the same user
 * hold multiple roles per academy (e.g. trainer + player elsewhere).
 *
 * The lookup table `academy` is seeded by Plan 02's lookup-codes seed
 * (RESEARCH §Lookup tables). For test isolation we insert an academy
 * row directly — the RLS lookup_codes test already exercises seeded
 * data; this test focuses on the membership FK behaviour.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { users } from '@/server/db/schema/auth';
import { academy } from '@/server/db/schema/lookups';
import { academyMemberships } from '@/server/db/schema/memberships';

import { freshDb } from '../helpers/db';

describe('academy_memberships — USER-02', () => {
  it('a trainer linked to two academies has two membership rows', async () => {
    await using h = await freshDb();

    // Seed two academies. The lookup table is the canonical source of
    // truth; D-19 keeps the codes language-neutral and the labels in
    // the i18n catalogs.
    await h.db
      .insert(academy)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values([
        {
          code: 'academy_antwerpen',
          canonicalName: 'Academy Antwerpen',
          sortOrder: 1,
        },
        {
          code: 'topsportschool',
          canonicalName: 'Topsportschool',
          sortOrder: 2,
        },
      ] as any);

    const [td] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'td-academy@vttl.test',
        name: 'TD Academy',
        role: 'technical_director',
      } as any)
      .returning();
    const [trainer] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'trainer-academy@vttl.test',
        name: 'Trainer Academy',
        role: 'trainer',
      } as any)
      .returning();
    if (!td || !trainer) throw new Error('seed users returned no rows');

    // Two memberships, same trainer, two academies.
    await h.db
      .insert(academyMemberships)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values([
        {
          userId: trainer.id,
          academyCode: 'academy_antwerpen',
          role: 'trainer',
          linkedBy: td.id,
        },
        {
          userId: trainer.id,
          academyCode: 'topsportschool',
          role: 'trainer',
          linkedBy: td.id,
        },
      ] as any);

    const memberships = await h.db
      .select()
      .from(academyMemberships)
      .where(eq(academyMemberships.userId, trainer.id));
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.academyCode).sort()).toEqual([
      'academy_antwerpen',
      'topsportschool',
    ]);
    // Composite PK includes role, so a single trainer can later add a
    // 'player' membership at the same academy without breaking PK.
    expect(memberships.every((m) => m.role === 'trainer')).toBe(true);
  });

  it('FK: inserting a membership for an unknown academy_code fails', async () => {
    await using h = await freshDb();
    const [trainer] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'trainer-fk@vttl.test',
        name: 'Trainer FK',
        role: 'trainer',
      } as any)
      .returning();
    if (!trainer) throw new Error('seed user returned no rows');

    await expect(
      h.db
        .insert(academyMemberships)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({
          userId: trainer.id,
          academyCode: 'nonexistent_academy',
          role: 'trainer',
        } as any),
    ).rejects.toThrow();
  });
});
