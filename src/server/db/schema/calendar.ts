/**
 * calendar — Phase 3 polymorphic event schema (D-47..D-51).
 *
 * Class-table inheritance (D-49):
 *  - calendar_events: base table with shared columns (id, type_code, title,
 *    starts_at, ends_at, all_day, location, description, rrule, created_by,
 *    timestamps).
 *  - 6 extension tables (training_sessions, tournaments, meetings, stages,
 *    eval_conversations, medical_appointments), each with event_id PK FK
 *    REFERENCES calendar_events(id) ON DELETE CASCADE.
 *
 * Polymorphic participant junction (D-50):
 *  - calendar_event_participants(event_id, user_id, role_in_event,
 *    rsvp_status, created_at). Composite PK (event_id, user_id). Sparring
 *    partner participation is a Phase 4 addition (separate junction).
 *
 * Single-occurrence override (D-54):
 *  - calendar_event_exceptions(id, event_id, occurrence_date, cancelled,
 *    override_*, created_by, created_at). UNIQUE(event_id, occurrence_date).
 *
 * NO deleted_at column on calendar_events (D-58 hard delete only); audit-log
 * JSONB snapshot is the forensic recovery path (see calendar.event.delete
 * handler in Wave 3).
 *
 * Phase 4 schema-handover contract (D-51): Phase 4 adds session_participants,
 * session_sparring_partners, tournament_results, match_results, and
 * ranking_entries ONLY. No changes to these tables.
 *
 * Reference: .planning/phases/03-kalender/03-CONTEXT.md D-47..D-58
 *            .planning/phases/03-kalender/03-RESEARCH.md §Pattern 2
 *            drizzle/0009_*.sql + drizzle/0010_*.sql
 */
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import {
  ageCategories,
  eventType,
  organisation,
  tournamentType,
  trainingType,
} from './lookups';
import { trainers } from './trainers';

// ─── Base ──────────────────────────────────────────────────────────────

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    typeCode: text('type_code')
      .notNull()
      .references(() => eventType.code, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    allDay: boolean('all_day').notNull().default(false),
    location: text('location'),
    description: text('description'),
    rrule: text('rrule'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
    updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    check(
      'calendar_events_ends_after_starts',
      sql`${t.endsAt} >= ${t.startsAt}`,
    ),
    index('idx_calendar_events_starts_ends').on(t.startsAt, t.endsAt),
    index('idx_calendar_events_type').on(t.typeCode),
    index('idx_calendar_events_creator').on(t.createdBy),
  ],
);

// ─── Junction (polymorphic over user_id) ───────────────────────────────

export const calendarEventParticipants = pgTable(
  'calendar_event_participants',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleInEvent: text('role_in_event').notNull(),
    rsvpStatus: text('rsvp_status').notNull().default('pending'),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    check(
      'cep_role_enum',
      sql`${t.roleInEvent} IN ('organizer','participant','invitee')`,
    ),
    check(
      'cep_rsvp_enum',
      sql`${t.rsvpStatus} IN ('pending','accepted','declined')`,
    ),
    index('idx_cep_user_event').on(t.userId, t.eventId),
  ],
);

// ─── Exceptions (D-54 single-occurrence override) ──────────────────────

export const calendarEventExceptions = pgTable(
  'calendar_event_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    occurrenceDate: date('occurrence_date').notNull(),
    cancelled: boolean('cancelled').notNull().default(false),
    overrideStartsAt: tstz('override_starts_at'),
    overrideEndsAt: tstz('override_ends_at'),
    overrideTitle: text('override_title'),
    overrideLocation: text('override_location'),
    overrideDescription: text('override_description'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    unique('uniq_calendar_event_exceptions_event_occurrence').on(
      t.eventId,
      t.occurrenceDate,
    ),
    index('idx_cee_event').on(t.eventId),
    check(
      'cee_override_times_consistent',
      sql`(${t.overrideStartsAt} IS NULL AND ${t.overrideEndsAt} IS NULL) OR (${t.overrideStartsAt} IS NOT NULL AND ${t.overrideEndsAt} IS NOT NULL AND ${t.overrideEndsAt} >= ${t.overrideStartsAt})`,
    ),
  ],
);

