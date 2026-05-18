/**
 * calendar.* tRPC router — Phase 3 polymorphic calendar (D-47..D-58).
 *
 * 9 procedures:
 *   - list                          — protectedProcedure. RLS scopes via
 *                                     calendar_events_visible_to. Server-side
 *                                     rrule expansion per D-53; read-time horizon
 *                                     clamp per D-55.
 *   - event.create                  — protectedProcedure + requireRoleForEventType
 *                                     (D-48). validateHorizon per D-55. Conflict
 *                                     probe (D-57). audit on success + override
 *                                     audit when force:true.
 *   - event.update                  — protectedProcedure (creator/TD-only via RLS).
 *                                     Same conflict probe + audit.
 *   - event.delete                  — protectedProcedure. D-58c cascade order:
 *                                     SELECT FOR UPDATE → JSONB snapshot →
 *                                     writeAudit → DELETE → tx commit.
 *   - event.declineParticipation    — protectedProcedure. Updates own rsvp_status;
 *                                     D-58 RSVP decline ≠ delete.
 *   - event.cancelOccurrence        — protectedProcedure. Writes
 *                                     calendar_event_exceptions(cancelled=true).
 *   - event.get                     — protectedProcedure. NOT_FOUND on RLS-filtered
 *                                     (D-36 carry-forward).
 *   - event.detectConflicts         — protectedProcedure. SECURITY DEFINER
 *                                     cross-scope + service-layer redaction
 *                                     (D-57 + D-57b). Never blocks; returns
 *                                     {conflicts, blocked: false}.
 *   - filterOptions.list            — protectedProcedure. Scope-filtered typeahead
 *                                     source for filter bar (CAL-04+CAL-05).
 *
 * Audit codes emitted (6 total — must match tests/integration/calendar-audit.test.ts):
 *   calendar_event_created, calendar_event_updated, calendar_event_deleted,
 *   calendar_event_declined, calendar_event_conflict_override,
 *   calendar_event_exception_created
 *
 * Reference: .planning/phases/03-kalender/03-CONTEXT.md D-47..D-58
 *            .planning/phases/03-kalender/03-RESEARCH.md §Example 1/2/3
 *            src/server/trpc/routers/player.ts (canonical Phase 2 analog)
 */
import { TRPCError } from '@trpc/server';
import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { z } from 'zod';

import {
  ensureHorizon,
  expandRrule,
  formatOccurrenceDate,
  serializeRrule,
  splitRRule,
  validateHorizon,
  type ExceptionInput,
} from '@/lib/rrule';
import {
  redactConflict,
  type RedactedConflict,
} from '@/lib/calendar/conflicts';
import type { Role } from '@/server/auth/permissions';
import { users } from '@/server/db/schema/auth';
import { db as rawDb, type DbClient } from '@/server/db/client';
import {
  calendarEventExceptions,
  calendarEventParticipants,
  calendarEvents,
  evalConversations,
  medicalAppointments,
  meetings,
  stages,
  tournaments,
  trainingSessions,
} from '@/server/db/schema/calendar';
import { players } from '@/server/db/schema/players';
import { sessionSparringPartners } from '@/server/db/schema/training';
import { trainers } from '@/server/db/schema/trainers';

import { writeAudit } from '../middleware/audit';
import { canCreateEventType } from '../middleware/calendarCreate';
import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
import {
  attachSparringPartnersInput,
  cancelOccurrenceInput,
  declineParticipationInput,
  detectConflictsInput,
  editRecurringInput,
  eventCreateInput,
  eventDeleteInput,
  eventGetInput,
  eventUpdateInput,
  filterOptionsInput,
  listInput,
  type EditRecurringEditsInput,
} from '../schemas/calendar';
import { router } from '../trpc';

// ─── Response shapes ────────────────────────────────────────────────────

interface EventInstance {
  id: string;
  typeCode: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  description: string | null;
  createdBy: string;
  hasRrule: boolean;
  /** null for non-recurring events. */
  occurrenceDate: Date | null;
  isException: boolean;
  cancelled: boolean;
  /** Lightweight participant summary — full participant list fetched separately
   *  by event.get. Saves a per-participant JOIN on list queries. */
  participantUserIds: string[];
  /** Set by the cheap adjacent-overlap pass below — UI surface 3 hint. */
  conflicting: boolean;
  /** Computed: creator OR TD. */
  canEdit: boolean;
  canDelete: boolean;
  /** Phase 4 UI4-D07 — needs-scoring corner overlay on the chip.
   *
   * True when:
   *   - event.type = 'event_type_training'
   *   - event has ended (endsAt < now)
   *   - now - endsAt <= 14d
   *   - caller is trainer-of-session OR technical_director
   *   - at least one session_participants row has NULL quality_score for
   *     the same (event_id, occurrence_date) — but we compute per-event,
   *     so we use a per-event LEFT JOIN check that defaults to TRUE when
   *     no rows yet exist (i.e., no one has been scored yet).
   *
   * False for non-training events or for callers without the score-write
   * scope; never set true for player / parent / academy_manager — the chip
   * overlay only fires for the action-owner role (T-04-53 mitigation).
   */
  needsScoring: boolean;
  /** Phase 4 UI4-D07 — needs-result corner overlay on the chip.
   *
   * True when:
   *   - event.type = 'event_type_tournament'
   *   - event has ended (endsAt < now)
   *   - now - endsAt <= 14d
   *   - caller is a calendar_event_participants row on this event
   *   - no tournament_results row exists for (caller, event)
   *
   * Player-only chip overlay; trainer/TD see the equivalent on
   * TournamentResultsLeaderboard (T-04-53 mitigation).
   */
  needsResult: boolean;
}

// ─── Helper: fetch per-type extension row ───────────────────────────────
//
// `db` is typed loosely (`AnyTx`) so the helper composes with either the
// top-level handle or a `db.transaction(...)` tx handle. Each branch uses
// only the methods both shapes share. The narrow `DbClient` type from
// `@/server/db/client` is the export for code that needs the strict shape
// (e.g. the top-level router handlers).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchExtensionRow(
  db: any,
  typeCode: string,
  eventId: string,
): Promise<unknown | null> {
  switch (typeCode) {
    case 'event_type_training': {
      const r = await db
        .select()
        .from(trainingSessions)
        .where(eq(trainingSessions.eventId, eventId));
      return r[0] ?? null;
    }
    case 'event_type_tournament': {
      const r = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.eventId, eventId));
      return r[0] ?? null;
    }
    case 'event_type_meeting': {
      const r = await db
        .select()
        .from(meetings)
        .where(eq(meetings.eventId, eventId));
      return r[0] ?? null;
    }
    case 'event_type_stage': {
      const r = await db
        .select()
        .from(stages)
        .where(eq(stages.eventId, eventId));
      return r[0] ?? null;
    }
    case 'event_type_eval_conversation': {
      const r = await db
        .select()
        .from(evalConversations)
        .where(eq(evalConversations.eventId, eventId));
      return r[0] ?? null;
    }
    case 'event_type_medical': {
      const r = await db
        .select()
        .from(medicalAppointments)
        .where(eq(medicalAppointments.eventId, eventId));
      return r[0] ?? null;
    }
    default:
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'errors.calendar.typeRequired',
      });
  }
}

// ─── Helper: per-type extension INSERT inside a tx ─────────────────────
//
// `input` is the discriminated-union shape returned by Zod; the switch on
// `input.type` lets TS narrow each branch to its concrete extension fields.

type EventCreateInputT = z.infer<typeof eventCreateInput>;
type EventUpdateInputT = z.infer<typeof eventUpdateInput>;

// `tx` is typed loosely so the helpers compose with either a top-level db
// handle (PostgresJsDatabase) or a transaction handle (PgTransaction) without
// the call site needing to coerce types — Drizzle returns subtly different
// instances from `db.transaction(...)` and the public `db` re-export. Each
// helper only uses methods both shapes share (insert / delete / select).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;

async function insertExtensionRow(
  tx: AnyTx,
  input: EventCreateInputT | EventUpdateInputT,
  eventId: string,
): Promise<void> {
  switch (input.type) {
    case 'event_type_training':
      await tx.insert(trainingSessions).values({
        eventId,
        durationMinutes: input.durationMinutes,
        trainingTypeCode: input.trainingTypeCode,
        organisationCode: input.organisationCode,
        trainerId: input.trainerId,
      });
      break;
    case 'event_type_tournament':
      await tx.insert(tournaments).values({
        eventId,
        city: input.city,
        country: input.country,
        ageCategoryCode: input.ageCategoryCode,
        tournamentTypeCode: input.tournamentTypeCode,
      });
      break;
    case 'event_type_meeting':
      await tx.insert(meetings).values({ eventId });
      break;
    case 'event_type_stage':
      await tx.insert(stages).values({
        eventId,
        place: input.place,
        country: input.country,
      });
      break;
    case 'event_type_eval_conversation':
      await tx.insert(evalConversations).values({
        eventId,
        evaluatorUserId: input.evaluatorUserId,
        playerUserId: input.playerUserId,
      });
      break;
    case 'event_type_medical': {
      // medicalCreateBranch.doctor is `string | undefined` — schema is
      // .optional() with no default. Normalise to `null` for the DB column
      // (text NULL is the storage representation of "no doctor").
      const doctor = input.doctor ?? null;
      await tx.insert(medicalAppointments).values({
        eventId,
        isInjury: input.isInjury,
        doctor,
      });
      break;
    }
  }
}

// ─── Helper: per-type extension COPY inside a tx (used by editRecurring) ─
//
// Phase 4 — Plan 04-06 D-84 "Deze en toekomstige": when a recurring event is
// split into old + new, the extension row on the old event is cloned onto
// the new event, then the edits relevant to that extension are applied. The
// helper switches on the event's typeCode (which is immutable per CR-02),
// pulls the old row, and INSERTs the new event_id with the edited fields
// overlaying the originals.

