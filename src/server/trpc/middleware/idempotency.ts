/**
 * idempotency middleware — VALID-08 wiring (Pitfall 5 from Phase 4 RESEARCH).
 *
 * Phase 1 shipped the `idempotency_keys` table but no middleware was wired
 * into any procedure. Phase 4 introduces this middleware factory and
 * composes it onto `training.markAttendanceAndScore`,
 * `tournament.enterResult`, and `ranking.addEntry`.
 *
 * Behavior:
 *   - Reads `_meta.idempotencyKey` from input via `getRawInput()`. No key
 *     supplied → middleware is a no-op (handler runs normally).
 *   - On cache HIT within 24h: returns the stored `responseBody` verbatim;
 *     writes an audit row with `action='idempotency_replay'` (GDPR-04 +
 *     04-PATTERNS.md §Cross-Cutting audit code #14).
 *   - On cache MISS: runs the handler, persists
 *     `(key, userId, endpoint, responseBody, expiresAt = now() + 24h)`.
 *
 * Caveat: stores the full handler response as JSONB. Large responses
 * (file uploads) should NOT use this middleware — they rely on
 * storage-layer dedup per `src/server/db/schema/idempotency.ts §Lifecycle`.
 *
 * Concurrent insert race: two in-flight requests with the same key may
 * both miss the cache and reach the INSERT. The PK on `idempotency_keys.key`
 * makes the second commit fail; we swallow that PK-violation so the
 * handler's side effects (which already committed on the first request)
 * are not double-attributed. The duplicate request's response body is
 * lost from the cache but the handler returns its actual result — a
 * client retry on flaky network gets the live result the first time
 * and the cached result on any subsequent retry within 24h.
 *
 * Exports:
 *   - `idempotencyMiddleware(endpointName)` — canonical name (matches
 *     Phase 4 plan spec and RESEARCH §Pitfall 5).
 *   - `withIdempotency(endpointName)` — alias for the RED test fixture
 *     `tests/unit/idempotency-middleware.test.ts`.
 *
 * Reference: .planning/phases/04-kerndomein/04-RESEARCH.md §Pitfall 5 (lines 977-1014)
 *            .planning/phases/04-kerndomein/04-PATTERNS.md §Cross-Cutting §2
 *            src/server/db/schema/idempotency.ts (table contract)
 */
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';

import { db as rawDb, type DbClient } from '@/server/db/client';
import { idempotencyKeys } from '@/server/db/schema';

import { middleware } from '../trpc';
import { writeAudit } from './audit';

/** Loose parse of input metadata — never throws on shape mismatch. */
const META_KEY_SCHEMA = z.object({
  _meta: z
    .object({ idempotencyKey: z.string().min(8).max(128).optional() })
    .optional(),
});

export const idempotencyMiddleware = (endpointName: string) =>
  middleware(async ({ ctx, next, getRawInput }) => {
    // Anonymous callers (publicProcedure) — no scope to attribute the key to.
    // Skip the middleware entirely so login / signup / ping are unaffected.
    if (!ctx.scope) return next();

    // Loose parse: a handler whose Zod schema does not declare `_meta`
    // still works — the middleware simply does not see a key.
    const raw = await getRawInput();
    const parsed = META_KEY_SCHEMA.safeParse(raw);
    const key = parsed.success ? parsed.data._meta?.idempotencyKey : undefined;
    if (!key) return next();

    // ctx.db is typed `unknown` in CallerContext (see trpc.ts rationale);
    // narrow here. Fall back to rawDb only outside withRlsContext, which
    // shouldn't happen on the procedures this middleware is composed onto,
    // but the fallback keeps the contract resilient.
    const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
    const now = new Date();

    // 1. Cache lookup — gate on (key, userId, endpoint) and require unexpired.
    const existing = await dbHandle
      .select({
        responseBody: idempotencyKeys.responseBody,
        expiresAt: idempotencyKeys.expiresAt,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.userId, ctx.scope.userId),
          eq(idempotencyKeys.endpoint, endpointName),
          gt(idempotencyKeys.expiresAt, now),
        ),
      )
      .limit(1);

    if (existing[0]) {
      // Cache HIT — write idempotency_replay audit row (Phase 4 audit code
      // #14) and return the cached body. The tRPC client receives a
      // structurally-identical response to the original call. We surface
      // a `__idempotency_replay: true` marker on the data so callers (and
      // tests) can distinguish replay from first-call result if they care.
      await writeAudit(ctx, {
        action: 'idempotency_replay',
        resourceType: 'idempotency_key',
        resourceId: key,
        newValues: { endpoint: endpointName },
        outcome: 'success',
      });
      const cached = existing[0].responseBody as Record<string, unknown> | null;
      const replayData = {
        ...(cached ?? {}),
        __idempotency_replay: true as const,
      };
      // Construct the tRPC v11 MiddlewareResult shape directly:
      //   { marker: 'middlewareMarker', ok: true, data: ..., ctx: ... }
      // The `middlewareMarker` constant is `@internal` in @trpc/server,
      // so the value `'middlewareMarker'` is duplicated here verbatim (see
      // node_modules/@trpc/server/dist/initTRPC-*.mjs `const middlewareMarker = "middlewareMarker"`).
      // This cast is the contract boundary — never inline the marker
      // string anywhere else.
      return {
        marker: 'middlewareMarker' as const,
        ok: true as const,
        data: replayData,
        ctx,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }

    // 2. Cache MISS — run the handler, then persist its response.
    const result = await next();

    try {
      await dbHandle.insert(idempotencyKeys).values({
        key,
        userId: ctx.scope.userId,
        endpoint: endpointName,
        // `next()` returns the wrapped result; the actual handler payload is
        // available under `.data` when the procedure was a Zod-typed
        // mutation. Older tRPC paths return the raw value directly. Persist
        // whichever is non-null.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseBody: ((result as any)?.data ?? (result as any) ?? null) as
          | Record<string, unknown>
          | null,
        // Optional sha256 — defer to v2 if replay-tampering becomes a concern.
        responseHash: null,
        createdAt: now,
        // 24h TTL — matches `idempotency_keys.expiresAt` contract (Phase 1
        // D-23). Expired rows reclaimed by Phase 1 Plan 13 pg_cron job.
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    } catch {
      // Concurrent insert with same key from another in-flight request —
      // accept silently. The first commit wins; we do not roll back the
      // handler's side effects (which already committed in `next()`).
      // The client retrying within 24h will get the cached body of the
      // FIRST request that won the PK race.
    }

    return result;
  });

/**
 * Alias for the RED test fixture `tests/unit/idempotency-middleware.test.ts`,
 * which imports `withIdempotency`. The canonical export is
 * `idempotencyMiddleware`; both names point to the same factory.
 */
export const withIdempotency = idempotencyMiddleware;
