/**
 * tournament.* tRPC router — Phase 4 (D-69..D-81 + DOM-CAT-02 + DOM-RESULT-02).
 *
 * 8 procedures (split across Plan 04-04 Tasks 1 & 2):
 *
 *  Management (D-79 — TD only) — Task 1:
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
 *  Result entry (D-69, D-71, D-73, D-75) — Task 2:
 *   - enterResult          atomic {outcome, matches[]} commit. D-71 player
 *                          14d wall; D-73 trainer-in-academy bypass; D-75
 *                          TD bypass + overwrite. DOM-CAT-02 age-category
 *                          snapshot at tournament.startsAt. Audit code
 *                          'tournament_result_entered' OR
 *                          'tournament_result_overwritten' (TD on existing
 *                          row → oldValues snapshot mandatory). Composed
 *                          with `idempotencyMiddleware('tournament.enterResult')`
 *                          (VALID-08).
 *   - listResults          academy-wide visibility via tournament_result_visible_to
 *                          5-branch UNION (D-78). No app-layer filter — RLS
 *                          is the only gate.
 *   - listPendingForPlayer per-player "needs entering" data source for the
 *                          D-72 nudge banner. Returns tournaments where the
 *                          player is a participant, ends_at is in the past
 *                          AND in the last 14d, AND no tournament_results
 *                          row exists yet.
 *
 * Audit codes emitted (6 of 14 — matches tests/integration/phase4-audit.test.ts):
 *   tournament_created, tournament_participant_added,
 *   tournament_participant_removed, tournament_result_entered,
 *   tournament_result_overwritten, tournament_entry_window_expired_attempt.
 *
 * Threat mitigations (per 04-04 PLAN <threat_model>):
 *   - T-04-21: API rejects when caller role=player and input.playerUserId
 *              !== caller.userId. RLS in 0018 mirrors at DB layer.
 *   - T-04-22: trainer path uses SQL JOIN proving shared academy_memberships;
 *              otherwise FORBIDDEN. Defence in depth with 0018 RLS.
 *   - T-04-23: server-side `Date.now() - endsAt > FOURTEEN_DAYS_MS` for
 *              role=player; trainer/TD bypass. Denied-outcome audit row
 *              written BEFORE the FORBIDDEN throw (Pitfall 3 + T-04-19
 *              carry-forward).
 *   - T-04-24: Zod `.min(1)` rejects empty matches[]; db.transaction wraps
 *              tournament_results + match_results — partial commit impossible
 *              (Pitfall 4).
 *   - T-04-25: idempotencyMiddleware composes on enterResult — duplicate
 *              key replays cached responseBody within 24h (Plan 04-03).
 *   - T-04-26: TD overwrite captures pre-state via SELECT before the
 *              transaction; audit row carries oldValues snapshot per D-75 +
 *              D-58c (forensic-recovery substitute for D-76's
 *              result_edit_history table that was rejected).
 *   - T-04-28: getAgeCategoryAt(playerUserId, tournament.startsAt) is the
 *              DOM-CAT-02 snapshot source; falls back to 'age_unknown' when
 *              the player has no covering history row.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-69..D-81
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 3 + §Pitfall 4
 *            src/server/trpc/routers/training.ts (Phase 4 Plan 04-03 — audit / wall / idempotency conventions)
 *            src/server/trpc/routers/calendar.ts (Phase 3 — tournament-extension insert + audit-before-delete pattern)
 */
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';

import { getAgeCategoryAt } from '@/lib/players';
import { db as rawDb, type DbClient } from '@/server/db/client';
import {
  calendarEventParticipants,
  calendarEvents,
  tournaments,
} from '@/server/db/schema/calendar';
import { matchResults, tournamentResults } from '@/server/db/schema/tournament';

import { writeAudit } from '../middleware/audit';
import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
import { idempotencyMiddleware } from '../middleware/idempotency';
import {
  addParticipantInput,
  enterResultInput,
  listPendingForPlayerInput,
  listResultsInput,
  removeParticipantInput,
  tournamentCreateInput,
  tournamentGetInput,
  tournamentListInput,
} from '../schemas/tournament';
import { router } from '../trpc';