async function copyExtensionRow(
  tx: AnyTx,
  typeCode: string,
  oldEventId: string,
  newEventId: string,
  edits: EditRecurringEditsInput,
): Promise<void> {
  switch (typeCode) {
    case 'event_type_training': {
      const r = await tx
        .select()
        .from(trainingSessions)
        .where(eq(trainingSessions.eventId, oldEventId));
      const old = r[0];
      if (!old) return;
      await tx.insert(trainingSessions).values({
        eventId: newEventId,
        durationMinutes: edits.durationMinutes ?? old.durationMinutes,
        trainingTypeCode: edits.trainingTypeCode ?? old.trainingTypeCode,
        organisationCode: edits.organisationCode ?? old.organisationCode,
        trainerId: edits.trainerId ?? old.trainerId,
      });
      break;
    }
    case 'event_type_tournament': {
      const r = await tx
        .select()
        .from(tournaments)
        .where(eq(tournaments.eventId, oldEventId));
      const old = r[0];
      if (!old) return;
      await tx.insert(tournaments).values({
        eventId: newEventId,
        city: edits.city ?? old.city,
        country: edits.country ?? old.country,
        ageCategoryCode: edits.ageCategoryCode ?? old.ageCategoryCode,
        tournamentTypeCode: edits.tournamentTypeCode ?? old.tournamentTypeCode,
      });
      break;
    }
    case 'event_type_meeting': {
      // Meetings have no extension columns; just clone the row marker.
      await tx.insert(meetings).values({ eventId: newEventId });
      break;
    }
    case 'event_type_stage': {
      const r = await tx
        .select()
        .from(stages)
        .where(eq(stages.eventId, oldEventId));
      const old = r[0];
      if (!old) return;
      await tx.insert(stages).values({
        eventId: newEventId,
        place: edits.place ?? old.place,
        country: edits.country ?? old.country,
      });
      break;
    }
    case 'event_type_eval_conversation': {
      const r = await tx
        .select()
        .from(evalConversations)
        .where(eq(evalConversations.eventId, oldEventId));
      const old = r[0];
      if (!old) return;
      await tx.insert(evalConversations).values({
        eventId: newEventId,
        evaluatorUserId: edits.evaluatorUserId ?? old.evaluatorUserId,
        playerUserId: edits.playerUserId ?? old.playerUserId,
      });
      break;
    }
    case 'event_type_medical': {
      const r = await tx
        .select()
        .from(medicalAppointments)
        .where(eq(medicalAppointments.eventId, oldEventId));
      const old = r[0];
      if (!old) return;
      await tx.insert(medicalAppointments).values({
        eventId: newEventId,
        isInjury: edits.isInjury ?? old.isInjury,
        // `edits.doctor` is `string | null | undefined`. undefined => preserve
        // old value; explicit null => clear; string => override. Mirrors the
        // optional/nullable pattern used elsewhere in this file.
        doctor:
          edits.doctor === undefined ? (old.doctor ?? null) : edits.doctor,
      });
      break;
    }
    default:
      break;
  }
}

// ─── Helper: per-type extension UPDATE in place (used by editRecurring) ─
//
// Phase 4 — Plan 04-06 D-84 "Alle in de reeks": when the user updates the
// entire series in place, the extension row is UPDATED with the relevant
// edits. Past session_participants are untouched — the UPDATE never cascades
// to those (D-83). Drizzle UPDATEs only change the listed columns.

