/**
 * training.* tRPC router — Phase 4 (D-60..D-68 + D-82 + DOM-MED-CONFLICT-01/02).
 *
 * 3 procedures:
 *   - markAttendanceAndScore — bulk upsert all session_participants for
 *     (event_id, occurrence_date). Atomic tx. D-64 14d absolute wall
 *     (no TD override). Idempotent via VALID-08 middleware. ON CONFLICT
 *     DO UPDATE on the composite PK (D-82 + Pitfall 6 race safety).
 *   - listPending — "Te scoren" aggregator. D-66 trainer sees own pending
 *     sessions (scope='self'); D-68 TD sees all pending sessions
 *     (scope='all', TD-only).
 *   - getSession — form preload payload: event/session metadata,
 *     participant roster, existing-rows pre-fill, plus DOM-MED-CONFLICT-02
 *     `hasMedicalConflict` flag per participant (form pre-flags absence
 *     for participants with overlapping medical events; trainer can override).
 *
 * Audit codes emitted (3 — must match tests/integration/phase4-audit.test.ts):
 *   - training_attendance_marked       — markAttendanceAndScore success
 *   - training_score_window_expired_attempt — denied outcome on D-64 wall reject
 *   - idempotency_replay               — emitted by the idempotency middleware
 *                                        when it short-circuits a duplicate Save
 *
 * Threat mitigations (per 04-03 PLAN <threat_model>):
 *   - T-04-15: 14d wall enforced server-side. Client may render disabled
 *     UI; the wall is non-bypassable at the API.
 *   - T-04-16: defense-in-depth — RLS sp_write_trainer_or_td (Plan 04-02)
 *     PLUS inline check `event.trainerId === ctx.scope.userId` for the
 *     trainer role; TD bypasses both.
 *   - T-04-17: ON CONFLICT DO UPDATE on (event_id, occurrence_date, user_id)
 *     so concurrent trainer + TD edits cannot raise PK-violation.
 *   - T-04-19: every wall rejection writes outcome='denied' audit row
 *     BEFORE throwing the TRPCError — observable in GDPR Article 30 feed.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-60..D-68
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 2 + §Pitfall 5/6
 *            src/server/trpc/routers/calendar.ts (Phase 3 analog — tx + audit pattern)
 */
import { TRPCError } from '@trpc/server';
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';

import type { DbClient } from '@/server/db/client';
import { users } from '@/server/db/schema/auth';
import {
  calendarEventParticipants,
  calendarEvents,
  trainingSessions,
} from '@/server/db/schema/calendar';
import { sessionParticipants } from '@/server/db/schema/training';

import { writeAudit, writeAuditOutsideTx } from '../middleware/audit';
import {
  protectedProcedure,
  trainerOrTdProcedure,
} from '../middleware/freshSession';
import { idempotencyMiddleware } from '../middleware/idempotency';
import {
  getSessionInput,
  listPendingInput,
  markAttendanceAndScoreInput,
} from '../schemas/training';
import { router } from '../trpc';

/** D-64 / D-71 wall in milliseconds. Strict-greater comparison per Pitfall 3:
 *  exactly 14 days = still allowed; day-15 (or day-14 + 1ms) = rejected. */
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Format a Date as YYYY-MM-DD using UTC components. Used for the
 * `occurrence_date` column (date type in Postgres — no time component).
 *
 * IMPORTANT: uses UTC slice, not local-time slice. The 14d wall is computed
 * against the UTC `ends_at` timestamp; the date stored on the row is the
 * UTC date of the session start. Locale-time slicing would introduce a
 * one-day drift across DST boundaries — same defect Phase 3 D-55 horizon
 * was hardened against.
 */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pre-flag participants who have an overlapping medical event for the
 * given training session time range (DOM-MED-CONFLICT-02).
 *
 * Uses the Phase 3 SECURITY DEFINER `overlapping_events_for_users(uuid[],
 * tstzrange[])` Postgres function — same cross-scope detection used by
 * `calendar.event.detectConflicts`. The function bypasses RLS so we get
 * ALL overlaps for the candidate participants (cross-scope correctness —
 * D-57); we only surface the flag in the response (no event details), so
 * no service-layer redaction is needed here.
 *
 * Returns a Set of user_ids whose overlap row has
 * `type_code = 'event_type_medical'`.
 */
