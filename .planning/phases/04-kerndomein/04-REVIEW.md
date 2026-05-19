---
phase: 04-kerndomein
reviewed: 2026-05-19T09:30:00Z
depth: standard
files_reviewed: 88
files_reviewed_list:
  - drizzle/0014_phase4_session_participants_and_sparring_junction.sql
  - drizzle/0015_phase4_tournament_results_and_match_results.sql
  - drizzle/0016_phase4_rankings_and_belgium_classification.sql
  - drizzle/0017_phase4_lookup_seeds.sql
  - drizzle/0018_phase4_rls_helpers_and_sparring_branch.sql
  - drizzle/0019_phase4_pg_cron_nudges.sql
  - drizzle/0020_phase4_system_inbox.sql
  - messages/en.json
  - messages/fr.json
  - messages/nl.json
  - next.config.ts
  - package.json
  - src/app/[locale]/(app)/dashboard/page.tsx
  - src/app/[locale]/(app)/players/[playerId]/rankings/page.tsx
  - src/app/[locale]/(app)/tournaments/[eventId]/page.tsx
  - src/app/[locale]/(app)/tournaments/[eventId]/result/page.tsx
  - src/app/[locale]/(app)/tournaments/new/page.tsx
  - src/app/[locale]/(app)/tournaments/page.tsx
  - src/app/[locale]/(app)/trainings/[eventId]/score/page.tsx
  - src/app/[locale]/globals.css
  - src/components/calendar/event-chip.tsx
  - src/components/calendar/event-detail-sheet.tsx
  - src/components/calendar/rrule-scope-picker-dialog.tsx
  - src/components/common/multi-day-picker.tsx
  - src/components/common/rrule-editor.tsx
  - src/components/common/star-rating-input.tsx
  - src/components/inbox/mark-inbox-row-read-button.tsx
  - src/components/inbox/minimal-system-inbox.tsx
  - src/components/nudge/nudge-banner-stack.tsx
  - src/components/nudge/nudge-banner.tsx
  - src/components/ranking/belgium-timeline-strip.tsx
  - src/components/ranking/new-ranking-entry-sheet.tsx
  - src/components/ranking/range-pill-selector.tsx
  - src/components/ranking/ranking-entries-table.tsx
  - src/components/ranking/ranking-line-chart.tsx
  - src/components/ranking/ranking-type-selector.tsx
  - src/components/ranking/rankings-tab.tsx
  - src/components/tournament/derived-won-lost-indicator.tsx
  - src/components/tournament/match-results-table.tsx
  - src/components/tournament/my-tournament-result-pending-widget.tsx
  - src/components/tournament/set-tally-input.tsx
  - src/components/tournament/tournament-create-form.tsx
  - src/components/tournament/tournament-filter-bar.tsx
  - src/components/tournament/tournament-list.tsx
  - src/components/tournament/tournament-participants-panel.tsx
  - src/components/tournament/tournament-result-entry-form.tsx
  - src/components/tournament/tournament-results-leaderboard.tsx
  - src/components/tournament/tournament-results-read-view.tsx
  - src/components/training/attendance-toggle.tsx
  - src/components/training/bulk-attendance-score-form.tsx
  - src/components/training/feedback-textarea.tsx
  - src/components/training/te-scoren-overview.tsx
  - src/components/ui/progress.tsx
  - src/components/ui/table.tsx
  - src/lib/match-result.ts
  - src/lib/quality-score.ts
  - src/lib/rrule.ts
  - src/lib/tournament-result.ts
  - src/server/db/schema/inbox.ts
  - src/server/db/schema/index.ts
  - src/server/db/schema/lookups.ts
  - src/server/db/schema/ranking.ts
  - src/server/db/schema/tournament.ts
  - src/server/db/schema/training.ts
  - src/server/trpc/middleware/freshSession.ts
  - src/server/trpc/middleware/idempotency.ts
  - src/server/trpc/routers/_app.ts
  - src/server/trpc/routers/calendar.ts
  - src/server/trpc/routers/inbox.ts
  - src/server/trpc/routers/ranking.ts
  - src/server/trpc/routers/tournament.ts
  - src/server/trpc/routers/training.ts
  - src/server/trpc/schemas/calendar.ts
  - src/server/trpc/schemas/inbox.ts
  - src/server/trpc/schemas/ranking.ts
  - src/server/trpc/schemas/tournament.ts
  - src/server/trpc/schemas/training.ts
findings:
  critical: 9
  warning: 14
  info: 7
  total: 30
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-19T09:30:00Z
**Depth:** standard
**Files Reviewed:** 88 source files (excluding tests, planning artifacts, generated files)
**Status:** issues_found

## Summary

Phase 4 ships a substantial domain layer — 7 Drizzle migrations, 5 tRPC routers, idempotency middleware, and 38 components — and the structural skeleton is solid: RBAC presets compose cleanly, RLS helpers follow the Phase 1+3 pattern, audit codes are namespaced per domain, and the split-column XOR + DB CHECK constraints look correct. **However**, the review surfaces nine concrete BLOCKERs that touch the most sensitive Phase 4 invariants:

1. **The "denied-outcome audit" pattern is fundamentally broken.** Every `writeAudit(..., outcome: 'denied')` call in tournament/training/calendar routers runs inside the RLS-bound transaction; throwing TRPCError immediately afterward rolls the audit row back. The forensic-visibility property claimed in the threat-mitigation comments (T-04-19, "wall rejection writes outcome='denied' audit row BEFORE throwing the TRPCError — observable in GDPR Article 30 feed") is NOT delivered. This is the single highest-impact defect in the phase.

2. **Idempotency middleware does not bind to input.** The cache key is `(key, userId, endpoint)` with no input hash. A client can send the same `_meta.idempotencyKey` with DIFFERENT inputs within 24 h and receive the cached response of the first call — a correctness break that also enables targeted replay attacks. The schema declares a `responseHash` column for exactly this purpose; the middleware always writes `null`.

3. **`tournament.enterResult` returns the wrong player's data when accessed via the entry route by non-player roles.** `result/page.tsx` line 65 picks `existing?.results[0]?.playerUserId` as the default target — arbitrary first-by-enteredAt — so a TD navigating to a tournament's `/result` page is silently positioned to overwrite some other player's result instead of entering one for the intended player. The page accepts no `?playerId=` parameter.