// ─── Extension tables (D-47 — 6 typed extensions) ─────────────────────

export const trainingSessions = pgTable('training_sessions', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
  durationMinutes: integer('duration_minutes').notNull(),
  trainingTypeCode: text('training_type_code')
    .notNull()
    .references(() => trainingType.code, { onDelete: 'restrict' }),
  organisationCode: text('organisation_code')
    .notNull()
    .references(() => organisation.code, { onDelete: 'restrict' }),
  trainerId: uuid('trainer_id')
    .notNull()
    .references(() => trainers.userId, { onDelete: 'restrict' }),
}, (t) => [
  check('training_sessions_duration_positive', sql`${t.durationMinutes} > 0`),
]);

export const tournaments = pgTable('tournaments', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
  city: text('city').notNull(),
  country: text('country').notNull().default('BE'),
  ageCategoryCode: text('age_category_code')
    .notNull()
    .references(() => ageCategories.code, { onDelete: 'restrict' }),
  tournamentTypeCode: text('tournament_type_code')
    .notNull()
    .references(() => tournamentType.code, { onDelete: 'restrict' }),
}, (t) => [
  check('tournaments_country_iso2', sql`char_length(${t.country}) = 2`),
]);

export const meetings = pgTable('meetings', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
});

export const stages = pgTable('stages', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
  place: text('place').notNull(),
  country: text('country').notNull().default('BE'),
}, (t) => [
  check('stages_country_iso2', sql`char_length(${t.country}) = 2`),
]);

export const evalConversations = pgTable('eval_conversations', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
  evaluatorUserId: uuid('evaluator_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  playerUserId: uuid('player_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
});

export const medicalAppointments = pgTable('medical_appointments', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
  isInjury: boolean('is_injury').notNull().default(false),
  doctor: text('doctor'),
  // NO pgcrypto cipher columns — Article-9 medical data lives in Phase 1's
  // medical_events table. This is calendar metadata only.
});

// ─── Relations (type-safe joins) ───────────────────────────────────────

export const calendarEventsRelations = relations(calendarEvents, ({ one, many }) => ({
  training: one(trainingSessions, {
    fields: [calendarEvents.id],
    references: [trainingSessions.eventId],
  }),
  tournament: one(tournaments, {
    fields: [calendarEvents.id],
    references: [tournaments.eventId],
  }),
  meeting: one(meetings, {
    fields: [calendarEvents.id],
    references: [meetings.eventId],
  }),
  stage: one(stages, {
    fields: [calendarEvents.id],
    references: [stages.eventId],
  }),
  evalConv: one(evalConversations, {
    fields: [calendarEvents.id],
    references: [evalConversations.eventId],
  }),
  medical: one(medicalAppointments, {
    fields: [calendarEvents.id],
    references: [medicalAppointments.eventId],
  }),
  participants: many(calendarEventParticipants),
  exceptions: many(calendarEventExceptions),
  creator: one(users, {
    fields: [calendarEvents.createdBy],
    references: [users.id],
  }),
}));

// ─── Type exports ──────────────────────────────────────────────────────

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;
export type CalendarEventParticipant = typeof calendarEventParticipants.$inferSelect;
export type NewCalendarEventParticipant = typeof calendarEventParticipants.$inferInsert;
export type CalendarEventException = typeof calendarEventExceptions.$inferSelect;
export type NewCalendarEventException = typeof calendarEventExceptions.$inferInsert;
export type TrainingSession = typeof trainingSessions.$inferSelect;
export type NewTrainingSession = typeof trainingSessions.$inferInsert;
export type Tournament = typeof tournaments.$inferSelect;
export type NewTournament = typeof tournaments.$inferInsert;
export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;
export type Stage = typeof stages.$inferSelect;
export type NewStage = typeof stages.$inferInsert;
export type EvalConversation = typeof evalConversations.$inferSelect;
export type NewEvalConversation = typeof evalConversations.$inferInsert;
export type MedicalAppointment = typeof medicalAppointments.$inferSelect;
export type NewMedicalAppointment = typeof medicalAppointments.$inferInsert;
