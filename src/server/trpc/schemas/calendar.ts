/**
 * Zod input schemas for calendar.* tRPC procedures (Phase 3 Wave 2).
 *
 * All schemas use `.strict()` (VALID-06 carry-forward from Phase 2). All error
 * messages are i18n keys (I18N-08 + D-46 from Phase 2); client renders via
 * `useZodErrorMessage` from src/lib/forms/zod-i18n.ts; server logs raw key in
 * English.
 *
 * Discriminated union per event type (RESEARCH §Pattern 5):
 *   - The `type` field is the discriminator (literal one of 6 event_type_*
 *     codes).
 *   - Each branch carries its own type-specific extension fields per
 *     REQUIREMENTS.md §TRAIN-01 / §TOURN-01 / §AGE-01 / §AGE-03 / §MED-01
 *     (mapped onto calendar metadata).
 *   - Meetings have no extension columns (per Phase 3 base contract).
 *
 * Anti-Pattern 1 guard (RESEARCH §Anti-Patterns line 853): rrule strings must
 * NOT contain 'DTSTART:' — the source of truth is calendar_events.starts_at.
 *
 * Reference: .planning/phases/03-kalender/03-RESEARCH.md §Pattern 5
 *            .planning/phases/03-kalender/03-CONTEXT.md D-47, D-48, D-55, D-57
 */
import { z } from 'zod';

// ─── Shared field groups ────────────────────────────────────────────────

/** RFC 5545 RRULE string guard — rejects DTSTART: per Anti-Pattern 1.
 *  WR-04: the DTSTART rejection is a syntax/structure failure, not a
 *  horizon failure, so the error key is `rruleInvalid` (matches the
 *  parseRrule branch in src/lib/rrule.ts). The 2000-char cap is also a
 *  syntactic constraint, so same key. */
const rruleStringSchema = z
  .string()
  .max(2000, { message: 'errors.calendar.rruleInvalid' })
  .refine((s) => !s.includes('DTSTART:'), {
    message: 'errors.calendar.rruleInvalid',
  });

/** Participant subset accepted by event.create / event.update. */
const participantInputSchema = z
  .object({
    userId: z.string().uuid({ message: 'errors.field.required' }),
    roleInEvent: z.enum(['organizer', 'participant', 'invitee']),
  })
  .strict();

/** Common base fields shared by all 6 event types. */
const baseEventFields = {
  title: z
    .string()
    .min(1, { message: 'errors.calendar.titleRequired' })
    .max(200),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  rrule: rruleStringSchema.optional(),
  participants: z.array(participantInputSchema).default([]),
  /** D-57: when true, server bypasses the conflict-reject and logs an
   *  override audit row. */
  force: z.boolean().default(false),
};

// ─── Per-type extension branches ────────────────────────────────────────

const trainingCreateBranch = z
  .object({
    type: z.literal('event_type_training'),
    ...baseEventFields,
    // TRAIN-01 extension fields:
    trainingTypeCode: z.string().min(1, { message: 'errors.field.required' }),
    organisationCode: z.string().min(1, { message: 'errors.field.required' }),
    trainerId: z.string().uuid({ message: 'errors.field.required' }),
    durationMinutes: z
      .number()
      .int()
      .positive({ message: 'errors.calendar.endBeforeStart' }),
  })
  .strict()
  .refine((d) => d.endsAt > d.startsAt, {
    message: 'errors.calendar.endBeforeStart',
    path: ['endsAt'],
  });

const tournamentCreateBranch = z
  .object({
    type: z.literal('event_type_tournament'),
    ...baseEventFields,
    // TOURN-01 extension fields:
    city: z.string().min(1, { message: 'errors.field.required' }).max(200),
    country: z.string().length(2, { message: 'errors.field.country' }),
    ageCategoryCode: z.string().min(1, { message: 'errors.field.required' }),
    tournamentTypeCode: z.string().min(1, { message: 'errors.field.required' }),
  })
  .strict()
  .refine((d) => d.endsAt > d.startsAt, {
    message: 'errors.calendar.endBeforeStart',
    path: ['endsAt'],
  });

const meetingCreateBranch = z
  .object({
    type: z.literal('event_type_meeting'),
    ...baseEventFields,
    // No extension fields — meetings only use the base.
  })
  .strict()
  .refine((d) => d.endsAt > d.startsAt, {
    message: 'errors.calendar.endBeforeStart',
    path: ['endsAt'],
  });

const stageCreateBranch = z
  .object({
    type: z.literal('event_type_stage'),
    ...baseEventFields,
    // AGE-01 extension fields:
    place: z.string().min(1, { message: 'errors.field.required' }).max(200),
    country: z.string().length(2, { message: 'errors.field.country' }),
  })
  .strict()
  .refine((d) => d.endsAt > d.startsAt, {
    message: 'errors.calendar.endBeforeStart',
    path: ['endsAt'],
  });

