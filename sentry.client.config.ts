/**
 * Sentry browser runtime init — picked up automatically by @sentry/nextjs and
 * loaded into the client bundle.
 *
 * Implementation lives in `src/lib/sentry.ts` so server / client / edge stay
 * in lockstep on PII-stripping and DSN/env handling.
 *
 * Reference: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */
import { initSentry } from '@/lib/sentry';

initSentry();
