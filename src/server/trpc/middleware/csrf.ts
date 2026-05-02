/**
 * CSRF Origin-validation middleware (SEC-02 belt).
 *
 * Better Auth's session cookie defaults to `SameSite=Lax`, which blocks most
 * cross-site CSRF on state-changing requests. For tRPC mutations served from
 * the same origin, that plus `auth.options.trustedOrigins` is sufficient.
 *
 * This middleware adds a SECOND layer for non-browser clients (curl, native
 * apps) that bypass cookie SameSite rules: it checks the request `Origin`
 * header against `env.NEXT_PUBLIC_APP_URL`. If the caller supplied an Origin
 * that does NOT match, the request is rejected with TRPCError FORBIDDEN
 * `csrf_origin_mismatch`. If the Origin header is absent (server-to-server,
 * or first-party fetch with no Origin), the middleware is a no-op — the
 * SameSite cookie is the only relevant defence in that path.
 *
 * The middleware is exported as a higher-order function rather than via tRPC's
 * `t.middleware(...)` factory because the tRPC factory is constructed in
 * Plan 11 (`src/server/trpc/trpc.ts`). Plan 11 will wrap this with
 * `t.middleware(...)` at the call site, passing a closure that reads the
 * Origin from `ctx.req.headers.get('origin')` (App Router style).
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §CSRF (lines 1654-1658)
 *            .planning/phases/01-fundament/01-CONTEXT.md (T-01-01 — CSRF threat)
 */
import { TRPCError } from '@trpc/server';
import { env } from '@/lib/env';

/**
 * Build a tRPC-style middleware that validates the request Origin against
 * `env.NEXT_PUBLIC_APP_URL`. The caller supplies a `getOrigin` function that
 * extracts the Origin string (or null) from the current request — this
 * decoupling lets Plan 11 wire the closure to whichever request shape its
 * createContext eventually settles on.
 *
 * @param getOrigin Function returning the Origin header value or null when
 *                  the request did not include one (server-to-server, or a
 *                  same-origin fetch where the browser elides the header).
 * @returns         Middleware function suitable for `t.middleware(...)`. When
 *                  invoked with `{ next }` the function either resolves the
 *                  result of `next()` or throws TRPCError FORBIDDEN with
 *                  message `csrf_origin_mismatch`.
 */
export function csrfMiddleware(getOrigin: () => string | null) {
  return async ({ next }: { next: () => Promise<unknown> }): Promise<unknown> => {
    const origin = getOrigin();
    if (origin && origin !== env.NEXT_PUBLIC_APP_URL) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'csrf_origin_mismatch',
      });
    }
    return next();
  };
}
