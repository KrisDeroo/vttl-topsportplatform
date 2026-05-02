/**
 * `withRlsContext` — bridge between the application and Plan 04 RLS policies.
 *
 * The Plan 04 `current_user_id()` / `current_user_role()` Postgres helpers
 * read three GUCs (session-scoped settings):
 *
 *   - `app.user_id`     — uuid of the caller (NULL outside a request)
 *   - `app.user_role`   — VTTL role string ('player', 'parent', etc.)
 *   - `app.request_id`  — correlation id surfaced into audit_log
 *
 * Without those GUCs every RLS policy that checks `id = current_user_id()`
 * evaluates to NULL = NULL → false, denying everything. So this middleware
 * MUST run before any protected procedure executes a query.
 *
 * A FOURTH GUC, `app.medical_key`, is also bound here — see the block-comment
 * on the `set_config` block below for the rationale (deviation note: Rule 2,
 * "auto-add missing critical functionality"; the encryption helper's
 * preconditions are met by this middleware).
 *
 * Implementation:
 *   - Wraps the procedure body in a Drizzle transaction. `set_config(..., true)`
 *     scopes the GUC to that transaction (cleared on COMMIT/ROLLBACK), so
 *     concurrent requests on the same pool connection cannot leak GUCs to one
 *     another.
 *   - Replaces `ctx.db` with the transaction handle so handler code that
 *     reads `ctx.db ?? rawDb` (the audit middleware) gets the RLS-aware
 *     binding instead of the raw pool.
 *   - Anonymous requests (`scope === null`) skip the transaction entirely —
 *     `requireAuth` would have already rejected them, but the guard is here
 *     in case the middleware is composed before `requireAuth` (e.g. on a
 *     public procedure for which RLS still needs sane defaults).
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §withRlsContext (lines 1105–1124)
 *            src/server/db/rls/functions.sql — current_user_id() / current_user_role()
 *            src/server/db/helpers/encryption.ts — pgp_sym_(en|de)crypt with `app.medical_key`
 */
import { sql } from 'drizzle-orm';

import { env } from '@/lib/env';
import { db } from '@/server/db/client';

import { middleware } from '../trpc';

export const withRlsContext = middleware(async ({ ctx, next }) => {
  if (!ctx.scope) return next();

  return db.transaction(async (tx) => {
    // The third arg `true` to set_config = "is_local" — the value is bound to
    // the current transaction and reset on COMMIT/ROLLBACK. CRITICAL for
    // pooled-connection safety (CRIT-8): without `true`, the GUC would survive
    // on the connection and leak into the next request that picks it up.
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${ctx.scope!.userId}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.user_role', ${ctx.scope!.role}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.request_id', ${ctx.requestId}, true)`,
    );
    // app.medical_key — required by `helpers/encryption.ts` `encrypt()` /
    // `decrypt()` for pgcrypto symmetric en/decryption of medical_events
    // free-text columns. The helper's docstring originally placed this at
    // pool-init time (Plan 06); we set it per-transaction here for the same
    // reason as the user/role GUCs:
    //   1. `is_local=true` clears the value on COMMIT/ROLLBACK, so a connection
    //      returned to the pool no longer carries the key — defense in depth
    //      against accidental cross-request leakage.
    //   2. Pool-init binding requires a custom `onconnect` hook on the
    //      `postgres-js` client; that's a separate Plan 02 change. Co-locating
    //      all four GUCs in this middleware keeps the wiring auditable in one
    //      place — every authenticated tRPC procedure has access to medical
    //      decryption, anonymous/public procedures do not (correct least-privilege
    //      default).
    //   3. T-01-03 (information disclosure on medical free-text) mitigation
    //      depends on the encryption layer working — without this GUC bound,
    //      every medical write/read would fail with "unrecognized configuration
    //      parameter app.medical_key" at runtime. We close that gap here so
    //      Plan 03's pgcrypto helpers function once Phase 5 wires the medical
    //      router into the procedure tree.
    await tx.execute(
      sql`SELECT set_config('app.medical_key', ${env.MEDICAL_ENCRYPTION_KEY}, true)`,
    );

    // Hand the transaction handle to downstream middleware/handlers via ctx.db.
    return next({ ctx: { ...ctx, db: tx } });
  });
});