4. **`tournament.listPendingForPlayer` lacks the role-gate documented in its docstring.** The docstring says "Other roles → FORBIDDEN" but the handler only rejects the player-cross-target case. A `medical_staff`, `sparring_partner`, or anonymous-extra role can pass `playerUserId` and probe; while RLS scopes the rows returned, the absence of the gate violates the procedure's own contract and increases enumeration surface.

5. **Past-data immutability (D-83) is bypassable through `editRecurring(scope: 'all_in_series')`.** The past-occurrence guard (`splitIso < todayIso`) is implemented only in the `'single'` and `'this_and_future'` branches. The `'all_in_series'` branch UPDATEs the base calendar_events row's `startsAt` / `endsAt` / `rrule` with no check, breaking the conceptual anchor of historical session_participants rows.

6. **`system_inbox` INSERTs from `run_daily_*` SECURITY DEFINER cron functions are not granted INSERT permission.** The table has `FORCE ROW LEVEL SECURITY` and migration 0020 declares NO INSERT policy. Comment hand-waves that "the SECURITY DEFINER cron functions … deposit rows by virtue of running as the function-owner role (which bypasses RLS or is granted explicit privileges depending on hosting tier)" — but `FORCE RLS` applies even to the owner, and no explicit `GRANT INSERT` or INSERT policy exists. The daily nudge channels (D-67 ch2, D-72 ch2) will silently fail to materialize inbox rows on most managed Postgres tiers.

7. **`system_inbox` has no anti-duplicate constraint.** Daily cron re-runs the predicate every day; a trainer with one unscored session on day 1 gets a new row on day 1, day 2, day 3, … until they score. There is no `UNIQUE (user_id, kind, generated_date)` constraint and no `WHERE NOT EXISTS` guard in the SECURITY DEFINER functions. 14 stacked nudges per trainer per session is the worst case; even at the median this floods the inbox.

8. **Multiple components use `dangerouslySetInnerHTML` to render i18n strings that contain markdown-style `**bold**` markers.** The catalogs include `**Let op:**`, `** dagen**`, etc. — markdown syntax that does NOT render as `<strong>` in HTML. The user sees literal asterisks AND any future i18n change introducing real HTML would render unsanitized (XSS vector if catalog files are ever loaded from a less-trusted source). The Phase 3 `conflict-banner.tsx` already established the safer JSX-split pattern; Phase 4 should follow it.

9. **`getAgeCategoryAt` uses UTC date slicing.** The DOM-CAT-02 snapshot derives age category at `tournament.startsAt`. The helper slices the date via `.toISOString().slice(0, 10)` which produces UTC dates. A tournament starting at 2026-01-01 02:00 Brussels (= 2025-12-31 23:00 UTC) snapshots the wrong year for the age-category lookup. Phase 4 rrule.ts already implements Brussels-anchored formatting (`formatOccurrenceDate`); the players helper does not use it.

The 14 WARNINGs are correctness-leaning quality defects — broken progress-bar formulas, raw UUIDs displayed instead of names, hardcoded Dutch labels in routes that should be i18n'd, savepoint vs outer-tx confusion in the audit-before-delete pattern, and several less-critical UTC-vs-Brussels date inconsistencies. The 7 INFO items are minor (raw lookup codes shown to users instead of i18n labels, dead-code paths, etc.).

## Critical Issues

### CR-01: Denied-outcome audit rows are rolled back with the failing transaction

**File:** `src/server/trpc/routers/training.ts:170-184`, `src/server/trpc/routers/tournament.ts:600-617`, `src/server/trpc/routers/calendar.ts:1738-1749`, `1822-1833`

**Issue:**
Every protected procedure runs inside the `withRlsContext` Drizzle transaction (`src/server/trpc/middleware/rls.ts:47`). When the handler throws `TRPCError`, Drizzle rolls the whole transaction back — including any `writeAudit(ctx, { outcome: 'denied' })` rows inserted before the throw, because `writeAudit` uses `ctx.db` (the open tx handle, see `src/server/trpc/middleware/audit.ts:84`).

Three call sites are affected:

1. `training.markAttendanceAndScore` — `training_score_window_expired_attempt` (line 170-179) → rolled back.
2. `tournament.enterResult` — `tournament_entry_window_expired_attempt` (line 602-612) → rolled back.
3. `calendar.event.editRecurring` (single + this_and_future) — `calendar_event_*` with `outcome: 'denied'` (lines 1738, 1822) → rolled back.

The forensic-visibility property claimed by the inline comments (`"forensically visible even if the TRPCError throw is later wrapped or swallowed"`) is **NOT** delivered. After a denied attempt the audit_log table is empty for that request.

`auditMiddleware` in `audit.ts:136-158` already handles this correctly by stripping `ctx.db` from the context on the rejection path. The explicit per-handler `writeAudit(..., 'denied')` calls need the same treatment.

**Fix:**
Use a stripped audit context that falls back to `rawDb`, as the generic auditMiddleware does:

```typescript
// shared helper at the top of audit.ts
export async function writeAuditOutsideTx(
  ctx: AuditContext,
  entry: AuditEntry,
): Promise<void> {
  await writeAudit(
    {
      scope: ctx.scope ? { userId: ctx.scope.userId } : null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      // db deliberately stripped — writeAudit falls back to rawDb
    },
    entry,
  );
}

// usage in routers — before any wall-expired throw:
await writeAuditOutsideTx(ctx, {
  action: 'training_score_window_expired_attempt',
  resourceType: 'calendar_event',
  resourceId: input.eventId,
  newValues: { /* … */ },
  outcome: 'denied',
});
```

This requires the audit_log RLS INSERT policy to be `WITH CHECK (true)` (already the case per the comment in audit.ts:127-134). Verify the policy after the change.

### CR-02: Idempotency middleware ignores input — cached response can mismatch new input

**File:** `src/server/trpc/middleware/idempotency.ts:77-92`, `131-151`

**Issue:**
The cache lookup matches on `(key, userId, endpoint)` with `gt(expiresAt, now)`. There is no comparison of the request input. A client can:

1. POST `tournament.enterResult` with `_meta.idempotencyKey = "abc-123"` and `outcome = "outcome_winner"`.
2. Within 24 h, POST `tournament.enterResult` with `_meta.idempotencyKey = "abc-123"` and `outcome = "outcome_last_64"` — and receive the cached response for the FIRST call.

The schema already declares `response_hash` (`src/server/db/schema/idempotency.ts`) precisely so the second request can verify it is replaying the SAME logical write, but the middleware writes `responseHash: null` on every insert (line 145) and never reads it back.