const evalConvCreateBranch = z
  .object({
    type: z.literal('event_type_eval_conversation'),
    ...baseEventFields,
    // AGE-03 extension fields:
    evaluatorUserId: z.string().uuid({ message: 'errors.field.required' }),
    playerUserId: z.string().uuid({ message: 'errors.field.required' }),
  })
  .strict()
  .refine((d) => d.endsAt > d.startsAt, {
    message: 'errors.calendar.endBeforeStart',
    path: ['endsAt'],
  });

const medicalCreateBranch = z
  .object({
    type: z.literal('event_type_medical'),
    ...baseEventFields,
    // MED-EVENT (non-Article-9) extension fields:
    isInjury: z.boolean().default(false),
    doctor: z.string().max(200).optional(),
  })
  .strict()
  .refine((d) => d.endsAt > d.startsAt, {
    message: 'errors.calendar.endBeforeStart',
    path: ['endsAt'],
  })
  .refine(
    (d) =>
      d.startsAt >= new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    {
      message: 'errors.calendar.medicalPastStart',
      path: ['startsAt'],
    },
  );

// ─── Discriminated union for create ────────────────────────────────────

export const eventCreateInput = z.discriminatedUnion('type', [
  trainingCreateBranch,
  tournamentCreateBranch,
  meetingCreateBranch,
  stageCreateBranch,
  evalConvCreateBranch,
  medicalCreateBranch,
]);

// ─── Update / delete / list / decline / detectConflicts / filter inputs ─

/** event.update — same shape as create, plus eventId. The handler uses
 *  input.type to dispatch to the correct extension-table UPDATE. */
export const eventUpdateInput = z
  .object({
    eventId: z.string().uuid({ message: 'errors.field.required' }),
  })
  .and(eventCreateInput);

export const eventDeleteInput = z
  .object({
    eventId: z.string().uuid({ message: 'errors.field.required' }),
  })
  .strict();

export const eventGetInput = z
  .object({
    eventId: z.string().uuid({ message: 'errors.field.required' }),
  })
  .strict();

/** event.declineParticipation — caller sets own RSVP to 'declined'
 *  (D-58 operation 2). */
export const declineParticipationInput = z
  .object({
    eventId: z.string().uuid({ message: 'errors.field.required' }),
  })
  .strict();

/** event.cancelOccurrence — write an exception row with cancelled=true
 *  (D-58 operation 3). */
export const cancelOccurrenceInput = z
  .object({
    eventId: z.string().uuid({ message: 'errors.field.required' }),
    occurrenceDate: z.coerce.date(),
  })
  .strict();

/** event.detectConflicts — pre-save probe (D-57). */
export const detectConflictsInput = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    participants: z
      .array(
        z
          .object({
            userId: z.string().uuid({ message: 'errors.field.required' }),
          })
          .strict(),
      )
      .min(1, { message: 'errors.field.required' }),
    excludeEventId: z.string().uuid().optional(),
  })
  .strict()
  .refine((d) => d.endsAt > d.startsAt, {
    message: 'errors.calendar.endBeforeStart',
    path: ['endsAt'],
  });

/** calendar.list({from, to, filters}). D-55: read-time horizon — 2y range max. */
export const listInput = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    filters: z
      .object({
        types: z.array(z.string()).optional(),
        playerIds: z.array(z.string().uuid()).optional(),
        trainerIds: z.array(z.string().uuid()).optional(),
        sparringPartnerIds: z.array(z.string().uuid()).optional(),
        academyCodes: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (d) => d.to.getTime() - d.from.getTime() <= 2 * 365 * 24 * 60 * 60 * 1000,
    {
      message: 'errors.calendar.rangeTooLarge',
      path: ['to'],
    },
  );

/** calendar.filterOptions.list — scope-filtered typeahead source. */
export const filterOptionsInput = z
  .object({
    kind: z.enum(['player', 'trainer', 'sparring_partner', 'academy']),
    query: z.string().max(100).default(''),
  })
  .strict();

// ─── Type exports ───────────────────────────────────────────────────────

export type EventCreateInput = z.infer<typeof eventCreateInput>;
export type EventUpdateInput = z.infer<typeof eventUpdateInput>;
export type EventDeleteInput = z.infer<typeof eventDeleteInput>;
export type EventGetInput = z.infer<typeof eventGetInput>;
export type DeclineParticipationInput = z.infer<typeof declineParticipationInput>;
export type CancelOccurrenceInput = z.infer<typeof cancelOccurrenceInput>;
export type DetectConflictsInput = z.infer<typeof detectConflictsInput>;
export type ListInput = z.infer<typeof listInput>;
export type FilterOptionsInput = z.infer<typeof filterOptionsInput>;

/** The 6 event_type codes — exported for tests + UI to import without
 *  magic strings. */
export const EVENT_TYPE_CODES = [
  'event_type_training',
  'event_type_tournament',
  'event_type_meeting',
  'event_type_stage',
  'event_type_eval_conversation',
  'event_type_medical',
] as const;
export type EventTypeCode = (typeof EVENT_TYPE_CODES)[number];
