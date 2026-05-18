/**
 * Zod input schemas for inbox.* tRPC procedures (Phase 4 Wave 2 — Plan 04-07).
 *
 * The inbox surface is the user-facing read+mark side of the D-67 channel 2 /
 * D-72 channel 2 nudge pipeline. pg_cron jobs from migration 0019 INSERT rows
 * into `system_inbox` (migration 0020) nightly at 18:00 Europe/Brussels; the
 * tRPC procedures defined in `routers/inbox.ts` SELECT those rows for the
 * caller and UPDATE `read_at` on mark-read.
 *
 * Two schemas:
 *
 *   - `listInboxInput`  → both `listUnread` and `listAll` consume this same
 *                         shape. Cursor is the ISO timestamp of the LAST row's
 *                         created_at from the previous page (descending order),
 *                         so the next page is `created_at < cursor`. `limit`
 *                         caps at 50 (defensive) and defaults to 20.
 *
 *   - `markReadInput`   → row id only. Per-row scoping is enforced by RLS on
 *                         `system_inbox.system_inbox_update_own` (migration
 *                         0020) plus an app-layer `user_id = caller` filter
 *                         in the handler for defense-in-depth (T-04-46-
 *                         MARKREAD-CROSS-USER). NOT_FOUND surface on missing
 *                         OR cross-user rows prevents enumeration (D-36
 *                         carry-forward).
 *
 * `.strict()` on both schemas — rejects unknown keys per VALID-06 (carry-forward
 * from Phase 2 / Phase 3) to mitigate input-smuggling-via-extra-fields.
 *
 * No `_meta.idempotencyKey` on either schema:
 *   - `listUnread` / `listAll` are read-only (no side effects).
 *   - `markRead` is naturally idempotent (the handler short-circuits on
 *     already-read rows; replaying the same id is safe by construction —
 *     no VALID-08 wrapper needed). See `routers/inbox.ts` markRead body.
 *
 * Error messages are i18n keys per I18N-08 + D-46 carry-forward (Phase 2).
 *
 * Reference: .planning/phases/04-kerndomein/04-07-PLAN.md §Step 1
 *            src/server/trpc/schemas/ranking.ts (Plan 04-05 — closest analog)
 *            src/server/trpc/schemas/tournament.ts (Plan 04-04 — cursor shape)
 */
import { z } from 'zod';

// ─── listInboxInput (shared by listUnread + listAll) ──────────────────────

/**
 * Common cursor-paginated read shape. The router uses `created_at DESC`
 * ordering and treats `cursor` as "fetch rows OLDER than this timestamp".
 *
 * Limit default = 20 (matches the typical inbox-card-list page size). Hard
 * cap at 50 prevents accidental fetch-all queries when callers omit the
 * cursor.
 */
export const listInboxInput = z
  .object({
    limit: z
      .number()
      .int()
      .min(1, { message: 'errors.field.required' })
      .max(50, { message: 'errors.field.required' })
      .default(20),
    /**
     * Optional ISO-8601 timestamp from the previous page's last row
     * (its `created_at`). Omit for the first page. The router applies
     * `created_at < cursor` so the next page picks up where the previous
     * one left off in DESC order.
     */
    cursor: z.string().optional(),
  })
  .strict();
export type ListInboxInput = z.infer<typeof listInboxInput>;

// ─── markReadInput ────────────────────────────────────────────────────────

/**
 * Mark a single inbox row as read. The id MUST be a uuid (system_inbox.id
 * is uuid PK from migration 0020).
 *
 * RBAC: any authenticated user can mark their OWN rows read. RLS
 * `system_inbox_update_own` policy gates non-owner attempts at the DB layer;
 * the handler additionally filters by `user_id = caller` and surfaces
 * NOT_FOUND on cross-user attempts (preserves the "no enumeration" property
 * across both genuinely-missing and cross-user-targeted ids).
 */
export const markReadInput = z
  .object({
    id: z.string().uuid({ message: 'errors.field.invalidUuid' }),
  })
  .strict();
export type MarkReadInput = z.infer<typeof markReadInput>;