This is both a correctness bug (the second logical operation never runs) and a soft security finding (a player who learned a TD's idempotency key from logs could replay the TD's response to a different write attempt).

**Fix:**
Hash the raw input alongside the key. On cache hit, verify the request's input hash matches the stored `response_hash` (or rename to `request_hash`); on mismatch, treat as cache miss and overwrite the cached entry (or reject with `CONFLICT` if a strict-idempotency contract is preferred):

```typescript
import { createHash } from 'node:crypto';

// Stable JSON serialise the raw input (sorted keys) and hash.
const inputHash = createHash('sha256')
  .update(JSON.stringify(canonicaliseJson(raw)))
  .digest('hex');

// cache lookup adds:
//   eq(idempotencyKeys.responseHash, inputHash)
// insert writes responseHash: inputHash.
```

(Or, more conservative: rename the column to `request_hash`, leave `response_hash` for v2 response-tamper detection.)

### CR-03: `result/page.tsx` defaults non-player callers to an arbitrary other player's result

**File:** `src/app/[locale]/(app)/tournaments/[eventId]/result/page.tsx:65`

**Issue:**
```typescript
const targetPlayerId = isPlayer
  ? callerId
  : (existing?.results[0]?.playerUserId ?? callerId);
```

For TD or trainer callers, `targetPlayerId` is whichever player's result was entered FIRST in the tournament (the router orders results by `enteredAt` ASC). Subsequent code (line 89: `isOverwrite = isTd && Boolean(playerResult)`) flags the form as an "overwrite" and pre-populates with that player's data.

Consequences:
- TD intending to enter a new result for a not-yet-entered player accidentally overwrites the first player's result.
- TD intending to correct player B's result lands on player A's data, may submit, and silently corrupts player A.
- No `?playerId=` query parameter is read; there is no path to target a specific player from this route.

This is a data-integrity-class bug that the audit_log will record correctly (so D-75 forensic recovery via JSONB snapshot mitigates the damage) — but the bug WILL trigger in the field unless the UI route is fixed.

**Fix:**
Accept `?playerId=` and require it for non-player callers; render a player-selector if absent. Minimal patch:

```typescript
interface PageProps {
  params: Promise<{ locale: string; eventId: string }>;
  searchParams: Promise<{ mode?: string; playerId?: string }>;
}

// after reading sp:
const requestedPlayerId = sp.playerId;
const targetPlayerId = isPlayer
  ? callerId
  : requestedPlayerId ?? null;

if (!targetPlayerId) {
  // Render a small "Pick a player" UI sourced from tournament.get
  // participantCount + list (or redirect back to detail).
  return <PickPlayerForResult tournamentEventId={eventId} locale={locale} />;
}
```

Also gate the navigation links from `tournament-results-leaderboard.tsx` / `tournament-participants-panel.tsx` to include the `playerId` query string.

### CR-04: `tournament.listPendingForPlayer` is missing the role allowlist documented in its docstring

**File:** `src/server/trpc/routers/tournament.ts:858-872`

**Issue:**
The docstring (line 856-857) states: "RBAC: role=player can only query own pending. trainer/TD/parent can pass an explicit playerUserId override. Other roles → FORBIDDEN."

The handler only rejects the `(role === 'player' && targetPlayerId !== callerId)` case. There is no `else if (!['trainer','technical_director','parent'].includes(callerRole))` rejection. So a `medical_staff`, `sparring_partner`, or `academy_manager` user can call this procedure with any `playerUserId`. RLS on `tournament_results` will narrow the LEFT JOIN result, but the pending-tournament list (tournaments where no result exists) will be visible to any role that can see the parent calendar event — including roles the docstring intends to exclude.

The role check is also tactical for nudge-banner consistency: the nudge banner only renders for player or trainer/TD roles; allowing other roles to call the underlying query is needless surface.

**Fix:**
Add the missing else branch:

```typescript
if (callerRole === 'player' && targetPlayerId !== callerId) {
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'errors.tournament.notOwnPlayer',
  });
}
if (
  callerRole !== 'player' &&
  callerRole !== 'trainer' &&
  callerRole !== 'technical_director' &&
  callerRole !== 'parent'
) {
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'role_not_allowed',
  });
}
```

For the `parent` branch, also verify the targetPlayerId is a child of the calling parent (otherwise a parent can query any player), via a SQL probe of `parent_child_links` mirroring the trainer-academy probe in `enterResult` (lines 619-641).

### CR-05: `editRecurring` `'all_in_series'` scope bypasses the past-data immutability guard

**File:** `src/server/trpc/routers/calendar.ts:2019-2113`

**Issue:**
D-83 specifies past data is immutable for ALL three scopes. The handler implements the `splitIso < todayIso` past-occurrence guard inline at lines 1733-1749 (`'single'`) and lines 1820-1833 (`'this_and_future'`), but the `'all_in_series'` branch (lines 2019-2113) has NO past-data check. The handler will happily:

- UPDATE `calendar_events.startsAt` / `.endsAt` to dates in the past
- Replace the RRULE so the new expansion no longer matches historical `session_participants.occurrence_date` values

The trailing comment (line 2075-2078) claims "session_participants UNTOUCHED" — this is true only of the `session_participants` rows themselves. The calendar_events row's startsAt is the conceptual anchor for past occurrences; mutating it conceptually orphans the rows.

The Zod refinement (`schemas/calendar.ts:423-431`) only checks `endsAt > startsAt`, not that the values are not in the past.

**Fix:**
Add a refinement to `editRecurringEditsSchema` rejecting past startsAt, OR a runtime check in the `'all_in_series'` branch:

```typescript
if (input.scope === 'all_in_series') {
  if (input.edits.startsAt) {
    const newIso = formatOccurrenceDate(input.edits.startsAt);
    const todayIso = formatOccurrenceDate(new Date());
    if (newIso < todayIso) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'errors.calendar.cannotMoveSeriesToPast',
      });
    }
  }
  // …existing logic
}
```

i18n key `errors.calendar.cannotMoveSeriesToPast` (or reuse a generic past-immutable key) must be added to all three locale catalogs.

### CR-06: `run_daily_*` pg_cron functions INSERT into a FORCE-RLS table without an INSERT policy

**File:** `drizzle/0019_phase4_pg_cron_nudges.sql:40-55`, `80-98`, `drizzle/0020_phase4_system_inbox.sql:39-58`

