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
 *   resource `players`:             players.read_{own,assigned,any} + write + update_*
 *   resource `trainers`:            trainers.read_{own,assigned,any} + write + update_self
 *   resource `uploaded_files`:      files.upload + read_{own,any} + delete_any
 *
 * Reference: .planning/phases/01-fundament/01-CONTEXT.md §D-11
 *            .planning/phases/01-fundament/01-RESEARCH.md §Better Auth Integration
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §D-37, §D-38
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
  | 'lookup.write'
  // ── Phase 2 — players (D-37) ────────────────────────────────────────────
  | 'players.read_any'         // TD, medical_staff
  | 'players.read_assigned'    // trainer, academy_manager, parent
  | 'players.read_own'         // player (self)
  | 'players.write'            // TD only (create / delete)
  | 'players.update_any'       // TD; academy_manager in scope (RLS narrows)
  | 'players.update_self'      // player editing own non-sensitive fields (D-37)
  | 'players.set_age_category' // TD only (D-32)
  // ── Phase 2 — trainers (D-38) ───────────────────────────────────────────
  | 'trainers.read_any'        // TD, medical_staff
  | 'trainers.read_assigned'   // trainer, academy_manager in same academy
  | 'trainers.read_own'        // trainer (self)
  | 'trainers.write'           // TD only (create / delete)
  | 'trainers.update_self'     // trainer editing own non-sensitive fields (D-38)
  // ── Phase 2 — uploaded_files (FILE-03) ──────────────────────────────────
  | 'files.upload'             // any authenticated user (own files)
  | 'files.read_any'           // TD, medical_staff
  | 'files.read_own'           // owner of the file
  | 'files.delete_any';        // TD only

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
    // Phase 2 — full access to player + trainer + file resources.
    'players.read_any',
    'players.write',
    'players.update_any',
    'players.set_age_category',
    'trainers.read_any',
    'trainers.write',
    'files.upload',
    'files.read_any',
    'files.read_own',
    'files.delete_any',
  ],
  academy_manager: [
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
    'audit.read_self_actions',
    // Phase 2 — read + update players in own academies; RLS narrows update_any
    // to in-scope rows. Trainer scope is read-only.
    'players.read_assigned',
    'players.update_any',
    'trainers.read_assigned',
    'files.upload',
    'files.read_own',
  ],
  trainer: [
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
    'medical.read_traffic_light',
    'audit.read_self_actions',
    // Phase 2 — read-only on players (D-37: trainers cannot edit player profiles);
    // read peers + self in trainers; edit own trainer profile (D-38).
    'players.read_assigned',
    'trainers.read_assigned',
    'trainers.read_own',
    'trainers.update_self',
    'files.upload',
    'files.read_own',
  ],
  player: [
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
    'medical.read_own',
    // Phase 2 — read + edit own non-sensitive fields (D-37); upload own files.
    'players.read_own',
    'players.update_self',
    'files.upload',
    'files.read_own',
  ],
  parent: [
    'consent.give_self',
    'consent.give_for_minor',
    'consent.withdraw_self',
    'consent.read_own',
    'medical.read_assigned',
    // Phase 2 — read + edit own children via parent_child_links (RLS scopes
    // both predicates). update_self carries the same shape as for player —
    // server-side enforces field-set restriction, not RLS.
    'players.read_assigned',
    'players.update_self',
    'files.upload',
    'files.read_own',
  ],
  sparring_partner: [
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
    // Phase 2 — sparring partners do NOT have player/trainer scope in v1
    // (Phase 5 wires session-based scope). Files: own only (e.g. own profile).
    'files.read_own',
  ],
  medical_staff: [
    'medical.read_any',
    'medical.write',
    'consent.give_self',
    'consent.withdraw_self',
    'consent.read_own',
    // Phase 2 — medical staff need patient context: read all players + trainers,
    // read all files (for evaluation/medical document review in Phase 5).
    'players.read_any',
    'trainers.read_any',
    'files.read_any',
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
