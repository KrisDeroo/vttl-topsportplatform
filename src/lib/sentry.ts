/**
 * Centralised Sentry init — imported by sentry.{server,client,edge}.config.ts.
 *
 * EU region: select via DSN host. Sentry hosts EU ingest at
 * `*.ingest.de.sentry.io` — when registering for the project, choose "EU
 * (Frankfurt)" so the DSN starts with `https://<key>@oXXXX.ingest.de.sentry.io/`.
 * No code switch is required; the DSN does the routing.
 *
 * PII strip (T-01-06, GDPR Article 5(1)(c) data minimisation):
 *  - `event.user.email`, `ip_address`, `username`, `name` deleted; `id` is the
 *    only identifier we ship — pseudonymous, links to internal audit log only.
 *  - Request headers `authorization` + `cookie` (and `set-cookie`,
 *    `Authorization`, `Cookie` defensive variants) deleted.
 *  - Body keys with sensitive content deleted: `password`, `token`, `email`,
 *    `phone`, `dateOfBirth`, `consentTextSnapshot`. Any key starting with
 *    `medical_` (e.g. `medical_diagnosis`, `medical_history`) and any key
 *    ending with `Cipher` (already-ciphered medical fields — never log even
 *    the ciphertext to a third party) is also stripped.
 *
 * The redaction list mirrors `src/lib/log-redact-paths.ts` (REDACT_PATHS) in
 * intent — this hook implements the equivalent rules in JS form (Sentry's
 * event shape differs from pino's so the wildcard syntax cannot be reused
 * verbatim, but the semantics match).
 *
 * `initSentry()` is idempotent under the optional-DSN guard: when SENTRY_DSN
 * is unset (typical for local dev) it returns immediately and never calls
 * `Sentry.init`. Production deploys MUST set SENTRY_DSN at the env level.
 *
 * `tracesSampleRate` is 0.1 in production (10% of requests captured) and 1.0
 * elsewhere (full capture in dev/test). Tune in Phase 8 once production
 * volume is known.
 *
 * Reference:
 *  - .planning/phases/01-fundament/01-RESEARCH.md §Sentry init (lines 1889–1921)
 */
import * as Sentry from '@sentry/nextjs';

import { env } from './env';

const SENSITIVE_BODY_KEYS = [
  'password',
  'token',
  'email',
  'phone',
  'dateOfBirth',
  'consentTextSnapshot',
] as const;

const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'Authorization',
  'Cookie',
] as const;

export function initSentry(): void {
  // Optional in dev — no DSN means error tracking is silently disabled. Logs
  // still flow to pino + (optionally) Logflare; Sentry is the second layer.
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      // 1) Strip user PII — keep only the opaque user.id.
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete (event.user as Record<string, unknown>).username;
        delete (event.user as Record<string, unknown>).name;
      }

      // 2) Strip auth + cookie headers from the captured request.
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, unknown>;
        for (const k of SENSITIVE_HEADER_KEYS) {
          delete headers[k];
        }
      }

      // 3) Strip dangerous body keys (password, token, PII, medical_*, *Cipher).
      if (
        event.request?.data &&
        typeof event.request.data === 'object' &&
        !Array.isArray(event.request.data)
      ) {
        const data = event.request.data as Record<string, unknown>;
        for (const k of SENSITIVE_BODY_KEYS) {
          delete data[k];
        }
        for (const k of Object.keys(data)) {
          if (k.startsWith('medical_') || k.endsWith('Cipher')) {
            delete data[k];
          }
        }
      }

      return event;
    },
  });
}