**Issue:**
`system_inbox` has `FORCE ROW LEVEL SECURITY`. `FORCE` applies RLS to the table OWNER as well — not just to `app_user`. Migration 0020 declares only SELECT (`system_inbox_select_own`) and UPDATE (`system_inbox_update_own`) policies. There is NO INSERT policy.

`run_daily_trainer_score_nudge` and `run_daily_player_tournament_result_nudge` are declared `SECURITY DEFINER`. The function runs as the role that ran `CREATE OR REPLACE FUNCTION` (usually a privileged migration role like `postgres` or `supabase_admin`). On most managed Postgres environments:

- Coolify self-hosted: the migration runs as the deploy-time role (often a superuser); INSERT might succeed.
- Supabase / Neon: the migration role is a non-superuser owner (e.g., `postgres` in Supabase shared tier); with `FORCE RLS` the owner IS subject to RLS, INSERT will fail.
- Hetzner managed PG / RDS: depends on tier.

The comment in 0020 line 54-58 acknowledges this ambiguity ("bypasses RLS or is granted explicit privileges depending on hosting tier") and defers the fix. But the deferred fix means nightly nudges silently NEVER fire on at least one supported hosting target (Supabase, the platform's stack-recommended fallback) — degrading D-67 ch2 and D-72 ch2 to no-ops.

The Brussels-DST guard in the function body also won't trigger this failure observably because the failed INSERT raises an exception that pg_cron logs to `cron.job_run_details` but never to the application — silent failure.

**Fix:**
Add an explicit INSERT policy that allows the function role:

```sql
-- In 0020, after the SELECT/UPDATE policies:
CREATE POLICY "system_inbox_insert_security_definer"
  ON "system_inbox" FOR INSERT
  WITH CHECK (true);  -- Trusted: only writeable from SECURITY DEFINER functions
                      -- (no app_user GRANT INSERT on this table).
```

AND explicitly `REVOKE INSERT, UPDATE, DELETE ON system_inbox FROM app_user`. Combined, this restricts INSERT to roles WITH explicit grants while still allowing the SECURITY DEFINER function to write.

Alternative: drop `FORCE` and rely on `ENABLE ROW LEVEL SECURITY` only — then SECURITY DEFINER (as owner) bypasses RLS. But this is a weaker invariant; the explicit policy is better.

### CR-07: `system_inbox` has no anti-duplicate constraint — daily cron stacks rows

**File:** `drizzle/0019_phase4_pg_cron_nudges.sql:40-55`, `80-98`, `drizzle/0020_phase4_system_inbox.sql:21-30`

**Issue:**
The two cron functions `INSERT INTO system_inbox (user_id, kind, payload)` unconditionally. The functions group by `trainer_id` / `cep.user_id` so each daily run produces at most one row per affected user. But each subsequent day's run produces ANOTHER row for the same user — the function doesn't `LEFT JOIN system_inbox` to skip users who already have an unread row of the same kind from the last N days.

Effect: a trainer with 1 unscored session and no inbox-checking habit accumulates 14 unread inbox rows (one per day until the 14d wall expires). The "minimal inbox" UI (Plan 04-07) lists every row chronologically; this becomes wall-of-text fatigue and undermines the nudge design.

Worse: if a trainer scores ON day 5 and the inbox-row count returned by `pg_cron` falls to 0 on day 6, the FIVE prior unread rows persist and the trainer marking them read becomes busywork.

**Fix:**
Either (a) add a unique constraint and use `ON CONFLICT DO NOTHING`, or (b) `LEFT JOIN` the recent inbox in the SELECT:

```sql
-- Option a: in 0020, add a partial unique index for daily dedup.
CREATE UNIQUE INDEX "uq_system_inbox_daily" ON "system_inbox"
  (user_id, kind, (created_at AT TIME ZONE 'Europe/Brussels')::date);

-- Then in 0019, change INSERT to:
INSERT INTO system_inbox (user_id, kind, payload)
SELECT … FROM …
ON CONFLICT ON CONSTRAINT "uq_system_inbox_daily" DO NOTHING;
```

(Option b is cleaner but harder to express with the GROUP BY shape — go with option a.)

Also recommended: an admin pg_cron job that purges read rows older than 30 days. GDPR retention concern.

### CR-08: `dangerouslySetInnerHTML` renders i18n markdown markers as literal text and is an XSS sink

**File:** `src/components/nudge/nudge-banner.tsx:127`, `src/components/calendar/rrule-scope-picker-dialog.tsx:85, 101, 117`

**Issue:**
The i18n catalogs (`messages/{nl,en,fr}.json`) contain markdown-style `**` markers for bold emphasis:

```
"day10to12": "⚠ **{n} trainingen** — nog **{daysLeft} dagen** om te scoren…"
"scopeThisPreview": "Alleen de afspraak op **{date}** wordt aangepast…"
"scopeFuturePreview": "Wijzigingen worden toegepast op de afspraak van **{date}** én alle toekomstige…"
```

Both components render these via `<p dangerouslySetInnerHTML={{ __html: body }} />`. Two problems:

1. **Correctness:** `**bold**` is markdown syntax. HTML does not interpret it. The user literally sees `**2 trainingen**` with asterisks. No bold styling is applied.

2. **Security:** any future i18n change that introduces real HTML (or a translator submission via a CMS pipeline) renders unsanitized. There is no DOMPurify, no allowlist sanitizer. While `{n}` / `{date}` are next-intl-interpolated (safe by default), the surrounding catalog text is concatenated as-is into the HTML stream.

Phase 3 explicitly chose the safer JSX-split pattern (see `src/components/calendar/conflict-banner.tsx:24` "no innerHTML" comment). Phase 4 regressed.

**Fix:**
Option A — drop the markdown markers and the dangerouslySetInnerHTML, render as plain text:

```jsx
<p className="flex-1 text-sm">{body}</p>
```
Update catalogs to remove `**`.

Option B — render structured chunks with next-intl's rich text:

```jsx
// In catalog:
"day10to12": "⚠ <b>{n} trainingen</b> — nog <b>{daysLeft} dagen</b> …"
// In component:
<p className="flex-1 text-sm">
  {t.rich('day10to12', {
    n: sessions.length,
    daysLeft,
    b: (chunks) => <strong>{chunks}</strong>,
  })}
</p>
```
This is next-intl's idiomatic safe path; no `dangerouslySetInnerHTML` needed.

Apply the same fix to `rrule-scope-picker-dialog.tsx` lines 85, 101, 117.

### CR-09: `getAgeCategoryAt` uses UTC-sliced dates, drifting the DOM-CAT-02 snapshot for evening tournaments

**File:** `src/lib/players.ts:102`

**Issue:**
```typescript
const dateIso = date.toISOString().slice(0, 10); // YYYY-MM-DD
```

This produces a UTC date string. For a tournament starting at 2026-01-01 02:00 Brussels (= 2025-12-31 23:00 UTC), the helper queries `age_category_history` with `dateIso = '2025-12-31'` — finding the prior year's age-category row.

`tournament.enterResult` (`tournament.ts:664`) calls `getAgeCategoryAt(input.playerUserId, ev.startsAt, db)`. A player who ages into a new category on January 1 gets the wrong category snapshot for January-1-evening tournaments. The wrong code is then frozen on the `tournament_results.player_age_category_code` row — never auto-corrected.

The Phase 4 `rrule.ts` shipped `formatOccurrenceDate(d)` (line 82-89) precisely as the Brussels-anchored replacement for UTC slicing. The same helper should be used here.

**Fix:**
```typescript
// In src/lib/players.ts, replace line 102:
import { formatOccurrenceDate } from './rrule';
// …
const dateIso = formatOccurrenceDate(date); // Brussels-anchored YYYY-MM-DD
```

Audit other call sites of `.toISOString().slice(0, 10)` across the Phase 4 surface for the same drift — see WR-02 below.

## Warnings

### WR-01: `tournament.removeParticipant` audit-before-delete pattern uses outer ctx.db for audit but inner tx handle for DELETE

**File:** `src/server/trpc/routers/tournament.ts:446-493`

**Issue:**
Inside `db.transaction(async (tx) => { … })` (a savepoint nested in the RLS-bound outer tx):
- `tx.select(...).for('update')` — runs in the savepoint.
- `writeAudit(ctx, …)` — uses `ctx.db` which is the OUTER tx, not the savepoint.
- `tx.delete(...)` — runs in the savepoint.

If the savepoint rolls back (e.g., the DELETE raises a constraint violation), the audit row in the outer tx is committed. The block comment (lines 425-430) claims "audit INSERT and DELETE are in the same tx" — they are not. The behavior is actually mostly-desirable (audit row survives savepoint rollback), but the comment is wrong and the locking guarantee from `FOR UPDATE` becomes weaker because the audit is not coordinated with the lock.

**Fix:**
Either pass the tx handle into the audit call, OR document the actual semantics:

```typescript
await db.transaction(async (tx) => {
  // … SELECT FOR UPDATE
  await writeAudit(
    { ...ctx, db: tx },
    { action: 'tournament_participant_removed', /* … */ },
  );
  await tx.delete(…);
});
```

If the audit must outlive a savepoint rollback (current accidental behaviour), keep the outer `ctx.db` and update the comment to match. The status quo is at minimum a docs-vs-code mismatch.

### WR-02: Multiple UI components use UTC-sliced dates that drift one day for Belgian evening events

**File:** `src/components/calendar/event-detail-sheet.tsx:202-204`, `src/app/[locale]/(app)/trainings/[eventId]/score/page.tsx:32`, `src/components/training/te-scoren-overview.tsx:43-45, 95`

**Issue:**
Six call sites use `.toISOString().slice(0, 10)` to derive an `occurrenceDate` query parameter:
- `event-detail-sheet.tsx:202` — `const occurrenceDate = new Date(event.event.startsAt).toISOString().slice(0, 10);` — links to `/trainings/[eventId]/score?occurrenceDate=...`. For a 21:00 Brussels training in winter (CET) this gives the correct date; in summer (CEST) a 22:30 training falls on the previous UTC day.
- `te-scoren-overview.tsx:43-45` and line 95 — `isoDateOf(startsAt)` — same UTC-slice helper, builds links to the same score route.
- `score/page.tsx:32` — `defaultOccurrenceDate()` defaults to today's UTC date.

If the URL's `occurrenceDate=2026-05-15` then routes to the score page, the server calls `training.getSession({ eventId, occurrenceDate: new Date('2026-05-15') })`. The training router (`training.ts:79-81`) re-slices via UTC `toIsoDate`. The chain is internally consistent BUT it differs from `formatOccurrenceDate` in `rrule.ts` which is Brussels-anchored. If a `calendar_event_exception` row was written by Phase 3's `cancelOccurrence` (which uses Brussels-anchored `formatOccurrenceDate`), the chains DISAGREE on what day a 22:00 training "is".

**Fix:**
Replace every `.toISOString().slice(0, 10)` in the Phase 4 calendar/training UI with `formatOccurrenceDate` from `@/lib/rrule`. Apply the same change to the server-side `toIsoDate` in `tournament.ts:125` and `training.ts:79-81`.

### WR-03: `TeScorenOverview` progress bar formula is meaningless

**File:** `src/components/training/te-scoren-overview.tsx:108`

**Issue:**
```jsx
<Progress value={Math.max(0, 100 - pendingCount * 10)} aria-label={t('column.progress')} />
```

The value is a function only of the pending count, with an arbitrary `* 10` factor. A session with 1 unscored player shows 90% complete. A session with 9 unscored players shows 10% complete. A session with 10 unscored players shows 0%. A session with 15 unscored players shows the clamped 0%.

The component comment admits this is a placeholder ("server will return exact total later") but the UI ships with this misleading visualization. Users will misinterpret a 50% bar as "half done" when in reality "5 players still need scoring out of an unknown total".

The router (`training.ts:325`) computes only `pendingPlayerCount`. The schema return type lacks a `totalParticipantCount` field needed to render a real progress bar.

**Fix:**
Extend the router's GROUP BY result to include a participant total, OR drop the progress bar entirely (UI4-D23 doesn't mandate one in this surface — re-check the UI-SPEC). Suggested router change:

