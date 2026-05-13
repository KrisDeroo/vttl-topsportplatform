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
 *
 * WR-06 fix (2026-05-01): the previous list contained `*.medical_*`,
 * intending to redact every key starting with `medical_`. pino's
 * underlying `fast-redact` library does NOT support partial-segment
 * wildcards in the trailing path component — it would have matched a
 * literal property called `medical_*` (asterisk character) and let
 * keys like `medical_diagnosis` / `medical_history` flow through
 * unredacted. Replaced with the enumerated set of medical-prefixed
 * fields the v1 schema actually emits, mirroring the runtime
 * `k.startsWith('medical_')` check that `src/lib/sentry.ts` already
 * uses. New medical-prefixed fields MUST be added here when
 * introduced.
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

  // Encrypted medical envelopes (Plan 03 medical_events table) — see
  // WR-06 block-comment for why each medical-prefixed field is listed
  // explicitly instead of relying on a `medical_*` glob.
  '*.medical_diagnosis',
  '*.medical_diagnosis_cipher',
  '*.medical_doctor',
  '*.medical_doctor_cipher',
  '*.medical_event_description',
  '*.medical_event_description_cipher',
  '*.medical_history',
  '*.medical_notes',
  '*.medical_original_filename',
  '*.medical_original_filename_cipher',
  '*.eventDescriptionCipher',
  '*.doctorCipher',
  '*.originalFilenameCipher',

  // Consent text snapshot (legally significant, may contain PII references)
  '*.consentTextSnapshot',

  // Phase 2 (PLAYER-06, Plans 02-01 + 02-15 — operational PII):
  // emergency contacts are minor-protected personal data and become
  // first-class fields on `players` rows. Per CRIT-7 these must be
  // redacted both at log time (pino) and Sentry beforeSend. Cover
  // both the camelCase zod input shape and the snake_case DB column
  // shape since pino renders both depending on the call site.
  '*.emergencyContactName',
  '*.emergencyContactPhone',
  '*.emergencyContactRelation',
  '*.emergency_contact_name',
  '*.emergency_contact_phone',
  '*.emergency_contact_relation',
] as const;

export type RedactPath = (typeof REDACT_PATHS)[number];