async function updateExtensionRow(
  tx: AnyTx,
  typeCode: string,
  eventId: string,
  edits: EditRecurringEditsInput,
): Promise<void> {
  switch (typeCode) {
    case 'event_type_training': {
      const patch: Record<string, unknown> = {};
      if (edits.durationMinutes !== undefined)
        patch.durationMinutes = edits.durationMinutes;
      if (edits.trainingTypeCode !== undefined)
        patch.trainingTypeCode = edits.trainingTypeCode;
      if (edits.organisationCode !== undefined)
        patch.organisationCode = edits.organisationCode;
      if (edits.trainerId !== undefined) patch.trainerId = edits.trainerId;
      if (Object.keys(patch).length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx
        .update(trainingSessions)
        .set(patch as any)
        .where(eq(trainingSessions.eventId, eventId));
      break;
    }
    case 'event_type_tournament': {
      const patch: Record<string, unknown> = {};
      if (edits.city !== undefined) patch.city = edits.city;
      if (edits.country !== undefined) patch.country = edits.country;
      if (edits.ageCategoryCode !== undefined)
        patch.ageCategoryCode = edits.ageCategoryCode;
      if (edits.tournamentTypeCode !== undefined)
        patch.tournamentTypeCode = edits.tournamentTypeCode;
      if (Object.keys(patch).length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx
        .update(tournaments)
        .set(patch as any)
        .where(eq(tournaments.eventId, eventId));
      break;
    }
    case 'event_type_meeting':
      // No extension columns to update.
      return;
    case 'event_type_stage': {
      const patch: Record<string, unknown> = {};
      if (edits.place !== undefined) patch.place = edits.place;
      if (edits.country !== undefined) patch.country = edits.country;
      if (Object.keys(patch).length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx
        .update(stages)
        .set(patch as any)
        .where(eq(stages.eventId, eventId));
      break;
    }
    case 'event_type_eval_conversation': {
      const patch: Record<string, unknown> = {};
      if (edits.evaluatorUserId !== undefined)
        patch.evaluatorUserId = edits.evaluatorUserId;
      if (edits.playerUserId !== undefined)
        patch.playerUserId = edits.playerUserId;
      if (Object.keys(patch).length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx
        .update(evalConversations)
        .set(patch as any)
        .where(eq(evalConversations.eventId, eventId));
      break;
    }
    case 'event_type_medical': {
      const patch: Record<string, unknown> = {};
      if (edits.isInjury !== undefined) patch.isInjury = edits.isInjury;
      if (edits.doctor !== undefined) patch.doctor = edits.doctor;
      if (Object.keys(patch).length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx
        .update(medicalAppointments)
        .set(patch as any)
        .where(eq(medicalAppointments.eventId, eventId));
      break;
    }
    default:
      break;
  }
}

// ─── Helper: per-type extension DELETE inside a tx (used by update) ────

async function deleteExtensionRow(
  tx: AnyTx,
  typeCode: string,
  eventId: string,
): Promise<void> {
  switch (typeCode) {
    case 'event_type_training':
      await tx
        .delete(trainingSessions)
        .where(eq(trainingSessions.eventId, eventId));
      break;
    case 'event_type_tournament':
      await tx.delete(tournaments).where(eq(tournaments.eventId, eventId));
      break;
    case 'event_type_meeting':
      await tx.delete(meetings).where(eq(meetings.eventId, eventId));
      break;
    case 'event_type_stage':
      await tx.delete(stages).where(eq(stages.eventId, eventId));
      break;
    case 'event_type_eval_conversation':
      await tx
        .delete(evalConversations)
        .where(eq(evalConversations.eventId, eventId));
      break;
    case 'event_type_medical':
      await tx
        .delete(medicalAppointments)
        .where(eq(medicalAppointments.eventId, eventId));
      break;
    default:
      // Unknown type — leave extension untouched. Defensive.
      break;
  }
}

// ─── Router definition ────────────────────────────────────────────────

export const calendarRouter = router({
  // ============================================================
  // list({from, to, filters})
  // ============================================================
  // Per D-53: server-side rrule expansion. Returns concrete EventInstance[].
  // Per D-55: read-time horizon enforced at Zod (range <= 2y) AND clamped per-row.
  // RLS does the scope filter via calendar_events_visible_to() (transparent here).
  list: protectedProcedure
    .input(listInput)
    .query(async ({ ctx, input }): Promise<EventInstance[]> => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;
      const callerId = ctx.scope.userId;
      const callerRole = ctx.scope.role;

      // Fetch base events that either:
      //   - non-recurring & overlap with [from, to]
      //   - recurring & starts before `to`
      // RLS narrows automatically.
      const baseRows = await db
        .select()
        .from(calendarEvents)
        .where(
          or(
            and(
              isNull(calendarEvents.rrule),
              lte(calendarEvents.startsAt, input.to),
              gte(calendarEvents.endsAt, input.from),
            ),
            and(
              isNotNull(calendarEvents.rrule),
              lte(calendarEvents.startsAt, input.to),
            ),
          ),
        );

      if (baseRows.length === 0) return [];

      // Fetch exceptions for all recurring rows in one shot.
      const recurringIds = baseRows
        .filter((r) => r.rrule)
        .map((r) => r.id);
      const exceptions =
        recurringIds.length > 0
          ? await db
              .select()
              .from(calendarEventExceptions)
              .where(
                sql`${calendarEventExceptions.eventId} = ANY(${recurringIds})`,
              )
          : [];

      // Fetch participants for all visible events in one shot
      // (for filter + UI hints).
      const allIds = baseRows.map((r) => r.id);
      const participants = await db
        .select()
        .from(calendarEventParticipants)
        .where(sql`${calendarEventParticipants.eventId} = ANY(${allIds})`);

      const participantsByEvent = new Map<string, string[]>();
      for (const p of participants) {
        const arr = participantsByEvent.get(p.eventId) ?? [];
        arr.push(p.userId);
        participantsByEvent.set(p.eventId, arr);
      }

      // Flatten: one EventInstance per occurrence.
      const instances: EventInstance[] = [];
      for (const row of baseRows) {
        const canEdit =
          row.createdBy === callerId || callerRole === 'technical_director';
        const canDelete = canEdit;
        const participantUserIds = participantsByEvent.get(row.id) ?? [];

        if (!row.rrule) {
          instances.push({
            id: row.id,
            typeCode: row.typeCode,
            title: row.title,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            allDay: row.allDay,
            location: row.location,
            description: row.description,
            createdBy: row.createdBy,
            hasRrule: false,
            occurrenceDate: null,
            isException: false,
            cancelled: false,
            participantUserIds,
            conflicting: false,
            canEdit,
            canDelete,
            needsScoring: false,
            needsResult: false,
          });
          continue;
        }

        // Recurring: expand
        const exForThis: ExceptionInput[] = exceptions
          .filter((e) => e.eventId === row.id)
          .map((e) => ({
            occurrenceDate: e.occurrenceDate,
            cancelled: e.cancelled,
            overrideStartsAt: e.overrideStartsAt,
            overrideEndsAt: e.overrideEndsAt,
            overrideTitle: e.overrideTitle,
            overrideLocation: e.overrideLocation,
            overrideDescription: e.overrideDescription,
          }));
        const durationMs = row.endsAt.getTime() - row.startsAt.getTime();
        const occurrences = expandRrule(
          row.rrule,
          row.startsAt,
          durationMs,
          input.from,
          input.to,
          exForThis,
        );
        for (const occ of occurrences) {
          instances.push({
            id: row.id,
            typeCode: row.typeCode,
            title: occ.titleOverride ?? row.title,
            startsAt: occ.startsAt,
            endsAt: occ.endsAt,
            allDay: row.allDay,
            location: occ.locationOverride ?? row.location,
            description: occ.descriptionOverride ?? row.description,
            createdBy: row.createdBy,
            hasRrule: true,
            occurrenceDate: occ.occurrenceDate,
            isException:
              occ.titleOverride !== null ||
              occ.locationOverride !== null ||
              occ.descriptionOverride !== null,
            // cancelled occurrences are already skipped by expandRrule
            cancelled: false,
            participantUserIds,
            conflicting: false,
            canEdit,
            canDelete,
            needsScoring: false,
            needsResult: false,
          });
        }
      }

      // Cheap conflict-annotation pass: scan adjacent same-participant overlaps.
      // (UI surface 3 from CONTEXT — passive hint icon on chips with
      //  conflicting=true)
      for (let i = 0; i < instances.length; i++) {
        for (let j = i + 1; j < instances.length; j++) {
          const a = instances[i];
          const b = instances[j];
          if (!a || !b) continue;
          if (a.id === b.id) continue;
          if (a.startsAt >= b.endsAt || b.startsAt >= a.endsAt) continue;
          const aSet = new Set(a.participantUserIds);
          const overlap = b.participantUserIds.some((u) => aSet.has(u));
          if (overlap) {
            a.conflicting = true;
            b.conflicting = true;
          }
        }
      }

      // ============================================================
      // Phase 4 UI4-D07 — needsScoring / needsResult corner-badge flags.
      // ============================================================
      //
      // Compute per-event flags driving the EventChip yellow ⚠ overlay.
      //
      // T-04-53 invariant: only the role with WRITE scope sees the flag —
      // never leak "pending action" status to roles that can't act on it.
      // Defensive: any DB query failure leaves the defaults (false, false)
      // — silent degradation rather than 500-ing the whole calendar.
      const FOURTEEN_DAYS_MS_CAL = 14 * 24 * 60 * 60 * 1000;
      const nowTs = Date.now();
      try {
        // Collect candidate event ids by type, within the 14d ended-window.
        const candidateTrainingIds: string[] = [];
        const candidateTournamentIds: string[] = [];
        for (const inst of instances) {
          const elapsed = nowTs - inst.endsAt.getTime();
          if (elapsed <= 0 || elapsed > FOURTEEN_DAYS_MS_CAL) continue;
          if (inst.typeCode === 'event_type_training') {
            candidateTrainingIds.push(inst.id);
          } else if (inst.typeCode === 'event_type_tournament') {
            candidateTournamentIds.push(inst.id);
          }
        }

        // needsScoring — trainer/TD only.
        if (
          candidateTrainingIds.length > 0 &&
          (callerRole === 'trainer' || callerRole === 'technical_director')
        ) {
          // A training "needs scoring" if it has ended in last 14d AND
          // either (a) there are session_participants rows with NULL
          // quality_score, OR (b) NO session_participants rows exist yet
          // (the trainer hasn't started scoring). Use SQL EXISTS via a
          // simple aggregate: events whose calendar_event_participants
          // count exceeds the count of scored session_participants.
          const sessionStats = await db.execute<{
            event_id: string;
            participant_count: number;
            scored_count: number;
          }>(sql`
            SELECT
              ce.id AS event_id,
              (
                SELECT COUNT(*)::int FROM calendar_event_participants cep
                JOIN users u ON u.id = cep.user_id
                WHERE cep.event_id = ce.id AND u.role = 'player'
              ) AS participant_count,
              (
                SELECT COUNT(*)::int FROM session_participants sp
                WHERE sp.event_id = ce.id
                  AND sp.quality_score IS NOT NULL
              ) AS scored_count
            FROM calendar_events ce
            WHERE ce.id = ANY(${candidateTrainingIds}::uuid[])
          `);
          const statsRows: Array<{
            event_id: string;
            participant_count: number;
            scored_count: number;
          }> = Array.isArray(sessionStats)
            ? (sessionStats as Array<{
                event_id: string;
                participant_count: number;
                scored_count: number;
              }>)
            : ((sessionStats as unknown as {
                rows?: Array<{
                  event_id: string;
                  participant_count: number;
                  scored_count: number;
                }>;
              }).rows ?? []);
          const trainingNeedsScoring = new Set<string>();
          for (const r of statsRows) {
            if (Number(r.participant_count) > Number(r.scored_count)) {
              trainingNeedsScoring.add(r.event_id);
            }
          }
          // For trainer scope: only mark events where this trainer is the
          // session trainer. TD always sees the flag.
          let trainerSessionIds = new Set<string>();
          if (callerRole === 'trainer') {
            const trainerRows = await db.execute<{ event_id: string }>(sql`
              SELECT event_id FROM training_sessions
              WHERE trainer_id = ${callerId}
                AND event_id = ANY(${candidateTrainingIds}::uuid[])
            `);
            const rows: Array<{ event_id: string }> = Array.isArray(trainerRows)
              ? (trainerRows as Array<{ event_id: string }>)
              : ((trainerRows as unknown as { rows?: Array<{ event_id: string }> }).rows ?? []);
            trainerSessionIds = new Set(rows.map((r) => r.event_id));
          }
          for (const inst of instances) {
            if (inst.typeCode !== 'event_type_training') continue;
            if (!trainingNeedsScoring.has(inst.id)) continue;
            if (callerRole === 'trainer' && !trainerSessionIds.has(inst.id)) continue;
            inst.needsScoring = true;
          }
        }

        // needsResult — player only, and only for tournaments they participate in.
        if (
          candidateTournamentIds.length > 0 &&
          callerRole === 'player'
        ) {
          // Tournament rows where caller is participant AND no
          // tournament_results row exists.
          const pendingRows = await db.execute<{ event_id: string }>(sql`
            SELECT cep.event_id
            FROM calendar_event_participants cep
            LEFT JOIN tournament_results tr
              ON tr.tournament_event_id = cep.event_id
              AND tr.player_user_id = cep.user_id
            WHERE cep.user_id = ${callerId}
              AND cep.event_id = ANY(${candidateTournamentIds}::uuid[])
              AND tr.tournament_event_id IS NULL
          `);
          const rows: Array<{ event_id: string }> = Array.isArray(pendingRows)
            ? (pendingRows as Array<{ event_id: string }>)
            : ((pendingRows as unknown as { rows?: Array<{ event_id: string }> }).rows ?? []);
          const pendingSet = new Set(rows.map((r) => r.event_id));
          for (const inst of instances) {
            if (inst.typeCode !== 'event_type_tournament') continue;
            if (pendingSet.has(inst.id)) inst.needsResult = true;
          }
        }
      } catch {
        // Silent degradation — chip overlay is decorative, never block list.
      }

      // Apply Zod-decoded filters (cosmetic — RLS already scoped).
      if (input.filters) {
        const f = input.filters;
        let filtered = instances;
        if (f.types && f.types.length > 0) {
          const set = new Set(f.types);
          filtered = filtered.filter((i) => set.has(i.typeCode));
        }
        if (f.playerIds && f.playerIds.length > 0) {
          const ids = new Set(f.playerIds);
          filtered = filtered.filter((i) =>
            i.participantUserIds.some((u) => ids.has(u)),
          );
        }
        if (f.trainerIds && f.trainerIds.length > 0) {
          const ids = new Set(f.trainerIds);
          filtered = filtered.filter(
            (i) =>
              ids.has(i.createdBy) ||
              i.participantUserIds.some((u) => ids.has(u)),
          );
        }
        return filtered;
      }

      return instances;
    }),

  // ============================================================
  // event subgroup
  // ============================================================
  event: router({
    // ----------------------------------------------
    // event.create
    // ----------------------------------------------
    create: protectedProcedure
      .input(eventCreateInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        // D-48 per-type RBAC gate — checked inline rather than as a
        // middleware because the role allowlist depends on the parsed
        // input.type, which is not available to `.use()` middleware
        // without a non-trivial getRawInput dance. The shared
        // `canCreateEventType` predicate from middleware/calendarCreate.ts
        // is the single source of truth for the matrix (D-48). The
        // calendar_events RLS INSERT WITH CHECK created_by=current_user_id()
        // is defence in depth at the DB layer.
        if (!canCreateEventType(ctx.scope.role, input.type)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'role_not_allowed',
          });
        }
        const db = (ctx.db as DbClient | undefined) ?? rawDb;
        const callerId = ctx.scope.userId;

        // D-55: write-time horizon validation.
        let rruleToStore = input.rrule;
        if (rruleToStore) {
          try {
            // If the UI sent "Eindigt: Nooit", auto-inject UNTIL = +2y.
            rruleToStore = ensureHorizon(rruleToStore, new Date());
            validateHorizon(rruleToStore, new Date());
          } catch (err) {
            if (err instanceof TRPCError) throw err;
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'errors.calendar.rruleHorizonExceeded',
            });
          }
        }

        // CR-04: validate every participant userId is in the caller's
        // visibility scope BEFORE any DB writes. Without this gate, the
        // schema only checks UUIDs, RLS only checks event ownership, and
        // the SECURITY DEFINER conflict probe (which deliberately bypasses
        // RLS per D-57) would leak overlap data for arbitrary userIds.
        if (input.participants.length > 0) {
          await assertParticipantsInScope(
            db,
            ctx.scope,
            input.participants.map((p) => p.userId),
          );
        }

        // D-57: conflict probe before write. We always run the probe when
        // there are participants — even with force:true — so the override
        // audit can record the conflicts being overridden (WR-06: the old
        // code wrote calendar_event_conflict_override on every force:true
        // call, even when there were no conflicts to override; this
        // polluted the audit feed with phantom overrides from bulk imports
        // or buggy retries).
        //
        // overriddenConflicts is captured here and consumed by the
        // override-audit block after the tx commits.
        let overriddenConflicts: RedactedConflict[] = [];
        if (input.participants.length > 0) {
          const conflicts = await detectConflictsForParticipants(
            db,
            ctx.scope,
            input.startsAt,
            input.endsAt,
            input.participants.map((p) => p.userId),
            // excludeEventId: this is a new event — nothing to exclude.
            undefined,
          );
          if (conflicts.length > 0 && !input.force) {
            // Return the conflicts as a soft error — the UI surfaces
            // ConflictWarning and resubmits with force:true if the user
            // clicks "Toch opslaan".
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'errors.calendar.conflictDetected',
              cause: { conflicts, blocked: false },
            });
          }
          overriddenConflicts = conflicts;
        }

        let eventId: string;
        try {
          eventId = await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(calendarEvents)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .values({
                typeCode: input.type,
                title: input.title,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                allDay: input.allDay,
                location: input.location ?? null,
                description: input.description ?? null,
                rrule: rruleToStore ?? null,
                createdBy: callerId,
              } as any)
              .returning({ id: calendarEvents.id });
            const first = inserted[0];
            if (!first) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'calendar_event_insert_returned_no_row',
              });
            }
            const id = first.id;
            await insertExtensionRow(tx, input, id);

            // Insert participants. Add the creator as 'organizer' if not
            // present. Element type is widened to plain strings so the
            // 'organizer'/'accepted' add-on tuple satisfies the inferred
            // array element type (Drizzle's $inferInsert is strict about
            // narrow literals).
            const participantValues: Array<{
              eventId: string;
              userId: string;
              roleInEvent: string;
              rsvpStatus: string;
            }> = input.participants.map((p) => ({
              eventId: id,
              userId: p.userId,
              roleInEvent: p.roleInEvent,
              rsvpStatus: 'pending',
            }));
            if (!participantValues.find((p) => p.userId === callerId)) {
              participantValues.push({
                eventId: id,
                userId: callerId,
                roleInEvent: 'organizer',
                rsvpStatus: 'accepted',
              });
            }
            if (participantValues.length > 0) {
              await tx
                .insert(calendarEventParticipants)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .values(participantValues as any);
            }

            return id;
          });
        } catch (err: unknown) {
          // CHECK calendar_events_ends_after_starts violation → BAD_REQUEST
          const e = err as { code?: string; constraint?: string };
          if (
            e.code === '23514' &&
            (e.constraint?.includes('ends_after_starts') ?? false)
          ) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'errors.calendar.endBeforeStart',
            });
          }
          throw err;
        }

        // If we created with force:true AND there were actual conflicts,
        // audit the override BEFORE the success audit so the audit trail
        // shows the explicit decision-and-mutation. WR-06: only emit when
        // conflicts existed — a force:true call with an empty
        // overriddenConflicts has nothing to override and is silently a
        // normal create, not a policy decision worth logging.
        if (input.force && overriddenConflicts.length > 0) {
          await writeAudit(ctx, {
            action: 'calendar_event_conflict_override',
            resourceType: 'calendar_event',
            resourceId: eventId,
            newValues: {
              force: true,
              participants: input.participants.map((p) => p.userId),
              // WR-06: capture the actual conflicts the caller is
              // overriding so a TD reviewing the audit feed can answer
              // "which conflicts did the team choose to override".
              conflicts: overriddenConflicts.map((c) => ({
                eventId: c.eventId,
                typeCode: c.typeCode,
                participant: c.participant,
                startsAt:
                  c.startsAt instanceof Date
                    ? c.startsAt.toISOString()
                    : c.startsAt,
                endsAt:
                  c.endsAt instanceof Date
                    ? c.endsAt.toISOString()
                    : c.endsAt,
                detailMode: c.detailMode,
              })),
            },
          });
        }

        await writeAudit(ctx, {
          action: 'calendar_event_created',
          resourceType: 'calendar_event',
          resourceId: eventId,
          newValues: {
            typeCode: input.type,
            startsAt: input.startsAt.toISOString(),
            endsAt: input.endsAt.toISOString(),
            participantCount: input.participants.length,
            hasRrule: Boolean(rruleToStore),
          },
        });

        return { eventId };
      }),

    // ----------------------------------------------
    // event.update
    // ----------------------------------------------
    // RLS narrows to creator + TD. Same conflict-probe contract as create.
    update: protectedProcedure
      .input(eventUpdateInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;

        const existing = await db
          .select()
          .from(calendarEvents)
          .where(eq(calendarEvents.id, input.eventId));
        const existingRow = existing[0];
        if (!existingRow) {
          // D-36 carry-forward: NOT_FOUND on RLS-filtered, never FORBIDDEN.
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        // CR-02: lock event type at create (UI-SPEC line 317 already prevents
        // the user changing it via the UI). Without this gate, a player who
        // created a meeting (D-48: meetings are open to everyone) could
        // submit an update with `type: 'event_type_tournament'` (D-48:
        // TD-only) and bypass the create-time RBAC matrix entirely.
        // Additionally, the old code did NOT update calendar_events.type_code
        // and called deleteExtensionRow with the NEW type — leaving the old
        // extension row orphaned and a new extension row in a second table,
        // violating the D-49 polymorphic invariant (one extension row per
        // event matching the base type_code).
        if (input.type !== existingRow.typeCode) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'errors.calendar.typeImmutable',
          });
        }

        // CR-02 defence-in-depth: re-apply the D-48 RBAC gate on update. The
        // type is already locked above, so this only protects against a
        // user whose role has been DOWNGRADED between create and update
        // (e.g. a trainer demoted to player tries to edit the tournament
        // they created as TD — RLS allows the update because they're the
        // creator, but the role no longer permits the event_type).
        if (!canCreateEventType(ctx.scope.role, input.type)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'role_not_allowed',
          });
        }

        // D-55: re-validate horizon on update if rrule changes.
        let rruleToStore = input.rrule;
        if (rruleToStore) {
          rruleToStore = ensureHorizon(rruleToStore, existingRow.createdAt);
          validateHorizon(rruleToStore, existingRow.createdAt);
        }

        // CR-04: same participant-scope guard as create — re-validated here
        // because update replaces the participant list whole (CR-03 also
        // changes that to a diff-then-merge, but the scope check still must
        // run on whatever set the caller is sending).
        if (input.participants.length > 0) {
          await assertParticipantsInScope(
            db,
            ctx.scope,
            input.participants.map((p) => p.userId),
          );
        }

        // D-57: conflict probe (excludeEventId = this event). Mirrors the
        // create path — always probe when there are participants so the
        // override audit (below, WR-06) records actual conflicts only.
        let overriddenConflicts: RedactedConflict[] = [];
        if (input.participants.length > 0) {
          const conflicts = await detectConflictsForParticipants(
            db,
            ctx.scope,
            input.startsAt,
            input.endsAt,
            input.participants.map((p) => p.userId),
            input.eventId,
          );
          if (conflicts.length > 0 && !input.force) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'errors.calendar.conflictDetected',
              cause: { conflicts, blocked: false },
            });
          }
          overriddenConflicts = conflicts;
        }

        // WR-05: assemble a richer audit snapshot. Capture the pre-state
        // (existing base row + existing extension row + existing
        // participant list) for `oldValues`, and the merged final state
        // for `newValues`. The previous code only stored {title, startsAt,
        // endsAt} on both sides, making a venue or description rename
        // invisible to GDPR Article 30 forensic recovery.
        //
        // Audit accumulators are populated inside the tx (where we already
        // SELECT the rows) and emitted via writeAudit after the tx commits.
        let auditOldValues: Record<string, unknown> = {};
        let auditNewValues: Record<string, unknown> = {};

        await db.transaction(async (tx) => {
          // Fetch the existing extension row pre-update for the audit
          // snapshot. The base + participant rows are already SELECTed
          // below in the CR-03 diff path. NOTE: this duplicates a tiny
          // read but keeps the audit block self-contained — refactoring
          // to share the read is a Phase 4 polish.
          const oldExtension = await fetchExtensionRow(
            tx,
            existingRow.typeCode,
            input.eventId,
          );

          await tx
            .update(calendarEvents)
            .set({
              title: input.title,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              allDay: input.allDay,
              location: input.location ?? null,
              description: input.description ?? null,
              rrule: rruleToStore ?? null,
              updatedAt: new Date(),
            })
            .where(eq(calendarEvents.id, input.eventId));

          // CR-03: diff-then-merge participants instead of delete + reinsert.
          // The old code reset every rsvp_status to 'pending' and dropped the
          // 'organizer' role for the creator, undoing every accepted/declined
          // RSVP and demoting organisers on every save.
          //
          // Approach:
          //   1. SELECT existing participants → byUserId map.
          //   2. Compute the desired set:
          //        a. From `input.participants`, but preserve existing
          //           rsvpStatus for any survivor. Preserve 'organizer' role
          //           for the creator (per D-58 mental model: the creator is
          //           always the organiser; UI does not surface a way to
          //           demote them).
          //        b. Always (re-)add the caller as 'organizer'/'accepted'
          //           if missing — mirrors event.create line ~594-601.
          //   3. DELETE rows for userIds NOT in the desired set.
          //   4. INSERT rows for new userIds; UPDATE roleInEvent for
          //      existing rows whose role changed (rsvp_status untouched).
          //
          // RLS: cep_insert / cep_delete check creator-or-TD ownership of
          // the event — same gate as before, so RLS posture is unchanged.
          const existingParticipants = await tx
            .select()
            .from(calendarEventParticipants)
            .where(eq(calendarEventParticipants.eventId, input.eventId));
          const existingByUserId = new Map(
            existingParticipants.map((p) => [p.userId, p]),
          );

          const creatorId = existingRow.createdBy;
          // Build the desired set from input + caller-self-add.
          const desired = new Map<
            string,
            { roleInEvent: string; rsvpStatus: string }
          >();
          for (const p of input.participants) {
            const existing = existingByUserId.get(p.userId);
            // Preserve 'organizer' for the creator (UI lumps everyone into
            // a single bucket and would otherwise downgrade the creator to
            // 'participant' on every save).
            const role =
              p.userId === creatorId && existing?.roleInEvent === 'organizer'
                ? 'organizer'
                : p.roleInEvent;
            // Preserve existing rsvp_status; default 'pending' for new
            // participants.
            const rsvp = existing?.rsvpStatus ?? 'pending';
            desired.set(p.userId, { roleInEvent: role, rsvpStatus: rsvp });
          }
          // Caller self-add (mirrors event.create — caller is always the
          // organiser of their own creation/edit unless explicitly someone
          // else, which v1 UI does not surface).
          const callerId = ctx.scope.userId;
          if (!desired.has(callerId)) {
            const existing = existingByUserId.get(callerId);
            desired.set(callerId, {
              roleInEvent: existing?.roleInEvent ?? 'organizer',
              rsvpStatus: existing?.rsvpStatus ?? 'accepted',
            });
          }

          // Delete rows for userIds that have been removed.
          const removedUserIds = existingParticipants
            .map((p) => p.userId)
            .filter((uid) => !desired.has(uid));
          if (removedUserIds.length > 0) {
            await tx
              .delete(calendarEventParticipants)
              .where(
                and(
                  eq(calendarEventParticipants.eventId, input.eventId),
                  sql`${calendarEventParticipants.userId} = ANY(${removedUserIds}::uuid[])`,
                ),
              );
          }

          // Insert new rows + UPDATE role changes on existing rows.
          for (const [userId, want] of desired) {
            const existing = existingByUserId.get(userId);
            if (!existing) {
              await tx
                .insert(calendarEventParticipants)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .values({
                  eventId: input.eventId,
                  userId,
                  roleInEvent: want.roleInEvent,
                  rsvpStatus: want.rsvpStatus,
                } as any);
            } else if (existing.roleInEvent !== want.roleInEvent) {
              // Only role can change here; rsvp_status is owned by the
              // participant themselves via declineParticipation (D-58).
              await tx
                .update(calendarEventParticipants)
                .set({ roleInEvent: want.roleInEvent })
                .where(
                  and(
                    eq(calendarEventParticipants.eventId, input.eventId),
                    eq(calendarEventParticipants.userId, userId),
                  ),
                );
            }
            // else: row already in desired shape — no-op.
          }
          // Extension table update is per-type — we delete + re-insert for
          // simplicity (foreign tables only have a PK to calendar_events).
          //
          // CR-02: pass the EXISTING typeCode to deleteExtensionRow so we
          // remove the right extension row. After the type-immutability
          // check above input.type === existingRow.typeCode, but we read
          // from existingRow defensively to make the orphan-row scenario
          // impossible to reintroduce by accident if the immutability
          // guard is ever relaxed.
          await deleteExtensionRow(tx, existingRow.typeCode, input.eventId);
          await insertExtensionRow(tx, input, input.eventId);

          // WR-05: assemble the audit snapshot inside the tx where we
          // have first-class access to pre-state + the merged desired
          // set. Full base row (oldValues) + merged final state
          // (newValues). The 1 KB-ish JSONB overhead is the Phase 1
          // pattern (event.delete already snapshots the full base +
          // extension + participants + exceptions).
          auditOldValues = {
            base: {
              ...existingRow,
              startsAt: existingRow.startsAt.toISOString(),
              endsAt: existingRow.endsAt.toISOString(),
              createdAt: existingRow.createdAt.toISOString(),
              updatedAt: existingRow.updatedAt.toISOString(),
            },
            extension: oldExtension,
            participants: existingParticipants.map((p) => ({
              userId: p.userId,
              roleInEvent: p.roleInEvent,
              rsvpStatus: p.rsvpStatus,
            })),
          };
          auditNewValues = {
            base: {
              id: existingRow.id,
              typeCode: input.type,
              title: input.title,
              startsAt: input.startsAt.toISOString(),
              endsAt: input.endsAt.toISOString(),
              allDay: input.allDay,
              location: input.location ?? null,
              description: input.description ?? null,
              rrule: rruleToStore ?? null,
              createdBy: existingRow.createdBy,
            },
            // The merged participants reflect the desired set after the
            // CR-03 diff-then-merge above — including caller self-add.
            participants: Array.from(desired.entries()).map(
              ([userId, want]) => ({
                userId,
                roleInEvent: want.roleInEvent,
                rsvpStatus: want.rsvpStatus,
              }),
            ),
          };
        });

        // WR-06: only emit the override audit when there were actual
        // conflicts to override (mirrors event.create). A force:true call
        // with empty overriddenConflicts is functionally a normal update;
        // logging it as an override pollutes the audit feed.
        if (input.force && overriddenConflicts.length > 0) {
          await writeAudit(ctx, {
            action: 'calendar_event_conflict_override',
            resourceType: 'calendar_event',
            resourceId: input.eventId,
            newValues: {
              force: true,
              participants: input.participants.map((p) => p.userId),
              conflicts: overriddenConflicts.map((c) => ({
                eventId: c.eventId,
                typeCode: c.typeCode,
                participant: c.participant,
                startsAt:
                  c.startsAt instanceof Date
                    ? c.startsAt.toISOString()
                    : c.startsAt,
                endsAt:
                  c.endsAt instanceof Date
                    ? c.endsAt.toISOString()
                    : c.endsAt,
                detailMode: c.detailMode,
              })),
            },
          });
        }
        await writeAudit(ctx, {
          action: 'calendar_event_updated',
          resourceType: 'calendar_event',
          resourceId: input.eventId,
          // WR-05: full pre/post snapshots (base + extension + merged
          // participants), populated inside the tx above. The Phase 1
          // pattern for forensic recovery — GDPR Article 30 needs to be
          // able to reconstruct who-changed-what at any audit timestamp.
          oldValues: auditOldValues,
          newValues: auditNewValues,
        });

        return { ok: true };
      }),

    // ----------------------------------------------
    // event.delete — D-58c cascade order + JSONB snapshot
    // ----------------------------------------------
    delete: protectedProcedure
      .input(eventDeleteInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;

        await db.transaction(async (tx) => {
          // 1. SELECT base + extension + participants + exceptions FOR UPDATE.
          const base = await tx
            .select()
            .from(calendarEvents)
            .where(eq(calendarEvents.id, input.eventId))
            .for('update');
          const baseRow = base[0];
          if (!baseRow) {
            // RLS-filtered or not present — D-36 NOT_FOUND.
            throw new TRPCError({ code: 'NOT_FOUND' });
          }
          const extensionRow = await fetchExtensionRow(
            tx,
            baseRow.typeCode,
            baseRow.id,
          );
          const participantRows = await tx
            .select()
            .from(calendarEventParticipants)
            .where(eq(calendarEventParticipants.eventId, baseRow.id))
            .for('update');
          const exceptionRows = await tx
            .select()
            .from(calendarEventExceptions)
            .where(eq(calendarEventExceptions.eventId, baseRow.id))
            .for('update');

          // 2. Snapshot — capped at 1000 exceptions per Pitfall 9.
          const MAX_EXCEPTIONS = 1000;
          const snapshot = {
            base: baseRow,
            extension: extensionRow,
            participants: participantRows,
            exceptions: exceptionRows.slice(0, MAX_EXCEPTIONS),
            exceptionsTotalCount: exceptionRows.length,
          };

          // 3. writeAudit BEFORE the DELETE so the trail is durable.
          //    writeAudit uses ctx.db ?? rawDb; ctx.db here is the
          //    withRlsContext transaction handle — same tx as `tx` above.
          await writeAudit(ctx, {
            action: 'calendar_event_deleted',
            resourceType: 'calendar_event',
            resourceId: baseRow.id,
            oldValues: snapshot,
          });

          // 4. DELETE — FK CASCADE drops extension + participants + exceptions.
          await tx
            .delete(calendarEvents)
            .where(eq(calendarEvents.id, baseRow.id));

          // 5. tx commit happens at the end of the callback.
        });

        return { ok: true };
      }),

    // ----------------------------------------------
    // event.declineParticipation — D-58 RSVP decline
    // ----------------------------------------------
    declineParticipation: protectedProcedure
      .input(declineParticipationInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;
        const callerId = ctx.scope.userId;

        // Update only the row where user_id = callerId (RSVP forgery
        // prevention; RLS cep_update_self policy enforces this at the DB
        // layer too).
        const updated = await db
          .update(calendarEventParticipants)
          .set({ rsvpStatus: 'declined' })
          .where(
            and(
              eq(calendarEventParticipants.eventId, input.eventId),
              eq(calendarEventParticipants.userId, callerId),
            ),
          )
          .returning();

        if (updated.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        await writeAudit(ctx, {
          action: 'calendar_event_declined',
          resourceType: 'calendar_event',
          resourceId: input.eventId,
          newValues: { rsvpStatus: 'declined' },
        });

        return { ok: true };
      }),

    // ----------------------------------------------
    // event.cancelOccurrence — D-58 cancel single occurrence
    // ----------------------------------------------
    cancelOccurrence: protectedProcedure
      .input(cancelOccurrenceInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;
        const callerId = ctx.scope.userId;

        // WR-07: mirror the event.update / event.delete shape — SELECT
        // the base row first so an RLS-filtered (or genuinely missing)
        // event returns a clean D-36 NOT_FOUND rather than letting the
        // INSERT below trip on a WITH CHECK violation, which surfaces
        // as an opaque tRPC error code. A player who can SEE the event
        // (participant) but not edit it gets a consistent NOT_FOUND now,
        // matching the rest of the calendar router's contract.
        const baseProbe = await db
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .where(eq(calendarEvents.id, input.eventId));
        if (baseProbe.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        // Insert exception row with cancelled=true.
        // UNIQUE(event_id, occurrence_date) protects against double-cancel.
        try {
          // The `occurrence_date` column is DATE — Drizzle expects an ISO
          // YYYY-MM-DD string. We accept a Date at the Zod boundary, then
          // serialise to the DB-friendly string here.
          //
          // CR-05: anchor on Europe/Brussels via formatOccurrenceDate(), not
          // UTC `toISOString().slice(0,10)`. A Belgian client sending a Date
          // representing May 16 00:00 CEST is May 15 22:00 UTC; the old
          // UTC-slice wrote '2026-05-15' and cancelled the wrong day. The
          // read-side expandRrule() uses the same helper so the exception
          // row matches the user's intended occurrence.
          const occurrenceDateIso = formatOccurrenceDate(
            input.occurrenceDate,
          );
          const inserted = await db
            .insert(calendarEventExceptions)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values({
              eventId: input.eventId,
              occurrenceDate: occurrenceDateIso,
              cancelled: true,
              createdBy: callerId,
            } as any)
            .returning({ id: calendarEventExceptions.id });

          const row = inserted[0];
          if (!row) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'calendar_event_exception_insert_returned_no_row',
            });
          }

          await writeAudit(ctx, {
            action: 'calendar_event_exception_created',
            resourceType: 'calendar_event_exception',
            resourceId: row.id,
            newValues: {
              eventId: input.eventId,
              occurrenceDate: occurrenceDateIso,
              cancelled: true,
            },
          });
          return { ok: true };
        } catch (err: unknown) {
          const e = err as { code?: string };
          if (e.code === '23505') {
            // Duplicate exception — treat as idempotent success.
            return { ok: true };
          }
          throw err;
        }
      }),

    // ----------------------------------------------
    // event.get — NOT_FOUND on RLS-filtered (D-36 carry-forward)
    // ----------------------------------------------
    get: protectedProcedure
      .input(eventGetInput)
      .query(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;

        const row = await db.query.calendarEvents.findFirst({
          where: eq(calendarEvents.id, input.eventId),
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

        const extension = await fetchExtensionRow(db, row.typeCode, row.id);
        const participants = await db
          .select()
          .from(calendarEventParticipants)
          .where(eq(calendarEventParticipants.eventId, row.id));
        const exceptions = await db
          .select()
          .from(calendarEventExceptions)
          .where(eq(calendarEventExceptions.eventId, row.id));

        return { event: row, extension, participants, exceptions };
      }),

    // ----------------------------------------------
    // event.detectConflicts — D-57 cross-scope + role-gated redaction
    // ----------------------------------------------
    detectConflicts: protectedProcedure
      .input(detectConflictsInput)
      .query(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;

        const conflicts = await detectConflictsForParticipants(
          db,
          ctx.scope,
          input.startsAt,
          input.endsAt,
          input.participants.map((p) => p.userId),
          input.excludeEventId,
        );

        // D-57: never block; UI decides how to surface.
        return { conflicts, blocked: false };
      }),

    // ----------------------------------------------
    // event.editRecurring — D-84 three-scope dispatcher
    // ----------------------------------------------
    // Phase 4 Plan 04-06: closes the Phase 3 deferred RRULE-edit-scope work.
    // Three branches:
    //
    //   scope='single'           — delegates to the calendar_event_exceptions
    //                              write path (Phase 3 D-54). For overrides,
    //                              writes a row with override_* fields. For
    //                              cancel-only edits, sets cancelled=true.
    //
    //   scope='this_and_future'  — split-and-rewrite (D-84). Old event's
    //                              RRULE UNTIL is truncated to splitDate - 1d;
    //                              a NEW calendar_events row is INSERTed with
    //                              the edited fields applied. Extension row
    //                              copied with edits overlayed. Series-level
    //                              calendar_event_participants COPIED (RSVPs
    //                              reset to 'pending'). session_sparring_partners
    //                              COPIED for training events (TRAIN-06).
    //                              session_participants STAY on the old event
    //                              (D-83 immutable past — past data is bound
    //                              to the historical day, never migrates).
    //
    //   scope='all_in_series'    — UPDATE the base + extension in place.
    //                              session_participants UNTOUCHED (D-83 —
    //                              the UPDATE on calendar_events does NOT
    //                              cascade to per-occurrence attendance rows;
    //                              they were written for specific past dates).
    //                              calendar_event_exceptions whose
    //                              occurrence_date no longer matches the new
    //                              expansion are kept as inert rows (UI4-D20,
    //                              defensive against rrule-revert).
    //
    // Audit codes (per phase4-audit.test.ts manifest):
    //   calendar_event_recurring_split      — emitted on 'this_and_future'
    //   calendar_event_recurring_updated_all — emitted on 'all_in_series'
    //   (calendar_event_exception_created   — already emitted on 'single' by
    //    the underlying exception-INSERT path).
    editRecurring: protectedProcedure
      .input(editRecurringInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;
        const callerId = ctx.scope.userId;

        // 1. Load the base event. RLS filters non-visible rows → NOT_FOUND
        //    (D-36 carry-forward; never FORBIDDEN, never leaks existence).
        const baseRows = await db
          .select()
          .from(calendarEvents)
          .where(eq(calendarEvents.id, input.eventId));
        const oldEvent = baseRows[0];
        if (!oldEvent) throw new TRPCError({ code: 'NOT_FOUND' });

        // 2. The event must be a recurring series.
        if (!oldEvent.rrule) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'errors.calendar.notRecurring',
          });
        }

        // 3. Per-event-type RBAC gate (D-48 defense in depth — mirrors
        //    event.create / event.update). Anonymous → handled by
        //    protectedProcedure; wrong role → FORBIDDEN. Past data immutable
        //    check applies separately per scope below.
        if (!canCreateEventType(ctx.scope.role, oldEvent.typeCode)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'errors.calendar.roleCannotEditType',
          });
        }

        // ─── scope: single ─────────────────────────────────────────────
        if (input.scope === 'single') {
          // Thin wrapper around the Phase 3 exception-INSERT path.
          // Requires splitDate as the occurrence anchor (Zod refinement
          // guarantees presence; type-narrow here).
          if (!input.splitDate) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'errors.calendar.splitDateRequired',
            });
          }
          // D-83: past occurrences cannot be edited. Use Brussels-anchored
          // date to compute the comparison so a Belgian-evening edit doesn't
          // trip on a UTC midnight boundary.
          const splitIso = formatOccurrenceDate(input.splitDate);
          const todayIso = formatOccurrenceDate(new Date());
          if (splitIso < todayIso) {
            // Past-data immutability — server rejects edits on past
            // occurrences. The exception schema permits it, but D-83
            // makes it a policy-level rejection.
            await writeAudit(ctx, {
              action: 'calendar_event_exception_created',
              resourceType: 'calendar_event',
              resourceId: oldEvent.id,
              outcome: 'denied',
              newValues: { reason: 'past_immutable', splitDate: splitIso },
            });
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'errors.calendar.splitDateRequired',
            });
          }
          // Write the exception row. UPSERT so a follow-up edit on the
          // same occurrence supersedes the previous override.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const exceptionValues: any = {
            eventId: oldEvent.id,
            occurrenceDate: splitIso,
            cancelled: input.edits.cancelled ?? false,
            overrideStartsAt: input.edits.startsAt ?? null,
            overrideEndsAt: input.edits.endsAt ?? null,
            overrideTitle: input.edits.title ?? null,
            overrideLocation:
              input.edits.location === undefined
                ? null
                : input.edits.location,
            overrideDescription:
              input.edits.description === undefined
                ? null
                : input.edits.description,
            createdBy: callerId,
          };
          const inserted = await db
            .insert(calendarEventExceptions)
            .values(exceptionValues)
            .onConflictDoUpdate({
              target: [
                calendarEventExceptions.eventId,
                calendarEventExceptions.occurrenceDate,
              ],
              set: {
                cancelled: exceptionValues.cancelled,
                overrideStartsAt: exceptionValues.overrideStartsAt,
                overrideEndsAt: exceptionValues.overrideEndsAt,
                overrideTitle: exceptionValues.overrideTitle,
                overrideLocation: exceptionValues.overrideLocation,
                overrideDescription: exceptionValues.overrideDescription,
              },
            })
            .returning({ id: calendarEventExceptions.id });
          const exceptionId = inserted[0]?.id;
          await writeAudit(ctx, {
            action: 'calendar_event_exception_created',
            resourceType: 'calendar_event_exception',
            resourceId: exceptionId ?? oldEvent.id,
            newValues: {
              eventId: oldEvent.id,
              occurrenceDate: splitIso,
              cancelled: exceptionValues.cancelled,
              edits: input.edits,
            },
          });
          return {
            ok: true as const,
            scope: 'single' as const,
            occurrenceDate: splitIso,
          };
        }

        // ─── scope: this_and_future ────────────────────────────────────
        if (input.scope === 'this_and_future') {
          if (!input.splitDate) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'errors.calendar.splitDateRequired',
            });
          }
          // D-83: split anchor cannot be in the past. The whole point of
          // "this and future" is to fork the series at a not-yet-occurred
          // boundary; planting the split in the past would mutate
          // already-realised attendance assumptions.
          const splitIso = formatOccurrenceDate(input.splitDate);
          const todayIso = formatOccurrenceDate(new Date());
          if (splitIso < todayIso) {
            await writeAudit(ctx, {
              action: 'calendar_event_recurring_split',
              resourceType: 'calendar_event',
              resourceId: oldEvent.id,
              outcome: 'denied',
              newValues: { reason: 'past_immutable', splitDate: splitIso },
            });
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'errors.calendar.splitDateRequired',
            });
          }

          // Run splitRRule outside the tx so any rrule-parse failure
          // surfaces cleanly as BAD_REQUEST before we open a write tx.
          const split = splitRRule(
            oldEvent.rrule,
            input.splitDate,
            oldEvent.startsAt,
          );

          // Decide the new event's RRULE. If the caller is changing FREQ
          // or BYDAY, REBUILD the rule via serializeRrule (D-85). Otherwise
          // keep the continuation rule returned by splitRRule.
          let newRruleString = split.newRruleString;
          if (input.edits.frequency || input.edits.byday) {
            newRruleString = serializeRrule({
              freq:
                input.edits.frequency ??
                // If only BYDAY changed but FREQ was unspecified, default to
                // weekly — BYDAY only makes sense there (D-85 enforcement
                // already in the schema).
                'weekly',
              ...(input.edits.byday ? { byday: input.edits.byday } : {}),
              ...(input.edits.until ? { until: input.edits.until } : {}),
              ...(input.edits.interval !== undefined
                ? { interval: input.edits.interval }
                : {}),
            });
          }

          // Compute new starts_at / ends_at. The newDtstart is the split
          // boundary instant; the caller may further override via
          // edits.startsAt (rare — used to change the time-of-day on
          // the new series).
          const oldDurationMs =
            oldEvent.endsAt.getTime() - oldEvent.startsAt.getTime();
          const newStartsAt = input.edits.startsAt ?? split.newDtstart;
          const newEndsAt =
            input.edits.endsAt ??
            new Date(newStartsAt.getTime() + oldDurationMs);

          // D-55: inject UNTIL=+2y if absent.
          const newRruleWithHorizon = ensureHorizon(newRruleString, newStartsAt);
          validateHorizon(newRruleWithHorizon, newStartsAt);

          let newEventId = '';
          try {
            newEventId = await db.transaction(async (tx) => {
              // 1. Truncate the old event's RRULE.
              await tx
                .update(calendarEvents)
                .set({
                  rrule: split.oldRruleString,
                  updatedAt: new Date(),
                })
                .where(eq(calendarEvents.id, oldEvent.id));

              // 2. INSERT the new event with the edited base fields.
              const inserted = await tx
                .insert(calendarEvents)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .values({
                  typeCode: oldEvent.typeCode,
                  title: input.edits.title ?? oldEvent.title,
                  startsAt: newStartsAt,
                  endsAt: newEndsAt,
                  allDay: oldEvent.allDay,
                  location:
                    input.edits.location === undefined
                      ? oldEvent.location
                      : input.edits.location,
                  description:
                    input.edits.description === undefined
                      ? oldEvent.description
                      : input.edits.description,
                  rrule: newRruleWithHorizon,
                  createdBy: callerId,
                } as any)
                .returning({ id: calendarEvents.id });
              const newId = inserted[0]?.id;
              if (!newId) {
                throw new TRPCError({
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'calendar_event_insert_returned_no_row',
                });
              }

              // 3. COPY the extension row with edits overlayed.
              await copyExtensionRow(
                tx,
                oldEvent.typeCode,
                oldEvent.id,
                newId,
                input.edits,
              );

              // 4. COPY series-level calendar_event_participants. RSVPs
              //    reset to 'pending' (UX decision documented in RESEARCH
              //    §Pattern 1; users on the new series should consciously
              //    re-accept after the rule change).
              const oldParts = await tx
                .select()
                .from(calendarEventParticipants)
                .where(eq(calendarEventParticipants.eventId, oldEvent.id));
              if (oldParts.length > 0) {
                await tx.insert(calendarEventParticipants).values(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  oldParts.map((p) => ({
                    eventId: newId,
                    userId: p.userId,
                    roleInEvent: p.roleInEvent,
                    rsvpStatus: 'pending',
                  })) as any,
                );
              }

              // 5. COPY session_sparring_partners for training events
              //    (TRAIN-06). Sparring continuity across the split is
              //    expected — same partners follow the new series.
              if (oldEvent.typeCode === 'event_type_training') {
                const oldSparring = await tx
                  .select()
                  .from(sessionSparringPartners)
                  .where(eq(sessionSparringPartners.eventId, oldEvent.id));
                if (oldSparring.length > 0) {
                  await tx.insert(sessionSparringPartners).values(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    oldSparring.map((s) => ({
                      eventId: newId,
                      sparringPartnerId: s.sparringPartnerId,
                      createdBy: callerId,
                    })) as any,
                  );
                }
              }

              // 6. D-83 EXPLICIT: session_participants rows STAY on the old
              //    event (past data immutable). DO NOT touch them. This
              //    comment is the policy anchor — the absence of any
              //    INSERT/UPDATE/DELETE on session_participants here is
              //    intentional.

              return newId;
            });
          } catch (err: unknown) {
            const e = err as { code?: string; constraint?: string };
            if (
              e.code === '23514' &&
              (e.constraint?.includes('ends_after_starts') ?? false)
            ) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'errors.calendar.endBeforeStart',
              });
            }
            throw err;
          }

          await writeAudit(ctx, {
            action: 'calendar_event_recurring_split',
            resourceType: 'calendar_event',
            resourceId: oldEvent.id,
            oldValues: {
              base: {
                id: oldEvent.id,
                title: oldEvent.title,
                rrule: oldEvent.rrule,
                startsAt: oldEvent.startsAt.toISOString(),
                endsAt: oldEvent.endsAt.toISOString(),
              },
            },
            newValues: {
              newEventId,
              splitDate: input.splitDate.toISOString(),
              newRrule: newRruleWithHorizon,
              edits: input.edits,
            },
          });

          return {
            ok: true as const,
            scope: 'this_and_future' as const,
            newEventId,
          };
        }

        // ─── scope: all_in_series ──────────────────────────────────────
        if (input.scope === 'all_in_series') {
          // UPDATE the base + extension in place. Past session_participants
          // UNTOUCHED — Drizzle UPDATEs only the listed columns; nothing
          // here writes to session_participants (D-83).
          //
          // If the user changes FREQ/BYDAY, REBUILD the RRULE via
          // serializeRrule (D-85). Preserve UNTIL/COUNT if neither edit
          // mentions them.

          // Decide new RRULE.
          let newRruleString = oldEvent.rrule;
          if (input.edits.frequency || input.edits.byday) {
            newRruleString = serializeRrule({
              freq: input.edits.frequency ?? 'weekly',
              ...(input.edits.byday ? { byday: input.edits.byday } : {}),
              ...(input.edits.until ? { until: input.edits.until } : {}),
              ...(input.edits.interval !== undefined
                ? { interval: input.edits.interval }
                : {}),
            });
            newRruleString = ensureHorizon(newRruleString, oldEvent.createdAt);
            validateHorizon(newRruleString, oldEvent.createdAt);
          }

          try {
            await db.transaction(async (tx) => {
              const baseUpdate: Record<string, unknown> = {
                updatedAt: new Date(),
              };
              if (input.edits.title !== undefined)
                baseUpdate.title = input.edits.title;
              if (input.edits.startsAt !== undefined)
                baseUpdate.startsAt = input.edits.startsAt;
              if (input.edits.endsAt !== undefined)
                baseUpdate.endsAt = input.edits.endsAt;
              if (input.edits.location !== undefined)
                baseUpdate.location = input.edits.location;
              if (input.edits.description !== undefined)
                baseUpdate.description = input.edits.description;
              if (newRruleString !== oldEvent.rrule)
                baseUpdate.rrule = newRruleString;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await tx
                .update(calendarEvents)
                .set(baseUpdate as any)
                .where(eq(calendarEvents.id, oldEvent.id));

              await updateExtensionRow(
                tx,
                oldEvent.typeCode,
                oldEvent.id,
                input.edits,
              );

              // D-83 EXPLICIT: session_participants UNTOUCHED. Inert
              // calendar_event_exceptions on dates no longer matching the
              // new expansion are KEPT (UI4-D20 zombie policy — defensive
              // against rrule-revert).
            });
          } catch (err: unknown) {
            const e = err as { code?: string; constraint?: string };
            if (
              e.code === '23514' &&
              (e.constraint?.includes('ends_after_starts') ?? false)
            ) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'errors.calendar.endBeforeStart',
              });
            }
            throw err;
          }

          await writeAudit(ctx, {
            action: 'calendar_event_recurring_updated_all',
            resourceType: 'calendar_event',
            resourceId: oldEvent.id,
            oldValues: {
              base: {
                id: oldEvent.id,
                title: oldEvent.title,
                rrule: oldEvent.rrule,
                startsAt: oldEvent.startsAt.toISOString(),
                endsAt: oldEvent.endsAt.toISOString(),
              },
            },
            newValues: {
              rrule: newRruleString,
              edits: input.edits,
            },
          });

          return { ok: true as const, scope: 'all_in_series' as const };
        }

        // Defensive — should be unreachable due to Zod enum.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.calendar.unknownScope',
        });
      }),

    // ----------------------------------------------
    // event.attachSparringPartners — D-79 + D-63 + Assumption A5
    // ----------------------------------------------
    // Phase 4 Plan 04-06: TD-only mutation that attaches sparring partners
    // to a training session via the session_sparring_partners junction.
    //
    // App-layer FK row-filter (Assumption A5): PostgreSQL FKs cannot
    // natively constrain the referenced row by a predicate on a NON-PK
    // column. The junction's `sparring_partner_id` references users.id
    // (PK), but the role-must-be-sparring_partner predicate is a row-
    // filter on a non-PK column. This is enforced at the application
    // layer here AND defense-in-depth via the Plan 04-02 0018 RLS
    // policy (which checks calendar_events_visible_to includes the
    // sparring branch).
    //
    // Audit code: sparring_partner_attached (per phase4-audit.test.ts).
    attachSparringPartners: tdProcedure
      .input(attachSparringPartnersInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;
        const callerId = ctx.scope.userId;

        // 1. Verify the event exists, is visible to TD (RLS), and is a
        //    training session (sparring partners are training-specific
        //    per D-63).
        const baseRows = await db
          .select({
            id: calendarEvents.id,
            typeCode: calendarEvents.typeCode,
          })
          .from(calendarEvents)
          .where(eq(calendarEvents.id, input.eventId));
        const event = baseRows[0];
        if (!event) throw new TRPCError({ code: 'NOT_FOUND' });
        if (event.typeCode !== 'event_type_training') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'errors.calendar.roleCannotEditType',
          });
        }

        // 2. APP-LAYER FK row-filter (Assumption A5). SELECT each candidate
        //    user and verify role === 'sparring_partner'. One round trip.
        const ids = Array.from(new Set(input.sparringPartnerIds));
        const userRows = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(inArray(users.id, ids));
        const seen = new Set(userRows.map((r) => r.id));
        const missing = ids.filter((id) => !seen.has(id));
        const wrongRole = userRows
          .filter((r) => r.role !== 'sparring_partner')
          .map((r) => r.id);
        if (missing.length > 0 || wrongRole.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'errors.sparring.notASparringPartner',
          });
        }

        // 3. INSERT junction rows. ON CONFLICT DO NOTHING for idempotency
        //    on re-attach attempts (the composite PK guards against dupes
        //    at the DB layer anyway).
        await db
          .insert(sessionSparringPartners)
          .values(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ids.map((spId) => ({
              eventId: input.eventId,
              sparringPartnerId: spId,
              createdBy: callerId,
            })) as any,
          )
          .onConflictDoNothing();

        // 4. Audit — one row per attachment so the trail enumerates each
        //    junction insert (forensic recovery + GDPR Article 30).
        for (const spId of ids) {
          await writeAudit(ctx, {
            action: 'sparring_partner_attached',
            resourceType: 'session_sparring_partner',
            resourceId: `${input.eventId}:${spId}`,
            newValues: {
              eventId: input.eventId,
              sparringPartnerId: spId,
            },
          });
        }

        return { ok: true as const, attached: ids.length };
      }),
  }),

  // ============================================================
  // filterOptions.list — scope-filtered typeahead for filter bar
  // ============================================================
  // Per CAL-04 + CAL-05: the dropdown options are server-side scope-narrowed.
  // RLS on players / trainers / academies / users already filters; the query
  // just searches by name within the visible set. Sparring partners are a
  // Phase 4 entity (return empty here — D-50 no-op).
  filterOptions: router({
    list: protectedProcedure
      .input(filterOptionsInput)
      .query(async ({ ctx, input }) => {
        if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const db = (ctx.db as DbClient | undefined) ?? rawDb;
        const MAX_OPTIONS = 50;
        // WR-09: escape user-supplied LIKE meta-characters (`%`, `_`,
        // `\\`) so a query like "Jan%" does not silently widen the match
        // to everything containing "Jan". Drizzle parameterises the value
        // so this is not a security issue, but it is a correctness gap.
        // Backslash is the escape char (matches the ESCAPE '\\' clause
        // on the ILIKE below).
        const escapeForLike = (s: string): string =>
          s
            .replaceAll('\\', '\\\\')
            .replaceAll('%', '\\%')
            .replaceAll('_', '\\_');
        const likeArg = `%${escapeForLike(input.query)}%`;

        switch (input.kind) {
          case 'player': {
            // RLS scopes players via players_visible_to (Phase 1).
            // WR-09: JOIN users so we can filter inactive players out
            // (active column lives on users, not the players child
            // table). Add deterministic ORDER BY so the LIMIT 50 cut-off
            // returns the same subset across calls. Escape LIKE
            // meta-chars per the helper above.
            const result = await db.execute<{ id: string; label: string }>(sql`
              SELECT p.user_id AS id,
                     (p.first_name || ' ' || p.last_name) AS label
                FROM players p
                JOIN users u ON u.id = p.user_id
               WHERE u.active = true
                 AND (p.first_name || ' ' || p.last_name)
                       ILIKE ${likeArg} ESCAPE '\\'
               ORDER BY p.last_name, p.first_name
               LIMIT ${MAX_OPTIONS}
            `);
            // postgres-js returns an array directly; some drivers wrap in
            // {rows}. Normalise so the return type is always an array.
            return Array.isArray(result)
              ? result
              : ((result as unknown as { rows?: { id: string; label: string }[] })
                  .rows ?? []);
          }
          case 'trainer': {
            // WR-09: same JOIN-users-for-active + ORDER BY + LIKE-escape
            // pattern as the player branch.
            const result = await db.execute<{ id: string; label: string }>(sql`
              SELECT t.user_id AS id,
                     (t.first_name || ' ' || t.last_name) AS label
                FROM trainers t
                JOIN users u ON u.id = t.user_id
               WHERE u.active = true
                 AND (t.first_name || ' ' || t.last_name)
                       ILIKE ${likeArg} ESCAPE '\\'
               ORDER BY t.last_name, t.first_name
               LIMIT ${MAX_OPTIONS}
            `);
            return Array.isArray(result)
              ? result
              : ((result as unknown as { rows?: { id: string; label: string }[] })
                  .rows ?? []);
          }
          case 'sparring_partner':
            // Phase 3 NO-OP per D-50. Phase 4 adds sparring_partners table.
            return [];
          case 'academy': {
            // WR-09: academy branch already had active+ORDER BY; only
            // the LIKE-escape was missing. Same ESCAPE '\\' clause.
            const result = await db.execute<{ id: string; label: string }>(sql`
              SELECT code AS id, canonical_name AS label
                FROM academy
               WHERE active = true
                 AND canonical_name ILIKE ${likeArg} ESCAPE '\\'
               ORDER BY sort_order
               LIMIT ${MAX_OPTIONS}
            `);
            return Array.isArray(result)
              ? result
              : ((result as unknown as { rows?: { id: string; label: string }[] })
                  .rows ?? []);
          }
          default:
            return [];
        }
      }),
  }),
});

