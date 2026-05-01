/**
 * Memberships — academy_memberships, parent_child_links.
 *
 * `academy_memberships`:
 *  Composite PK on (user_id, academy_code, role) — a user can hold
 *  multiple roles in the same academy (e.g. a trainer who is also a
 *  player elsewhere). On delete cascade: removing a user clears their
 *  memberships. Restrict on academy: you cannot DELETE an academy
 *  while it has members.
 *
 * `parent_child_links`:
 *  Composite PK on (parent_user_id, child_user_id) AND a UNIQUE
 *  constraint on `child_user_id` alone. The UNIQUE constraint encodes
 *  the Belgian Art. 8 rule (HIGH-5):
 *    For a minor (< 16) the platform recognises EXACTLY ONE consenting
 *    parent. Two-parent custody is handled outside the platform (the
 *    second parent receives no separate account); legally the first
 *    consenting parent represents both.
 *  This is a hard schema invariant — retrofitting it later requires
 *  running expand-contract on a table with thousands of rows.
 *
 * `consentGivenAt` (NOT NULL) is the parent's consent timestamp under
 * Belgian Art. 8; the actual `consent_records` row goes into the
 * consent_records table separately (single source of truth for GDPR
 * proof) but we duplicate the timestamp here for fast RLS predicates.
 *
 * `linkedBy` is nullable so seed scripts and self-service flows
 * (where the parent links themselves) work — but in production every
 * link must be either self-created (linkedBy = parent_user_id) or
 * TD-created (linkedBy = TD's id). Plan 11 enforces that.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Memberships + parent-child links (lines 644-672)
 */
import { pgTable, uuid, text, primaryKey, unique } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import { academy } from './lookups';

export const academyMemberships = pgTable(
  'academy_memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    academyCode: text('academy_code')
      .notNull()
      .references(() => academy.code, { onDelete: 'restrict' }),
    role: text('role').notNull(), // 'trainer' | 'academy_manager' | 'player'
    linkedAt: tstz('linked_at', { defaultNow: true }).notNull(),
    linkedBy: uuid('linked_by').references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.academyCode, t.role] }),
  }),
);

export const parentChildLinks = pgTable(
  'parent_child_links',
  {
    parentUserId: uuid('parent_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    childUserId: uuid('child_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    consentGivenAt: tstz('consent_given_at').notNull(), // Belgian Art. 8
    linkedAt: tstz('linked_at', { defaultNow: true }).notNull(),
    linkedBy: uuid('linked_by').references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.parentUserId, t.childUserId] }),
    // HIGH-5: a minor has EXACTLY ONE consenting parent (BE Art. 8).
    uniqueChildIfMinor: unique('uniq_child_user').on(t.childUserId),
  }),
);
