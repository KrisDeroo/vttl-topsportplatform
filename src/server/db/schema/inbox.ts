/**
 * system_inbox — Phase 4 minimal stub for D-67 ch2 / D-72 ch2 nudge messages.
 *
 * pg_cron jobs (migration 0019) INSERT rows nightly at 18:00 Europe/Brussels.
 * tRPC inbox.listUnread/listAll/markRead procedures (Plan 04-07) serve them.
 * Phase 6 absorbs this table with the full Inbox UI (threads, compose,
 * attachments). Phase 4's schema is intentionally minimal — Phase 6 may
 * migrate forward with additional columns (thread_id, sender_id, ...) but
 * the (user_id, kind, payload) triple is preserved.
 *
 * RLS (0020): SELECT-own + UPDATE-own; no INSERT/DELETE policies — only
 * SECURITY DEFINER cron functions write; admin GDPR-06 erasure deletes.
 *
 * `kind` is CHECK-enum-constrained in DB to known values:
 *   * 'trainer_score_nudge'  — D-67 channel 2 (run_daily_trainer_score_nudge).
 *   * 'player_result_nudge'  — D-72 channel 2 (run_daily_player_tournament_result_nudge).
 * Future Phase 6 message types extend the CHECK + this comment.
 *
 * Indexes (declared in `0020_phase4_system_inbox.sql`, not here — matches
 * the established Phase 1 pattern where `idempotency_keys` barrel omits
 * indexes that live in the hand-authored migration):
 *   * idx_system_inbox_user_unread (partial, user_id+created_at DESC WHERE read_at IS NULL)
 *   * idx_system_inbox_user_all    (full, user_id+created_at DESC)
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §D-67 §D-72
 *            drizzle/0020_phase4_system_inbox.sql
 */
import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';

export const systemInbox = pgTable('system_inbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull().default({}),
  readAt: tstz('read_at'),
  createdAt: tstz('created_at', { defaultNow: true }).notNull(),
});

export type SystemInbox = typeof systemInbox.$inferSelect;
export type NewSystemInbox = typeof systemInbox.$inferInsert;
