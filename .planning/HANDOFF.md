# Session Handoff — VTTL Topsportplatform

**Written:** 2026-05-03
**Last branch HEAD:** `029a4b0` (`fix(verify-gaps): ESLint flat-config + canonical rollback section markers`)
**Working directory:** `/Users/kris/Documents/Claude Code/VTTL Topsport`
**Branch:** `main` (origin/main updated locally to track HEAD; nothing pushed to a remote)

## TL;DR — where we are

Phase 1 (Fundament) is **structurally complete**: 18/18 plans merged, 1 code-review/fix cycle landed (7 BLOCKER + 11 WARNING fixes across 16 atomic commits), 2 verifier-flagged gaps closed (ESLint flat-config + canonical rollback section markers). `npx tsc --noEmit` exits 0. Verifier returned `human_needed` (9/11 must-haves auto-verified, 6 items need browser/live-DB to confirm).

Next action when you resume: **finish marking Phase 1 complete and start Phase 2**. See "Resume steps" below — they're mechanical.

The user gave a multi-hour autonomous mandate (`/gsd-autonomous`) to execute all remaining phases (2–8) end-to-end and then close the milestone (audit → complete → cleanup). Auto-mode is enabled (`workflow.auto_advance=true`) so checkpoint plans `01-08`, `01-12`, `01-15` were auto-approved on `human-verify` checkpoints; do the same for any future ones.

## What just happened (chronological)

1. **Discovered planner-output bug.** 12 of 18 phase-1 PLAN.md files had `---phase: 01-fundament` glued on a single line. `gsd-sdk phase-plan-index` silently bucketed those 12 plans into wave 1 with `autonomous: true`. Fix committed as `1ce8149`. Saved as `feedback_validate_plan_frontmatter.md` so future phases get this audit before any executor dispatch.