// ─── Helper: participant-scope guard (CR-04) ───────────────────────────

/**
 * CR-04: validate that every userId the caller wants to add as a participant
 * is visible to them. Without this gate, the Zod schema only required UUIDs,
 * RLS `cep_insert` only checked the EVENT's ownership, and the SECURITY
 * DEFINER conflict probe would happily leak overlap data for arbitrary
 * userIds — a directory-enumeration primitive.
 *
 * Visibility rules (mirror calendar_events_visible_to from migration 0011):
 *   - technical_director / medical_staff see every active user.
 *   - All other roles see:
 *       • themselves (self-add is always allowed)
 *       • every user_id returned by `players_visible_to(caller_id, role)`
 *         (the Phase 1 canonical visibility helper — covers parents' children
 *         AND trainers'/academy_managers' academy peers).
 *       • every user_id sharing an academy_membership with the caller (TD's
 *         academy management + trainer-of-trainer cross-coverage cases —
 *         participants in calendar events can be other trainers, not only
 *         players, and players_visible_to() is the player-only helper).
 *
 * Throws TRPCError FORBIDDEN with `errors.calendar.participantNotInScope`
 * (i18n key already shipped in all three catalogs — line 303 nl/en/fr) if
 * any participantId is outside scope.
 *
 * The check uses ONE SQL round-trip — UNION'd visibility set, intersected
 * with the input array. No N+1.
 */
