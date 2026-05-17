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

// ─── Phase 4 — Plan 04-06: event.editRecurring (D-84 + D-85) ────────────

/**
 * D-84 recurring-edit scope discriminator. Values:
 *  - 'single'           — single occurrence override (writes
 *                          calendar_event_exceptions row, Phase 3 D-54 carry-forward).
 *  - 'this_and_future'  — split-and-rewrite. Old event's UNTIL gets truncated;
 *                          a new event is INSERTed from `splitDate` with the
 *                          edited fields. Participants + sparring partners
 *                          COPIED to the new event (TRAIN-06). session_participants
 *                          stay on the old event (D-83 immutable past).
 *  - 'all_in_series'    — UPDATE the base + extension in place. Past
 *                          session_participants untouched (D-83 — the UPDATE
 *                          does not cascade to per-occurrence attendance rows).
 *                          Inert calendar_event_exceptions on dates that no
 *                          longer match the new expansion are kept (UI4-D20).
 */
export const recurringEditScope = z.enum([
  'single',
  'this_and_future',
  'all_in_series',
]);
export type RecurringEditScope = z.infer<typeof recurringEditScope>;

/**
 * Edits payload for {@link editRecurringInput}. A subset of fields the user
 * can change in any of the three scopes:
 *  - For 'single':           edit the occurrence row (override_*, cancelled).
 *  - For 'this_and_future':  edit the new event's base + extension fields.
 *  - For 'all_in_series':    edit the existing base + extension fields.
 *
 * RRULE-replacement happens via the optional FREQ + BYDAY fields (D-85);
 * BYMONTHDAY is not present (deferred to v2 per CONTEXT §Deferred).
 *
 * Extension-table fields are union-typed: only the ones matching the event's
 * `type_code` are applied by the handler; others are ignored (a deliberate
 * design choice so the handler can accept the same payload for different
 * event types without a per-type discriminated union — the existence test
 * is on the field, not on a discriminator).
 */
const editRecurringEditsSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    location: z.string().max(500).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    cancelled: z.boolean().optional(),
    // D-85 RRULE-replacement fields (only meaningful for
    // this_and_future / all_in_series). FREQ is the canonical option;
    // BYDAY is allowed only with FREQ=WEEKLY (refined below).
    frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
    byday: z
      .array(z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']))
      .optional(),
    interval: z.number().int().positive().max(52).optional(),
    until: z.coerce.date().optional(),
    // Training-extension fields (event_type_training).
    trainingTypeCode: z.string().optional(),
    organisationCode: z.string().optional(),
    trainerId: z.string().uuid().optional(),
    durationMinutes: z.number().int().positive().optional(),
    // Tournament-extension fields (event_type_tournament). Country must
    // be ISO-2 if supplied.
    city: z.string().min(1).max(200).optional(),
    country: z.string().length(2).optional(),
    ageCategoryCode: z.string().optional(),
    tournamentTypeCode: z.string().optional(),
    // Stage extension (event_type_stage).
    place: z.string().min(1).max(200).optional(),
    // Eval conversation extension.
    evaluatorUserId: z.string().uuid().optional(),
    playerUserId: z.string().uuid().optional(),
    // Medical appointment extension.
    isInjury: z.boolean().optional(),
    doctor: z.string().max(200).nullable().optional(),
  })
  .strict();

export type EditRecurringEditsInput = z.infer<typeof editRecurringEditsSchema>;

/**
 * event.editRecurring input. Refinements:
 *  1. splitDate is required when scope ∈ {'single', 'this_and_future'} —
 *     the handler needs to know WHICH occurrence (D-84). 'all_in_series'
 *     touches every future occurrence so splitDate is meaningless.
 *  2. BYDAY requires FREQ=WEEKLY (D-85). BYMONTHDAY (FREQ=MONTHLY with
 *     a weekday selector) is deferred to v2.
 *  3. BYDAY must be non-empty when present (UI invariant; serializeRrule
 *     enforces the same constraint at runtime).
 *  4. endsAt > startsAt when both supplied.
 */
export const editRecurringInput = z
  .object({
    eventId: z.string().uuid(),
    scope: recurringEditScope,
    splitDate: z.coerce.date().optional(),
    edits: editRecurringEditsSchema,
    /** Idempotency key (VALID-08 carry-forward — optional here). */
    _meta: z
      .object({ idempotencyKey: z.string().min(8).max(128).optional() })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.scope === 'all_in_series' ? true : v.splitDate !== undefined,
    {
      message: 'errors.calendar.splitDateRequired',
      path: ['splitDate'],
    },
  )
  .refine(
    (v) =>
      v.edits.byday && v.edits.frequency && v.edits.frequency !== 'weekly'
        ? false
        : true,
    {
      message: 'errors.calendar.bymonthdayNotSupported',
      path: ['edits', 'byday'],
    },
  )
  .refine(
    (v) => (v.edits.byday ? v.edits.byday.length >= 1 : true),
    {
      message: 'errors.calendar.rruleBydayRequired',
      path: ['edits', 'byday'],
    },
  )
  .refine(
    (v) =>
      v.edits.startsAt && v.edits.endsAt
        ? v.edits.endsAt > v.edits.startsAt
        : true,
    {
      message: 'errors.calendar.endBeforeStart',
      path: ['edits', 'endsAt'],
    },
  );

export type EditRecurringInput = z.infer<typeof editRecurringInput>;

// ─── Phase 4 — Plan 04-06: event.attachSparringPartners ──────────────

/**
 * Input for `event.attachSparringPartners` (TD-only — D-79 + D-63).
 *
 * Attaches one or more sparring-partner users to a training session via the
 * `session_sparring_partners` junction. The handler verifies each FK target's
 * `users.role === 'sparring_partner'` at the application layer (Assumption A5
 * — PostgreSQL does not natively support FK row-filters on referenced columns,
 * so we enforce this in application code in addition to the RLS policy added
 * by Plan 04-02 migration 0018).
 */
export const attachSparringPartnersInput = z
  .object({
    eventId: z.string().uuid(),
    sparringPartnerIds: z.array(z.string().uuid()).min(1).max(50),
  })
  .strict();
export type AttachSparringPartnersInput = z.infer<
  typeof attachSparringPartnersInput
>;
