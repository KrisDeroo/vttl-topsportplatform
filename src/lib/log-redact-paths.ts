/**
 * REDACT_PATHS — single source of truth for pino redact + Sentry beforeSend.
 *
 * Both the pino logger (src/lib/log.ts, OPS-01) and the Sentry init
 * (src/lib/sentry.ts, T-01-06) consume this list. `tests/unit/log-redact.test.ts`
 * also imports it directly so CI fails the moment a required path is dropped.
 * Any new sensitive field MUST be added here so the two redaction layers and
 * the contract test stay in lockstep.
 *
 * Conventions:
 *   - `req.headers.*` / `res.headers.*` paths target HTTP request/response
 *     headers Better Auth / tRPC attaches to logs (cookies and bearer tokens
 *     never leave the redactor).
 *   - `*.<field>` paths use pino's wildcard form so any nested object whose
 *     key matches `<field>` is redacted regardless of depth (e.g. `user.email`,
 *     `body.user.email`, `result.parent.user.email`).
 *   - `*.medical_*` (with the trailing wildcard) catches the encrypted
 *     medical-event envelope columns introduced in Plan 03.
 *
 * Why a constant module rather than inline in log.ts: Plan 05 ships this list
 * with auth-config tests BEFORE Plan 13 lands the runtime pino instance.
 * Keeping the data and the logger in separate files lets Plan 05's tests
 * assert the contract today, while Plan 13's logger wiring imports it later.
 *
 * Reference:
 *  - .planning/phases/01-fundament/01-05-better-auth-config-PLAN.md (plans the constant)
 *  - .planning/phases/01-fundament/01-13-observability-pino-sentry-PLAN.md (consumes it)
 *  - .planning/phases/01-fundament/01-RESEARCH.md §Logging (SEC-04, OPS-01)
 *  - .planning/phases/01-fundament/01-CONTEXT.md (CRIT-7 medical access audit)
 */
export const REDACT_PATHS = [
  // HTTP headers carrying credentials / session state
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',

  // Credentials and credential surrogates (anywhere in the payload tree)
  '*.password',
  '*.passwordHash',
  '*.token',

  // Direct PII
  '*.email',
  '*.phone',
  '*.dateOfBirth',
  '*.ipAddress',

  // Encrypted medical envelopes (Plan 03 medical_events table)
  '*.medical_*',
  '*.eventDescriptionCipher',
  '*.doctorCipher',

  // Consent text snapshot (legally significant, may contain PII references)
  '*.consentTextSnapshot',
] as const;

export type RedactPath = (typeof REDACT_PATHS)[number];
