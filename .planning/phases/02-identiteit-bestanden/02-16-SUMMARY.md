---
phase: 02-identiteit-bestanden
plan: 16
subsystem: docs
tags: [documentation, deployment, coolify, clamav, supabase-storage, operator-runbook]

# Dependency graph
requires:
  - phase: 02-identiteit-bestanden
    provides: file upload pipeline (02-04 storage helpers + 02-06 malware scan worker), Phase 2 env vars (02-01), staging schema push (02-14)
provides:
  - "docs/file-upload-pipeline.md — single-page reference for the upload→scan→clean lifecycle"
  - "docs/deployment.md — Coolify deployment runbook with Phase 1 baseline + Phase 2 ClamAV sidecar"
affects: [03-kalender, 05-uitgebreid-domein, 08-kwaliteit-release]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-phase deployment doc append: each phase that adds runtime infra appends a `## Phase N additions` section (env vars table, service block, smoke tests, rollback)"
    - "Operator-facing doc format: short, code-block-heavy, table-of-failure-modes (mirrors Phase 1 docs/migration-runbook.md + docs/observability.md)"

key-files:
  created:
    - "docs/file-upload-pipeline.md"
    - "docs/deployment.md"
  modified: []

key-decisions:
  - "Created docs/deployment.md from scratch (Rule 2): the plan said extend Phase 1 but Phase 1 never shipped this doc. Added a Phase 1 baseline section so the Phase 2 additions read in context."
  - "Region documented as eu-west-1 (Dublin), correcting PROJECT.md eu-central-1 — confirmed by 02-14 staging push pooler hostname."
  - "v1 transactional email decision documented (RESEND_API_KEY=re_dev_disabled, TD manual activation) — operator must not regress without product-owner sign-off."
  - "BLOCKER-04 honored: App Router body-size limit modeled as Zod + Caddy + rate-limit layers; explicit warning that bodyParser config is Pages-Router-only."
  - "BLOCKER-10 honored: recompute_player_minor_flags() pg_cron job documented now (Phase 8 deliverable) so operators know about the drift window for is_minor."
  - "WARNING-15 honored: service-role rotation procedure + DIRECT_DATABASE_URL revocation runbook + mark_scan_result post-rotation smoke check."
  - "FILE-02 (medical bucket) and FILE-05 (evaluation attachments) explicitly scoped to Phase 5; magic-bytes registry extension path documented, no Phase 2 router or UI added."
  - "Caddy snippet uses lowercase 5mb (matches Caddy convention + plan grep) — single literal across both docs for consistency."

patterns-established:
  - "Pattern: cron-sweep documentation lands in operator docs before the migration that creates it, with explicit Phase 2 stance (NOT implemented, here is why the once-per-year drift is acceptable for v1)."
  - "Pattern: env-var table per phase enumerates Source (where the operator gets the value) AND Used by (which file consumes the env), making rotation runbooks self-contained."
  - "Pattern: smoke tests after deploy use docker exec into specific sidecar containers (EICAR via clamdscan --stream) rather than HTTP probes — clamd is INSTREAM-only, not HTTP."

requirements-completed:
  - VALID-04
  - OPS-01

# Metrics
duration: 6min
completed: 2026-05-13
---

# Phase 2 Plan 16: Deployment Docs Summary

**Two operator-facing docs that close Phase 2: a single-page file-upload pipeline reference (lifecycle, magic-bytes, ClamAV, signed URLs, audit, Phase 8 cron sweeps) and a Coolify deployment runbook with the Phase 1 baseline plus the Phase 2 ClamAV sidecar and four new env vars.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-13T20:22:29Z
- **Completed:** 2026-05-13T20:28:05Z
- **Tasks:** 2
- **Files created:** 2 (docs/file-upload-pipeline.md, docs/deployment.md)
- **Files modified:** 0 (Phase 1 docs untouched; only new ones added)

## Accomplishments

