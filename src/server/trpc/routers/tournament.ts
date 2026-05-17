/**
 * tournament.* tRPC router — Phase 4 (D-69..D-81 + DOM-CAT-02 + DOM-RESULT-02).
 *
 * 8 procedures (split across Plan 04-04 Tasks 1 & 2):
 *
 *  Management (D-79 — TD only) — Task 1 (this file):
 *   - create               atomically inserts calendar_events (typeCode=
 *                          'event_type_tournament') + tournaments extension.
 *                          Audit code 'tournament_created'.
 *   - list                 paginated listing of tournaments visible to the
 *                          caller (RLS does scope; cursor pagination via
 *                          (starts_at, event_id)).
 *   - get                  single-tournament read with participant count.
 *                          RLS-filtered → NOT_FOUND on out-of-scope
 *                          (D-36 carry-forward).
 *   - addParticipant       INSERT calendar_event_participants(role='participant',
 *                          rsvp='accepted'). Triggers Phase 3 calendar view +
 *                          (Plan 04-07) the 14d entry nudge chain. Audit
 *                          'tournament_participant_added'.
 *   - removeParticipant    Audit-before-delete pattern (D-58c carry-forward):
 *                          SELECT FOR UPDATE → snapshot → writeAudit
 *                          'tournament_participant_removed' (oldValues
 *                          captures the participant row) → DELETE.
 *
 *  Result entry (D-69, D-71, D-73, D-75) — Task 2 (appended in the same plan):
 *   - enterResult / listResults / listPendingForPlayer. See Task 2 doc-block
 *     below the management procedures.
 *
 * Audit codes emitted by THIS task (3 of the plan's 6):
 *   tournament_created, tournament_participant_added,
 *   tournament_participant_removed.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-69..D-81
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 3 + §Pitfall 4
 *            src/server/trpc/routers/training.ts (Phase 4 Plan 04-03 — audit / wall / idempotency conventions)
 *            src/server/trpc/routers/calendar.ts (Phase 3 — tournament-extension insert + audit-before-delete pattern)
 */
import { TRPCError } from '@trpc/server';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import { db as rawDb, type DbClient } from '@/server/db/client';
import {
  calendarEventParticipants,
  calendarEvents,
  tournaments,
} from '@/server/db/schema/calendar';

import { writeAudit } from '../middleware/audit';
import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
import {
  addParticipantInput,
  removeParticipantInput,
  tournamentCreateInput,
  tournamentGetInput,
  tournamentListInput,
} from '../schemas/tournament';
import { router } from '../trpc';

// ─── Router definition ─────────────────────────────────────────────────

