/**
 * Per-event-type RBAC matrix middleware (D-48).
 *
 * The matrix:
 *   - event_type_training:          TD or trainer
 *   - event_type_tournament:        TD only
 *   - event_type_meeting:           any authenticated role
 *                                     (TD/trainer/player/academy_manager/medical_staff)
 *   - event_type_stage:             TD only
 *   - event_type_eval_conversation: TD only
 *   - event_type_medical:           TD only
 *
 * Composition pattern:
 *   The factory `requireRoleForEventType(typeCode)` returns a middleware that
 *   checks the caller's role against the matrix and throws FORBIDDEN
 *   'role_not_allowed' otherwise. Anonymous callers throw UNAUTHORIZED so the
 *   UI routes to login (Phase 1 WR-03 fix carry-forward — see freshSession.ts).
 *
 * Usage from calendar.ts router:
 *   create: protectedProcedure
 *     .input(eventCreateInput)
 *     .use((opts) => requireRoleForEventType(opts.input.type)(opts))
 *     .mutation(async ({ ctx, input }) => { ... })
 *
 * Note: per-event RLS on calendar_events (calendar_events_visible_to +
 * per-action policies in migration 0011) is the defense-in-depth backstop —
 * even if this middleware were bypassed, the database would reject INSERTs
 * with created_by != current_user_id().
 *
 * Reference: .planning/phases/03-kalender/03-CONTEXT.md D-48
 *            .planning/phases/03-kalender/03-RESEARCH.md §Pattern 4
 *            src/server/trpc/middleware/freshSession.ts (requireRole pattern)
 */
import { TRPCError } from '@trpc/server';

import type { Role } from '@/server/auth/permissions';

import { middleware } from '../trpc';

/** D-48 per-event-type allowlist. Maps event_type_X → set of roles permitted
 *  to create. */
const CREATE_ALLOWED_ROLES: Record<string, ReadonlyArray<Role>> = {
  event_type_training: ['technical_director', 'trainer'],
  event_type_tournament: ['technical_director'],
  event_type_meeting: [
    'technical_director',
    'trainer',
    'player',
    'academy_manager',
    'medical_staff',
  ],
  event_type_stage: ['technical_director'],
  event_type_eval_conversation: ['technical_director'],
  event_type_medical: ['technical_director'],
};

/**
 * Middleware factory: returns a middleware that gates calendar.event.create
 * by event_type_code per D-48.
 *
 * Anonymous (scope === null) → UNAUTHORIZED (UI routes to login).
 * Authenticated wrong role → FORBIDDEN 'role_not_allowed' (UI shows "your role
 * does not permit this").
 */
export const requireRoleForEventType = (typeCode: string) =>
  middleware(({ ctx, next }) => {
    if (!ctx.scope) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const allowed = CREATE_ALLOWED_ROLES[typeCode];
    if (!allowed || !allowed.includes(ctx.scope.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'role_not_allowed',
      });
    }
    return next({ ctx });
  });

/** Plain helper for non-middleware contexts (tests, ad-hoc checks). */
export function canCreateEventType(role: Role, typeCode: string): boolean {
  const allowed = CREATE_ALLOWED_ROLES[typeCode];
  return Boolean(allowed && allowed.includes(role));
}

/** Exported for visibility — tests assert the matrix shape. */
export { CREATE_ALLOWED_ROLES };