```typescript
// In training.ts listPending — extend the SELECT:
.select({
  eventId: calendarEvents.id,
  // …
  pendingPlayerCount: sql<number>`COUNT(*)::int`,
  totalPlayerCount: sql<number>`(
    SELECT COUNT(*)::int FROM calendar_event_participants cep
    JOIN users u ON u.id = cep.user_id
    WHERE cep.event_id = ${calendarEvents.id} AND u.role = 'player'
  )`,
})
```

UI then computes `value={Math.round(100 * (total - pending) / Math.max(total, 1))}`.

### WR-04: `TeScorenOverview` renders trainer UUID instead of trainer name in TD view

**File:** `src/components/training/te-scoren-overview.tsx:105`

**Issue:**
```jsx
{isTd && <TableCell>{s.trainerId}</TableCell>}
```

The TD's cross-trainer "Te scoren" overview (D-68) shows a raw uuid like `b6d56ce1-7b54-5e31-daf2-e5358fdcab2a` in the trainer column. This is undebuggable in the UI and unusable in practice.

The router's `listPending` SELECT (`training.ts:319-326`) doesn't pull the trainer's name. The schema doesn't return it.

**Fix:**
Extend the router to JOIN `users` (and/or `trainers` for first_name/last_name) and return a display label:

```typescript
.select({
  // …
  trainerName: sql<string | null>`(
    SELECT u.name FROM users u WHERE u.id = ${trainingSessions.trainerId}
  )`,
})
```

