/**
 * tRPC HTTP transport — Next.js App Router catch-all route (Plan 11).
 *
 * Mounts every tRPC procedure under `/api/trpc/<router>.<procedure>`. The
 * `fetchRequestHandler` adapter from `@trpc/server/adapters/fetch` consumes a
 * Web Request and returns a Web Response — directly compatible with App Router
 * route handlers (no Express/Node bridge).
 *
 * `createContext` is invoked once per call to materialise the `CallerContext`
 * (Plan 11 server-context.ts): reads the Better Auth session, rebuilds the
 * authorization scope, attaches a request-scoped pino child logger.
 *
 * `onError` deliberately writes only to local stderr in dev — pino's redact
 * filter (Plan 13) already strips PII from the application log path, but the
 * route handler does not see those filters; we keep it minimal to avoid
 * leaking message bodies that may contain user input. In production the
 * tRPC error has already been thrown through pino-redacted middleware logs
 * (`requireAuth`, `requireRole`, etc.), so silence here is intentional.
 */
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

function handler(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext(),
    onError({ error, path }) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.error(`[trpc] ${path ?? '<unknown>'}: ${error.message}`);
      }
    },
  });
}

export { handler as GET, handler as POST };
