/**
 * `canActivate(userId)` — Belgian minor-consent activation gate (Plan 12).
 *
 * Phase 1 succescriterium #5: "under-16 cannot activate without parental
 * consent". This file is the deterministic predicate the TD admin UI
 * (Plan 15 `admin.user.activate`) MUST call before flipping
 * `users.active = true`.
 *
 * Decision tree (mirrors RESEARCH.md §Belgian minor-consent enforcement,
 * lines 1786-1810):
 *
 *   1. User row exists?               No  → { ok: false, reason: 'not_found' }
 *   2. `users.is_minor === true`?
 *      a. parent_child_links row?     No  → { ok: false, reason: 'parent_link_missing' }
 *      b. parent has consent at
 *         CURRENT_POLICY.operational
 *         on the minor's user_id?     No  → { ok: false, reason: 'parent_consent_missing' }
 *   3. The user themselves have an
 *      active operational consent at
 *      CURRENT_POLICY.operational?    No  → { ok: false, reason: 'consent_missing' }
 *   4. All checks pass               Yes  → { ok: true }
 *
 * Why the user always needs an own row (even if they're a minor): the
 * `users.id` row in `consent_records` is what the consent ledger stores;
 * the `consenting_party_user_id` distinguishes "the user clicked agree"
 * (adult, self-consent) from "the parent clicked agree on behalf"
 * (minor). Both rows have the SAME `user_id` (the minor's id) — Belgian
 * GDPR Art. 8 requires the consent to be held on the data-subject's row,
 * not on the parent's. So even for a minor we only check ONE row, but
 * the row's `consenting_party_user_id` must equal the linked parent's id.
 *
 * Why this is server-only: it issues a DB read against `users` +
 * `parent_child_links` + `consent_records` and uses `CURRENT_POLICY`
 * (which is itself a server-only constant module). Importing this file
 * into a client component will fail at build time because `db` is server
 * code.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md
 *            §Belgian minor-consent enforcement (lines 1761-1810);
 *            .planning/phases/01-fundament/01-CONTEXT.md (D-04..07);
 *            src/lib/consent.ts (CURRENT_POLICY).
 */
import { and, eq, isNull } from 'drizzle-orm';

import { CURRENT_POLICY, isMinorAt } from '@/lib/consent';
import { db } from '@/server/db/client';
import { users } from '@/server/db/schema/auth';
import { consentRecords } from '@/server/db/schema/consent';
import { parentChildLinks } from '@/server/db/schema/memberships';

/**
 * Discriminated outcome — either `{ ok: true }` (activate is safe) or
 * `{ ok: false, reason }` with one of four canonical reasons. Callers
 * (Plan 15 admin UI) translate the reason into a user-facing message
 * via the i18n catalog.
 */
export interface ActivationResult {
  ok: boolean;
  reason?:
    | 'not_found'
    | 'parent_link_missing'
    | 'parent_consent_missing'
    | 'consent_missing';
}

/**
 * Runs the four-step decision tree above and returns the outcome.
 *
 * No mutations — `canActivate` is a pure predicate. Mutating `users.active`
 * is the caller's responsibility (the TD admin UI in Plan 15) so this
 * function can be safely invoked from the consent-bumping background job
 * (Plan 10) to compute "is this minor now eligible because the parent
 * just consented?" without side effects.
 */
export async function canActivate(userId: string): Promise<ActivationResult> {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) return { ok: false, reason: 'not_found' };

  // CR-01 fix: the prior implementation read `u.is_minor` from a STORED
  // generated column on `users` whose expression referenced
  // `CURRENT_DATE`. Postgres rejects non-IMMUTABLE expressions in STORED
  // generated columns, so the migration could never apply. We now compute
  // the flag in application code via `isMinorAt(dateOfBirth, now)` —
  // UTC-anchored at day granularity, deterministic across the 16th
  // birthday boundary, and produces the same `boolean | null` tri-state
  // the rest of the code below expects (NULL when DOB is missing →
  // adult-treatment for activation purposes).
  const isMinor = isMinorAt(u.dateOfBirth, new Date());

  if (isMinor === true) {
    const link = await db.query.parentChildLinks.findFirst({
      where: eq(parentChildLinks.childUserId, userId),
    });
    if (!link) return { ok: false, reason: 'parent_link_missing' };

    // Belgian Art. 8: the parent must consent ON the minor's row. We
    // assert the SAME row has `user_id = minor.id` AND
    // `consenting_party_user_id = parent.id` — single SELECT, no JOIN.
    const parentConsent = await db.query.consentRecords.findFirst({
      where: and(
        eq(consentRecords.userId, userId),
        eq(consentRecords.consentingPartyUserId, link.parentUserId),
        eq(consentRecords.consentCategory, 'operational'),
        eq(
          consentRecords.policyVersion,
          CURRENT_POLICY.operational.version,
        ),
        isNull(consentRecords.withdrawnAt),
      ),
    });
    if (!parentConsent) {
      return { ok: false, reason: 'parent_consent_missing' };
    }
    // For a minor the parent-consent row IS the activation consent. We
    // do not additionally require a self-consent row from the minor —
    // they cannot legally provide it under Belgian Art. 8 until their
    // 16th birthday. Plan 15 will trigger a self-consent flow at that
    // point (out of Phase 1 scope).
    return { ok: true };
  }

  // Adult / DOB-unknown user: must have own active operational consent.
  // Phase 1 treats `is_minor IS NULL` as "not a minor for activation" —
  // a TD/staff user with no DOB on file is assumed adult.
  const ownConsent = await db.query.consentRecords.findFirst({
    where: and(
      eq(consentRecords.userId, userId),
      eq(consentRecords.consentCategory, 'operational'),
      eq(consentRecords.policyVersion, CURRENT_POLICY.operational.version),
      isNull(consentRecords.withdrawnAt),
    ),
  });
  if (!ownConsent) return { ok: false, reason: 'consent_missing' };

  return { ok: true };
}
