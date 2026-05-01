import type { drizzle } from 'drizzle-orm/postgres-js';

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

/** Creates one user per role + a victim player whose data each role tries to access.
 * Returns the user IDs keyed by role + the victim's id. */
export async function seedRolesMatrix(_db: ReturnType<typeof drizzle>) {
  // Implementation: insert 7 users (one per role) + 1 victim player
  // + 1 medical_event for victim + 1 consent_record + 1 audit_log + 1 parent_child_link
  // Filled in once Plan 02 schema lands. Stub returns empty until then.
  return { users: {} as Record<Role, string>, victimId: '' };
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
