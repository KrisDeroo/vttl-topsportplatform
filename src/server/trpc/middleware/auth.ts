/**
 * `requireAuth` — Plan 11 first-line authorization gate.
 *
 * Runs on EVERY authenticated tRPC procedure (composed into `protectedProcedure`
 * in `freshSession.ts`). Two responsibilities:
 *
 *   1. Reject anonymous callers (no session OR no scope) with UNAUTHORIZED.
 *   2. Reject sessions that have been forcibly revoked (D-09) by the TD's
 *      admin actions — role downgrade, parent-link removal, account
 *      deactivation. Sub-millisecond Upstash REST GET against the revocation
 *      list (Plan 09).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Phase-1 scope refresh policy (MAJOR-11 resolution):
 *
 * D-08 specifies a 15-min JWT-claim cache for scope (academyIds + linkedPlayerIds
 * + role) so we don't hit the DB on every authenticated request. **Phase 1
 * implements the simpler "always fresh" variant**: `createContext` re-fetches
 * scope from the DB on EVERY request. Net effect: every protected tRPC call
 * costs an extra ~10–30ms for the academy + parent-link reads.
 *
 * Rationale for deferring the cache:
 *   - Better Auth's `additionalFields` plugin (the canonical place to extend
 *     session-cookie claims) adds non-trivial coupling to the auth library
 *     upgrade path. It's better added once we have real load profiles in
 *     Phase 8 staging and can verify the cache vs latency tradeoff.
 *   - Revocation (`isRevoked` Upstash GET) is the security-critical part of
 *     D-08/09 — that lives right here on every request, sub-millisecond, and
 *     is implemented correctly.
 *   - The dead "scope-staleness" check in earlier drafts was a footgun: with no
 *     cache, `issuedAt` is always within milliseconds, so the gate never
 *     fired — pure noise that masked the absence of caching. We remove it now
 *     and re-introduce a real cache + gate in v1.1.
 *
 * v1.1 follow-up (tracked in PROJECT.md backlog):
 *   1. Wire Better Auth `additionalFields` to populate `academyIds[] /
 *      linkedPlayerIds[] / roleClaimIssuedAt` on the session row.
 *   2. Re-add a staleness gate here that throws after 15 minutes.
 *   3. Add a `session.update()` call site in admin mutations (Plan 15) so a
 *      role / link change invalidates the cache before the TTL expires
 *      (revocation list remains the immediate-effect path).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §requireAuth (lines 1074–1103)
 *            .planning/phases/01-fundament/01-CONTEXT.md §C (D-08, D-09)
 */
import { TRPCError } from '@trpc/server';

import { isRevoked } from '@/server/auth/revocation';

import { middleware } from '../trpc';

export const requireAuth = middleware(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.scope) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  // D-09 — sub-ms Upstash REST GET. Returns the revocation reason (string)
  // when the user has been forcibly invalidated, or `null` when active.
  const reason = await isRevoked(ctx.scope.userId);
  if (reason) {
    ctx.log.info(
      { userId: ctx.scope.userId, reason },
      'auth.revoked',
    );
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'session_revoked',
    });
  }

  // No staleness check — scope is always fresh because createContext re-fetches
  // every request. See block-comment above for the v1.1 caching plan.

  return next({ ctx: { ...ctx, scope: ctx.scope } });
});