/**
 * D-71 14-day discipline wall expressed in milliseconds. Strict-greater
 * comparison per Pitfall 3 carry-forward: exactly 14 days = still allowed;
 * day-15 (day-14 + 1ms) = rejected. This matches the Postgres
 * `now() - ends_at <= INTERVAL '14 days'` boundary semantics used in
 * `listPendingForPlayer`.
 */
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Derive `entered_by` from the caller's role (DOM-RESULT-02). Three buckets:
 *   - 'player'  — caller is the player whose result is being entered
 *   - 'td'      — caller is the technical director
 *   - 'trainer' — caller is a trainer (and necessarily shares an academy
 *                 with the player; the SQL guard in enterResult enforces this)
 *
 * Other roles (sparring_partner, parent, medical_staff, academy_manager)
 * cannot reach this code path — they're rejected by the per-role gate inside
 * `enterResult` BEFORE this helper is called.
 */
function deriveEnteredBy(
  role: 'player' | 'trainer' | 'technical_director',
): 'player' | 'trainer' | 'td' {
  if (role === 'player') return 'player';
  if (role === 'technical_director') return 'td';
  return 'trainer';
}

/**
 * Format a Date as YYYY-MM-DD (UTC) for the `match_date` PG `date` column.
 * Mirrors the helper in `routers/training.ts` — same DST-correctness
 * rationale (UTC slice prevents the one-day drift local-time slicing would
 * introduce around DST boundaries).
 */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

  // ============================================================
  // enterResult — D-69 atomic + D-71 player wall + D-73 trainer/TD bypass
  // ============================================================
  //
  // The keystone procedure of Phase 4 tournaments. Five invariants:
  //
  //   1. ATOMIC (D-69): tournament_results (UPSERT) + match_results
  //      (DELETE+INSERT) commit in a single db.transaction; partial
  //      failure rolls back the entire entry. Empty matches[] rejected
  //      by Zod .min(1); the handler's transaction is the second gate.
  //
  //   2. PLAYER WALL (D-71): role=player can enter/edit ≤ 14 days after
  //      ends_at. Strict-greater comparison per Pitfall 3 carry-forward.
  //      Day-15 = wallExpired=true = FORBIDDEN. Denied-outcome audit row
  //      written BEFORE the throw (T-04-19 forensic-visibility pattern).
  //
  //   3. ASYMMETRIC BACKFILL (D-73): trainer-in-same-academy AND TD
  //      bypass the wall — they can enter/edit on the player's behalf at
  //      any time. Trainer's "same academy" is enforced via a SQL JOIN
  //      against academy_memberships (NOT via ctx.scope.academyIds,
  //      because the in-memory scope is a snapshot and the academy
  //      assignment can change between requests; the DB is the truth).
  //
  //   4. TD UNCONDITIONAL OVERWRITE (D-75): TD can overwrite an existing
  //      result. Pre-state captured via SELECT before the tx → audit row
  //      carries oldValues snapshot → audit code switches to
  //      'tournament_result_overwritten'. This is the D-76 forensic
  //      substitute (the originally-planned result_edit_history table
  //      was rejected; audit_log JSONB snapshot is the audit trail).
  //
  //   5. DOM-CAT-02 AGE-CATEGORY SNAPSHOT: `player_age_category_code` is
  //      derived from `age_category_history` AT tournament.startsAt and
  //      frozen on the row. The player ages out over time; the
  //      tournament-result row stays anchored to the player's category
  //      at competition time.
  //
  // Composed with `idempotencyMiddleware('tournament.enterResult')` so the
  // client may pass `_meta.idempotencyKey` to dedup retries within 24h
  // (VALID-08; cache-hit emits 'idempotency_replay' audit code via the
  // middleware).
  enterResult: protectedProcedure
    .use(idempotencyMiddleware('tournament.enterResult'))
    .input(enterResultInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;
      const callerId = ctx.scope.userId;
      const callerRole = ctx.scope.role;

      // 1. Defense-in-depth on the atomic invariant — Zod already filtered
      //    on .min(1) but a malformed handler-side caller (e.g. an admin
      //    script that constructs the call without going through the
      //    Zod-validated tRPC client) must also be rejected.
      if (input.matches.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.tournament.atLeastOneMatchRequired',
        });
      }

      // 2. Load tournament event: endsAt (for D-71 wall arithmetic) +
      //    startsAt (for DOM-CAT-02 age-category snapshot) + typeCode
      //    (defensive — reject if caller passed a non-tournament event id).
      const event = await db
        .select({
          startsAt: calendarEvents.startsAt,
          endsAt: calendarEvents.endsAt,
          typeCode: calendarEvents.typeCode,
        })
        .from(calendarEvents)
        .where(eq(calendarEvents.id, input.tournamentEventId))
        .limit(1);
      const ev = event[0];
      if (!ev) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'errors.tournament.notFound',
        });
      }
      if (ev.typeCode !== 'event_type_tournament') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.tournament.notATournament',
        });
      }

      // 3. RBAC layer — three role buckets:
      //      player → own result only (no cross-player forgery); 14d wall
      //      trainer → must share an academy with the player; no wall (D-73)
      //      technical_director → unconditional; no wall (D-75)
      //    Other roles fall through to FORBIDDEN.
      if (callerRole === 'player') {
        // Own-row gate (T-04-21).
        if (input.playerUserId !== callerId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'errors.tournament.notOwnPlayer',
          });
        }
        // D-71 14d wall (strict-greater).
        const wallExpired =
          Date.now() - ev.endsAt.getTime() > FOURTEEN_DAYS_MS;
        if (wallExpired) {
          // Denied-outcome audit BEFORE the throw (T-04-19 forensic visibility).
          await writeAudit(ctx, {
            action: 'tournament_entry_window_expired_attempt',
            resourceType: 'tournament',
            resourceId: input.tournamentEventId,
            newValues: {
              playerUserId: input.playerUserId,
              endsAt: ev.endsAt.toISOString(),
              attemptedAt: new Date().toISOString(),
            },
            outcome: 'denied',
          });
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'errors.tournament.entryWindowExpired',
          });
        }
      } else if (callerRole === 'trainer') {
        // D-73 shared-academy proof. SQL is the authority (not ctx.scope.academyIds).
        const shared = await db.execute<{ ok: number }>(sql`
          SELECT 1 AS ok
          FROM academy_memberships am_player
          JOIN academy_memberships am_caller
            ON am_caller.academy_code = am_player.academy_code
          WHERE am_player.user_id = ${input.playerUserId}
            AND am_player.role = 'player'
            AND am_caller.user_id = ${callerId}
            AND am_caller.role = 'trainer'
          LIMIT 1
        `);
        // postgres-js returns an array; pg-style wraps in {rows}. Normalise.
        const sharedRows: Array<{ ok: number }> = Array.isArray(shared)
          ? (shared as Array<{ ok: number }>)
          : ((shared as unknown as { rows?: Array<{ ok: number }> }).rows ??
            []);
        if (sharedRows.length === 0) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'errors.tournament.trainerNotInAcademy',
          });
        }
        // No wall for trainer (D-73).
      } else if (callerRole === 'technical_director') {
        // D-75 unconditional — no wall, no academy check.
      } else {
        // sparring_partner, parent, medical_staff, academy_manager → not allowed
        // to enter tournament results. RLS would block them anyway, but a
        // first-line gate produces a clearer error than a downstream RLS
        // INSERT WITH CHECK rejection.
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'role_not_allowed',
        });
      }

      // 4. Attribution (DOM-RESULT-02).
      const enteredBy = deriveEnteredBy(
        callerRole as 'player' | 'trainer' | 'technical_director',
      );

      // 5. DOM-CAT-02 — snapshot the age category as of tournament.startsAt.
      //    Falls back to 'age_unknown' when the player has no covering
      //    age_category_history row (e.g. legacy / pre-history accounts).
      const cat = await getAgeCategoryAt(input.playerUserId, ev.startsAt, db);
      const playerAgeCategoryCode = cat?.code ?? 'age_unknown';

      // 6. Pre-state snapshot for the D-75 overwrite audit. Two queries
      //    OUTSIDE the tx (snapshot is read-only): the tournament_results
      //    head row + all match_results rows for this (tournament, player).
      //    If preTournamentRow is present, this is an UPDATE/overwrite path.
      const preTournamentRows = await db
        .select()
        .from(tournamentResults)
        .where(
          and(
            eq(tournamentResults.tournamentEventId, input.tournamentEventId),
            eq(tournamentResults.playerUserId, input.playerUserId),
          ),
        )
        .limit(1);
      const preMatchRows = await db
        .select()
        .from(matchResults)
        .where(
          and(
            eq(matchResults.tournamentEventId, input.tournamentEventId),
            eq(matchResults.playerUserId, input.playerUserId),
          ),
        );
      const isOverwrite = preTournamentRows.length > 0;

      // 7. Atomic transaction: UPSERT tournament_results + DELETE+INSERT
      //    match_results (full replacement per RESEARCH Pattern 3 — see
      //    Open Question 3 there for the diff-merge alternative discussion).
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .insert(tournamentResults)
          .values({
            tournamentEventId: input.tournamentEventId,
            playerUserId: input.playerUserId,
            outcomeLevelCode: input.outcome,
            playerAgeCategoryCode,
            enteredBy,
            enteredByUserId: callerId,
            enteredAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              tournamentResults.tournamentEventId,
              tournamentResults.playerUserId,
            ],
            set: {
              outcomeLevelCode: input.outcome,
              playerAgeCategoryCode,
              enteredBy,
              enteredByUserId: callerId,
              updatedAt: now,
            },
          });

        await tx
          .delete(matchResults)
          .where(
            and(
              eq(matchResults.tournamentEventId, input.tournamentEventId),
              eq(matchResults.playerUserId, input.playerUserId),
            ),
          );

        // Drizzle's `tstz('created_at', { defaultNow: true })` helper returns a
        // conditional type whose strict inference flags `createdAt` as required
        // (same friction Plan 04-03 hit on session_participants). The schema
        // default is the canonical source; cast through `any` to skip the
        // mistaken inference. Audit follows the same pattern (see audit.ts).
        await tx
          .insert(matchResults)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .values(
            input.matches.map((m) => ({
              tournamentEventId: input.tournamentEventId,
              playerUserId: input.playerUserId,
              roundCode: m.round,
              opponentName: m.opponent,
              opponentRanking: m.opponentRanking,
              matchDate: toIsoDate(m.matchDate),
              setsWon: m.setsWon,
              setsLost: m.setsLost,
              videoLink: m.videoLink,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            })) as any,
          );
      });

      // 8. Audit. Two codes:
      //    - 'tournament_result_overwritten' when isOverwrite AND caller is
      //      TD (D-75 unconditional overwrite — the differentiator is who
      //      overwrote, not whether a row existed; a player editing their
      //      own result within 14d is also "isOverwrite" but is captured
      //      as a normal entry, not a TD overwrite).
      //    - 'tournament_result_entered' for every other case (initial
      //      entry, player self-edit within 14d, trainer backfill, even
      //      a TD-initiated brand-new entry).
      const isTdOverwrite =
        isOverwrite && callerRole === 'technical_director';
      await writeAudit(ctx, {
        action: isTdOverwrite
          ? 'tournament_result_overwritten'
          : 'tournament_result_entered',
        resourceType: 'tournament_result',
        resourceId: `${input.tournamentEventId}:${input.playerUserId}`,
        oldValues: isTdOverwrite
          ? {
              tournament: preTournamentRows[0],
              matches: preMatchRows,
            }
          : undefined,
        newValues: {
          outcome: input.outcome,
          matchCount: input.matches.length,
          enteredBy,
          ageCategorySnapshot: playerAgeCategoryCode,
        },
        outcome: 'success',
      });

      return {
        ok: true as const,
        isOverwrite,
        enteredBy,
        ageCategorySnapshot: playerAgeCategoryCode,
      };
    }),

  // ============================================================
  // listResults — D-78 academy-wide visibility (5-branch UNION via RLS)
  // ============================================================
  //
  // Two queries on RLS-scoped tables — the database (via
  // `tournament_result_visible_to` 5-branch UNION shipped in 0018) decides
  // which rows the caller sees. The router does NOT add any app-layer
  // scope filter — that would defeat the D-78 academy-wide leaderboard
  // semantics. The threat T-04-27 (academy peer leak) is accepted by
  // design (per CONTEXT D-78).
  //
  // Match rows are returned alongside the tournament_results rows so the
  // UI can render the per-player accordion (outcome + match grid). Client
  // groups matches by `playerUserId`.
  listResults: protectedProcedure
    .input(listResultsInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;

      const results = await db
        .select({
          playerUserId: tournamentResults.playerUserId,
          outcomeLevelCode: tournamentResults.outcomeLevelCode,
          playerAgeCategoryCode: tournamentResults.playerAgeCategoryCode,
          enteredBy: tournamentResults.enteredBy,
          enteredByUserId: tournamentResults.enteredByUserId,
          enteredAt: tournamentResults.enteredAt,
          updatedAt: tournamentResults.updatedAt,
        })
        .from(tournamentResults)
        .where(
          eq(tournamentResults.tournamentEventId, input.tournamentEventId),
        )
        .orderBy(asc(tournamentResults.enteredAt));

      const matches = await db
        .select()
        .from(matchResults)
        .where(eq(matchResults.tournamentEventId, input.tournamentEventId))
        .orderBy(desc(matchResults.matchDate));

      return { results, matches };
    }),

  // ============================================================
  // listPendingForPlayer — D-72 entry-window nudge data source
  // ============================================================
  //
  // Returns tournaments where:
  //   - the target player is a participant
  //   - the tournament has ended (ends_at < now)
  //   - the tournament ended within the last 14 days (ends_at >= now - 14d)
  //   - NO tournament_results row exists yet for (player, event)
  //
  // The UI inbox banner (Plan 04-07) reads this on every dashboard mount;
  // the pg_cron daily nudge job (Plan 04-07) reads the same logic to
  // populate `system_inbox` rows. Returning the data via the router is the
  // interactive path; the pg_cron path is the passive notification surface.
  //
  // RBAC: role=player can only query own pending. trainer/TD/parent can
  // pass an explicit playerUserId override. Other roles → FORBIDDEN.
  listPendingForPlayer: protectedProcedure
    .input(listPendingForPlayerInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;
      const callerId = ctx.scope.userId;
      const callerRole = ctx.scope.role;

      const targetPlayerId = input.playerUserId ?? callerId;
      if (callerRole === 'player' && targetPlayerId !== callerId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'errors.tournament.notOwnPlayer',
        });
      }

      const now = new Date();
      const fourteenDaysAgo = new Date(now.getTime() - FOURTEEN_DAYS_MS);

      // LEFT JOIN tournament_results: rows where the result row is missing
      // are the "pending" set. RLS filters calendar_event_participants and
      // tournament_results both — out-of-scope players naturally return
      // zero rows. Sort by ends_at DESC so the most recently-ended (and
      // therefore most urgent on the 14d clock) tournament leads the list.
      const pending = await db
        .select({
          eventId: calendarEvents.id,
          naam: calendarEvents.title,
          startsAt: calendarEvents.startsAt,
          endsAt: calendarEvents.endsAt,
          city: tournaments.city,
          country: tournaments.country,
        })
        .from(calendarEvents)
        .innerJoin(tournaments, eq(tournaments.eventId, calendarEvents.id))
        .innerJoin(
          calendarEventParticipants,
          and(
            eq(calendarEventParticipants.eventId, calendarEvents.id),
            eq(calendarEventParticipants.userId, targetPlayerId),
          ),
        )
        .leftJoin(
          tournamentResults,
          and(
            eq(
              tournamentResults.tournamentEventId,
              calendarEvents.id,
            ),
            eq(tournamentResults.playerUserId, targetPlayerId),
          ),
        )
        .where(
          and(
            eq(calendarEvents.typeCode, 'event_type_tournament'),
            lt(calendarEvents.endsAt, now),
            gte(calendarEvents.endsAt, fourteenDaysAgo),
            isNull(tournamentResults.tournamentEventId),
          ),
        )
        .orderBy(desc(calendarEvents.endsAt));

      return { pending };
    }),
});

// Re-export the FOURTEEN_DAYS_MS constant so future plans (especially the
// 04-07 pg_cron nudge wiring) can keep the wall constant in lock-step. The
// training router exports its own copy; both must remain numerically equal
// because D-64 (training) and D-71 (tournament) both pin to "14 days".
export { FOURTEEN_DAYS_MS as TOURNAMENT_WALL_MS };