- **docs/file-upload-pipeline.md** (377 lines, 26.7 KB):
  - Lifecycle diagram (browser → server → Storage → BullMQ → ClamAV) with the exact tRPC mutation steps (Zod parse, magic-bytes, DB INSERT, storage upload, queue enqueue, audit)
  - Magic-bytes registry per bucket — explicit Phase 2 scope (profiles only) with FILE-02 medical + FILE-05 evaluations called out as Phase 5
  - App Router body-size BLOCKER-04 model: Zod cap (`contentBase64.max`) + Caddy `request_body { max_size 5mb }` + SEC-08 rate-limit. Explicit warning that the `bodyParser` config is Pages-Router-only and has zero effect in App Router.
  - Base64-vs-multipart transport rationale (Open Question 2)
  - DB-first vs storage-first ordering (Open Question 3)
  - ClamAV sidecar deployment + EICAR health check + freshclam refresh procedure
  - Failure modes table (5 rows: stuck pending, stale signatures, ECONNREFUSED, retry exhaustion, OOM)
  - Signed URL 1h TTL + 50-min client refresh (Pitfall 8 mitigation)
  - Audit trail spec (file.upload, file.signed_url_issued, file.delete, file.delete_storage_failed) — what's logged and what's redacted
  - **Service-role rotation procedure (WARNING-15)** with 5-second in-flight window note
  - **DIRECT_DATABASE_URL revocation runbook** (post-migration cleanup)
  - **Post-rotation smoke check** for mark_scan_result SECURITY DEFINER + EXECUTE grant
  - **Phase 8 cron sweeps** — full SQL for `recompute_player_minor_flags()` (BLOCKER-10) + orphan upload sweep + stuck-scan reporting query
  - "What to do when X" decision matrix (8 rows)
  - **v1 transactional-email decision** documented (Resend disabled, TD manual activation)

- **docs/deployment.md** (281 lines, 17.8 KB):
  - Architecture diagram (Coolify on Hetzner CX31 → Supabase Pro eu-west-1)
  - **Region note**: eu-west-1 (Dublin) confirmed from 02-14 staging push, correcting PROJECT.md's eu-central-1 mention
  - Phase 1 baseline env-var table (10 vars including `RESEND_API_KEY=re_dev_disabled`)
  - Phase 1 deploy steps (Coolify wizard, secrets, redis service, smoke check)
  - **Phase 2 additions** section:
    - 4 new env vars table (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLAMAV_HOST, CLAMAV_PORT) with Source + Used-by columns
    - Service-role rotation runbook (WARNING-15)
    - DIRECT_DATABASE_URL revocation procedure
    - ClamAV sidecar `docker-compose` block (private network only, no public port bind)
    - Resource sizing table (5 components, ~2.9 GB total, ~5 GB headroom on CX31)
    - App Router body-size BLOCKER-04 layered model with Caddy 5mb snippet
    - Worker process env-var inventory (Phase 1 + Phase 2 additions)
    - 6 smoke tests post-deploy (health, ClamAV reachability via nc, EICAR via clamdscan, storage bucket exists, mark_scan_result + EXECUTE grant, manual upload)
    - Freshclam schedule
    - Phase 2 rollback procedure (code redeploy + 3 migration rollback files in reverse order)
  - "Future phase additions" placeholder for Phases 3/5/6/8

## Task Commits

Each task was committed atomically:

1. **Task 1: Write docs/file-upload-pipeline.md** — `686f675` (docs)
2. **Task 2: Extend docs/deployment.md with ClamAV sidecar + Phase 2 env** — `6080dbc` (docs)

## Files Created/Modified

- `docs/file-upload-pipeline.md` (created, 377 lines) — single-source-of-truth for the Phase 2 file pipeline; covers lifecycle, magic-bytes, body-size, ClamAV, signed URLs, audit, service-role rotation, DIRECT_DATABASE_URL revocation, Phase 8 cron sweeps, v1 no-email decision.
- `docs/deployment.md` (created, 281 lines) — Coolify deployment runbook; Phase 1 baseline + Phase 2 ClamAV sidecar additions; smoke tests + rollback.

## Decisions Made

