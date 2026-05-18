/**
 * Next.js 15 config.
 *
 * - Wraps with next-intl plugin so RSC translations resolve via
 *   src/i18n/request.ts (created in Plan 01-07).
 * - serverExternalPackages: prevents Next.js from bundling Node-native packages
 *   that ship CommonJS / native bindings (pino's transports, bullmq's worker
 *   thread, ioredis's TCP socket, postgres's libpq-style protocol).
 * - typedRoutes: compile-time validation of <Link href="/...">. Currently
 *   blocks `pnpm build` because the codebase universally uses
 *   `redirect(`/${locale}/login`)` patterns; this is a pre-existing build
 *   issue tracked in `.planning/phases/04-kerndomein/deferred-items.md`
 *   under "Pre-existing build failure" — both parent worktree and Plan
 *   04-08 worktree fail at the same line in `admin/users/page.tsx`.
 */
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['pino', 'pino-pretty', 'bullmq', 'ioredis', 'postgres'],
  experimental: { typedRoutes: true },
});
