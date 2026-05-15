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
import { and, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { z } from 'zod';

import {
  ensureHorizon,
  expandRrule,
  formatOccurrenceDate,
  validateHorizon,
  type ExceptionInput,
} from '@/lib/rrule';
import {
  redactConflict,
  type RedactedConflict,
} from '@/lib/calendar/conflicts';
import type { Role } from '@/server/auth/permissions';
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
import { trainers } from '@/server/db/schema/trainers';

import { writeAudit } from '../middleware/audit';
import { canCreateEventType } from '../middleware/calendarCreate';
import { protectedProcedure } from '../middleware/freshSession';
import {
  cancelOccurrenceInput,
  declineParticipationInput,
  detectConflictsInput,
  eventCreateInput,
  eventDeleteInput,
  eventGetInput,
  eventUpdateInput,
  filterOptionsInput,
  listInput,
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

        // D-57: conflict probe before write (unless force:true).
        if (!input.force && input.participants.length > 0) {
          const conflicts = await detectConflictsForParticipants(
            db,
            ctx.scope,
            input.startsAt,
            input.endsAt,
            input.participants.map((p) => p.userId),
            // excludeEventId: this is a new event — nothing to exclude.
            undefined,
          );
          if (conflicts.length > 0) {
            // Return the conflicts as a soft error — the UI surfaces
            // ConflictWarning and resubmits with force:true if the user
            // clicks "Toch opslaan".
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'errors.calendar.conflictDetected',
              cause: { conflicts, blocked: false },
            });
          }
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

        // If we created with force:true, audit the override BEFORE the
        // success audit so the audit trail shows the explicit
        // decision-and-mutation.
        if (input.force && input.participants.length > 0) {
          await writeAudit(ctx, {
            action: 'calendar_event_conflict_override',
            resourceType: 'calendar_event',
            resourceId: eventId,
            newValues: {
              force: true,
              participants: input.participants.map((p) => p.userId),
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

        // D-57: conflict probe (excludeEventId = this event).
        if (!input.force && input.participants.length > 0) {
          const conflicts = await detectConflictsForParticipants(
            db,
            ctx.scope,
            input.startsAt,
            input.endsAt,
            input.participants.map((p) => p.userId),
            input.eventId,
          );
          if (conflicts.length > 0) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'errors.calendar.conflictDetected',
              cause: { conflicts, blocked: false },
            });
          }
        }

        await db.transaction(async (tx) => {
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

          // Replace participants (delete + re-insert is the simplest atomic
          // shape; a more efficient diff is a Phase 4 optimisation).
          await tx
            .delete(calendarEventParticipants)
            .where(eq(calendarEventParticipants.eventId, input.eventId));
          if (input.participants.length > 0) {
            const participantValues: Array<{
              eventId: string;
              userId: string;
              roleInEvent: string;
              rsvpStatus: string;
            }> = input.participants.map((p) => ({
              eventId: input.eventId,
              userId: p.userId,
              roleInEvent: p.roleInEvent,
              rsvpStatus: 'pending',
            }));
            await tx
              .insert(calendarEventParticipants)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .values(participantValues as any);
          }
          // Extension table update is per-type — we delete + re-insert for
          // simplicity (foreign tables only have a PK to calendar_events).
          await deleteExtensionRow(tx, input.type, input.eventId);
          await insertExtensionRow(tx, input, input.eventId);
        });

        if (input.force && input.participants.length > 0) {
          await writeAudit(ctx, {
            action: 'calendar_event_conflict_override',
            resourceType: 'calendar_event',
            resourceId: input.eventId,
            newValues: { force: true },
          });
        }
        await writeAudit(ctx, {
          action: 'calendar_event_updated',
          resourceType: 'calendar_event',
          resourceId: input.eventId,
          oldValues: {
            title: existingRow.title,
            startsAt: existingRow.startsAt.toISOString(),
            endsAt: existingRow.endsAt.toISOString(),
          },
          newValues: {
            title: input.title,
            startsAt: input.startsAt.toISOString(),
            endsAt: input.endsAt.toISOString(),
          },
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
        const likeArg = `%${input.query}%`;

        switch (input.kind) {
          case 'player': {
            // RLS scopes players via players_visible_to (Phase 1).
            // Simple LIKE search for the query string.
            const result = await db.execute<{ id: string; label: string }>(sql`
              SELECT user_id AS id,
                     (first_name || ' ' || last_name) AS label
                FROM players
               WHERE (first_name || ' ' || last_name) ILIKE ${likeArg}
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
            const result = await db.execute<{ id: string; label: string }>(sql`
              SELECT user_id AS id,
                     (first_name || ' ' || last_name) AS label
                FROM trainers
               WHERE (first_name || ' ' || last_name) ILIKE ${likeArg}
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
            const result = await db.execute<{ id: string; label: string }>(sql`
              SELECT code AS id, canonical_name AS label
                FROM academy
               WHERE active = true
                 AND canonical_name ILIKE ${likeArg}
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