export const tournamentRouter = router({
  // ============================================================
  // create — D-79 TD-only tournament creation
  // ============================================================
  //
  // Atomic tx: INSERT calendar_events (typeCode='event_type_tournament')
  // + INSERT tournaments extension row. Mirrors the Phase 3
  // calendar.event.create discriminated-union branch for
  // 'event_type_tournament' — but namespaced under tournament.* so a
  // TD-only client only needs the tournament router permissions, and the
  // audit code (`tournament_created`) is domain-specific.
  //
  // RBAC: `tdProcedure` rejects non-TD callers at middleware. RLS
  // (calendar_events INSERT WITH CHECK created_by=current_user_id() —
  // Phase 3) is the defence-in-depth backstop.
  create: tdProcedure
    .input(tournamentCreateInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;
      const callerId = ctx.scope.userId;

      let eventId: string;
      try {
        eventId = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(calendarEvents)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values({
              typeCode: 'event_type_tournament',
              title: input.naam,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              allDay: false,
              location: input.city,
              description: input.description ?? null,
              rrule: null,
              createdBy: callerId,
            } as any)
            .returning({ id: calendarEvents.id });
          const first = inserted[0];
          if (!first) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'tournament_insert_returned_no_row',
            });
          }
          const id = first.id;
          await tx.insert(tournaments).values({
            eventId: id,
            city: input.city,
            country: input.country,
            ageCategoryCode: input.ageCategoryCode,
            tournamentTypeCode: input.tournamentTypeCode,
          });
          return id;
        });
      } catch (err: unknown) {
        // CHECK calendar_events_ends_after_starts violation → BAD_REQUEST
        // (Phase 3 carry-forward; the schema-level refine catches this
        // before the DB but a clock-skew edge case might still hit it).
        const e = err as { code?: string; constraint?: string };
        if (
          e.code === '23514' &&
          (e.constraint?.includes('ends_after_starts') ?? false)
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'errors.calendar.endsAfterStarts',
          });
        }
        throw err;
      }

      await writeAudit(ctx, {
        action: 'tournament_created',
        resourceType: 'tournament',
        resourceId: eventId,
        newValues: {
          naam: input.naam,
          startsAt: input.startsAt.toISOString(),
          endsAt: input.endsAt.toISOString(),
          city: input.city,
          country: input.country,
          ageCategoryCode: input.ageCategoryCode,
          tournamentTypeCode: input.tournamentTypeCode,
        },
        outcome: 'success',
      });

      return { eventId };
    }),

  // ============================================================
  // list — paginated tournament catalogue (RLS-scoped)
  // ============================================================
  //
  // Cursor format: `${startsAtIso}|${eventId}` (events with the same starts_at
  // are ordered deterministically by id). Returns up to `limit` rows ordered
  // ascending by starts_at; supports filter-by-age, filter-by-type, and
  // start-date range. RLS via Phase 3 `calendar_events_visible_to(...)` is
  // the scoping gate — list never adds an app-layer scope filter.
  list: protectedProcedure
    .input(tournamentListInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;

      const conditions = [
        eq(calendarEvents.typeCode, 'event_type_tournament'),
      ];
      if (input.startFrom)
        conditions.push(gte(calendarEvents.startsAt, input.startFrom));
      if (input.startTo)
        conditions.push(lte(calendarEvents.startsAt, input.startTo));
      if (input.ageCategoryCodes && input.ageCategoryCodes.length > 0) {
        conditions.push(
          sql`${tournaments.ageCategoryCode} = ANY(${input.ageCategoryCodes})`,
        );
      }
      if (input.tournamentTypeCodes && input.tournamentTypeCodes.length > 0) {
        conditions.push(
          sql`${tournaments.tournamentTypeCode} = ANY(${input.tournamentTypeCodes})`,
        );
      }
      // Cursor: rows after `(startsAt, id)` in lex order.
      if (input.cursor) {
        const [iso, id] = input.cursor.split('|');
        if (iso && id) {
          const cursorDate = new Date(iso);
          conditions.push(
            sql`(${calendarEvents.startsAt}, ${calendarEvents.id}) > (${cursorDate}, ${id})`,
          );
        }
      }

      const rows = await db
        .select({
          eventId: calendarEvents.id,
          naam: calendarEvents.title,
          startsAt: calendarEvents.startsAt,
          endsAt: calendarEvents.endsAt,
          city: tournaments.city,
          country: tournaments.country,
          ageCategoryCode: tournaments.ageCategoryCode,
          tournamentTypeCode: tournaments.tournamentTypeCode,
        })
        .from(calendarEvents)
        .innerJoin(tournaments, eq(tournaments.eventId, calendarEvents.id))
        .where(and(...conditions))
        .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor =
        hasMore && page.length > 0
          ? `${page[page.length - 1]!.startsAt.toISOString()}|${page[page.length - 1]!.eventId}`
          : null;

      return { tournaments: page, nextCursor };
    }),

  // ============================================================
  // get — single tournament with participant count
  // ============================================================
  //
  // RLS via Phase 3 `calendar_events_visible_to` filters at the DB layer.
  // Out-of-scope rows return zero rows → NOT_FOUND (D-36 carry-forward —
  // never FORBIDDEN, prevents enumeration probes).
  get: protectedProcedure
    .input(tournamentGetInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;

      const rows = await db
        .select({
          eventId: calendarEvents.id,
          naam: calendarEvents.title,
          startsAt: calendarEvents.startsAt,
          endsAt: calendarEvents.endsAt,
          description: calendarEvents.description,
          createdBy: calendarEvents.createdBy,
          city: tournaments.city,
          country: tournaments.country,
          ageCategoryCode: tournaments.ageCategoryCode,
          tournamentTypeCode: tournaments.tournamentTypeCode,
        })
        .from(calendarEvents)
        .innerJoin(tournaments, eq(tournaments.eventId, calendarEvents.id))
        .where(
          and(
            eq(calendarEvents.id, input.tournamentEventId),
            eq(calendarEvents.typeCode, 'event_type_tournament'),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'errors.tournament.notFound',
        });
      }

      const participantCount = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(calendarEventParticipants)
        .where(eq(calendarEventParticipants.eventId, input.tournamentEventId));

      return {
        ...row,
        participantCount: participantCount[0]?.count ?? 0,
      };
    }),

  // ============================================================
  // addParticipant — D-79 TD-only participant registration
  // ============================================================
  //
  // Inserts calendar_event_participants(role_in_event='participant',
  // rsvp_status='accepted'). The participant insert is what causes the
  // tournament to surface on the player's calendar AND triggers the D-72
  // 14d entry-window nudge chain (Plan 04-07 pg_cron job watches
  // calendar_event_participants joined to tournament_results to identify
  // "in window AND no result yet" rows).
  //
  // ON CONFLICT DO NOTHING: re-adding the same player is idempotent —
  // returns ok=true without raising; the prior row stays unchanged and
  // the audit row records the "re-add attempt" attribution.
  addParticipant: tdProcedure
    .input(addParticipantInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;

      // Verify tournament exists (D-36 NOT_FOUND on RLS-filtered).
      const exists = await db
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.id, input.tournamentEventId),
            eq(calendarEvents.typeCode, 'event_type_tournament'),
          ),
        )
        .limit(1);
      if (!exists[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'errors.tournament.notFound',
        });
      }

      await db
        .insert(calendarEventParticipants)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({
          eventId: input.tournamentEventId,
          userId: input.playerUserId,
          roleInEvent: 'participant',
          rsvpStatus: 'accepted',
        } as any)
        .onConflictDoNothing({
          target: [
            calendarEventParticipants.eventId,
            calendarEventParticipants.userId,
          ],
        });

      await writeAudit(ctx, {
        action: 'tournament_participant_added',
        resourceType: 'tournament_participation',
        resourceId: `${input.tournamentEventId}:${input.playerUserId}`,
        newValues: {
          tournamentEventId: input.tournamentEventId,
          playerUserId: input.playerUserId,
          roleInEvent: 'participant',
          rsvpStatus: 'accepted',
        },
        outcome: 'success',
      });

      return { ok: true as const };
    }),

  // ============================================================
  // removeParticipant — D-79 TD-only participant deregistration
  // ============================================================
  //
  // Audit-before-delete pattern (D-58c carry-forward from Phase 3
  // event.delete): SELECT FOR UPDATE → snapshot the row → writeAudit with
  // oldValues → DELETE inside the same transaction. Three properties:
  //   1. The audit row exists even if the DELETE later rolls back (audit
  //      INSERT and DELETE are in the same tx).
  //   2. The snapshot captures the row's full state for forensic recovery.
  //   3. SELECT FOR UPDATE prevents a concurrent update from racing the
  //      DELETE — the audit would otherwise capture stale state.
  //
  // Note: tournament_results.player_user_id has `onDelete: 'restrict'` to
  // users.id, so deleting the calendar_event_participants row does NOT
  // cascade into tournament_results. The TD can remove a participant who
  // already has a result — the result stays in the leaderboard (D-78
  // academy-wide visibility is unaffected). If the TD truly wants to undo
  // a result, they call enterResult with empty matches (rejected by D-69
  // .min(1)) or directly DELETE through an admin path — outside this
  // procedure's scope.
  removeParticipant: tdProcedure
    .input(removeParticipantInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;

      await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(calendarEventParticipants)
          .where(
            and(
              eq(
                calendarEventParticipants.eventId,
                input.tournamentEventId,
              ),
              eq(calendarEventParticipants.userId, input.playerUserId),
            ),
          )
          .for('update');
        const row = rows[0];
        if (!row) {
          // RLS-filtered or absent — D-36 NOT_FOUND.
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'errors.tournament.participantNotFound',
          });
        }

        // 1. writeAudit BEFORE the DELETE so the trail is durable across
        //    the boundary. writeAudit pulls ctx.db (the same withRlsContext
        //    transaction handle); the INSERT into audit_log lives in the
        //    same tx as the DELETE below.
        await writeAudit(ctx, {
          action: 'tournament_participant_removed',
          resourceType: 'tournament_participation',
          resourceId: `${input.tournamentEventId}:${input.playerUserId}`,
          oldValues: row,
          outcome: 'success',
        });

        // 2. DELETE
        await tx
          .delete(calendarEventParticipants)
          .where(
            and(
              eq(
                calendarEventParticipants.eventId,
                input.tournamentEventId,
              ),
              eq(calendarEventParticipants.userId, input.playerUserId),
            ),
          );
      });

      return { ok: true as const };
    }),

  // NOTE: enterResult / listResults / listPendingForPlayer ship in Task 2 of
  // this same plan (04-04). Task 1 lands the TD-only management surface so
  // the router compiles end-to-end before the result-entry path is wired.
});
