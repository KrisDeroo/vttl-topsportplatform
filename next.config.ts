/**
 * Next.js 15 config.
 *
 * - Wraps with next-intl plugin so RSC translations resolve via
 *   src/i18n/request.ts (created in Plan 01-07).
 * - serverExternalPackages: prevents Next.js from bundling Node-native packages
 *   that ship CommonJS / native bindings (pino's transports, bullmq's worker
 *   thread, ioredis's TCP socket, postgres's libpq-style protocol).
 * - typedRoutes: compile-time validation of <Link href="/...">.
 */
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['pino', 'pino-pretty', 'bullmq', 'ioredis', 'postgres'],
  experimental: { typedRoutes: true },
});
