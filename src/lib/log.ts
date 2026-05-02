/**
 * pino structured logger — application-wide log surface (OPS-01, SEC-04).
 *
 * Three concerns are wired here:
 *  1) Redaction. Every PII path lives in `src/lib/log-redact-paths.ts`
 *     (REDACT_PATHS) and is consumed verbatim — both pino and the Sentry
 *     beforeSend hook (src/lib/sentry.ts) read the same list so the two
 *     redaction layers cannot drift. Censor token is `[REDACTED]` (matches
 *     the audit-trail expectation; never serialise the original value).
 *  2) Transport. In dev/test we send to pino-pretty (human-readable, colorized).
 *     In production we ship to Logflare or Axiom (EU region, OPS-03) when the
 *     env vars LOGFLARE_API_KEY + LOGFLARE_SOURCE are set; otherwise pino
 *     defaults to stdout (Coolify scrapes the container log stream).
 *  3) Base context. Every log line carries `service: 'vttl-topsport'` and
 *     `env: <NODE_ENV>` so log aggregators can route, filter, and dashboard
 *     by service without parsing message bodies.
 *
 * The `Logger` type is re-exported so callers can type child loggers
 * (Plan 11 attaches `requestId` + `userId` per-request via `log.child(...)`).
 *
 * Backend logs are English (I18N-11) — never translate `service` keys or log
 * messages by locale. UI strings flow through next-intl; this is a different
 * surface.
 *
 * Reference:
 *  - .planning/phases/01-fundament/01-RESEARCH.md §pino setup (lines 1850–1887)
 *  - .planning/phases/01-fundament/01-RESEARCH.md §Log shipping (lines 1972–1990)
 */
import pino, { type Logger } from 'pino';

import { env } from './env';
import { REDACT_PATHS } from './log-redact-paths';

const isProd = env.NODE_ENV === 'production';

/**
 * Build the pino transport configuration.
 *
 * `pino.transport({ targets })` returns a worker-thread destination; calling
 * it with an empty target list throws, so we return `undefined` (use pino's
 * default stdout sink) when no transport is configured.
 *
 * In dev/test: pino-pretty for human-readable output.
 * In prod with Logflare creds: ship to Logflare EU dataset.
 * In prod without Logflare creds: stdout (Coolify scrapes via Docker logs;
 * acceptable fallback if OPS-03 aggregator is being onboarded).
 */
function buildTransport(): ReturnType<typeof pino.transport> | undefined {
  const targets: Array<{ target: string; options: Record<string, unknown> }> = [];

  if (!isProd) {
    targets.push({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    });
  }

  if (env.LOGFLARE_API_KEY && env.LOGFLARE_SOURCE) {
    targets.push({
      target: '@logflare/pino-logflare',
      options: {
        apiKey: env.LOGFLARE_API_KEY,
        sourceToken: env.LOGFLARE_SOURCE,
      },
    });
  }

  if (targets.length === 0) return undefined;
  return pino.transport({ targets });
}

export const log: Logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { service: 'vttl-topsport', env: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...REDACT_PATHS],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  buildTransport(),
);

export type { Logger };