- **Created docs/deployment.md from scratch (Rule 2).** The plan instructed "extend Phase 1" but Phase 1's actual deliverables (per the worktree HEAD `docs/` listing) are migration-runbook.md, observability.md, and erasure-strategy.md — there is no Phase 1 deployment doc to extend. Operating under Rule 2 (auto-add missing critical functionality), I added a short Phase 1 baseline so the Phase 2 additions read in context. The Phase 2 content respects the plan's stated structure (env-var table → sidecar block → resource sizing → body-size limit → worker process → smoke tests → freshclam → rollback) and is appended after the Phase 1 baseline so future phase additions land at the bottom in the documented pattern.
- **Region correction to eu-west-1.** The 02-14 MIGRATION-LOG.md staging push confirmed the Supabase project is in eu-west-1 (Dublin) — pooler hostname `aws-0-eu-west-1.pooler.supabase.com`. Both docs say eu-west-1; the original PROJECT.md mention of eu-central-1 (Frankfurt) is explicitly called out and corrected so operators do not confuse the two on future invocations.
- **v1 no-email decision codified.** Both docs document the 2026-05-13 product-owner decision to remove Resend from v1 (`RESEND_API_KEY=re_dev_disabled`; TD manual activation; v2 reconsiders). The `lib/email.ts` interface is preserved with a no-op implementation, so consuming code does not crash.
- **Caddy snippet uses `5mb` (lowercase) consistently.** Caddy accepts both casings; the plan's automated verification grep was case-sensitive on `5mb`. Both docs use the same casing so a future operator copying the snippet from either source gets the same string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Created docs/deployment.md from scratch with Phase 1 baseline section**

- **Found during:** Task 2 (Extend docs/deployment.md)
- **Issue:** The plan said to extend the Phase 1 `docs/deployment.md`, but no such file exists. Phase 1 shipped migration-runbook.md, observability.md, and erasure-strategy.md only.
- **Fix:** Created a new docs/deployment.md with a Phase 1 baseline section (architecture diagram, Phase 1 env-var table, Phase 1 deploy steps, backup mention) and then appended the Phase 2 additions per the plan's template. The Phase 1 baseline draws from the implicit infrastructure established by 01-01..01-18 (Coolify, Supabase Pro eu-west-1, Better Auth, Upstash, Logflare, Resend-as-no-op).
- **Files modified:** `docs/deployment.md` (created)
- **Verification:** All Task 2 automated grep checks pass (`Phase 2 additions`, `SUPABASE_SERVICE_ROLE_KEY`, `CLAMAV_HOST`, `clamav/clamav:stable`, `freshclam`, `5mb`).
- **Committed in:** `6080dbc` (Task 2 commit)

**2. [Rule 1 - Bug] Aligned Caddy `5mb` casing across both docs**

- **Found during:** Task 2 verify step
- **Issue:** Task 1's file-upload-pipeline.md used `5MB` (uppercase) in the Caddy snippet; the deployment doc plan grep was case-sensitive on lowercase `5mb`. Two inconsistent strings for the same Caddy config would mislead operators copy-pasting from either source.
- **Fix:** Edited both docs to use `5mb` (lowercase) — matches Caddy convention + plan grep.
- **Files modified:** `docs/file-upload-pipeline.md`, `docs/deployment.md`
- **Verification:** `grep "5mb"` matches in both docs; `grep "5MB"` returns 0.
- **Committed in:** `6080dbc` (Task 2 commit — folded the file-upload-pipeline edit into the Task 2 commit as a consistency follow-up)

---

**Total deviations:** 2 auto-fixed (1 missing critical baseline doc, 1 case-consistency bug)
**Impact on plan:** Both deviations strengthen the deliverables: the Phase 1 baseline makes deployment.md operationally useful from day one; the 5mb consistency prevents an operator copy-paste mismatch. No scope creep — Phase 1 baseline section is short and only documents what already exists from 01-01..01-18.

## Issues Encountered

- The plan's path under `<files_to_read>` pointed at `.planning/phases/02-identiteit-bestanden/02-16-deployment-docs-PLAN.md` inside the worktree, but the plan file lives in the parent repo as an untracked file (worktree HEAD = `7fc9deb`, which predates the Phase 2 plans). Resolved by reading from the main repo path (`/Users/kris/Documents/Claude Code/VTTL Topsport/.planning/phases/02-identiteit-bestanden/02-16-deployment-docs-PLAN.md`); no impact on output.