UI: `<TableCell>{s.trainerName ?? s.trainerId}</TableCell>`.

### WR-05: `tournament-detail` page hardcodes Dutch labels (i18n parity violation)

**File:** `src/app/[locale]/(app)/tournaments/[eventId]/page.tsx:55-77`

**Issue:**
Lines 55-77 contain literal `"Startdatum:"`, `"Einddatum:"`, `"Type:"`, `"Leeftijdscategorie:"`, `"Deelnemers:"` — none of which go through `useTranslations` / `getTranslations`. English (en) and French (fr) users see Dutch labels.

CLAUDE.md explicitly requires "All user-facing labels, copy, validation messages, transactional emails, and consent text must be available in all three locales before production." The `i18n-catalog-completeness` test (Phase 4 unit test) only checks catalog parity — it cannot detect hardcoded literals in JSX.

**Fix:**
```tsx
const tDetail = await getTranslations({ locale, namespace: 'tournament.detail' });
// …
<div>
  <span className="text-muted-foreground">{tDetail('label.startDate')}:</span>{' '}
  {/* … */}
</div>
```

Add the keys to all three catalogs.

### WR-06: `tournament-detail` displays raw lookup codes instead of i18n labels

**File:** `src/app/[locale]/(app)/tournaments/[eventId]/page.tsx:69, 73`

**Issue:**
```jsx
{tournament.tournamentTypeCode ?? '—'}
{tournament.ageCategoryCode ?? '—'}
```

Users see `tournament_wtt` and `age_senior` literally. Lookup catalogs `lookup.tournamentType.*` and `lookups.ageCategory.*` exist (per `tournament-create-form.tsx:59-60`).

Same issue in `trainings/[eventId]/score/page.tsx:80, 82`:
```jsx
{t('metadataType', { type: session.event.trainingTypeCode ?? '—' })}
{t('metadataOrg', { org: session.event.organisationCode ?? '—' })}
```
The raw code is passed as a substitution variable, not translated.

**Fix:**
Translate the lookup codes before passing them into the JSX:

```tsx
const tLookupType = await getTranslations({ locale, namespace: 'lookup.tournamentType' });
const tLookupAge = await getTranslations({ locale, namespace: 'lookups.ageCategory' });
// …
{tournament.tournamentTypeCode ? tLookupType(tournament.tournamentTypeCode) : '—'}
{tournament.ageCategoryCode ? tLookupAge(tournament.ageCategoryCode) : '—'}
```

### WR-07: `RankingLineChart` hardcodes `'nl-BE'` for date formatting

**File:** `src/components/ranking/ranking-line-chart.tsx:58-62, 140-144`

**Issue:**
```typescript
const dateStr = new Date(d.recordedAt).toLocaleDateString('nl-BE', { … });
// later, the axis tickFormatter also hardcodes 'nl-BE'.
```

A French or English user sees Dutch-formatted dates (e.g. dd/mm/jj instead of dd/mm/yy or mm/dd/yy). The component doesn't accept a `locale` prop and doesn't read `useLocale()`.

**Fix:**
```typescript
import { useLocale } from 'next-intl';
// …
const locale = useLocale();
const localeTag = locale === 'en' ? 'en-GB' : `${locale}-BE`;
const dateStr = new Date(d.recordedAt).toLocaleDateString(localeTag, { … });
```

Apply the same to the XAxis tickFormatter.

### WR-08: `idempotency` middleware writes `responseHash: null` despite the column being designed for hashing

**File:** `src/server/trpc/middleware/idempotency.ts:144`

**Issue:**
```typescript
responseHash: null,
```
With a comment "Optional sha256 — defer to v2 if replay-tampering becomes a concern". But this column is the only mechanism by which a replay can be verified — see CR-02. The comment understates the issue: replay-tampering is a CORRECTNESS concern (not just security), because a client retrying with mutated input gets the stale response.

This is the same finding as CR-02 from a schema-discipline angle. Recorded here so the docstring on the column shape can be updated alongside the middleware fix.

**Fix:**
Once CR-02 is implemented, repurpose `response_hash` to `request_hash` OR add a separate `request_hash` column. Mark `response_hash` as `null`-by-default deferred.

### WR-09: `calendar.list` needsScoring computation aggregates across ALL occurrences of a recurring training

**File:** `src/server/trpc/routers/calendar.ts:732-794`

**Issue:**
The SQL counts:
- `participant_count` = SELECT COUNT(*) FROM calendar_event_participants WHERE event_id = ce.id AND role='player'
- `scored_count` = SELECT COUNT(*) FROM session_participants WHERE event_id = ce.id AND quality_score IS NOT NULL

For a recurring training event, `session_participants` rows accumulate across ALL past occurrences. If a series has 6 players and runs weekly for 3 months, `scored_count` accumulates to 6 × 12 = 72 while `participant_count` stays at 6. `participant_count > scored_count` is false, so the chip never shows the yellow ⚠ overlay even when the most recent occurrence is unscored.

Conversely, a brand-new recurring training where the trainer scored zero past occurrences will trigger the overlay for every chip in the calendar — including future occurrences (although the elapsed-window filter mostly catches this).

**Fix:**
Compare per-occurrence:

