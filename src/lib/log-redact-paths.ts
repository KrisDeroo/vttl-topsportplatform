/**
 * REDACT_PATHS — single source of truth for pino redact + Sentry beforeSend.
 *
 * Both the pino logger (src/lib/log.ts, OPS-01) and the Sentry init
 * (src/lib/sentry.ts, T-01-06) consume this list. Any new sensitive field MUST
 * be added here so the two redaction layers stay in lockstep.
 *
 * Path syntax follows pino's redact rules
 * (https://getpino.io/#/docs/redaction):
 *   - `req.headers.authorization` — exact path
 *   - `*.password` — wildcard segment
 *   - `*.medical_*` — bracketed wildcard match (pino supports the leading-wildcard
 *      pattern at any nesting depth; the trailing-wildcard `medical_*` is matched
 *      via pino's path tokenisation)
 *
 * Plan 05 plans this constant; Plan 13 wires it into the logger. Wave 3 sees
 * Plan 13 land before Plan 05's CSRF middleware does, so this file is created
 * here. Plan 05 can `import { REDACT_PATHS } from '@/lib/log-redact-paths'`
 * directly without redefining it.
 *
 * Reference:
 *  - .planning/phases/01-fundament/01-05-better-auth-config-PLAN.md (plans the constant)
 *  - .planning/phases/01-fundament/01-13-observability-pino-sentry-PLAN.md (consumes it)
 *  - .planning/phases/01-fundament/01-RESEARCH.md §pino setup (lines 1850–1887)
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.email',
  '*.phone',
  '*.dateOfBirth',
  '*.ipAddress',
  '*.medical_*',
  '*.eventDescriptionCipher',
  '*.doctorCipher',
  '*.consentTextSnapshot',
] as const;
