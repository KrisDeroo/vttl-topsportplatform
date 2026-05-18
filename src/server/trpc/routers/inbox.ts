/**
 * inbox.* tRPC router — Phase 4 minimal stub for D-67 channel 2 + D-72 channel 2.
 *
 * Backed by `system_inbox` (migration 0020) which is populated nightly at
 * 18:00 Europe/Brussels by pg_cron jobs from migration 0019. The two job
 * functions are SECURITY DEFINER and write rows for two `kind` codes:
 *   - 'trainer_score_nudge'  (D-67 channel 2 — run_daily_trainer_score_nudge)
 *   - 'player_result_nudge'  (D-72 channel 2 — run_daily_player_tournament_result_nudge)
 *
 * Phase 6 absorbs this surface with the full Inbox UI (threads, compose,
 * attachments). Phase 4 ships only the read + mark-read endpoints needed to
 * surface nudge messages in the UI (Plan 04-08 banner stack + minimal inbox
 * list component).
 *
 * Three procedures:
 *
 *   - listUnread (read)  → rows for caller WHERE read_at IS NULL, DESC by
 *                          created_at, cursor-paginated. Powers the banner
 *                          count + the "nieuw" inbox section.
 *
 *   - listAll    (read)  → rows for caller (read + unread), DESC by created_at,
 *                          cursor-paginated. Powers the history view inside
 *                          the minimal inbox component.
 *
 *   - markRead   (write) → idempotent UPDATE that sets read_at on the
 *                          caller's own row. Replaying with an already-read
 *                          id is a no-op returning {ok:true, alreadyRead:true}.
 *
 * No app-layer scope filter on the reads — RLS `system_inbox_select_own`
 * (migration 0020) is the canonical visibility gate. We DO pass the
 * `eq(userId, caller)` clause to the SELECT for defense-in-depth (T-04-44-
 * CROSS-USER-INBOX-LEAK), but the RLS policy is the authoritative gate; an
 * out-of-scope subject returns an empty array.
 *
 * Audit codes emitted (1):
 *   - inbox_marked_read — emitted on the *first* successful mark-read for a
 *                         given id (not on replay). Cross-user attempts
 *                         return NOT_FOUND and emit no audit row (per the
 *                         "no enumeration via audit_log" property — Plan
 *                         04-04 listResults precedent).
 *
 * Threat mitigations (per 04-07 PLAN <threat_model>):
 *   - T-04-44-CROSS-USER-INBOX-LEAK:
 *       RLS policy `system_inbox_select_own` restricts caller to user_id =
 *       current_user_id(); router additionally appends `eq(userId, caller)`
 *       to the WHERE clause for defense-in-depth.
 *   - T-04-45-INBOX-FORGED-INSERT:
 *       Migration 0020 has NO INSERT policy for app_user; only the
 *       SECURITY DEFINER cron functions from 0019 can deposit rows. This
 *       router has NO mutation that INSERTs into system_inbox.
 *   - T-04-46-MARKREAD-CROSS-USER:
 *       App-layer filter `(eq(id, input.id), eq(userId, caller))` in the
 *       SELECT-before-UPDATE; RLS `system_inbox_update_own` policy
 *       mirrors at DB layer. Cross-user attempts surface NOT_FOUND, not
 *       FORBIDDEN, so an attacker cannot probe whether an id exists.
 *
 * No idempotency middleware composed:
 *   - listUnread / listAll are read-only.
 *   - markRead is naturally idempotent — the handler reads the row,
 *     short-circuits if read_at is already set, and emits no audit on
 *     replay. VALID-08 middleware would be redundant cycles for the
 *     same guarantee.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §D-67 §D-72
 *            .planning/phases/04-kerndomein/04-07-PLAN.md §Step 2
 *            src/server/trpc/routers/ranking.ts (Plan 04-05 — read-side pattern)
 *            src/server/trpc/routers/training.ts (Plan 04-03 — listPending shape)
 *            drizzle/0020_phase4_system_inbox.sql (RLS + indexes)
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';

import { db as rawDb, type DbClient } from '@/server/db/client';
import { systemInbox } from '@/server/db/schema/inbox';

import { writeAudit } from '../middleware/audit';
import { protectedProcedure } from '../middleware/freshSession';
import { listInboxInput, markReadInput } from '../schemas/inbox';
import { router } from '../trpc';

export const inboxRouter = router({
  // ============================================================
  // listUnread — banner-count source + "nieuw" section feed
  // ============================================================
  //
  // Filters: user_id = caller (RLS + app-layer DiD), read_at IS NULL.
  // Order: created_at DESC (most recent first).
  // Pagination: cursor = ISO timestamp of last row's created_at; next
  // page picks up rows with created_at < cursor.
  //
  // RLS is the canonical visibility gate (system_inbox_select_own —
  // 0020); the app-layer `eq(userId, callerId)` is defense-in-depth per
  // T-04-44-CROSS-USER-INBOX-LEAK. Out-of-scope subjects return an
  // empty array.
  listUnread: protectedProcedure
    .input(listInboxInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;
      const callerId = ctx.scope.userId;

      const conditions = [
        eq(systemInbox.userId, callerId),
        isNull(systemInbox.readAt),
      ];
      if (input.cursor) {
        conditions.push(lt(systemInbox.createdAt, new Date(input.cursor)));
      }

      // Fetch limit+1 so we can detect whether more rows exist without a
      // second COUNT query (same pattern as tournament.list, ranking.*
      // — Plan 04-04 / 04-05 precedent).
      const rows = await db
        .select({
          id: systemInbox.id,
          userId: systemInbox.userId,
          kind: systemInbox.kind,
          payload: systemInbox.payload,
          readAt: systemInbox.readAt,
          createdAt: systemInbox.createdAt,
        })
        .from(systemInbox)
        .where(and(...conditions))
        .orderBy(desc(systemInbox.createdAt))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor =
        hasMore && page.length > 0
          ? page[page.length - 1]!.createdAt.toISOString()
          : null;

      return { entries: page, nextCursor };
    }),

  // ============================================================
  // listAll — full inbox history (read + unread) for caller
  // ============================================================
  //
  // Same shape as listUnread minus the `isNull(readAt)` filter. RLS still
  // scopes to caller-own rows. Powers the minimal inbox component's
  // history view (Plan 04-08).
  listAll: protectedProcedure
    .input(listInboxInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;
      const callerId = ctx.scope.userId;

      const conditions = [eq(systemInbox.userId, callerId)];
      if (input.cursor) {
        conditions.push(lt(systemInbox.createdAt, new Date(input.cursor)));
      }

      const rows = await db
        .select({
          id: systemInbox.id,
          userId: systemInbox.userId,
          kind: systemInbox.kind,
          payload: systemInbox.payload,
          readAt: systemInbox.readAt,
          createdAt: systemInbox.createdAt,
        })
        .from(systemInbox)
        .where(and(...conditions))
        .orderBy(desc(systemInbox.createdAt))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor =
        hasMore && page.length > 0
          ? page[page.length - 1]!.createdAt.toISOString()
          : null;

      return { entries: page, nextCursor };
    }),

  // ============================================================
  // markRead — idempotent UPDATE of read_at on caller's own row
  // ============================================================
  //
  // Three steps:
  //   1. SELECT the row filtered by (id, user_id = caller). The app-layer
  //      user_id filter mirrors RLS (system_inbox_update_own); RLS is the
  //      authoritative gate but the explicit filter makes the cross-user
  //      case surface NOT_FOUND deterministically (T-04-46-MARKREAD-CROSS-
  //      USER mitigation — no FORBIDDEN, no enumeration probe).
  //   2. If the row's read_at is already set, return {ok, alreadyRead:true}
  //      with NO state change and NO audit row (idempotent replay).
  //   3. Otherwise UPDATE read_at = now() and emit `inbox_marked_read`
  //      audit row (GDPR-04 — every state-changing write traces back to
  //      an actor + timestamp + resource_id).
  //
  // No idempotency middleware composed — the SELECT-before-UPDATE achieves
  // the same exactly-once semantics without the 24h dedup cache overhead.
  // Concurrent markRead races for the same id resolve to: first UPDATE
  // wins + emits audit, second UPDATE no-ops because the SELECT sees the
  // row already read (assuming the second SELECT happens AFTER the first
  // UPDATE commits; the race is benign even if both UPDATEs fire because
  // read_at is overwritten to a marginally-later timestamp without
  // changing user-observable state).
  markRead: protectedProcedure
    .input(markReadInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const db = (ctx.db as DbClient | undefined) ?? rawDb;
      const callerId = ctx.scope.userId;

      // 1. SELECT existing row scoped to caller. NOT_FOUND on either
      //    truly-missing OR cross-user rows (RLS + app-layer filter
      //    surface the same shape).
      const existing = await db
        .select({
          id: systemInbox.id,
          kind: systemInbox.kind,
          readAt: systemInbox.readAt,
        })
        .from(systemInbox)
        .where(
          and(eq(systemInbox.id, input.id), eq(systemInbox.userId, callerId)),
        )
        .limit(1);
      const row = existing[0];
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      // 2. Idempotent short-circuit — already read.
      if (row.readAt !== null) {
        return {
          ok: true as const,
          alreadyRead: true as const,
          id: row.id,
        };
      }

      // 3. First-time mark-read — UPDATE + audit.
      const now = new Date();
      await db
        .update(systemInbox)
        .set({ readAt: now })
        .where(
          and(eq(systemInbox.id, input.id), eq(systemInbox.userId, callerId)),
        );

      // Audit AFTER the UPDATE commits (Phase 1 audit.ts contract — audit
      // row reflects the truth of the write, not the intent). The
      // `kind` field is recorded in newValues so the forensic trail can
      // distinguish trainer-nudge vs player-nudge dismissals.
      await writeAudit(ctx, {
        action: 'inbox_marked_read',
        resourceType: 'system_inbox',
        resourceId: row.id,
        newValues: {
          kind: row.kind,
          readAt: now.toISOString(),
        },
        outcome: 'success',
      });

      return {
        ok: true as const,
        alreadyRead: false as const,
        id: row.id,
      };
    }),
});
