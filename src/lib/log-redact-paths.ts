/**
 * Single source of truth for pino redact paths (SEC-04 + OPS-01).
 *
 * Imported by Plan 13 (`src/lib/log.ts`) when wiring the runtime pino logger,
 * AND directly by `tests/unit/log-redact.test.ts` so CI fails the moment a
 * required path is dropped from the list.
 *
 * Conventions:
 *   - `req.headers.*` paths target HTTP request headers Better Auth / tRPC
 *     attaches to logs (cookies and bearer tokens never leave the redactor).
 *   - `*.<field>` paths use pino's wildcard form so any nested object whose
 *     key matches `<field>` is redacted regardless of depth (e.g. `user.email`,
 *     `body.user.email`, `result.parent.user.email`).
 *   - `*.medical_*` (with the trailing wildcard) catches the encrypted
 *     medical-event envelope columns introduced in Plan 03.
 *
 * Why a constant module rather than inline in log.ts: Plan 05 ships this list
 * BEFORE Plan 13 lands the runtime pino instance — keeping the data and the
 * logger in separate files lets Plan 05's tests assert the contract today.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Logging (SEC-04)
 *            .planning/phases/01-fundament/01-CONTEXT.md (CRIT-7 medical access audit)
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
