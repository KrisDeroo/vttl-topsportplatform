/**
 * tRPC `consent.*` sub-router (Plan 12) — give / withdraw / status /
 * listForUser / listMyParentLinks / _enqueueVersionBump.
 *
 * Surface contract:
 *
 *   - `give`             — protectedProcedure. INSERTs a consent_records
 *                          row via `recordConsent` (lib/consent.ts) and
 *                          writes an audit_log entry. Optional
 *                          `forUserId` parameter lets a parent record
 *                          consent on behalf of a minor (Belgian Art. 8);
 *                          RLS policy `consent.insert_own_or_minor`
 *                          (Plan 04) enforces the parent-child link.
 *   - `withdraw`         — protectedProcedure. UPDATEs `withdrawn_at` on
 *                          a row the caller owns (RLS-enforced) and
 *                          writes audit. Withdrawal is one-way; replays
 *                          short-circuit via the `IS NULL` predicate.
 *   - `status`           — protectedProcedure. Returns `{ hasConsent,
 *                          row }` for the caller's own active consent at
 *                          `(category, CURRENT_POLICY[category].version)`.
 *                          Used by the UI to know whether to gate
 *                          medical / photo features behind a consent
 *                          prompt.
 *   - `listForUser`      — protectedProcedure. Returns the consent
 *                          history (newest first) for a user_id.
 *                          Visibility is RLS-enforced: caller must be
 *                          the user, the consenting party, or the TD.
 *   - `listMyParentLinks` — protectedProcedure. CRIT-3 own-link
 *                          visibility for parent/player roles. Returns
 *                          `parent_child_links` rows where the caller is
 *                          the parent OR child. RLS hides everything
 *                          else; the explicit OR predicate is
 *                          belt-and-braces (a misconfiguration surfaces
 *                          as zero rows, not all rows).
 *   - `_enqueueVersionBump` — protectedProcedure. Helper for a future
 *                          TD-only admin action (Plan 15) that enqueues
 *                          a notify-job per impacted user when a major
 *                          policy version is bumped (D-07). Phase 1 ships
 *                          the surface but does not expose a UI; the
 *                          BullMQ queue is wired in Plan 10.
 *
 * `protectedProcedure` (Plan 11 freshSession.ts) wraps every procedure
 * with: requireAuth + withRlsContext + requireCurrentConsent. The
 * `give` mutation is the natural exception (a user without a current
 * consent must be ABLE to give one to lift the gate) — see the
 * `requireConsent.ts` block-comment for why the existing middleware
 * tolerates this: it short-circuits when the row exists, and the
 * absence of a row throws `re_consent_required` which the UI catches
 * to render the banner that calls `consent.give`.
 *
 * Reference: .planning/phases/01-fundament/01-12-consent-flow-and-minor-gate-PLAN.md Task 2
 *            src/lib/consent.ts (recordConsent, CURRENT_POLICY)
 *            src/server/trpc/middleware/requireConsent.ts (D-07 gate)
 */
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  CURRENT_POLICY,
  recordConsent,
  type ConsentCategory,
} from '@/lib/consent';
import { db as rawDb, type DbClient } from '@/server/db/client';
import { consentRecords } from '@/server/db/schema/consent';
import { parentChildLinks } from '@/server/db/schema/memberships';
import { consentNotifyQueue } from '@/server/workers/queues';

import { writeAudit } from '../middleware/audit';
import { protectedProcedure } from '../middleware/freshSession';
import { router } from '../trpc';

/** Discriminator union for the three consent categories — kept in lock-step
 *  with `CURRENT_POLICY` keys (lib/consent.ts). */
const CategorySchema = z.enum([
  'operational',
  'medical_processing',
  'photo_video',
]);

/** Locale enum mirrors `routing.locales` (i18n/routing.ts). The tRPC layer
 *  re-validates here so a malformed input fails before touching the DB. */
const LocaleSchema = z.enum(['nl', 'en', 'fr']);

