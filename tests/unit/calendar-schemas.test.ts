/**
 * Phase 3 Wave 0 — Zod discriminated-union per event_type.
 *
 * Asserts: strict mode, i18n-key error messages, write-time RRULE horizon
 * validation, per-type required fields.
 *
 * Reference: 03-CONTEXT.md D-47 (six event types), D-48 (per-type RBAC),
 *            D-55 (write-time horizon), VALID-06 (.strict() everywhere);
 *            03-RESEARCH.md §Pattern 5 (Zod discriminated union);
 *            03-VALIDATION.md Wave 0 Requirements (calendar-schemas.test.ts).
 *
 * Implemented in Plan 03-08 (Wave 6) — all branches converted from it.todo.
 * The schemas module shipped in Plan 03-03.
 */
import { describe, it, expect } from 'vitest';

import { randomUUID } from 'node:crypto';

import { eventCreateInput } from '@/server/trpc/schemas/calendar';

// Use real v4 UUIDs — Zod 4's .uuid() guard validates the version digit, so
// hand-crafted '11111...' strings get rejected as invalid_format.
const userIdA = randomUUID();
const userIdB = randomUUID();
const userIdC = randomUUID();
const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
const futureEnd = new Date(futureStart.getTime() + 90 * 60 * 1000);

describe('eventCreateInput — discriminated union per event type', () => {
  it('accepts a valid training payload (type=event_type_training + TRAIN-01 fields)', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_training',
      title: 'Training A',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
      trainingTypeCode: 'training_type_group',
      organisationCode: 'org_academy',
      trainerId: userIdA,
      durationMinutes: 90,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid tournament payload (type=event_type_tournament + TOURN-01 fields)', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_tournament',
      title: 'Belgian Open',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
      city: 'Antwerpen',
      country: 'BE',
      ageCategoryCode: 'age_senior',
      tournamentTypeCode: 'tournament_belgium',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid meeting payload (type=event_type_meeting + invited users)', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_meeting',
      title: 'Coach standup',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [
        { userId: userIdA, roleInEvent: 'participant' },
        { userId: userIdB, roleInEvent: 'invitee' },
      ],
      force: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid stage payload (type=event_type_stage + place + country)', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_stage',
      title: 'Zomerstage',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
      place: 'Madrid',
      country: 'ES',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid eval_conversation payload (type=event_type_eval_conversation + player + evaluator)', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_eval_conversation',
      title: 'Halfjaarlijks gesprek',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
      evaluatorUserId: userIdA,
      playerUserId: userIdB,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid medical payload (type=event_type_medical + MED-EVENT fields)', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_medical',
      title: 'Knie-controle',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
      isInjury: false,
      doctor: 'Dr. Janssens',
    });
    expect(result.success).toBe(true);
  });

  it('rejects training payload with unknown field (.strict() — VALID-06)', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_training',
      title: 'Training A',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
      trainingTypeCode: 'training_type_group',
      organisationCode: 'org_academy',
      trainerId: userIdA,
      durationMinutes: 90,
      // Unknown field — .strict() must reject.
      forbiddenField: 'wat?',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issueKinds = result.error.issues.map((i) => i.code);
      expect(issueKinds).toContain('unrecognized_keys');
    }
  });

  it('emits i18n-key error messages (errors.calendar.endBeforeStart / errors.field.required)', () => {
    // endBeforeStart — endsAt <= startsAt
    const r1 = eventCreateInput.safeParse({
      type: 'event_type_meeting',
      title: 'Bad time',
      startsAt: futureEnd,
      endsAt: futureStart, // before start
      allDay: false,
      participants: [],
      force: false,
    });
    expect(r1.success).toBe(false);
    if (!r1.success) {
      const messages = r1.error.issues.map((i) => i.message);
      expect(messages).toContain('errors.calendar.endBeforeStart');
    }

    // required — missing required extension field on training branch.
    const r2 = eventCreateInput.safeParse({
      type: 'event_type_training',
      title: 'Missing fields',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
      // trainingTypeCode missing — should fail with required-key error.
    });
    expect(r2.success).toBe(false);
  });

  it('rejects when endsAt <= startsAt', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_meeting',
      title: 'Zero-length',
      startsAt: futureStart,
      endsAt: futureStart, // identical
      allDay: false,
      participants: [],
      force: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects rrule string with DTSTART: per Anti-Pattern 1', () => {
    // Zod rruleStringSchema rejects DTSTART:-containing strings (write-time
    // catch — the runtime validateHorizon call in the router catches more,
    // but the schema covers the structural side here.)
    const result = eventCreateInput.safeParse({
      type: 'event_type_meeting',
      title: 'Bad RRULE',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
      rrule: 'DTSTART:20260101T100000Z\nRRULE:FREQ=WEEKLY;COUNT=3',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('errors.calendar.rruleHorizonExceeded');
    }
  });

  it('rejects when type is unknown (discriminator branch missing)', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_unknown_thing',
      title: 'unknown',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [],
      force: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.code);
      // Zod 4 emits invalid_union for discriminator mismatch.
      expect(
        codes.includes('invalid_union') ||
          codes.includes('invalid_value') ||
          codes.includes('invalid_literal'),
      ).toBe(true);
    }
  });
});

// Sanity guard: ensure participants array shape is validated.
describe('participantInputSchema', () => {
  it('accepts a valid participant with organizer/participant/invitee role', () => {
    const result = eventCreateInput.safeParse({
      type: 'event_type_meeting',
      title: 'Meeting',
      startsAt: futureStart,
      endsAt: futureEnd,
      allDay: false,
      participants: [
        { userId: userIdA, roleInEvent: 'organizer' },
        { userId: userIdB, roleInEvent: 'participant' },
        { userId: userIdC, roleInEvent: 'invitee' },
      ],
      force: false,
    });
    expect(result.success).toBe(true);
  });
});