```sql
SELECT
  ce.id AS event_id,
  occ.occurrence_date,
  6 AS participant_count,  -- or COUNT from cep filtered to players
  COALESCE(scored.cnt, 0) AS scored_count
FROM calendar_events ce
CROSS JOIN LATERAL (SELECT DATE(ce.starts_at) AS occurrence_date) occ  -- non-recurring path
-- OR for recurring: input the occurrenceDate per chip
LEFT JOIN (
  SELECT event_id, occurrence_date, COUNT(*) AS cnt
  FROM session_participants
  WHERE quality_score IS NOT NULL
  GROUP BY event_id, occurrence_date
) scored ON scored.event_id = ce.id
       AND scored.occurrence_date = occ.occurrence_date
WHERE ce.id = ANY(${candidateTrainingIds}::uuid[]);
```

Or — simpler — compute needsScoring per chip on the client side after fetching `session_participants` per (event, occurrence). The current per-event aggregate is a wrong abstraction.

### WR-10: `nudge-banner.tsx` `daysLeft` derivation off-by-one for boundary day

**File:** `src/components/nudge/nudge-banner.tsx:69-76`

**Issue:**
```typescript
const maxDaysSinceEnd = sessions.reduce((acc, s) => {
  const days = Math.floor((now - new Date(s.endsAt).getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(acc, days);
}, 0);
// …
const daysLeft = Math.max(0, 14 - maxDaysSinceEnd);
```

`Math.floor` rounds down: a session that ended exactly 14 days ago has `days = 14`, `daysLeft = 0`. But the wall is `Date.now() - endsAt > FOURTEEN_DAYS_MS` (strict greater), so day 14 still ALLOWS write. The banner copy "⚠ Nog 0 dagen om te scoren" appears while writes are still accepted — confusing.

Same defect in the `playerPending` branch (lines 87-94).

**Fix:**
```typescript
const daysLeft = Math.max(0, 14 - maxDaysSinceEnd);
```
becomes
```typescript
// The wall is strict-greater (day 14 still allowed), so daysLeft = (14 - days) + 1
// or use Math.ceil on a more granular ms delta:
const msSinceEnd = now - new Date(s.endsAt).getTime();
const msLeft = FOURTEEN_DAYS_MS - msSinceEnd;
const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
```

### WR-11: `MarkInboxRowReadButton` does not implement optimistic UI; rapid clicks cause double mutations

**File:** `src/components/inbox/mark-inbox-row-read-button.tsx:38`

**Issue:**
`onClick={() => mutation.mutate({ id })}` — no debounce, no `disabled` check past the mutation.isPending state, and the server has its own idempotent short-circuit. But the second mutation still runs a SELECT before short-circuiting; under load this generates O(N) needless queries.

`disabled={mutation.isPending}` only blocks the SAME mutation; if a parent re-renders the row (e.g., list invalidation), the disabled prop resets while the inflight mutation is still resolving.

**Fix:**
Track a local `done` state:
```typescript
const [done, setDone] = React.useState(false);
const mutation = trpc.inbox.markRead.useMutation({
  onSuccess: () => {
    setDone(true);
    void utils.inbox.listAll.invalidate();
    void utils.inbox.listUnread.invalidate();
  },
  // …
});
return (
  <Button disabled={done || mutation.isPending} … />
);
```

### WR-12: `tournament-create-form` uses `<input type="datetime-local">` without timezone awareness

**File:** `src/components/tournament/tournament-create-form.tsx:120, 124`, with submit at line 96-97

**Issue:**
`type="datetime-local"` produces a string like `"2026-05-19T14:30"` interpreted by `new Date(...)` as the BROWSER'S local time. For a Belgian user (CEST in May), this produces a UTC instant offset by +02:00. For a Dutch user testing the platform during CEST, same. But for any developer running E2E tests in a non-Brussels timezone (e.g., CI in `UTC`), the persisted starts_at is 2 hours off from what the user typed.

For Phase 4 production this is fine because all real users are in Belgium, but it bites tests and dev environments. Worse, the field accepts any value — there's no min-time validation preventing past tournaments.

**Fix:**
Convert input to ISO-with-tz on submit:
```typescript
function withBrusselsOffset(localStr: string): Date {
  // Treat the user input as Brussels-local wall clock; convert via a date-fns-tz call.
  // Or accept the browser's interpretation and document the locale assumption.
}
```
At minimum, add a refinement to `tournamentCreateInput` rejecting startsAt in the past.

### WR-13: `tournament-result-entry-form` regenerates idempotencyKey on every mount but not on input change

**File:** `src/components/tournament/tournament-result-entry-form.tsx:117-119, 144`

**Issue:**
The key is generated once on mount (`React.useState(() => generateIdempotencyKey())`) and refreshed only after a successful save. If the form is mounted, the user types match data and submits, then receives a network error, they retry with the SAME idempotency key — but the server middleware's cache is keyed on `(key, userId, endpoint)` and returns the cached body of the FIRST attempt (which was the error).

Wait — actually on cache MISS the middleware runs the handler. On HTTP error the handler throws BEFORE `dbHandle.insert(idempotencyKeys)` runs. So a network error doesn't poison the cache. But if the handler throws AFTER a successful DB write — e.g., audit fails — then the cache could be poisoned.

Combined with CR-02 (no input hash): if the user edits the form after a failed save and re-submits with different data, they could replay the failed attempt's cached error response instead of getting their corrected data through.

**Fix:**
Regenerate the key whenever the form values change (`form.formState.isDirty`-watch), OR on every `onSubmit` call:
```typescript
function onSubmit(data) {
  const freshKey = generateIdempotencyKey();
  setIdempotencyKey(freshKey);
  mutation.mutate({ /* … */, _meta: { idempotencyKey: freshKey } });
}
```

### WR-14: Client-side idempotency key fallback uses `Math.random` (not cryptographically random)

**File:** `src/components/tournament/tournament-result-entry-form.tsx:80-85`, `src/components/training/bulk-attendance-score-form.tsx:67-74`, `src/components/ranking/new-ranking-entry-sheet.tsx:70-75`

**Issue:**
```typescript
function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}
```

`Math.random` is not cryptographically secure. For an idempotency key the consequence is mild (collision probability ~ 1 in 16^16 per user per 24h — vanishingly small), but the fallback is functionally never reached: every Node ≥14.17 and every modern browser has `crypto.randomUUID`. The branch is dead defensive code that admits a less-secure fallback for no benefit.

Combined with CR-02: a predictable idempotency key + no input hash = a more practical replay surface for an attacker who can observe one user's traffic.

