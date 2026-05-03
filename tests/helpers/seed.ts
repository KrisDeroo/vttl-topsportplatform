import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';

import { CURRENT_POLICY, getConsentText, recordConsent } from '@/lib/consent';
import { encrypt } from '@/server/db/helpers/encryption';
import { auditLog } from '@/server/db/schema/audit';
import { users } from '@/server/db/schema/auth';
import { academy } from '@/server/db/schema/lookups';
import { medicalEvents } from '@/server/db/schema/medical';
import {
  academyMemberships,
  parentChildLinks,
} from '@/server/db/schema/memberships';

export const ROLES = [
  'technical_director',
  'academy_manager',
  'trainer',
  'player',
  'parent',
  'sparring_partner',
  'medical_staff',
] as const;

export const RESOURCES = [
  'users',
  'consent_records',
  'medical_events',
  'audit_log',
  'parent_child_links',
] as const;

export type Role = (typeof ROLES)[number];
export type Resource = (typeof RESOURCES)[number];

/**
 * Seeded fixture handed back to the test that requested the matrix.
 *
 *  - `users[role]` — the one-and-only user_id holding that role
 *  - `victimId`    — a separate player id; used as the cross-role probe
 *                    target so the role's own player fixture does not
 *                    accidentally match `_own` predicates
 *  - `academyA`    — academy code linked to trainer + academy_manager
 *  - `academyB`    — academy code linked to victim (cross-academy
 *                    isolation case)
 */
export interface SeededRolesMatrix {
  users: Record<Role, string>;
  victimId: string;
  academyA: string;
  academyB: string;
}

/**
 * Seeds the fixture for D-11 RBAC matrix + admin-user.test.ts (MAJOR-6).
 *
 * The fixture covers the cells the matrix probes:
 *
 *   1. Two academies (A, B) — trainer + academy_manager linked to A,
 *      victim player to B, so `medical.read_assigned` queries that
 *      filter by academy return zero rows for cross-academy probes.
 *   2. Seven role users (one per `ROLES` entry), all `active=true` and
 *      `email_verified=true`, with an operational consent recorded so
 *      `requireCurrentConsent` middleware passes.
 *   3. One victim player (separate from the role's "player" fixture so
 *      cross-role probes target a stranger).
 *   4. One parent_child_link from the parent role to the victim.
 *      Belgian Art. 8 UNIQUE on `child_user_id` means there is exactly
 *      one parent-child row in the fixture.
 *   5. One medical_event for the victim. Free-text fields are encrypted
 *      via the `encrypt()` helper; the seed first sets the
 *      `app.medical_key` GUC on the connection so `pgp_sym_encrypt`
 *      resolves the key.
 *   6. One audit_log row attributing a `seed.bootstrap` action to the
 *      TD — gives the audit_log resource probe a row to read against
 *      under the `audit.read_any` permission grant.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 3
 *            tests/integration/rbac-matrix.test.ts (D-11 consumer)
 *            src/lib/consent.ts (recordConsent, CURRENT_POLICY)
 *            src/server/db/helpers/encryption.ts (pgcrypto wrapper)
 */
