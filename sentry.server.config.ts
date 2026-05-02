/**
 * Sentry server runtime init — picked up automatically by @sentry/nextjs on
 * server start (route handlers, server actions, RSCs).
 *
 * The actual configuration lives in `src/lib/sentry.ts` so all three runtime
 * configs (server / client / edge) share one beforeSend hook and one DSN/env
 * mapping. This file is the runtime entrypoint Next.js scans for.
 *
 * Reference: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */
import { initSentry } from '@/lib/sentry';

initSentry();