async function assertParticipantsInScope(
  db: DbClient,
  caller: { userId: string; role: Role },
  participantIds: string[],
): Promise<void> {
  if (participantIds.length === 0) return;

  // TD / medical_staff see everyone — short-circuit. The DB query below
  // would also handle this via players_visible_to (which returns SELECT id
  // FROM users for these roles), but skipping the round-trip is cheaper
  // and removes a layer of indirection in the common TD case.
  if (
    caller.role === 'technical_director' ||
    caller.role === 'medical_staff'
  ) {
    return;
  }

  // Deduplicate input — we don't care if the same id appears twice in the
  // payload (CR-03 still preserves it on the participant list write).
  const ids = Array.from(new Set(participantIds));

  // UNION the four visibility lanes into a single SELECT and ANY() the
  // result against the input. Returns visible user_ids only.
  const result = await db.execute<{ user_id: string }>(sql`
    SELECT DISTINCT user_id
      FROM (
        -- Lane 1: self
        SELECT ${caller.userId}::uuid AS user_id

        UNION

        -- Lane 2: Phase 1 canonical helper — covers parent→child and
        -- trainer/academy_manager→academy-peer-players.
        SELECT player_user_id AS user_id
          FROM players_visible_to(${caller.userId}::uuid, ${caller.role}::text)

        UNION

        -- Lane 3: anyone sharing an academy_membership with the caller.
        -- Picks up trainer↔trainer and trainer↔academy_manager visibility
        -- which players_visible_to() (player-only) does not surface.
        SELECT peer.user_id
          FROM academy_memberships me
          JOIN academy_memberships peer
            ON peer.academy_code = me.academy_code
         WHERE me.user_id = ${caller.userId}::uuid
      ) AS scope
     WHERE user_id = ANY(${ids}::uuid[])
  `);

  // postgres-js returns an array; pg-style drivers wrap in {rows}.
  const rows: { user_id: string }[] = Array.isArray(result)
    ? (result as { user_id: string }[])
    : (
        (result as unknown as { rows?: { user_id: string }[] }).rows ?? []
      );
  const visibleSet = new Set(rows.map((r) => r.user_id));
  const outOfScope = ids.filter((id) => !visibleSet.has(id));
  if (outOfScope.length > 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'errors.calendar.participantNotInScope',
    });
  }
}

