/**
 * training — Phase 4 operational tables on top of Phase 3 calendar.
 *
 * session_participants (D-60..D-64 + D-82):
 *   - Composite PK (event_id, occurrence_date, user_id) — per-occurrence row.
 *     Corrects Phase 3 D-51 sketch via D-82. Each occurrence of a recurring
 *     training gets its own attendance/score row; past data immutable per D-83
 *     (enforced at API layer in Plan 04-03 / 04-06).
 *   - `quality_score` smallint 1..10 (NULL allowed = pending). v1 UI = 5-star
 *     mapping to 2/4/6/8/10; v2 swap to 1..10 is zero-migration.
 *   - `attended` boolean NULL allowed (pending state until trainer submits).
 *   - `feedback_text` up to 2000 chars (CHECK).
 *
 * session_sparring_partners (D-63 + SPAR-02):
 *   - Junction filling Phase 3 calendar_events_visible_to Branch 6 placeholder
 *     (drizzle/0011 line 140-145). Wave 1 0018 migration adds Branch 6 to
 *     calendar_events_visible_to so sparring partners see events they're in.
 *   - FK to users(id) where role='sparring_partner' — row-filter enforced at
 *     API layer + integration test (no native PG row-filter on FK).
 *
 * RLS policies, audit-log emission, and the 14-day score wall (D-64) live in
 * the API layer (Plan 04-03) and Wave 1 0018 RLS migration.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §D-60..D-64 + §D-82
 *            drizzle/0014_phase4_session_participants_and_sparring_junction.sql
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import { calendarEvents } from './calendar';

export const sessionParticipants = pgTable(
  'session_participants',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    occurrenceDate: date('occurrence_date').notNull(), // D-82: per-occurrence row
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    attended: boolean('attended'),
    qualityScore: smallint('quality_score'),
    feedbackText: text('feedback_text'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
    updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: 'session_participants_pkey',
      columns: [t.eventId, t.occurrenceDate, t.userId],
    }),
    check(
      'session_participants_quality_score_range',
      sql`${t.qualityScore} IS NULL OR ${t.qualityScore} BETWEEN 1 AND 10`,
    ),
    check(
      'session_participants_feedback_length',
      sql`${t.feedbackText} IS NULL OR char_length(${t.feedbackText}) <= 2000`,
    ),
    index('idx_session_participants_user_date').on(
      t.userId,
      t.occurrenceDate,
    ),
    index('idx_session_participants_event').on(t.eventId),
  ],
);

export const sessionSparringPartners = pgTable(
  'session_sparring_partners',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    sparringPartnerId: uuid('sparring_partner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: 'session_sparring_partners_pkey',
      columns: [t.eventId, t.sparringPartnerId],
    }),
    index('idx_session_sparring_partners_user').on(t.sparringPartnerId),
  ],
);

export type SessionParticipant = typeof sessionParticipants.$inferSelect;
export type NewSessionParticipant = typeof sessionParticipants.$inferInsert;
export type SessionSparringPartner = typeof sessionSparringPartners.$inferSelect;
export type NewSessionSparringPartner = typeof sessionSparringPartners.$inferInsert;
