/**
 * Role -> permission matrix. Single source of truth (CRIT-3).
 *
 * Imported by:
 *   - tRPC middleware (Plan 11) — `assertPermission(role, perm)` runs in the
 *     procedure builder before any DB hit.
 *   - Admin UI (Plan 15) — gating which buttons render for the current role.
 *   - Consent flow (Plan 12) — checking `consent.give_for_minor` before
 *     allowing a parent to consent on behalf of their child.
 *
 * Rule: NEVER hard-code role checks (`if (role === 'parent')`) elsewhere.
 * Always import a permission name from this file. New behaviour adds a new
 * permission name; new roles add a new entry to ROLE_PERMISSIONS. The shape
 * of `ROLE_PERMISSIONS` is exhaustive — every Role key MUST appear, otherwise
 * `Record<Role, Permission[]>` breaks the compile.
 *
 * Mapping to D-11 RBAC matrix (tests/helpers/seed.ts, RBAC_EXPECTATIONS):
 *   resource `users`:               anyone authenticated may read directory ('user.*')
 *   resource `consent_records`:     `consent.read_*` (own / any)
 *   resource `medical_events`:      `medical.read_*` (own / assigned / any)
 *   resource `audit_log`:           `audit.read_any` (TD only) / `audit.read_self_actions`
 *   resource `parent_child_links`:  `consent.give_for_minor` for parents,
 *                                   `user.link_parent` for TD,
 *                                   own-link visibility via consent.read_own
 *
 * Reference: .planning/phases/01-fundament/01-CONTEXT.md §D-11
 *            .planning/phases/01-fundament/01-RESEARCH.md §Better Auth Integration
 */

/**
 * VTTL role hierarchy — must stay in lock-step with `userRoleEnum` in
 * `src/server/db/schema/auth.ts`. Reordering rows here does NOT shift
 * pg_dump ordinals (that's a DB enum concern) but the names must match.
 */
export type Role =
  | 'technical_director'
  | 'academy_manager'
  | 'trainer'
  | 'player'
  | 'parent'
  | 'sparring_partner'
  | 'medical_staff';

/**
 * Permission codes are dotted: `<resource>.<action>` where `action` may be
 * suffixed with the scope (`_own`, `_assigned`, `_any`).
 *
 * - `*_own`:       caller is the owner of the row (userId == row.user_id)
 * - `*_assigned`:  caller has an explicit link to the row owner
 *                  (parent_child_link, academy_membership)
 * - `*_any`:       caller may read across the whole platform (TD / medical_staff)
 *
 * The middleware (Plan 11) is responsible for translating `_assigned` into the
 * actual SQL `WHERE` clause — this constant is the policy declaration only.
 */
export type Permission =
  | 'user.create'
  | 'user.activate'
  | 'user.deactivate'
  | 'user.assign_role'
  | 'user.link_parent'
  | 'user.link_academy'
  | 'consent.give_self'
  | 'consent.give_for_minor'
  | 'consent.withdraw_self'
  | 'consent.read_own'
  | 'consent.read_any'
  | 'medical.read_own'
  | 'medical.read_assigned'
  | 'medical.read_any'
  | 'medical.write'
  | 'medical.read_traffic_light'
  | 'audit.read_any'
  | 'audit.read_self_actions'
  | 'lookup.write';

/**
 * The full role-to-permission grant matrix.
 *
 * Defaults are conservative:
 *   - Sparring partners and academy managers are read-mostly users; they
 *     manage their OWN consents and read their OWN audit trail, no PII access.
 *   - Trainers see traffic-light medical signals (red / yellow / green) only,
 *     never the underlying diagnosis.
 *   - Medical staff read & write any player's medical record but cannot read
 *     the broader audit log (CRIT-7 separates medical-write audit from
 *     security-event audit).
 *   - Technical director is the platform admin (AUTH-04/05).
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  technical_director: [
    'user.create',
    'user.activate',
    'user.deactivate',
    'user.assign_role',
    'user.link_parent',
    'user.link_academy',
    'consent.read_any',
    'consent.give_self',
    'consent.withdraw_self',
    'medical.read_any',
    'medical.write',
    'audit.read_any',
    'lookup.write',
  ],
  academy_manager: [
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
    'audit.read_self_actions',
  ],
  trainer: [
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
    'medical.read_traffic_light',
    'audit.read_self_actions',
  ],
  player: [
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
    'medical.read_own',
  ],
  parent: [
    'consent.give_self',
    'consent.give_for_minor',
    'consent.withdraw_self',
    'consent.read_own',
    'medical.read_assigned',
  ],
  sparring_partner: [
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
  ],
  medical_staff: [
    'medical.read_any',
    'medical.write',
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
  ],
};

/**
 * Pure-function predicate. Returns true iff the role's grant list contains
 * `perm`. The middleware (Plan 11) wraps this in `assertPermission(role, perm)`
 * which throws TRPCError FORBIDDEN — but the bare predicate is exported so
 * UI code (Plan 15) can pre-hide buttons without try/catch.
 */
export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}