## TODOs deferred to Phase 8 (explicitly called out in the docs)

The plan's output section asked for an explicit list of Phase 8 follow-ups. These are documented in `docs/file-upload-pipeline.md` §Phase 8 cron sweeps with full SQL:

1. **`recompute_player_minor_flags()` cron** (BLOCKER-10) — nightly at 02:00 Europe/Brussels. Recomputes `players.is_minor` for players whose 16th birthday has passed. SQL ready; not implemented in Phase 2.
2. **Orphan upload sweep** (WARNING-08) — daily at 03:00. Hard-deletes `uploaded_files` rows with `scan_status='pending'` older than 5 min that have no matching `storage.objects` row.
3. **Stuck-scan reporting query** — informational only; lists `uploaded_files` rows still in `pending` after 30 min. Operator decides whether to mark `error` or re-enqueue.
4. **Body-size cap revisit for Phase 5 medical PDFs** — when 5 MB raw medical PDFs ship (base64 ≈ 6.66 MB), update Zod cap, Caddy `max_size`, and SEC-08 rate-limit in the same PR.
5. **Transactional email reactivation (v2 spike)** — re-enable Resend, ship DPA + EU region + SPF/DKIM/DMARC, with consent-text legal review per locale complete.

## Self-Check: PASSED

- [x] `docs/file-upload-pipeline.md` exists — `[ -f ... ] && echo FOUND` returns FOUND
- [x] `docs/deployment.md` exists — `[ -f ... ] && echo FOUND` returns FOUND
- [x] Commit `686f675` exists — verified with `git log --oneline`
- [x] Commit `6080dbc` exists — verified with `git log --oneline`
- [x] All Task 1 plan-verify regexes match (ClamAV ×10, MIME_BY_BUCKET ×3, EICAR ×12, freshclam ×5, Pitfall 3 ×1, service-role key ×5, malware-scan ×3)
- [x] All Task 2 plan-verify regexes match (Phase 2 additions ×2, SUPABASE_SERVICE_ROLE_KEY ×5, CLAMAV_HOST ×5, clamav/clamav:stable ×3, freshclam ×6, 5mb ×2)
- [x] BLOCKER-04 honored: no Pages-Router `bodyParser` config snippet anywhere; layered model documented in both docs.
- [x] BLOCKER-10 honored: recompute_player_minor_flags() SQL fully documented in file-upload-pipeline.md §Phase 8 cron sweeps.
- [x] WARNING-15 honored: service-role rotation + DIRECT_DATABASE_URL revocation + mark_scan_result post-rotation smoke in both docs.
- [x] Region eu-west-1 (Dublin) documented; PROJECT.md eu-central-1 explicitly noted as superseded.
- [x] v1 no-email decision documented in both docs with `RESEND_API_KEY=re_dev_disabled` literal.
- [x] FILE-02 + FILE-05 scoped to Phase 5 explicitly; Phase 2 magic-bytes registry covers `profiles` only.

## Next Phase Readiness

- Phase 2 is doc-complete. Operators have a single-page reference for the file pipeline and a single-page deployment runbook with explicit Phase 2 sidecar config.
- Phase 8 cron sweep migrations now have a published spec — the SQL in `docs/file-upload-pipeline.md` §Phase 8 cron sweeps is ready to be lifted into a `drizzle/00XX_phase8_cron_sweeps.sql` migration when Phase 8 lands.
- Phase 5 (Medical + Evaluations) will append a `## Phase 5 additions` block to `docs/deployment.md` following the Phase 2 template (env vars table → bucket bootstrap → smoke tests → rollback).
- Phase 3 (Calendar) is unblocked: no new runtime infrastructure expected, so the deployment doc stays at Phase 2 baseline.
- The v1 no-email decision is now durable: it lives in two operator-facing docs + STATE/PROJECT layers will pick it up via this SUMMARY.

---

*Phase: 02-identiteit-bestanden*
*Plan: 16*
*Completed: 2026-05-13*