export async function seedRolesMatrix(
  db: ReturnType<typeof drizzle>,
): Promise<SeededRolesMatrix> {
  // pgp_sym_encrypt reads the key from `app.medical_key`; bind it on
  // this connection so encrypt() resolves correctly inside the seed.
  // `false` (is_local) — keeps the value on the connection across
  // statements within this seed, which is what we need for sequential
  // INSERTs through the same db handle.
  await db.execute(
    sql`SELECT set_config('app.medical_key', ${process.env.MEDICAL_ENCRYPTION_KEY ?? ''}, false)`,
  );

  // 1. Academies
  const [acA] = await db
    .insert(academy)
    .values({
      code: 'academy_a',
      canonicalName: 'Academy A',
      sortOrder: 10,
      active: true,
    })
    .returning();
  const [acB] = await db
    .insert(academy)
    .values({
      code: 'academy_b',
      canonicalName: 'Academy B',
      sortOrder: 20,
      active: true,
    })
    .returning();
  if (!acA || !acB) {
    throw new Error('seedRolesMatrix: academy insert returned no rows');
  }

  // 2. Seven role users. DOB 30 years ago so the generated `is_minor`
  //    column resolves to FALSE (no minor-gate fallout in tests that do
  //    not specifically target the GDPR-02 path).
  const adultDob = new Date(Date.now() - 30 * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const userIds = {} as Record<Role, string>;
  for (const role of ROLES) {
    const [u] = await db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: `seed-${role}@vttl.test`,
        name: `Seed ${role}`,
        role,
        preferredLocale: 'nl',
        dateOfBirth: adultDob,
        active: true,
        emailVerified: true,
      } as any)
      .returning();
    if (!u) {
      throw new Error(`seedRolesMatrix: user insert for ${role} returned no row`);
    }
    userIds[role] = u.id;
  }

  // 3. Victim player — a separate row so cross-role probes target a
  //    stranger and not the role's own fixture.
  const [victim] = await db
    .insert(users)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values({
      email: 'seed-victim@vttl.test',
      name: 'Seed Victim',
      role: 'player',
      preferredLocale: 'nl',
      dateOfBirth: adultDob,
      active: true,
      emailVerified: true,
    } as any)
    .returning();
  if (!victim) {
    throw new Error('seedRolesMatrix: victim insert returned no row');
  }

  // 4. Memberships: trainer + academy_manager → academy A; victim → B.
  await db
    .insert(academyMemberships)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values([
      {
        userId: userIds.trainer,
        academyCode: acA.code,
        role: 'trainer',
        linkedBy: userIds.technical_director,
      },
      {
        userId: userIds.academy_manager,
        academyCode: acA.code,
        role: 'academy_manager',
        linkedBy: userIds.technical_director,
      },
      {
        userId: victim.id,
        academyCode: acB.code,
        role: 'player',
        linkedBy: userIds.technical_director,
      },
    ] as any);

  // 5. Operational consent for every seeded user (so
  //    requireCurrentConsent passes) plus the victim.
  const operationalText = await getConsentText(
    'operational',
    CURRENT_POLICY.operational.version,
    'nl',
  );
  for (const role of ROLES) {
    await recordConsent({
      userId: userIds[role],
      category: 'operational',
      version: CURRENT_POLICY.operational.version,
      locale: 'nl',
      textShown: operationalText,
      ipAddress: '127.0.0.1',
      userAgent: 'seed',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
    });
  }
  await recordConsent({
    userId: victim.id,
    category: 'operational',
    version: CURRENT_POLICY.operational.version,
    locale: 'nl',
    textShown: operationalText,
    ipAddress: '127.0.0.1',
    userAgent: 'seed',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: db as any,
  });

  // 6. Parent → victim link. For adults the link still exists in the
  //    test fixture so RLS `pcl_visible` (Plan 04) has a row to test
  //    against. The Belgian Art. 8 UNIQUE constraint allows exactly one
  //    such row per child.
  await db
    .insert(parentChildLinks)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values({
      parentUserId: userIds.parent,
      childUserId: victim.id,
      consentGivenAt: new Date(Date.now()),
      linkedBy: userIds.technical_director,
    } as any);

  // 7. Medical event for the victim — encrypted free-text fields.
  await db
    .insert(medicalEvents)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values({
      playerUserId: victim.id,
      eventDescriptionCipher: encrypt('Seed injury — for RBAC matrix test') as unknown as string,
      doctorCipher: encrypt('Dr. Seed') as unknown as string,
      isInjury: true,
      startDate: new Date(Date.now()).toISOString().slice(0, 10),
      createdBy: userIds.medical_staff,
    } as any);

  // 8. Audit log seed row attributed to the TD.
  await db
    .insert(auditLog)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values({
      actorUserId: userIds.technical_director,
      action: 'seed.bootstrap',
      resourceType: 'fixture',
      outcome: 'success',
    } as any);

  return {
    users: userIds,
    victimId: victim.id,
    academyA: acA.code,
    academyB: acB.code,
  };
}

/** Expected outcome matrix — single source of truth for D-11.
 *  expected[role][resource] = 'allowed' | 'denied' | 'not_applicable'
 *  - allowed:  expect 200 + non-empty result
 *  - denied:   expect 403 OR 0 rows under RLS
 *  - not_applicable: skip
 */
/**
 * RBAC matrix — D-11.
 *
 * - `parent_child_links` for parent/player: ALLOWED via the consent.listMyParentLinks tRPC
 *   endpoint (Plan 12) — RLS policy `pcl_visible` (Plan 04) returns own links only.
 * - `parent_child_links` for medical_staff: DENIED in Phase 1 — medical staff treat the player
 *   directly; parent-link visibility is a separate Phase 5 grant tied to medical_documents
 *   uploaded by parents. If they need it earlier, the TD reads on their behalf.
 * - `medical_events` row is verified at the RAW SQL layer via rawPgAsAppUser (CRIT-2 — proves
 *   RLS works at the DB layer, not just the tRPC layer).
 */
export const RBAC_EXPECTATIONS: Record<
  Role,
  Record<Resource, 'allowed' | 'denied' | 'not_applicable'>
> = {
  technical_director: {
    users: 'allowed',
    consent_records: 'allowed',
    medical_events: 'allowed',
    audit_log: 'allowed',
    parent_child_links: 'allowed',
  },
  academy_manager: {
    users: 'allowed',
    consent_records: 'denied',
    medical_events: 'denied',
    audit_log: 'denied',
    parent_child_links: 'denied',
  },
  trainer: {
    users: 'allowed',
    consent_records: 'denied',
    medical_events: 'denied',
    audit_log: 'denied',
    parent_child_links: 'denied',
  },
  player: {
    users: 'allowed',
    consent_records: 'allowed',
    medical_events: 'allowed',
    audit_log: 'denied',
    parent_child_links: 'allowed',
  }, // own links via consent.listMyParentLinks
  parent: {
    users: 'allowed',
    consent_records: 'allowed',
    medical_events: 'allowed',
    audit_log: 'denied',
    parent_child_links: 'allowed',
  }, // own links via consent.listMyParentLinks
  sparring_partner: {
    users: 'allowed',
    consent_records: 'denied',
    medical_events: 'denied',
    audit_log: 'denied',
    parent_child_links: 'denied',
  },
  medical_staff: {
    users: 'allowed',
    consent_records: 'denied',
    medical_events: 'allowed',
    audit_log: 'denied',
    parent_child_links: 'denied',
  }, // Phase 1 scope; see comment above
};
