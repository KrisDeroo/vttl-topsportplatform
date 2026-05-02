# Observability — Phase 1

## Log retention (OPS-02)

| Source                                       | Retention                                | Storage                                                          |
| -------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Application logs (pino → Logflare/Axiom EU)  | 30 days                                  | External aggregator (OPS-03)                                     |
| `audit_log` table                            | 90 days                                  | Postgres; `pg_cron` purge job in Phase 8                         |
| `medical_access_audit` table                 | 6 years (Belgian Patient Rights Act)     | Postgres; archive to encrypted offsite in Phase 8                |
| Sentry error events                          | 90 days (Sentry default)                 | Sentry EU region                                                 |

The 6-year retention for `medical_access_audit` matches the Belgian Patient Rights Act minimum for medical-record-related audit trails. Plan 08+ (Phase 8) wires `pg_cron` for the 90-day audit_log purge and a manual archive job for the 6-year medical-access stream; Phase 1 only stages the schema and the retention contract.

## PII redaction

Single source of truth: `src/lib/log-redact-paths.ts` (`REDACT_PATHS`).

- pino consumes the list verbatim via `redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' }` in `src/lib/log.ts`.
- Sentry's `beforeSend` (`src/lib/sentry.ts`) implements the equivalent semantics for the Sentry event envelope (user object, request headers, request body — wildcard syntax differs but the rule set matches).

Any new sensitive field MUST be added to `REDACT_PATHS`. Adding it only to one of the two redaction layers is a defect (T-01-06).

## Slow-query log

- App layer: `withTiming(label, fn)` in `src/server/db/client.ts` logs queries >500ms at WARN under tag `db.slow_query`; ≤500ms at DEBUG under tag `db.query_timing`. Threshold of 500ms is deliberately aligned with the database-level setting below so a single slow query produces matching evidence at both layers.
- DB layer: Supabase setting `log_min_duration_statement = 500` (manual configuration on the project; documented as a Phase 8 release-gate task — see `.planning/phases/01-fundament/01-RESEARCH.md` §Drizzle query interceptor for the SQL).

## Alert rules (Plan 14 health endpoints feed these)

- Error rate > 1% over 5 min — Better Stack alert (Phase 8 polish).
- p95 latency > 1s on calendar/dashboard — Phase 3+ scope (no calendar yet in Phase 1).
- Database connection saturation > 80% — Supabase metrics; alert in Phase 8.

## Log shipping (OPS-03)

Production application logs ship to an EU-region aggregator. Two compatible options are wired into `src/lib/log.ts` via the env-driven feature flag (`LOGFLARE_API_KEY` + `LOGFLARE_SOURCE` presence):

- **Logflare** (recommended primary). Supabase-native, EU region available at signup. Pino transport: `@logflare/pino-logflare`.
- **Axiom**. EU dataset selectable on signup. Same env-flag pattern (transport target swap is a one-line change; documented for Phase 8 if Logflare onboarding stalls).

If neither aggregator is wired (env vars unset) pino logs to stdout — Coolify scrapes the container log stream as an interim path. Production go-live MUST have one aggregator configured (Phase 8 release gate).

## Backend logs are English (I18N-11)

pino logs and source code remain English regardless of UI locale. The constraint is enforced via:

- Project convention (`CLAUDE.md` constraint): "Backend logs and source code remain English".
- Plan 17 manual gate: spot-check via grep for non-English characters in source.
- Plan 18 ESLint custom rule (planned): block accidental NL/FR string literals in code paths under `src/server` and `src/lib`.

UI strings flow through `next-intl` and are a separate surface — never touch the pino log envelope.
