/**
 * tRPC core (Plan 11) — `initTRPC` factory + `CallerContext` shape (D-08).
 *
 * The `CallerContext` type is the contract every tRPC middleware reads:
 *   - `session`/`user` come from Better Auth (Plan 05) via `auth.api.getSession`.
 *   - `scope` is the per-request authorization snapshot rebuilt from the DB on
 *     each call (academy memberships + parent-child links + locale + role).
 *     D-08 specifies a 15-min JWT-claim cache; Phase 1 ships "always fresh"
 *     mode (re-fetch every request). See `middleware/auth.ts` block-comment for
 *     the v1.1 caching plan (MAJOR-11 resolution).
 *   - `requestId`/`ipAddress`/`userAgent` are populated from request headers in
 *     `server-context.ts` and surfaced to `audit_log` rows + child loggers.
 *   - `log` is a pino child logger bound to the request id (and user id if any).
 *   - `db` is intentionally optional: `withRlsContext` (Plan 04 RLS GUC binder)
 *     attaches a transaction-scoped Drizzle handle so subsequent middleware /
 *     handler code reads through RLS-aware connections.
 *
 * `errorFormatter` augments the default tRPC error shape with a flattened Zod
 * error so the client can render per-field validation messages in the user's
 * locale (next-intl message catalog renders the `code` strings — backend logs
 * remain English per I18N-11).
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §CallerContext (lines 1028–1156)
 */
import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import type { Logger } from 'pino';

import type { Session, User } from '@/server/auth/auth';
import type { Role } from '@/server/auth/permissions';

/**
 * Per-request authorization snapshot. Populated by `server-context.ts` from the
 * Better Auth session + DB joins; consumed by middleware (`requireAuth`,
 * `requireRole`, `requireFreshSession`) and by every handler that needs to
 * scope queries.
 *
 * `null` means "anonymous request" — passes through `publicProcedure` only.
 */
export type CallerScope = {
  userId: string;
  role: Role;
  /** Academy codes (e.g. ['vlaanderen-noord']) the user is a member of (any role within that academy). */
  academyIds: string[];
  /** child_user_id list from parent_child_links — populated for parents of minors. */
  linkedPlayerIds: string[];
  /** UI locale preference; selected from users.preferred_locale. */
  locale: 'nl' | 'en' | 'fr';
  /** Unix-ms epoch when this scope was rebuilt. Phase-1 always-fresh = always recent. */
  issuedAt: number;
  /** SEC-03: true while the session is within the freshAge window (1h post-auth). */
  fresh: boolean;
};

/**
 * tRPC `CallerContext` — the input to every middleware and procedure handler.
 *
 * `db` is added by `withRlsContext` (RLS-bound transaction). It is typed as
 * `unknown` here because the binding type is internal to Drizzle's transaction
 * factory and pinning the exact type leaks transaction-internal generics into
 * every middleware signature. Handlers that need it should narrow via
 * `ctx.db ?? rawDb` from `@/server/db/client` (the audit middleware does this).
 */
export type CallerContext = {
  session: Session | null;
  user: User | null;
  scope: CallerScope | null;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  log: Logger;
  /** RLS-bound transaction handle, populated by `withRlsContext`. */
  db?: unknown;
};

const t = initTRPC.context<CallerContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

// Re-export so middleware files can throw with the canonical tRPC error type.
export { TRPCError };

// Procedure presets (protected/td/sensitive/medical) are exported from
// `middleware/freshSession.ts` to break a circular dependency: those presets
// reference `requireAuth` / `withRlsContext` / `requireCurrentConsent`, each of
// which imports `middleware` from this file.