async function getMedicalConflictUserIds(
  db: DbClient,
  userIds: string[],
  startsAt: Date,
  endsAt: Date,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rangeLiteral = sql`tstzrange(${startsAt}, ${endsAt}, '[)')`;
  const rawResult = await db.execute<{
    user_id: string;
    type_code: string;
  }>(sql`
    SELECT user_id, type_code
      FROM overlapping_events_for_users(
        ${userIds}::uuid[],
        ARRAY[${rangeLiteral}]::tstzrange[]
      )
  `);
  // postgres-js returns an array; pg-style drivers wrap in {rows}.
  const rows: Array<{ user_id: string; type_code: string }> = Array.isArray(
    rawResult,
  )
    ? (rawResult as Array<{ user_id: string; type_code: string }>)
    : ((rawResult as unknown as { rows?: Array<{ user_id: string; type_code: string }> })
        .rows ?? []);
  const out = new Set<string>();
  for (const r of rows) {
    if (r.type_code === 'event_type_medical') out.add(r.user_id);
  }
  return out;
}

// ─── Router definition ─────────────────────────────────────────────────

export const trainingRouter = router({
  // ============================================================
  // markAttendanceAndScore — D-62 bulk upsert + D-64 wall + GDPR-04 audit
  // ============================================================
  markAttendanceAndScore: trainerOrTdProcedure
    .use(idempotencyMiddleware('training.markAttendanceAndScore'))
    .input(markAttendanceAndScoreInput)
    .mutation(async ({ ctx, input }) => {
      const dbHandle = ctx.db as DbClient;

      // 1. Load event for endsAt (14d wall arithmetic) AND trainer_id
      //    (defense-in-depth: trainer must own the session).
      const event = await dbHandle
        .select({
          endsAt: calendarEvents.endsAt,
          trainerId: trainingSessions.trainerId,
        })
        .from(calendarEvents)
        .innerJoin(
          trainingSessions,
          eq(trainingSessions.eventId, calendarEvents.id),
        )
        .where(eq(calendarEvents.id, input.eventId))
        .limit(1);

      if (!event[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'errors.calendar.eventNotFound',
        });
      }

      // 2. D-64 14-day absolute wall — NO TD override (per CONTEXT D-64).
      //    Audit row written FIRST (outcome='denied') so the rejection is
      //    forensically visible even if the TRPCError throw is later wrapped
      //    or swallowed by a calling layer.
      const wallExpired =
        Date.now() - event[0].endsAt.getTime() > FOURTEEN_DAYS_MS;
      if (wallExpired) {
        await writeAuditOutsideTx(ctx, {
          action: 'training_score_window_expired_attempt',
          resourceType: 'calendar_event',
          resourceId: input.eventId,
          newValues: {
            occurrenceDate: toIsoDate(input.occurrenceDate),
            participantCount: input.participants.length,
          },
          outcome: 'denied',
        });
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'errors.training.scoreWindowExpired',
        });
      }

      // 3. Defense-in-depth: trainer must be THE trainer of this session.
      //    TD bypasses this check. RLS (sp_write_trainer_or_td policy from
      //    Plan 04-02) is the database-layer backstop.
      if (
        ctx.scope!.role === 'trainer' &&
        event[0].trainerId !== ctx.scope!.userId
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'errors.training.notSessionTrainer',
        });
      }

      const occurrenceDateStr = toIsoDate(input.occurrenceDate);

      // 4. Snapshot pre-state for the audit row's oldValues (Pitfall 6 —
      //    concurrent trainer + TD overwrite must be forensically visible).
      const preState = await dbHandle
        .select()
        .from(sessionParticipants)
        .where(
          and(
            eq(sessionParticipants.eventId, input.eventId),
            eq(sessionParticipants.occurrenceDate, occurrenceDateStr),
          ),
        );

      // 5. Atomic bulk upsert — ON CONFLICT DO UPDATE on composite PK
      //    (event_id, occurrence_date, user_id). Per Pitfall 6: two trainers
      //    submitting concurrent edits must NOT raise a PK violation; the
      //    second writer's row wins, but the audit row captures both
      //    pre-state and post-state so the override is observable.
      const now = new Date();
      await dbHandle.transaction(async (tx) => {
        const rows = input.participants.map((p) => ({
          eventId: input.eventId,
          occurrenceDate: occurrenceDateStr,
          userId: p.userId,
          attended: p.attended,
          qualityScore: p.qualityScore,
          feedbackText: p.feedbackText,
          createdBy: ctx.scope!.userId,
          createdAt: now,
          updatedAt: now,
        }));

        await tx
          .insert(sessionParticipants)
          .values(rows)
          .onConflictDoUpdate({
            target: [
              sessionParticipants.eventId,
              sessionParticipants.occurrenceDate,
              sessionParticipants.userId,
            ],
            set: {
              attended: sql`EXCLUDED.attended`,
              qualityScore: sql`EXCLUDED.quality_score`,
              feedbackText: sql`EXCLUDED.feedback_text`,
              updatedAt: now,
            },
          });
      });

      // 6. Audit success — written AFTER the tx commits so the audit row
      //    reflects the truth of the write (Phase 1 audit.ts contract).
      await writeAudit(ctx, {
        action: 'training_attendance_marked',
        resourceType: 'session_participant',
        resourceId: `${input.eventId}:${occurrenceDateStr}`,
        oldValues: preState,
        newValues: {
          eventId: input.eventId,
          occurrenceDate: occurrenceDateStr,
          participants: input.participants,
        },
        outcome: 'success',
      });

      return {
        ok: true as const,
        updatedCount: input.participants.length,
      };
    }),

  // ============================================================
  // listPending — D-66 trainer self / D-68 TD all
  // ============================================================
  listPending: protectedProcedure
    .input(listPendingInput)
    .query(async ({ ctx, input }) => {
      // First-line gate — only trainer + TD can call this at all.
      // RLS scopes session_participants reads as a backstop.
      if (
        ctx.scope!.role !== 'trainer' &&
        ctx.scope!.role !== 'technical_director'
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'errors.role.notAllowed',
        });
      }
      // scope='all' (D-68) is TD-only.
      if (
        input.scope === 'all' &&
        ctx.scope!.role !== 'technical_director'
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'errors.role.notAllowed',
        });
      }

      const dbHandle = ctx.db as DbClient;
      const now = new Date();
      const fourteenDaysAgo = new Date(now.getTime() - FOURTEEN_DAYS_MS);

      // Aggregate per-session: only sessions whose ends_at is in the
      // past AND still within the 14d window AND has at least one row
      // with NULL quality_score (the "pending score" criterion).
      // For trainer + scope='self' we additionally filter to sessions
      // they trainer for (D-66). For TD + scope='all' we drop that filter
      // (D-68).
      const conditions = [
        lte(calendarEvents.endsAt, now),
        gt(calendarEvents.endsAt, fourteenDaysAgo),
        isNull(sessionParticipants.qualityScore),
      ];
      if (input.scope === 'self' && ctx.scope!.role === 'trainer') {
        conditions.push(eq(trainingSessions.trainerId, ctx.scope!.userId));
      }

      const rows = await dbHandle
        .select({
          eventId: calendarEvents.id,
          title: calendarEvents.title,
          startsAt: calendarEvents.startsAt,
          endsAt: calendarEvents.endsAt,
          trainerId: trainingSessions.trainerId,
          pendingPlayerCount: sql<number>`COUNT(*)::int`,
        })
        .from(sessionParticipants)
        .innerJoin(
          calendarEvents,
          eq(calendarEvents.id, sessionParticipants.eventId),
        )
        .innerJoin(
          trainingSessions,
          eq(trainingSessions.eventId, calendarEvents.id),
        )
        .where(and(...conditions))
        .groupBy(
          calendarEvents.id,
          calendarEvents.title,
          calendarEvents.startsAt,
          calendarEvents.endsAt,
          trainingSessions.trainerId,
        )
        .orderBy(calendarEvents.endsAt);

      return { sessions: rows };
    }),

  // ============================================================
  // getSession — form preload (D-62) + DOM-MED-CONFLICT-02 pre-flag
  // ============================================================
  getSession: protectedProcedure
    .input(getSessionInput)
    .query(async ({ ctx, input }) => {
      const dbHandle = ctx.db as DbClient;

      // 1. Load event + training session metadata. RLS via
      //    calendar_events_visible_to(...) gates visibility — caller who
      //    cannot see the event gets NOT_FOUND (D-36 carry-forward).
      const event = await dbHandle
        .select({
          id: calendarEvents.id,
          title: calendarEvents.title,
          startsAt: calendarEvents.startsAt,
          endsAt: calendarEvents.endsAt,
          location: calendarEvents.location,
          trainerId: trainingSessions.trainerId,
          trainingTypeCode: trainingSessions.trainingTypeCode,
          organisationCode: trainingSessions.organisationCode,
        })
        .from(calendarEvents)
        .innerJoin(
          trainingSessions,
          eq(trainingSessions.eventId, calendarEvents.id),
        )
        .where(eq(calendarEvents.id, input.eventId))
        .limit(1);

      if (!event[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'errors.calendar.eventNotFound',
        });
      }

      // 2. Series-level participants — players only (D-63 sparring
      //    excluded; sparring partners attend via the separate
      //    session_sparring_partners junction, not the per-occurrence
      //    score grid).
      const participants = await dbHandle
        .select({
          userId: calendarEventParticipants.userId,
          userName: users.name,
        })
        .from(calendarEventParticipants)
        .innerJoin(users, eq(users.id, calendarEventParticipants.userId))
        .where(
          and(
            eq(calendarEventParticipants.eventId, input.eventId),
            eq(users.role, 'player'),
          ),
        );

      // 3. Existing per-occurrence rows. Pre-fills the form with saved
      //    attendance/score/feedback for partial saves (trainer may have
      //    submitted attendance-only earlier and is now adding scores).
      const occurrenceDateStr = toIsoDate(input.occurrenceDate);
      const existingRows = await dbHandle
        .select()
        .from(sessionParticipants)
        .where(
          and(
            eq(sessionParticipants.eventId, input.eventId),
            eq(sessionParticipants.occurrenceDate, occurrenceDateStr),
          ),
        );
      const existingByUser = new Map(
        existingRows.map((r) => [r.userId, r] as const),
      );

      // 4. DOM-MED-CONFLICT-02: pre-flag participants with an overlapping
      //    medical event so the form defaults their attendance toggle to
      //    "afwezig met geldige reden" (absent_medical). Trainer can
      //    override at submit time; the override is captured in the audit
      //    row (the existing row will have attended=true after override).
      const userIds = participants.map((p) => p.userId);
      const medicalConflictByUser = await getMedicalConflictUserIds(
        dbHandle,
        userIds,
        event[0].startsAt,
        event[0].endsAt,
      );

      // 5. Compose form payload.
      return {
        event: event[0],
        participants: participants.map((p) => {
          const existing = existingByUser.get(p.userId);
          return {
            userId: p.userId,
            userName: p.userName,
            attended: existing?.attended ?? null,
            qualityScore: existing?.qualityScore ?? null,
            feedbackText: existing?.feedbackText ?? null,
            hasMedicalConflict: medicalConflictByUser.has(p.userId),
          };
        }),
      };
    }),
});