// ─── Helper: cross-scope SECURITY DEFINER overlap + redaction ──────────

/**
 * Inputs: explicit so this fn is testable.
 * Returns redacted conflicts ready for the wire — D-57 + D-57b applied.
 */
async function detectConflictsForParticipants(
  db: DbClient,
  caller: { userId: string; role: Role },
  startsAt: Date,
  endsAt: Date,
  participantIds: string[],
  excludeEventId: string | undefined,
): Promise<RedactedConflict[]> {
  if (participantIds.length === 0) return [];

  // 1. Cross-scope overlap via SECURITY DEFINER fn — bypasses RLS per D-57.
  //    Function signature (corrected in migration 0013 per CR-01):
  //    overlapping_events_for_users(uuid[], tstzrange[]). We pass a
  //    single-element tstzrange[] for the [startsAt, endsAt] window today;
  //    the array shape lets future ±15d per-occurrence expansion (D-56)
  //    probe multiple disjoint windows in one call.
  const rangeLiteral = sql`tstzrange(${startsAt}, ${endsAt}, '[)')`;
  const baseQuery = sql`
    SELECT event_id   AS "eventId",
           user_id    AS "userId",
           type_code  AS "typeCode",
           title,
           starts_at  AS "startsAt",
           ends_at    AS "endsAt",
           location,
           created_by AS "createdBy"
      FROM overlapping_events_for_users(
        ${participantIds}::uuid[],
        ARRAY[${rangeLiteral}]::tstzrange[]
      )
  `;
  const withExclude = excludeEventId
    ? sql`${baseQuery} WHERE event_id <> ${excludeEventId}`
    : baseQuery;

  const overlapsRaw = await db.execute<{
    eventId: string;
    userId: string;
    typeCode: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    location: string | null;
    createdBy: string;
  }>(withExclude);

  // postgres-js returns an array; pg-style drivers wrap in {rows}.
  const rows: {
    eventId: string;
    userId: string;
    typeCode: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    location: string | null;
    createdBy: string;
  }[] = Array.isArray(overlapsRaw)
    ? overlapsRaw
    : ((overlapsRaw as unknown as { rows?: typeof overlapsRaw }).rows ??
      []) as unknown as {
        eventId: string;
        userId: string;
        typeCode: string;
        title: string;
        startsAt: Date;
        endsAt: Date;
        location: string | null;
        createdBy: string;
      }[];

  if (rows.length === 0) return [];

  // 2. For each overlap, probe whether the caller is also a participant of
  //    the conflicting event (defines visibility per D-57). One scoped read
  //    for all rows. The probe uses RLS (no DEFINER) so the caller can only
  //    confirm participation in events they themselves can see.
  const eventIds = rows.map((r) => r.eventId);
  const callerParticipations = await db
    .select({ eventId: calendarEventParticipants.eventId })
    .from(calendarEventParticipants)
    .where(
      and(
        sql`${calendarEventParticipants.eventId} = ANY(${eventIds})`,
        eq(calendarEventParticipants.userId, caller.userId),
      ),
    );
  const callerInEventSet = new Set(callerParticipations.map((r) => r.eventId));

  // 3. Display-name lookup for all participants in the overlap rows. The
  //    caller added them to their own event so naming them is safe — D-57
  //    redaction governs the event details, not the participant name.
  const userIdSet = new Set(rows.map((r) => r.userId));
  const userIds = Array.from(userIdSet);
  const playerRows =
    userIds.length > 0
      ? await db
          .select({
            id: players.userId,
            firstName: players.firstName,
            lastName: players.lastName,
          })
          .from(players)
          .where(sql`${players.userId} = ANY(${userIds})`)
      : [];
  const trainerRows =
    userIds.length > 0
      ? await db
          .select({
            id: trainers.userId,
            firstName: trainers.firstName,
            lastName: trainers.lastName,
          })
          .from(trainers)
          .where(sql`${trainers.userId} = ANY(${userIds})`)
      : [];

  const displayName = new Map<string, string>();
  for (const u of playerRows) {
    displayName.set(u.id, `${u.firstName} ${u.lastName}`);
  }
  for (const u of trainerRows) {
    if (!displayName.has(u.id)) {
      displayName.set(u.id, `${u.firstName} ${u.lastName}`);
    }
  }

  // 4. Apply role-gated redaction.
  return rows.map((r) =>
    redactConflict(
      {
        eventId: r.eventId,
        userId: r.userId,
        typeCode: r.typeCode,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        location: r.location,
        createdBy: r.createdBy,
        callerIsParticipantInConflicting: callerInEventSet.has(r.eventId),
      },
      { userId: caller.userId, role: caller.role },
      displayName.get(r.userId) ?? r.userId,
    ),
  );
}
