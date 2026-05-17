/**
 * ranking.* tRPC router — Phase 4 (D-86..D-91 + RANK-01..07 + DOM-RANK-01).
 *
 * 4 procedures:
 *
 *   - addEntry          D-86 split-column XOR + D-89 RBAC (player + TD only,
 *                       trainer rejected) + value_shape cross-check +
 *                       VALID-08 idempotency + GDPR-04 audit
 *                       (`ranking_entry_added`). Composed with
 *                       `idempotencyMiddleware('ranking.addEntry')`.
 *
 *   - getHistory        Time-series read for a (player, type) pair, ASC by
 *                       recorded_at, bounded by optional [from, to]. RLS via
 *                       `ranking_entry_visible_to` (0018) is the scoping
 *                       gate — no app-layer scope filter.
 *
 *   - getCurrentByType  RANK-05 latest-only: ORDER BY recorded_at DESC
 *                       LIMIT 1. The "current ranking" is always derived
 *                       from the tail of the series, never stored flat on
 *                       `players`.
 *
 *   - listEntries       Audit/correction view: all entries for a player
 *                       (optionally filtered by type), DESC by recorded_at.
 *                       Powers the Rankings tab secondary "Ingevoerde
 *                       rankings" tab.
 *
 * Three-layer defense-in-depth for the XOR invariant (D-86, RESEARCH §Pattern 4):
 *   1. Zod discriminated union at input layer (`schemas/ranking.ts`).
 *   2. App-layer cross-check of `value.kind` against
 *      `ranking_type.value_shape` — semantic match.
 *   3. DB-level CHECK `ranking_entries_value_xor` — storage backstop
 *      (Plan 04-02 migration 0016).
 *
 * Audit codes emitted (1 of 14 — matches tests/integration/phase4-audit.test.ts):
 *   - ranking_entry_added — addEntry success
 *   (ranking_entry_updated is reserved for the v2 explicit-update endpoint;
 *    v1 corrections are delete-and-re-add via TD, captured under
 *    ranking_entry_added with role attribution in newValues.)
 *   - idempotency_replay is emitted by the composed idempotency middleware
 *     on cache hits (Plan 04-03 contract).
 *
 * Threat mitigations (per 04-05 PLAN <threat_model>):
 *   - T-04-31-RANKING-XOR-BYPASS:
 *       (1) Zod discriminated union at API, (2) value_shape cross-check
 *       at router, (3) DB-level CHECK XOR. Three-layer defense.
 *   - T-04-32-CROSS-PLAYER-RANKING-FORGERY:
 *       API rejects role=player AND playerUserId !== caller.userId with
 *       FORBIDDEN `errors.ranking.notOwnPlayer`. RLS WITH CHECK in 0018
 *       mirrors at DB layer.
 *   - T-04-33-TRAINER-RANKING-ENTRY-NOT-ALLOWED:
 *       Per D-89 — RANK-06 kept literal. Trainer role explicitly rejected
 *       with FORBIDDEN. RLS policy `re_write_player_or_td` in 0018 mirrors.
 *   - T-04-34-RANKING-REPLAY-ATTACK:
 *       `idempotencyMiddleware('ranking.addEntry')` composed; 24h dedup
 *       (`tests/integration/idempotency-ranking.test.ts` covers VALID-08).
 *   - T-04-35-SOURCE-TAMPERING-FEDERATION:
 *       Per DOM-RANK-01 — v1 is manual only. Zod accepts both 'manual' and
 *       'federation_official' but no API path explicitly sets
 *       'federation_official'; the input default + UI default is 'manual'.
 *       Acceptable for v1; v2 federation sync hardens.
 *   - T-04-36-AUDIT-OMISSION-ON-UPDATE:
 *       All mutations emit audit_log row. Plan 04-04 audit-before-overwrite
 *       pattern applies if/when an explicit update procedure ships
 *       (deferred for v1; correction = delete + re-add by TD).
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-86..D-91
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 4
 *            src/server/trpc/routers/tournament.ts (Plan 04-04 — idempotency
 *                                                   + audit + role-gate pattern)
 *            src/server/trpc/routers/training.ts (Plan 04-03 — idempotency
 *                                                  middleware composition)
 */
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import { db as rawDb, type DbClient } from '@/server/db/client';
import { rankingEntries } from '@/server/db/schema/ranking';
import { rankingType } from '@/server/db/schema/lookups';

import { writeAudit } from '../middleware/audit';
import { protectedProcedure } from '../middleware/freshSession';
import { idempotencyMiddleware } from '../middleware/idempotency';
import {
  addEntryInput,
  getCurrentByTypeInput,
  getHistoryInput,
  listEntriesInput,
} from '../schemas/ranking';
import { router } from '../trpc';

// ─── Router definition ─────────────────────────────────────────────────