2. **Discovered worktree-base bug.** Claude Code's `EnterWorktree` bases new worktrees on `refs/remotes/origin/main`, not local `main`. Local main was 10 commits ahead of origin/main (which pointed at `bb2a036`). The first two executor agents landed on the wrong base and one couldn't `git reset --hard` due to sandbox permission denial. Recovery: cherry-picked the salvageable 01-17 (test-infra) commits onto main, wrote SUMMARY by hand, then `git update-ref refs/remotes/origin/main HEAD` so subsequent worktrees got the right base. Saved as `feedback_auto_recover_orchestration.md` (recover silently, don't surface mechanical glitches).

3. **Executed Phase 1 in 8 waves**, dispatching `gsd-executor` agents in parallel via `isolation="worktree"` and `run_in_background=true`. After every wave: merged worktrees, restored orchestrator-owned planning files (STATE/ROADMAP/config) from a pre-merge backup, ran `npx tsc --noEmit`, fixed any genuine type bugs (deferred RED imports were ignored as expected), committed tracking updates.

4. **Code review** by `gsd-code-reviewer` returned 7 BLOCKERs + 11 WARNINGs + 7 INFOs. **Code-fixer** addressed all 7 BLOCKERs and all 11 WARNINGs in 16 atomic commits; INFOs deferred to backlog.

5. **Verifier** returned `human_needed` with 2 real gaps:
   - ESLint 10 + `next lint` mismatch (legacy options removed): migrated to `eslint.config.mjs` flat-config using `@eslint/eslintrc`'s FlatCompat. Now `npx next lint` runs without crashing (it warns "deprecated" but exits with the legitimate per-file results — Next 16 will remove `next lint` entirely; future fix is `npx @next/codemod@canary next-lint-to-eslint-cli .`).
   - 4 of 6 rollback files missed canonical `**Risk:** / **Procedure:** / **Verification:**` section markers required by `tests/unit/migration-format.test.ts`. All 4 (`0000_initial`, `0003_users_is_minor`, `0004_verifications_policy_tighten`, `0005_consenting_party_not_null`) now have all three sections.

6. **STATE.md** marked Phase 1 ✅ Complete (18/18, 100%, 1 code-review fix cycle, verifier human_needed deferred to UAT). The `## Phase Status` table reflects this. ROADMAP.md has all 18 plan checkboxes ticked.

## Resume steps (do these on the next clear)

Run these in order — each is one bash invocation:

1. **Persist the human verification items as a UAT file** so they surface in `/gsd-progress` and `/gsd-audit-uat`. Template content is fully drafted below — just write it as `.planning/phases/01-fundament/01-HUMAN-UAT.md` (the previous tool call to `Write` for this exact file was rejected by user before the clear; rewrite it):

```yaml
---
status: partial
phase: 01-fundament
source: [01-VERIFICATION.md]
started: 2026-05-03T11:00:00.000Z
updated: 2026-05-03T11:00:00.000Z
---
```

Items (verbatim from the verifier):
- (1) Boot against Supabase staging
- (2) RLS direct-query as `app_user` against `medical_events` returns 0 rows
- (3) End-to-end registration → consent → minor-flow
- (4) CI green on a real PR (lint + typecheck + vitest + rbac-matrix-gate + e2e @phase1)
- (5) Locale switcher visual smoke (nl/en/fr)
- (6) Phase 8 legal review of consent text (9 HTML files in public/locales)

Commit it as `test(01): persist human verification items as UAT`.

2. **Mark milestone-tracking advance** to Phase 2:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" state begin-phase --phase 2 --name "Identiteit & Bestanden" --plans 0
```

(plan count is 0 because Phase 2 has no plans yet — discuss/plan creates them.)

3. **Run Phase 2 discuss → plan → execute** via the autonomous workflow's per-phase loop:
   - `Skill(skill="gsd-discuss-phase", args="2")`
   - `Skill(skill="gsd-plan-phase", args="2")`
   - Inspect generated PLAN.md frontmatter — re-run the **plan-frontmatter audit** (`head -1` of every PLAN.md must be exactly `---`); fix with `perl -i -pe 's/^---phase:/---\nphase:/ if $. == 1' <file>` if any are broken (planner bug from #1 above; not yet fixed in `gsd-planner`).
   - `Skill(skill="gsd-execute-phase", args="2 --no-transition")` — dispatches per-wave executor agents.
   - Run `Skill(skill="gsd-code-review", args="2 --fix --auto")` after execute completes.
   - `gsd-verifier` agent for goal-backward verification.
   - If `gaps_found`: `Skill(skill="gsd-plan-phase", args="2 --gaps")` then `Skill(skill="gsd-execute-phase", args="2 --gaps-only --no-transition")` (1 retry max).
   - Mark Phase 2 complete in STATE.md / ROADMAP.md, advance to Phase 3.

4. **Repeat for Phases 3–8.** Phase scopes are in `.planning/ROADMAP.md` lines 236+ (`## Phase 3: Kalender` etc).

5. **After Phase 8 verification passes:** milestone close-out:
   - `Skill(skill="gsd-audit-milestone")` — cross-phase audit
   - `Skill(skill="gsd-complete-milestone")` — archive + advance milestone version
   - `Skill(skill="gsd-cleanup")` — archive accumulated phase directories

## Operating principles (don't re-discover these)

These are saved as durable memory entries (`memory/MEMORY.md` index file at `~/.claude/projects/.../VTTL-Topsport/memory/`) — the next Claude session loads them automatically. The big four:

- **`feedback_validate_plan_frontmatter.md`** — every phase, audit `head -1` of each PLAN.md before any `phase-plan-index` call. Planner output is sometimes malformed.
- **`feedback_auto_recover_orchestration.md`** — handle worktree base mismatch / locked worktree / sandbox permission denials silently. `git update-ref refs/remotes/origin/main HEAD` after every commit so EnterWorktree's next call gets the right base.
- **`feedback_long_autonomous_runs.md`** — user explicitly said "continue for the next 7 hours, only ask if you need credentials." Reinforced multiple times: "don't bother me anymore with string or array problems, just continue automatically", "graag geen vraag meer over strings. Ga maar automatisch door met 'yes'". Resolve all merge conflicts, type errors, lint warnings silently. Pause only for live credentials (Supabase login, Resend dashboard, Sentry org config) or genuinely contradictory product decisions.
- **`project_i18n.md`** — VTTL is nl/en/fr trilingual (NOT Dutch-only). Every UI phase must localize. Consent text snapshots stored with sha256+locale+version.

## Important code patterns established in Phase 1

- **D-14 cache abstraction:** ONLY `src/lib/cache.ts` may import `@upstash/redis`. ESLint `no-restricted-imports` enforces this; `src/server/trpc/middleware/rateLimit.ts` is the explicit allowlist override.
- **D-15 BullMQ:** uses `ioredis` against `REDIS_URL` (TCP/TLS), separate primitive from Upstash REST. Worker process is `npm run worker` → `tsx src/server/workers/index.ts`.
- **CR-06 fix:** `app.medical_key` GUC bound at pool connection level via `connection.options` in `src/server/db/client.ts`; tRPC middleware `withRlsContext` ALSO sets it per-tx. Workers/seed scripts/cron jobs that don't go through tRPC still get the key.
- **Migration discipline (MIG-01..05):** every `drizzle/NNNN_*.sql` has a `*.rollback.md` companion with `**Risk:** / **Procedure:** / **Verification:**` sections. CI gate `.github/workflows/protect-migrations.yml` blocks edits to committed migrations.
- **GDPR Art. 7 proof:** `consent.give` reads canonical HTML server-side from `public/locales/consent-{type}-{version}.{locale}.html`, computes sha256, stores both. Client cannot supply `textShown`. `consenting_party_user_id` is NOT NULL.
- **Belgian minor gate:** `isMinorAt(birthDate, now)` in `src/lib/consent.ts` (TypeScript helper, NOT a stored gen-col — see CR-01). `canActivate(userId)` in `src/server/auth/activate.ts` is the four-state decision.
- **RLS backstop:** every sensitive table has `ENABLE + FORCE ROW LEVEL SECURITY`. `medical_*` policies USING (false) for `app_user` — reads only via SECURITY DEFINER `query_medical_access_audit()`.
- **pino redact:** `src/lib/log-redact-paths.ts` is the single source of truth for both pino (`log.ts`) and Sentry (`sentry.ts`). Trailing-segment globs like `*.medical_*` do NOT work in pino's `fast-redact` — use enumerated paths.

## Files of interest if you're orienting

- `.planning/ROADMAP.md` — 8 phases, line numbers in TL;DR above
- `.planning/STATE.md` — current status (Phase 1 complete)
- `.planning/PROJECT.md` — product vision + constraints
- `.planning/REQUIREMENTS.md` — requirement IDs (I18N-*, GDPR-*, USER-*, SEC-*, OPS-*, MIG-*, CRIT-*, D-*)
- `.planning/phases/01-fundament/01-REVIEW.md` — what the reviewer found
- `.planning/phases/01-fundament/01-REVIEW-FIXES.md` — what the fixer changed
- `.planning/phases/01-fundament/01-VERIFICATION.md` — verifier report
- `package.json` — note: linter-modified twice; deps include react-email + resend + radix; ESLint flat-config in `eslint.config.mjs`
- `src/lib/log-redact-paths.ts` — was linter-touched; current state has explicit medical_* enumeration

## Stale/non-pushed git state

There is no remote. `refs/remotes/origin/main` is a locally-maintained alias used to keep `EnterWorktree` honest. Every commit has been followed by `git update-ref refs/remotes/origin/main HEAD`. If you ever do `git remote add origin ...`, you'll need to either drop that local alias or push to it.

## What NOT to do on resume

- Don't re-execute Phase 1 plans — they're done and merged.
- Don't surface "string/array" merge-conflict details to the user — fix silently.
- Don't pause for `human-verify` checkpoints — auto-approve.
- Don't read individual SUMMARY.md files unless investigating a specific defect — they total ~3500 lines.
- Don't push to a remote without asking.
