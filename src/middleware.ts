/**
 * Next.js middleware — placeholder for next-intl + auth gating.
 *
 * Wave 3 dependency: requires src/i18n/routing.ts (created in Plan 01-07).
 * Until Plan 07 lands, this re-export is intentionally a stub so other plans
 * (Plan 05 Better Auth, Plan 11 CallerContext) can reference the file path
 * without circular-import friction.
 *
 * Plan 01-07 will replace this with a fully wired createMiddleware() call
 * that uses defineRouting + locale negotiation per D-02 / D-03.
 *
 * Reference: .planning/phases/01-fundament/01-07-next-intl-routing-and-catalogs-PLAN.md
 */
export { default } from 'next-intl/middleware';

export const config = {
  // Match all paths except api, _next assets, _vercel internals, and files with extensions.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