export const rankingRouter = router({
  // ============================================================
  // addEntry — D-86 XOR + D-89 RBAC + VALID-08 idempotency + audit
  // ============================================================
  //
  // Five invariants:
  //
  //   1. RBAC (D-89 + RANK-06 kept literal): role MUST be one of
  //      ('player', 'technical_director'). Trainer, parent, sparring_partner,
  //      medical_staff, academy_manager → FORBIDDEN `role_not_allowed`.
  //
  //   2. CROSS-PLAYER FORGERY GATE: when role=player, input.playerUserId
  //      MUST equal ctx.scope.userId. Otherwise FORBIDDEN
  //      `errors.ranking.notOwnPlayer`. TD bypasses (D-89 — TD may enter
  //      for any player). RLS WITH CHECK in 0018 mirrors at DB layer.
  //
  //   3. RANKING TYPE VALIDATION: rankingTypeCode MUST exist AND be active.
  //      BAD_REQUEST `errors.ranking.unknownType` or
  //      `errors.ranking.inactiveType` otherwise.
  //
  //   4. VALUE-SHAPE CROSS-CHECK (D-86 layer 2): ranking_type.value_shape
  //      MUST match input.value.kind. Numeric type + classification input
  //      → BAD_REQUEST `errors.ranking.expectedNumeric`. Classification
  //      type + numeric input → BAD_REQUEST `errors.ranking.expectedClassification`.
  //      The DB-level CHECK XOR (`ranking_entries_value_xor`) is the
  //      storage backstop (layer 3).
  //
  //   5. VALID-08 IDEMPOTENCY: composed with
  //      `idempotencyMiddleware('ranking.addEntry')`. Client passes
  //      `_meta.idempotencyKey`; retry within 24h replays cached body
  //      and emits `idempotency_replay` audit code.
  //
  // GDPR-04 audit: emits `ranking_entry_added` on success with newValues
  // capturing { playerUserId, rankingTypeCode, source, valueKind, value }.
  addEntry: protectedProcedure
    .use(idempotencyMiddleware('ranking.addEntry'))
    .input(addEntryInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;
      const callerId = ctx.scope.userId;
      const callerRole = ctx.scope.role;

      // 1. RBAC — D-89 + RANK-06.
      if (
        callerRole !== 'player' &&
        callerRole !== 'technical_director'
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'role_not_allowed',
        });
      }
      if (
        callerRole === 'player' &&
        input.playerUserId !== callerId
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'errors.ranking.notOwnPlayer',
        });
      }

      // 2. Load ranking_type to read value_shape + active flag.
      const rt = await db
        .select({
          valueShape: rankingType.valueShape,
          active: rankingType.active,
        })
        .from(rankingType)
        .where(eq(rankingType.code, input.rankingTypeCode))
        .limit(1);
      const rtRow = rt[0];
      if (!rtRow) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.ranking.unknownType',
        });
      }
      if (!rtRow.active) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.ranking.inactiveType',
        });
      }

      // 3. value_shape cross-check (D-86 layer 2).
      if (
        rtRow.valueShape === 'numeric' &&
        input.value.kind !== 'numeric'
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.ranking.expectedNumeric',
        });
      }
      if (
        rtRow.valueShape === 'classification' &&
        input.value.kind !== 'classification'
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.ranking.expectedClassification',
        });
      }

      // 4. Insert. DB-level CHECK XOR provides defense-in-depth on the
      //    storage gate (T-04-31 layer 3). Drizzle's `numeric` column maps
      //    to string in TS to preserve full numeric precision; we coerce
      //    the input number to string at the boundary so the column type
      //    matches.
      const now = new Date();
      const insertRow = {
        playerUserId: input.playerUserId,
        rankingTypeCode: input.rankingTypeCode,
        recordedAt: input.recordedAt,
        source: input.source,
        valueNumeric:
          input.value.kind === 'numeric'
            ? input.value.value.toString()
            : null,
        valueClassificationCode:
          input.value.kind === 'classification' ? input.value.code : null,
        enteredBy: callerId,
        enteredAt: now,
      };

      const inserted = await db
        .insert(rankingEntries)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values(insertRow as any)
        .returning({ id: rankingEntries.id });
      const first = inserted[0];
      if (!first) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'ranking_insert_returned_no_row',
        });
      }

      // 5. Audit success — written AFTER the INSERT commits so the audit
      //    row reflects the truth of the write (Phase 1 audit.ts contract).
      await writeAudit(ctx, {
        action: 'ranking_entry_added',
        resourceType: 'ranking_entry',
        resourceId: first.id,
        newValues: {
          playerUserId: input.playerUserId,
          rankingTypeCode: input.rankingTypeCode,
          recordedAt: input.recordedAt.toISOString(),
          source: input.source,
          valueKind: input.value.kind,
          value:
            input.value.kind === 'numeric'
              ? input.value.value
              : input.value.code,
        },
        outcome: 'success',
      });

      return {
        ok: true as const,
        id: first.id,
        valueShape: rtRow.valueShape,
      };
    }),

  // ============================================================
  // getHistory — per-type time series read
  // ============================================================
  //
  // Returns rows ascending by recorded_at so the chart component can draw
  // the series left-to-right without re-sorting. The Rankings tab default
  // range is 24 months (D-90) but the range is applied by the client —
  // the procedure accepts any [from, to] so the same data path serves the
  // chart, the range pills (1m / 6m / 1y / 2y / all), and the Phase 7
  // dashboard widget (VIEW-03).
  //
  // RLS via `ranking_entry_visible_to(uid, role)` (0018) is the sole
  // scoping gate. The router does NOT add any app-layer filter; an
  // out-of-scope caller returns an empty array.
  getHistory: protectedProcedure
    .input(getHistoryInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;

      const conditions = [
        eq(rankingEntries.playerUserId, input.playerUserId),
        eq(rankingEntries.rankingTypeCode, input.rankingTypeCode),
      ];
      if (input.from) {
        conditions.push(gte(rankingEntries.recordedAt, input.from));
      }
      if (input.to) {
        conditions.push(lte(rankingEntries.recordedAt, input.to));
      }

      const entries = await db
        .select({
          id: rankingEntries.id,
          recordedAt: rankingEntries.recordedAt,
          source: rankingEntries.source,
          valueNumeric: rankingEntries.valueNumeric,
          valueClassificationCode: rankingEntries.valueClassificationCode,
          enteredBy: rankingEntries.enteredBy,
          enteredAt: rankingEntries.enteredAt,
        })
        .from(rankingEntries)
        .where(and(...conditions))
        .orderBy(asc(rankingEntries.recordedAt));

      return { entries };
    }),

  // ============================================================
  // getCurrentByType — RANK-05 latest-only derivation
  // ============================================================
  //
  // RANK-05: the current ranking is never stored as a flat field on
  // `players`; it is always derived from the tail of the time series
  // (ORDER BY recorded_at DESC LIMIT 1). This procedure surfaces that
  // derivation for the player-view header widget, the rankings tab
  // "current" pill, and Phase 7 cross-domain dashboard cards.
  //
  // RLS-scoped via `ranking_entry_visible_to`. Out-of-scope subjects
  // return `null`.
  getCurrentByType: protectedProcedure
    .input(getCurrentByTypeInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;

      const rows = await db
        .select({
          id: rankingEntries.id,
          recordedAt: rankingEntries.recordedAt,
          source: rankingEntries.source,
          valueNumeric: rankingEntries.valueNumeric,
          valueClassificationCode: rankingEntries.valueClassificationCode,
          enteredBy: rankingEntries.enteredBy,
          enteredAt: rankingEntries.enteredAt,
        })
        .from(rankingEntries)
        .where(
          and(
            eq(rankingEntries.playerUserId, input.playerUserId),
            eq(rankingEntries.rankingTypeCode, input.rankingTypeCode),
          ),
        )
        .orderBy(desc(rankingEntries.recordedAt))
        .limit(1);

      return { current: rows[0] ?? null };
    }),

  // ============================================================
  // listEntries — audit/correction view (all entries for a player)
  // ============================================================
  //
  // Returns every ranking entry visible to the caller for a player
  // (optionally filtered by ranking type) sorted DESC by recorded_at —
  // the canonical shape for the Rankings tab secondary "Ingevoerde
  // rankings" sub-tab. Includes entered_by + entered_at for forensic
  // traceability per GDPR-04 (the audit_log is the authoritative trail;
  // listEntries surfaces a read-only view for the player + TD UI).
  listEntries: protectedProcedure
    .input(listEntriesInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;

      const conditions = [
        eq(rankingEntries.playerUserId, input.playerUserId),
      ];
      if (input.rankingTypeCode) {
        conditions.push(
          eq(rankingEntries.rankingTypeCode, input.rankingTypeCode),
        );
      }

      const entries = await db
        .select({
          id: rankingEntries.id,
          rankingTypeCode: rankingEntries.rankingTypeCode,
          recordedAt: rankingEntries.recordedAt,
          source: rankingEntries.source,
          valueNumeric: rankingEntries.valueNumeric,
          valueClassificationCode: rankingEntries.valueClassificationCode,
          enteredBy: rankingEntries.enteredBy,
          enteredAt: rankingEntries.enteredAt,
        })
        .from(rankingEntries)
        .where(and(...conditions))
        .orderBy(desc(rankingEntries.recordedAt));

      return { entries };
    }),
});
