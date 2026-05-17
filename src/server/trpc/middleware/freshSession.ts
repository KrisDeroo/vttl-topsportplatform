/**
 * `requireFreshSession`, `requireRole`, and the four procedure presets.
 *
 * SEC-03 (`requireFreshSession`): sensitive operations — parent-child link
 * creation, medical-data access, GDPR export / erasure — require that the
 * caller has re-authenticated within the last 1 hour (Plan 05 freshAge=1h).
 * Throws FORBIDDEN `re_auth_required` so the UI can prompt for re-login
 * without losing the form state.
 *
 * `requireRole(...roles)`: lightweight RBAC check. Used by `tdProcedure` /
 * `medicalProcedure` to gate router-level access; the deeper `Permission`
 * checks (Plan 05 ROLE_PERMISSIONS) are still required at the data-access
 * layer for fine-grained scope rules (`*_own` / `*_assigned` / `*_any`).
 *
 * Procedure presets — single source of truth so feature plans never reassemble
 * the chain. Order matters: revocation/auth first (cheap reject), then
 * RLS GUC binding (DB transaction), then consent gate, then role / freshness.
 *
 *   publicProcedure       — no auth (login, signup, password-reset, ping)
 *   protectedProcedure    — auth + RLS + current-consent (every authenticated user)
 *   tdProcedure           — protectedProcedure + role(technical_director)
 *   sensitiveProcedure    — protectedProcedure + freshSession (SEC-03)
 *   medicalProcedure      — protectedProcedure + role(td|medical_staff|player|parent)
 *
 * `medicalProcedure` deliberately does NOT include `requireFreshSession`
 * because per-row scope checks (the player viewing OWN file, the parent
 * viewing OWN child) and Phase-5 medical-audit middleware are the actual
 * SEC-03 gate; freshness for medical-write is added in Phase 5 by composing
 * `medicalProcedure.use(requireFreshSession)`.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §requireRole / requireFreshSession (lines 1126–1152)
 */
import { TRPCError } from '@trpc/server';

import type { Role } from '@/server/auth/permissions';

import { middleware, publicProcedure } from '../trpc';
import { requireAuth } from './auth';
import { requireCurrentConsent } from './requireConsent';
import { withRlsContext } from './rls';

/**
 * SEC-03 — re-auth window. Plan 05 sets `session.freshAge = 1h`.
 *
 * WR-02 fix (2026-05-01): split null-scope (anonymous) from
 * non-fresh-scope (authenticated but stale). The previous version
 * collapsed both into FORBIDDEN `re_auth_required`, telling an
 * unauthenticated caller to "re-authenticate" — that is information
 * disclosure (it confirms the procedure exists) and a UX bug (the UI
 * routes the user to a re-auth page instead of a login page).
 * Anonymous → UNAUTHORIZED; stale → FORBIDDEN.
 */
export const requireFreshSession = middleware(({ ctx, next }) => {
  if (!ctx.scope) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (!ctx.scope.fresh) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 're_auth_required',
    });
  }
  return next({ ctx });
});

/**
 * Role allowlist gate.
 *
 * WR-03 fix (2026-05-01): same shape as `requireFreshSession` —
 * anonymous (`scope === null`) is UNAUTHORIZED so the UI can route to
 * login; an authenticated caller in the wrong role is FORBIDDEN
 * `role_not_allowed`. The previous version collapsed both into
 * `role_not_allowed`, which the UI surfaces as "your role does not
 * permit this" instead of "please log in".
 */
export const requireRole = (...roles: Role[]) =>
  middleware(({ ctx, next }) => {
    if (!ctx.scope) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    if (!roles.includes(ctx.scope.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'role_not_allowed',
      });
    }
    return next({ ctx });
  });

/* ─── Procedure presets ─────────────────────────────────────────────────── */

/**
 * Authenticated procedure preset.
 *
 * Chain (in order):
 *   1. `requireAuth`            — UNAUTHORIZED if no session OR revoked (D-09)
 *   2. `withRlsContext`         — opens a Postgres transaction with
 *                                 app.user_id / app.user_role / app.request_id
 *                                 GUCs set so Plan 04 RLS policies fire.
 *   3. `requireCurrentConsent`  — D-07 re-consent gate. Lives inside the
 *                                 transaction so the SELECT runs through RLS.
 */
export const protectedProcedure = publicProcedure
  .use(requireAuth)
  .use(withRlsContext)
  .use(requireCurrentConsent);

/**
 * `consentGiveProcedure` — auth + RLS, NO `requireCurrentConsent` gate.
 *
 * CR-03 fix (2026-05-01): `consent.give` was previously composed on
 * `protectedProcedure`, which transitively chains `requireCurrentConsent`
 * via the standard preset. A first-time user (or any user after a major
 * version bump) has no row at `CURRENT_POLICY[category].version`, so the
 * gate threw `re_consent_required` BEFORE the give-mutation ran — making
 * the only endpoint that creates a consent row itself gated on having
 * one. Net effect: the consent banner could never proceed (deadlock).
 *
 * This preset reuses requireAuth + withRlsContext (so RLS still gates
 * the INSERT and audit attribution remains correct) but intentionally
 * omits `requireCurrentConsent`. Only `consent.give` should compose on
 * this preset; every other authenticated mutation belongs on
 * `protectedProcedure`.
 */
export const consentGiveProcedure = publicProcedure
  .use(requireAuth)
  .use(withRlsContext);

/** Technical-director-only procedures (admin user-management — AUTH-04/05, Plan 15). */
export const tdProcedure = protectedProcedure.use(
  requireRole('technical_director'),
);

/** Sensitive procedures (parent-link, medical-write, GDPR export) — SEC-03. */
export const sensitiveProcedure = protectedProcedure.use(requireFreshSession);

/**
 * Medical procedures (Phase 5 will further chain a medical-audit middleware).
 *
 * Allowlist:
 *   - technical_director — read any (D-11)
 *   - medical_staff       — read any + write (D-11)
 *   - player              — read OWN (D-11; further filtered by RLS)
 *   - parent              — read assigned (D-11; further filtered by RLS)
 *
 * trainer (`medical.read_traffic_light`) is intentionally excluded here —
 * the traffic-light view is a separate procedure that does not expose
 * underlying diagnoses, so it does not need the medical-procedure chain.
 */
export const medicalProcedure = protectedProcedure.use(
  requireRole('technical_director', 'medical_staff', 'player', 'parent'),
);

/**
 * trainerOrTdProcedure — Phase 4 preset (Plan 04-03).
 *
 * Composes `protectedProcedure` (auth + RLS-bound tx + current-consent)
 * with a role gate of `trainer` OR `technical_director`. Used by
 * `training.markAttendanceAndScore` (D-62 combined attendance/score
 * capture, gated to the trainer who owns the session or the TD) and
 * by tournament backfill paths (Plan 04-04 inline RBAC).
 *
 * Deeper per-row scoping (the trainer must be the session's `trainer_id`)
 * is enforced inline in the procedure handler — see
 * `src/server/trpc/routers/training.ts` markAttendanceAndScore body.
 * This middleware is the cheap first gate; RLS is the defence-in-depth
 * backstop.
 */
export const trainerOrTdProcedure = protectedProcedure.use(
  requireRole('trainer', 'technical_director'),
);