**Fix:**
```typescript
function generateIdempotencyKey(): string {
  if (typeof crypto === 'undefined' || !('randomUUID' in crypto)) {
    throw new Error('crypto.randomUUID required');
  }
  return crypto.randomUUID();
}
```
Or use `crypto.getRandomValues(new Uint8Array(16))` and format as hex. Drop the `Math.random` fallback.

## Info

### IN-01: `event-detail-sheet.tsx` reads from `event.event.needsScoring` / `needsResult` via type assertion

**File:** `src/components/calendar/event-detail-sheet.tsx:194, 198`

**Issue:**
```typescript
Boolean((event.event as unknown as { needsScoring?: boolean }).needsScoring)
```
The router's `event.get` procedure (calendar.ts) does NOT include `needsScoring` / `needsResult` in its return — these flags are computed only in `calendar.list`. The component is asserting against a shape that the API never produces, so `showOpenScoring` and `showEnterResult` are always FALSE in practice (the buttons never render). The conditional CTAs documented in `UI4-D11` don't fire from the event detail sheet.

**Fix:**
Either extend `event.get` to compute the same `needsScoring` / `needsResult` flags (preferred — single source of truth), OR fetch them via a separate read in the sheet. The current code is dead.

### IN-02: `event-detail-sheet.tsx` UTC date slice for `occurrenceDate` (related to WR-02)

**File:** `src/components/calendar/event-detail-sheet.tsx:202-204`

**Issue:**
See WR-02. Specifically here, the `occurrenceDate` query param is computed from `event.event.startsAt` (the SERIES dtstart, not the occurrence the user clicked). For a recurring training, this routes the trainer to the wrong occurrence's score form.

**Fix:**
The sheet listens to `calendar:open-detail` with `{ eventId, occurrenceDate }` per the event chip dispatch. Plumb the `occurrenceDate` from the dispatched event through the sheet state and use it for the link query:
```typescript
const [occurrenceDate, setOccurrenceDate] = useState<string | null>(null);
// in handler: setOccurrenceDate(detail.occurrenceDate ?? null);
// in link: ?occurrenceDate=${formatOccurrenceDate(new Date(occurrenceDate))}
```

### IN-03: `RankingLineChart` `recordedAt` defensive type guard is unreachable

**File:** `src/components/ranking/ranking-line-chart.tsx:104-108`

**Issue:**
```typescript
recordedAt:
  typeof e.recordedAt === 'object' && e.recordedAt !== null && 'toISOString' in e.recordedAt
    ? (e.recordedAt as Date).toISOString()
    : String(e.recordedAt),
```
The tRPC client deserializes Date columns to either Date instances (via superjson) or ISO strings. The router returns `recordedAt: rankingEntries.recordedAt` which is `tstz` → Date. Through tRPC HTTP, Date becomes ISO string. The `typeof === 'object'` branch handles a serialization shape that the React Query client never produces.

**Fix:**
Simplify to `recordedAt: typeof e.recordedAt === 'string' ? e.recordedAt : (e.recordedAt as Date).toISOString()`, or use superjson's branded type if applicable.

### IN-04: `next.config.ts` does not address documented typedRoutes failures

**File:** `next.config.ts`, `.planning/phases/04-kerndomein/deferred-items.md`

**Issue:**
Phase 4's `deferred-items.md` documents 25 pre-existing `typedRoutes` typecheck errors. The README points to `experimental.typedRoutes: false` as a one-line workspace-wide fix. Phase 4 introduced more `redirect(\`/${locale}/...\`)` call sites — they compound the issue. This was acknowledged out of scope, but the deferred resolution should be tracked.

**Fix:**
Either set `experimental.typedRoutes: false` (single-line workspace fix per `deferred-items.md` option 2) or migrate all dynamic redirect call sites to `Route` casts. Option 2 (`typedRoutes: false`) is the lowest-friction path until the Next.js typedRoutes API stabilizes.

### IN-05: Schema-SQL drift on `idx_session_participants_pending` partial index

**File:** `src/server/db/schema/training.ts:76-81` vs `drizzle/0014_phase4_session_participants_and_sparring_junction.sql:38-39`

**Issue:**
The SQL migration creates a partial index `idx_session_participants_pending` with `WHERE quality_score IS NULL`. The Drizzle schema declares the other two indexes (`idx_session_participants_user_date`, `idx_session_participants_event`) but not the pending one. Drizzle `pgPullPush` would see the table as out-of-sync with the schema definition.

**Fix:**
Add the partial index to the Drizzle schema:
```typescript
index('idx_session_participants_pending')
  .on(t.eventId)
  .where(sql`${t.qualityScore} IS NULL`),
```

### IN-06: Inbox cursor parsing accepts invalid dates silently

**File:** `src/server/trpc/routers/inbox.ts:107, 153`

**Issue:**
`new Date(input.cursor)` — if `input.cursor` is `"not-a-date"`, `new Date()` returns an `Invalid Date`. Drizzle will pass this as a parameter, likely raising a PG error at execute time (or, worse, casting silently to a sentinel value depending on driver).

**Fix:**
```typescript
if (input.cursor) {
  const d = new Date(input.cursor);
  if (Number.isNaN(d.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'errors.field.invalidCursor' });
  }
  conditions.push(lt(systemInbox.createdAt, d));
}
```

### IN-07: `iconForKind` / `bodyKeyForKind` heuristics use substring match on `kind`

**File:** `src/components/inbox/minimal-system-inbox.tsx:34-43`

**Issue:**
```typescript
function iconForKind(kind: string) {
  if (kind.includes('trainer') || kind.includes('training')) return Dumbbell;
  if (kind.includes('player') || kind.includes('tournament')) return Trophy;
  return Bell;
}
```
The DB CHECK constraint (`drizzle/0020_phase4_system_inbox.sql:28-29`) restricts `kind` to two known codes (`trainer_score_nudge`, `player_result_nudge`). The substring heuristics are fragile — when Phase 6 extends the inbox with new `kind` values, the substring rules will misclassify (e.g., a future `player_consent_due` kind would land in the player branch even though it has nothing to do with tournaments).

**Fix:**
Switch to exact-match on the known codes; default to `Bell` for unknown kinds (with a comment noting Phase 6 will add more):
```typescript
function iconForKind(kind: string) {
  switch (kind) {
    case 'trainer_score_nudge': return Dumbbell;
    case 'player_result_nudge': return Trophy;
    default: return Bell;
  }
}
```

---

_Reviewed: 2026-05-19T09:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
