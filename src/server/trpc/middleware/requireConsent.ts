/**
 * `requireCurrentConsent` — middleware that blocks every protected procedure
 * until the caller has an active `consent_records` row at the current
 * operational policy version (D-07: re_consent_required).
 *
 * Logic:
 *   - Anonymous (`scope === null`): no-op. The `requireAuth` gate sits before
 *     this middleware in the protected chain so anonymous calls never reach
 *     this code in practice; the guard is here for composition safety.
 *   - Authenticated: query `consent_records` for at least one non-withdrawn
 *     row matching `(user_id, category='operational', policy_version=current)`.
 *     If absent, throw FORBIDDEN with message `re_consent_required` so the
 *     client can surface the re-consent banner (Plan 12 component).
 *
 * The DB read uses `ctx.db ?? rawDb` so it benefits from the `withRlsContext`
 * transaction when present (Plan 04 RLS — consent_records.read_own ensures
 * users can see their OWN consent rows).
 *
 * Why the SQL is a NOT EXISTS over a VALUES synthetic table: Plan 12 will
 * widen the policy_version check to multi-category (operational +
 * medical_processing + photo_video). The VALUES form is the natural shape for
 * that — adding categories means appending tuples. For Phase 1 we only block
 * on 'operational' since the other categories are optional / role-specific.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §requireCurrentConsent (lines 1812–1844)
 *            .planning/phases/01-fundament/01-CONTEXT.md §B (D-07)
 */
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';

import { CURRENT_POLICY } from '@/lib/consent';
import { db as rawDb, type DbClient } from '@/server/db/client';

import { middleware } from '../trpc';

export const requireCurrentConsent = middleware(async ({ ctx, next }) => {
  if (!ctx.scope) return next();

  const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

  // Returns one row when the user is missing a current 'operational' consent,
  // zero rows when they have one. Plan 12 may widen this to multi-category.
  const stale = await dbHandle.execute(
    sql`
      SELECT 1 AS missing
        FROM (VALUES ('operational')) cats(cat)
       WHERE NOT EXISTS (
         SELECT 1 FROM consent_records cr
          WHERE cr.user_id = ${ctx.scope.userId}
            AND cr.consent_category = cats.cat
            AND cr.policy_version = ${CURRENT_POLICY.operational.version}
            AND cr.withdrawn_at IS NULL
       )
       LIMIT 1
    `,
  );

  // WR-01 fix (2026-05-01): fail closed, not open. The previous
  // implementation coerced any non-array shape to `[]` and then took
  // the "no missing categories" branch — silently SKIPPING the consent
  // gate for any caller whose `db.execute` happened to return a
  // non-array (a postgres-js wrapper change, a transaction-handle
  // quirk, or an unexpected error envelope). The gate is the
  // platform-wide D-07 re-consent enforcement; surfacing an
  // INTERNAL_SERVER_ERROR here is the only correct response — the
  // caller's tRPC handler must not run with an indeterminate consent
  // status.
  if (!Array.isArray(stale)) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'consent_check_unexpected_shape',
    });
  }
  if (stale.length > 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 're_consent_required',
    });
  }
  return next();
});
