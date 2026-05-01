/**
 * Next.js middleware — next-intl locale negotiation (D-02 / D-03).
 *
 * Replaces the Plan 01 stub. Mounts createMiddleware(routing) at every non-API,
 * non-_next, non-static path, which:
 *   - detects the request locale per routing.localeDetection (Accept-Language)
 *   - sets a cookie so subsequent navigation honors the choice
 *   - rewrites/redirects between '/x' (default 'nl') and '/en/x', '/fr/x'
 *
 * Plan 11 (CallerContext) wraps this with auth gating once Better Auth is live.
 *
 * Reference:
 *   - .planning/phases/01-fundament/01-RESEARCH.md §Middleware (lines 1437-1450)
 *   - https://next-intl-docs.vercel.app/docs/routing/middleware
 */
import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match everything except api, trpc, _next, _vercel, and static files (anything
  // with a literal '.' in the path, which excludes assets like favicon.ico, robots.txt).
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