export const consentRouter = router({
  /**
   * Records a new consent. Adult flow:
   *   `forUserId` omitted, `consentingPartyUserId = ctx.scope.userId`.
   * Minor flow (parent acts on behalf):
   *   `forUserId = minor.id`, `consentingPartyUserId = ctx.scope.userId`.
   *
   * `textShown.min(50)` is a sanity floor — the shortest committed
   * consent text (any locale, any category) is well over 50 chars; a
   * shorter input would mean the client sent an empty or wrong text and
   * the SHA-256 we'd compute would be meaningless.
   */
  give: protectedProcedure
    .input(
      z.object({
        category: CategorySchema,
        version: z.string().min(1),
        locale: LocaleSchema,
        textShown: z.string().min(50),
        forUserId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // ctx.scope is non-null inside protectedProcedure — requireAuth has
      // already short-circuited the anonymous case. The `!` is documenting
      // intent rather than asserting blindly.
      const callerId = ctx.scope!.userId;
      const targetUserId = input.forUserId ?? callerId;
      // `exactOptionalPropertyTypes: true` (tsconfig.json) forbids
      // passing `db: undefined` explicitly — spread only when the
      // RLS-bound handle is actually present so the optional property
      // is omitted in the anonymous-fallback case.
      const ctxDb = ctx.db as DbClient | undefined;
      const row = await recordConsent({
        userId: targetUserId,
        category: input.category as ConsentCategory,
        version: input.version,
        locale: input.locale,
        textShown: input.textShown,
        consentingPartyUserId: callerId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        ...(ctxDb ? { db: ctxDb } : {}),
      });
      await writeAudit(ctx, {
        action: 'consent.give',
        resourceType: 'consent_record',
        resourceId: row.id,
        newValues: {
          category: input.category,
          version: input.version,
          locale: input.locale,
          forUserId: input.forUserId ?? null,
        },
      });
      return row;
    }),

  /**
   * One-way withdrawal. Sets `withdrawn_at = now()` for a row the
   * caller may write (Plan 04 RLS policy `consent.withdraw_self`).
   * Replays (`AND withdrawn_at IS NULL`) short-circuit so a double-click
   * doesn't bump the timestamp twice.
   *
   * Throws NOT_FOUND when no row matches — could be either "wrong id"
   * or "already withdrawn"; we collapse both to the same error to avoid
   * leaking row-existence information.
   */
  withdraw: protectedProcedure
    .input(z.object({ consentRecordId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      const [row] = await dbHandle
        .update(consentRecords)
        .set({ withdrawnAt: new Date(Date.now()) })
        .where(
          and(
            eq(consentRecords.id, input.consentRecordId),
            isNull(consentRecords.withdrawnAt),
          ),
        )
        .returning();
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await writeAudit(ctx, {
        action: 'consent.withdraw',
        resourceType: 'consent_record',
        resourceId: row.id,
      });
      return row;
    }),

  /**
   * Read the caller's current consent state for a category.
   * Returns `{ hasConsent: false, row: undefined }` when no active row
   * exists at the current policy version.
   */
  status: protectedProcedure
    .input(z.object({ category: CategorySchema }))
    .query(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      const cat = input.category as ConsentCategory;
      const row = await dbHandle.query.consentRecords.findFirst({
        where: and(
          eq(consentRecords.userId, ctx.scope!.userId),
          eq(consentRecords.consentCategory, cat),
          eq(consentRecords.policyVersion, CURRENT_POLICY[cat].version),
          isNull(consentRecords.withdrawnAt),
        ),
      });
      return { hasConsent: Boolean(row), row };
    }),

  /**
   * Consent history for a user, newest first. RLS (Plan 04) restricts
   * visibility to the user themselves, the consenting party, and the TD.
   * The handler does not add an explicit predicate — RLS is the gate;
   * adding an app-layer filter risks the two diverging.
   */
  listForUser: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      return dbHandle.query.consentRecords.findMany({
        where: eq(consentRecords.userId, input.userId),
        orderBy: (cr, { desc }) => desc(cr.givenAt),
      });
    }),

  /**
   * CRIT-3 — own parent_child_link visibility for parent/player roles.
   *
   * RLS policy `pcl_visible` (Plan 04) already permits this view: a row
   * is visible iff the caller is parent OR child. We expose a tRPC
   * endpoint on `protectedProcedure` (NOT `tdProcedure`) so the
   * affected roles can list THEIR OWN links without going through a
   * TD-only admin path. Trainer / academy_manager / sparring_partner
   * have no endpoint and (per RBAC matrix) no business reading these
   * links.
   *
   * The explicit `OR` predicate is belt-and-braces: an RLS
   * misconfiguration would surface as no-rows here, not as the
   * application-table contents leaking.
   */
  listMyParentLinks: protectedProcedure.query(async ({ ctx }) => {
    const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
    return dbHandle.query.parentChildLinks.findMany({
      where: or(
        eq(parentChildLinks.parentUserId, ctx.scope!.userId),
        eq(parentChildLinks.childUserId, ctx.scope!.userId),
      ),
    });
  }),

  /**
   * Internal — enqueue a notify-job after a major version bump (D-07).
   *
   * Phase 1 ships the surface; the call site (Plan 15 admin "bump
   * consent version" UI) is out of scope. The handler simply pushes onto
   * the BullMQ queue declared in `src/server/workers/queues.ts`; the
   * worker handler (`workers/jobs/consent-version-bump.ts`) does the
   * idempotency check + email send.
   */
  _enqueueVersionBump: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        category: CategorySchema,
        oldVersion: z.string().min(1),
        newVersion: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      await consentNotifyQueue.add('consent-version-bump', input);
      return { queued: true };
    }),
});
