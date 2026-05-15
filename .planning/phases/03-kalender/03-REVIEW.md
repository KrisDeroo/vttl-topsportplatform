---
phase: 03-kalender
reviewed: 2026-05-15T12:45:15Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql
  - drizzle/0010_phase3_calendar_extension_tables.sql
  - drizzle/0011_phase3_calendar_rls_policies.sql
  - drizzle/0012_phase3_event_type_seed.sql
  - src/lib/rrule.ts
  - src/lib/calendar/conflicts.ts
  - src/server/db/schema/calendar.ts
  - src/server/db/schema/lookups.ts
  - src/server/db/schema/index.ts
  - src/server/trpc/routers/calendar.ts
  - src/server/trpc/routers/_app.ts
  - src/server/trpc/schemas/calendar.ts
  - src/server/trpc/middleware/calendarCreate.ts
  - src/app/[locale]/(app)/calendar/page.tsx
  - src/app/[locale]/(app)/calendar/loading.tsx
  - src/app/[locale]/globals.css
  - src/components/calendar/calendar-view.tsx
  - src/components/calendar/calendar-toolbar.tsx
  - src/components/calendar/event-chip.tsx
  - src/components/calendar/calendar-skeleton.tsx
  - src/components/calendar/empty-hint-strip.tsx
  - src/components/calendar/event-create-sheet.tsx
  - src/components/calendar/event-edit-sheet.tsx
  - src/components/calendar/event-detail-sheet.tsx
  - src/components/calendar/event-delete-dialog.tsx
  - src/components/calendar/event-delete-dialog-mount.tsx
  - src/components/calendar/event-filter-bar.tsx
  - src/components/calendar/filter-combobox.tsx
  - src/components/calendar/conflict-warning.tsx
  - src/components/calendar/conflict-banner.tsx
  - src/components/common/date-time-picker.tsx
  - src/components/common/rrule-editor.tsx
  - messages/nl.json (+ en.json, fr.json)
findings:
  critical: 5
  warning: 11
  info: 9
  total: 25
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-15T12:45:15Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Phase 3 ships a polymorphic calendar (class-table inheritance over `calendar_events` + 6 typed extensions), recurring-event RRULE expansion, cross-scope conflict detection with role-gated redaction, and a FullCalendar-based UI. The schema and RLS layout are largely sound and follow Phase 1/2 conventions (SECURITY DEFINER + search_path lock; REVOKE/GRANT explicit; FORCE RLS on every new table; per-action policies with `WITH CHECK`). Hand-authored migrations are well-commented and the audit-log contract is honoured for the 6 emitted action codes.

**However, this submission has 5 BLOCKER-class defects that ship a broken feature:**

1. **CR-01 — SECURITY DEFINER signature mismatch (every conflict probe throws).** The Postgres function is declared `overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ)` in 0011 but the router calls it with `(UUID[], ARRAY[tstzrange]::tstzrange[])` — 2 args, second one a tstzrange array. PostgreSQL will reject every call with `function … does not exist`, meaning `event.detectConflicts` always errors and the conflict probe in `event.create`/`event.update` either fails the mutation or — if higher-level handlers swallow the error — never detects conflicts. The redacted conflict UI surface is dead code.

2. **CR-02 — `event.update` corrupts polymorphic extension state and bypasses D-48 RBAC.** The handler does not refuse a `type`-change in the input payload, does not update `calendar_events.type_code`, deletes the extension row for the *new* type (not the existing one), and inserts into the new type's table — leaving the old extension row orphaned. A player who created a meeting can submit `type: 'event_type_tournament'` and produce: meeting row in `calendar_events.type_code`, stray meeting row in `meetings`, and a new row in `tournaments` — polymorphic invariant violated. There is no `canCreateEventType()` gate on update.

3. **CR-03 — Edit flow destroys participant roles and RSVP state.** `event.update` deletes all participants and re-inserts them with hard-coded `roleInEvent: 'participant'` and `rsvpStatus: 'pending'`. The Edit Sheet loads every participant into the `playerIds` form bucket (including the creator/organizer). After any edit, the creator is no longer 'organizer', all `'accepted'` RSVPs are reset to `'pending'`, and any `'invitee'` distinction is lost. The create handler self-adds the caller as 'organizer'; update does not.

4. **CR-04 — `event.create`/`event.update` accept arbitrary participant user IDs (no scope check).** The Zod schema only requires `userId: z.string().uuid()`. The RLS policy `cep_insert` only checks creator/TD on the parent event, not the participant identity. A trainer can add players from another academy (or a TD's user_id) as a participant by guessing UUIDs — the conflict probe + audit log would then leak overlap data they shouldn't see. The error key `errors.calendar.participantNotInScope` exists in all three i18n catalogs (line 303 nl/en/fr) but is never thrown by the server.

5. **CR-05 — `cancelOccurrence` date conversion has a UTC-vs-local off-by-one.** The handler converts a Date input to `toISOString().slice(0, 10)` and stores it in the `occurrence_date` column. A Belgian client sending a Date that represents `2026-05-16 00:00:00+02:00` (May 16 local midnight) becomes `2026-05-15T22:00:00Z` UTC → `'2026-05-15'` — cancels the wrong day. The same UTC-slice pattern is used in `expandRrule` (line 222, 229) so matching is internally consistent, but data written here is wrong relative to user intent.

In addition there are 11 warnings (DST-drift in rrule, broken filter pipeline end-to-end, missing i18n keys vs thrown error keys, audit-log gaps, dead-code reachability bugs in the rrule validator) and 9 info-level items (naming drift, missing ORDER BY, unhandled FK violation paths, etc.).

Recommend treating CR-01..CR-05 as ship blockers before this phase merges.

---

## Critical Issues

### CR-01: `overlapping_events_for_users` SQL call signature does not match the SECURITY DEFINER declaration — every conflict probe throws at runtime

**File:** `src/server/trpc/routers/calendar.ts:1079-1093`
(SQL declared at `drizzle/0011_phase3_calendar_rls_policies.sql:169-200`.)

**Issue:**
The Postgres function is declared with three scalar arguments:
```sql
CREATE OR REPLACE FUNCTION overlapping_events_for_users(
  p_user_ids UUID[],
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
```
The router invokes it with two arguments, the second being a `tstzrange[]`:
```ts
const rangeLiteral = sql`tstzrange(${startsAt}, ${endsAt}, '[)')`;
const baseQuery = sql`
  …
  FROM overlapping_events_for_users(
    ${participantIds}::uuid[],
    ARRAY[${rangeLiteral}]::tstzrange[]
  )
`;
```
PostgreSQL will respond with `ERROR: function overlapping_events_for_users(uuid[], tstzrange[]) does not exist` on every call. This breaks:
- `calendar.event.detectConflicts` — always throws.
- `calendar.event.create` conflict probe when `!input.force && input.participants.length > 0` — also always throws, turning every legitimate create-with-participants into a server error.
- `calendar.event.update` conflict probe — same.

The inline comment "The fn signature (per 03-02): overlapping_events_for_users(uuid[], tstzrange[])" disagrees with the migration; one side is wrong. Tests evidently did not exercise `detectConflicts` end-to-end (or stubbed the SQL function).

**Fix:**
Align the call site with the declared signature:
```ts
const baseQuery = sql`
  SELECT event_id   AS "eventId",
         user_id    AS "userId",
         type_code  AS "typeCode",
         title,
         starts_at  AS "startsAt",
         ends_at    AS "endsAt",
         location,
         created_by AS "createdBy"
    FROM overlapping_events_for_users(
      ${participantIds}::uuid[],
      ${startsAt}::timestamptz,
      ${endsAt}::timestamptz
    )
`;
```
Add an integration test that calls `event.detectConflicts` against a real Postgres (not a mock) so the regression cannot reach review again.

---

### CR-02: `event.update` allows type escalation and corrupts polymorphic extension state

**File:** `src/server/trpc/routers/calendar.ts:661-744`

**Issue:**
Three compounding defects:

1. **No RBAC gate.** `event.create` calls `canCreateEventType(role, type)` (line 502); `event.update` calls nothing equivalent. A player can create a meeting (allowed by D-48), then submit an update with `type: 'event_type_tournament'` (TD-only). RLS allows the update because the player is the creator.

2. **`calendar_events.type_code` is never written on update.** Line 705-715 sets `title`/`startsAt`/`endsAt`/`allDay`/`location`/`description`/`rrule`/`updatedAt` but omits `typeCode`. So even when the user submits a different `input.type`, the base row keeps its original type.

3. **`deleteExtensionRow` uses the wrong type.** Line 742 calls `deleteExtensionRow(tx, input.type, input.eventId)` — passing the *new* type. If the original type was `event_type_meeting` and the input is `event_type_tournament`, this deletes from `tournaments` (a no-op — there is no row yet), leaving the original `meetings` row intact. Then `insertExtensionRow(tx, input, input.eventId)` inserts into `tournaments`. Net effect: the event has rows in two extension tables, violating the D-49 polymorphic invariant (one extension row per event, matching `calendar_events.type_code`).

A subsequent `event.get` returns the old-type extension (because it reads by `row.typeCode` which is still the original). The orphaned new-type extension row is invisible until someone scans the extension tables directly.

**Fix:**
1. Reject type changes outright in v1 (UI-SPEC line 317 says type is locked at create):
   ```ts
   if (input.type !== existingRow.typeCode) {
     throw new TRPCError({
       code: 'BAD_REQUEST',
       message: 'errors.calendar.typeImmutable',
     });
   }
   ```
   (Add the new i18n key to all three catalogs.)

2. Apply the D-48 gate defensively:
   ```ts
   if (!canCreateEventType(ctx.scope.role, input.type)) {
     throw new TRPCError({ code: 'FORBIDDEN', message: 'role_not_allowed' });
   }
   ```

3. Use the existing type for `deleteExtensionRow`:
   ```ts
   await deleteExtensionRow(tx, existingRow.typeCode, input.eventId);
   await insertExtensionRow(tx, input, input.eventId);
   ```

---

### CR-03: `event.update` destroys participant roles and RSVP state on every save

**File:** `src/server/trpc/routers/calendar.ts:720-739` (server) + `src/components/calendar/event-edit-sheet.tsx:258-264` (client)

**Issue:**
The server-side handler:
```ts
await tx.delete(calendarEventParticipants)
  .where(eq(calendarEventParticipants.eventId, input.eventId));
…
const participantValues = input.participants.map((p) => ({
  …
  roleInEvent: p.roleInEvent,
  rsvpStatus: 'pending',          // ← every save resets RSVPs
}));
await tx.insert(calendarEventParticipants).values(participantValues);
```

Unlike `event.create` (lines 594-601), update does NOT re-add the caller as `'organizer'` after the wipe. So:
- The creator's row goes from `(roleInEvent='organizer', rsvpStatus='accepted')` to either nothing (if dropped from the form's playerIds) or `(roleInEvent='participant', rsvpStatus='pending')`.
- Every accepted/declined RSVP becomes `'pending'`.

The Edit Sheet compounds this. When loading an existing event it lumps every participant into one bucket regardless of original role:
```ts
playerIds: (loaded.participants ?? []).map((p) => p.userId),
trainerIds: [],
sparringPartnerIds: [],
```
And on save the `buildUpdatePayload` flattens everyone back as `'participant'`:
```ts
const participants = [
  ...v.playerIds.map((userId) => ({ userId, roleInEvent: 'participant' as const })),
  …
];
```

Net effect: every edit (even a no-op title change) silently re-classifies organizers as plain participants and re-sends invite states. The "Ik kan niet aanwezig zijn" decline is undone the next time anyone edits the event.

**Fix:**
1. Load original `roleInEvent` and `rsvpStatus` into the form and round-trip them per-participant on save.
2. In `event.update`, diff the participant list (add/remove/role-change) instead of delete-and-reinsert. At minimum:
   - Carry forward existing `rsvpStatus` for participants that survive the update.
   - Re-add the caller as `'organizer'`/`'accepted'` after the wipe, mirroring `event.create` (lines 594-601).
3. Tests: add a contract test that a save of an event leaves accepted RSVPs accepted and preserves the organizer's role.

---

### CR-04: Server accepts arbitrary participant `userId`s without scope check — i18n key for the gate exists but is never thrown

**File:** `src/server/trpc/routers/calendar.ts:528-548, 685-700` (event.create / event.update)
**Schema:** `src/server/trpc/schemas/calendar.ts:36-41` (participantInputSchema)
**i18n key (orphaned):** `messages/{nl,en,fr}.json` → `errors.calendar.participantNotInScope`

**Issue:**
`participantInputSchema` validates only that `userId` is a UUID and `roleInEvent` is in the closed enum. The router never checks that the caller can see the user being added as a participant. The DB-layer guardrail (`cep_insert` RLS policy in 0011 line 248-255) only verifies `ce.created_by = current_user_id() OR TD` — i.e. that the *event's* author is the caller, NOT that the participant is in scope.

Concrete attack: a trainer can call `event.create` with `participants: [{ userId: '<arbitrary uuid>', roleInEvent: 'participant' }]`. If the UUID matches a real user, the row is inserted. The conflict probe will then run against that user via the SECURITY DEFINER function (which deliberately bypasses RLS) and the resulting redacted-conflict response could leak the existence and time-range of an event the participant has elsewhere — a directory-enumeration primitive.

Even less malignly, a UX user typing a UUID by hand has no feedback that the user is out of scope.

The repository already ships the right error key in every locale:
```json
"participantNotInScope": "Eén of meer geselecteerde deelnemers vallen buiten je bereik"
```
… but no code path throws it.

**Fix:**
Add a scope probe in `event.create` and `event.update` BEFORE the insert, using `players_visible_to` / `academy_memberships` joins that mirror `calendar_events_visible_to`:
```ts
// Pseudocode — refine to match Phase 1/2 helpers.
const inScope = await db.execute<{ user_id: string }>(sql`
  SELECT u.id AS user_id FROM users u
   WHERE u.id = ANY(${participantIds}::uuid[])
     AND u.id IN (SELECT user_id FROM players_visible_to(${callerId}, ${callerRole}))
`);
const visibleSet = new Set(inScope.map((r) => r.user_id));
const outOfScope = participantIds.filter((id) => !visibleSet.has(id));
if (outOfScope.length > 0) {
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'errors.calendar.participantNotInScope',
  });
}
```
Make sure TD/medical_staff still pass (they see everyone). Add an integration test for the cross-academy injection case.

---

### CR-05: `cancelOccurrence` and `expandRrule` use `toISOString().slice(0, 10)` — off-by-one for any client outside UTC

**File:** `src/server/trpc/routers/calendar.ts:895-897` (cancel)
**Related:** `src/lib/rrule.ts:222, 229` (read-side match)

**Issue:**
```ts
const occurrenceDateIso = input.occurrenceDate
  .toISOString()
  .slice(0, 10);
```
`input.occurrenceDate` is decoded by `z.coerce.date()` and arrives as a `Date`. The slice takes the *UTC* date. For a Belgian/French user (`+01:00` or `+02:00`):
- A client Date representing `2026-05-16 00:00 CET` is `2026-05-15T23:00:00Z` → stored as `'2026-05-15'`.
- Result: cancelling the May 16 morning training writes an exception against May 15.

The read-side `expandRrule` uses the same UTC slice for matching, so the stored exception will be applied to the *May 15* occurrence — quietly cancelling the wrong day. The user sees no error; the wrong session disappears from the grid.

The same shape risk exists in any future code that joins `calendar_event_exceptions.occurrence_date` against rrule expansions if the timezone of dtstart changes.

**Fix:**
Decide one canonical zone for occurrence_date — either (a) date-only in the event's *original anchor* timezone (recommended; matches user mental model), or (b) UTC-only with explicit conversion at the boundary. Document the choice and apply consistently.

Concrete tactical fix using date-fns-tz (or a manual offset):
```ts
import { formatInTimeZone } from 'date-fns-tz';

// The platform is Belgian — derive from the event row or default to Europe/Brussels.
const occurrenceDateIso = formatInTimeZone(
  input.occurrenceDate,
  'Europe/Brussels',
  'yyyy-MM-dd',
);
```
And the corresponding match in `expandRrule`:
```ts
const occDateIso = formatInTimeZone(d, 'Europe/Brussels', 'yyyy-MM-dd');
```
Add a regression test running with `TZ=Europe/Brussels` confirming a May 16 23:30 local cancel writes `'2026-05-16'`.

---

## Warnings

### WR-01: Recurring events drift across DST boundaries — "weekly 10:00" becomes 09:00 or 11:00 after the spring/fall change

**File:** `src/lib/rrule.ts:181-216` (expandRrule)

**Issue:**
`parseRrule` rejects any rrule string containing `DTSTART:` (Anti-Pattern 1 guard), and `expandRrule` uses `rrulestr(rruleStr, { dtstart })` with the Date from `calendar_events.starts_at` as the anchor. Postgres `timestamptz` is UTC; rrule's default semantics produce occurrences as *stable UTC moments*.

For an event that should recur "every Wednesday 10:00 local time", this is wrong:
- DTSTART picked in winter at `2026-01-07 10:00 CET` → stored as `2026-01-07T09:00:00Z`.
- After DST change to CEST (`2026-03-29`), the next Wednesday's UTC `09:00:00Z` is `11:00 local` — one hour OFF from intended 10:00.

The Pitfall 3 comment on lines 36-38 asserts "rrule's default UTC semantics handle DST correctly" — this is incorrect for the *local-time-recurrence* user mental model used in the UI. The platform is Flemish/Belgian; users expect "every Tuesday 18:00" to actually be 18:00 in Brussels regardless of DST.

This is the canonical RFC 5545 reason for `DTSTART;TZID:Europe/Brussels:`. The current schema rejects DTSTART in the rrule string, so the only escape is a separate TZID column or an out-of-band convention.

**Fix:**
Short-term (Phase 3): store `tz_id` on `calendar_events` as a text column defaulting to `'Europe/Brussels'`. In `expandRrule`, convert `dtstart` to floating-local using `tz_id`, expand, convert each result back to UTC for the wire. The `rrule` library accepts `Date` arguments interpreted as floating local via `tzid` option (or use the rrule-tz wrapper).

Long-term: revisit the Anti-Pattern 1 guard — RFC 5545 allows `DTSTART;TZID:…:YYYYMMDDTHHMMSS` (note: not `:YYYYMMDDTHHMMSSZ`). The guard should reject only the *Z-suffix UTC* form so a TZID-bound DTSTART can become the canonical timezone source. Add a DST-edge regression test (event spanning the March/October change).

---

### WR-02: Filter URL state never reaches the server — base64-encoded `?filter=…` is read by the Filter Bar but the calendar.list pre-fetch ignores it

**File:** `src/app/[locale]/(app)/calendar/page.tsx:108` + `src/components/calendar/event-filter-bar.tsx:117-127`

**Issue:**
The page does:
```ts
const initialEvents = (await caller.calendar.list({ from, to })) as Array<…>;
```
No `filters` argument is passed. The page detects only the presence of the `?filter=` parameter as a boolean (`Boolean(sp.filter)`) for the empty-state copy variant, never decoding it.

Meanwhile `EventFilterBar` writes a base64-encoded JSON blob into `?filter=`. On the read side the bar pushes the new URL via `router.push`, causing a Next.js client navigation. The Server Component re-runs the pre-fetch — but still with no `filters` argument. The client-side `calendar.list` query (via tRPC React Query in Wave 4 — there isn't one yet) would normally re-fetch with the filter, but no listener is wired.

Net effect: **filters do nothing in v1**. The user toggles a filter, the URL changes, but the calendar grid is unchanged. The chip-level filter at lines 456-477 of the router does exist, but it's only invoked when the caller passes `filters` — which `page.tsx` never does.

The phase plan-decision noted "filters ship in Plan 07" (page.tsx line 12); but Plan 07 also did not wire the URL decoder into the Server Component. The filter bar is functional-looking but inert.

**Fix:**
1. Decode `sp.filter` (same base64+JSON shape) in the Server Component and pass into the `caller.calendar.list({ from, to, filters })` call.
2. Validate the decoded shape via `listInput.shape.filters.parse(decoded)` so a tampered URL is rejected loudly.
3. Add a client-side `trpc.calendar.list.useQuery({ from, to, filters }, …)` in `<CalendarView>` (or near it) so client-only navigations (filter toggles without full page reload) update the grid.

---

### WR-03: `validateHorizon` never rejects open-ended rrules in practice because `ensureHorizon` always runs first

**File:** `src/server/trpc/routers/calendar.ts:513-525, 678-682`
**Related:** `src/lib/rrule.ts:132-137`

**Issue:**
The validator says it rejects rules without UNTIL AND without COUNT:
```ts
if (!opts.until && !opts.count) {
  throw new TRPCError({ … message: 'errors.calendar.rruleHorizonExceeded' });
}
```
But every caller does:
```ts
rruleToStore = ensureHorizon(rruleToStore, …);
validateHorizon(rruleToStore, …);
```
`ensureHorizon` auto-injects `UNTIL = +2y` whenever neither UNTIL nor COUNT is set. So by the time `validateHorizon` runs, that branch is unreachable. The validator is effectively only checking the second branch ("UNTIL beyond +2y"), and the docstring is misleading.

This is also a defensive-failure path: if a future code path calls `validateHorizon` *without* first calling `ensureHorizon`, the developer might assume the guard catches the open-ended case — but only because of the brittle ordering convention.

**Fix:**
Either (a) inline `ensureHorizon` into `validateHorizon` so it's idempotent, or (b) drop the auto-injection and make the validator throw — the RruleEditor sends a real UNTIL string after the user picks an end mode.

Recommended: remove the silent auto-injection. "Never" in the UI should set a sensible default `UNTIL = +1y` (or +2y for explicit horizon) in the client and send it; the validator then becomes the single source of truth.

---

### WR-04: All three rrule-related error paths return the same i18n key, so user gets "Herhaling kan maximaal 2 jaar vooruit lopen" for what was actually a syntax error

**File:** `src/lib/rrule.ts:86-110`

**Issue:**
`parseRrule` throws `errors.calendar.rruleHorizonExceeded` for three distinct conditions:
1. The string contains `DTSTART:` (Anti-Pattern 1 guard).
2. `rrulestr` failed to parse (syntax error).
3. The parsed value is an `RRuleSet` instead of a single `RRule`.

`validateHorizon` adds a fourth use of the same key. Only the actual "UNTIL beyond +2y" case fits the message.

A user who typed a malformed rrule string sees "Recurrence can extend at most 2 years ahead" — confusing and undebuggable.

**Fix:**
Introduce `errors.calendar.rruleInvalid` for the parse-failure branches. Keep `rruleHorizonExceeded` for the actual horizon check. Update all three i18n catalogs.

---

### WR-05: `event.update` audit row's `oldValues` records only 3 fields — partial forensic snapshot, asymmetric with the delete audit

**File:** `src/server/trpc/routers/calendar.ts:754-768`

**Issue:**
The update audit captures:
```ts
oldValues: {
  title: existingRow.title,
  startsAt: existingRow.startsAt.toISOString(),
  endsAt: existingRow.endsAt.toISOString(),
},
newValues: {
  title: input.title,
  startsAt: input.startsAt.toISOString(),
  endsAt: input.endsAt.toISOString(),
},
```
No `location`, `description`, `rrule`, `allDay`, type-specific extension fields, or participant lists. Compare with `event.delete`, which captures the full base + extension + participants + exceptions snapshot.

For GDPR Article 30 + accountability ("we know who changed what"), partial snapshots make audit-log forensic recovery impossible. A trainer renaming a tournament also moving venues would have no record that "Antwerp Open" became "Brussels Open".

**Fix:**
Capture the full base row in `oldValues` and the merged final state in `newValues`. Keep the JSONB compact via Drizzle's typed serialisation; the 1 KB-ish overhead per audit row is acceptable (Phase 1's pattern).

---

### WR-06: Override audit fires when `force=true` even if no conflict ever existed — log integrity drift

**File:** `src/server/trpc/routers/calendar.ts:629-639, 746-753`

**Issue:**
```ts
if (input.force && input.participants.length > 0) {
  await writeAudit(ctx, { action: 'calendar_event_conflict_override', … });
}
```
A client that posts `force: true` on the very first call (without seeing a CONFLICT response) writes a `calendar_event_conflict_override` row even though no conflict was detected. Two paths abuse this:
1. Automation / scripted bulk imports could intentionally pass `force: true` to skip the probe, polluting the override audit feed.
2. A buggy front-end retry might call with `force: true` on retry of an unrelated failure.

Either way, the audit log becomes unreliable as an answer to "show me every conflict the team chose to override" — TD review counts will include phantom overrides.

**Fix:**
Capture the conflict set as part of the `calendar_event_conflict_override` audit (the actual conflicts the caller is overriding):
```ts
if (input.force && input.participants.length > 0) {
  // Run the probe even when force=true, purely for the audit detail.
  const conflicts = await detectConflictsForParticipants(…);
  if (conflicts.length > 0) {
    await writeAudit(ctx, {
      action: 'calendar_event_conflict_override',
      …,
      newValues: { conflicts: conflicts.map((c) => ({ … })) },
    });
  }
  // else: no audit row — there was nothing to override.
}
```
Cost is one extra DB call per force-create; acceptable.

---

### WR-07: `event.cancelOccurrence` does not verify the caller can see the event before inserting the exception

**File:** `src/server/trpc/routers/calendar.ts:882-936`

**Issue:**
The handler inserts directly into `calendar_event_exceptions` without first running a SELECT-and-NOT_FOUND pattern (which `event.update` and `event.delete` use). The INSERT relies on RLS `cee_insert` policy to reject non-creator non-TD callers, but the resulting error is whatever postgres returns for a WITH CHECK failure — typically wrapped as an opaque tRPC error rather than the project's `NOT_FOUND` convention (D-36 carry-forward).

Side effect: a player who can SEE an event (as a participant) but not edit it gets a confusing "permission denied at DB layer" error when they try to cancel an occurrence, instead of a clean `NOT_FOUND`/`FORBIDDEN`. Tests on this path likely don't catch the difference.

**Fix:**
Mirror the `event.update` shape: SELECT the base row first, throw NOT_FOUND if RLS filters it out, THEN insert the exception.

---

### WR-08: Conflict-banner only re-fetches `event.get` if the user is creator/TD — drag-drop by a non-owner participant silently 404s on move

**File:** `src/components/calendar/conflict-banner.tsx:80-118`

**Issue:**
When a drag or resize fires, the banner does:
```ts
const full = await utils.calendar.event.get.fetch({ eventId: detail.eventId });
```
Then composes the full update payload and calls `update`. `event.get` returns NOT_FOUND for non-creator non-TD (RLS scope is "creator or TD" via the update RLS policy interaction). For a participant who is allowed to DRAG (`canEdit` is page-level wide) but not allowed to UPDATE the row, the fetch fails, the catch falls to `toast.error(tToast('error'))` + `detail.revert()`. The user sees a generic error.

But CalendarView line 261-262 gates `editable={canEdit && !isMobile}` where `canEdit` is from page.tsx and equals `canCreate` (line 144), which is true for any role in the 5-role union. So a `medical_staff` who is merely a participant on a training session can drag the event, get a 404 on the get, and see a confusing "Opslaan mislukt" toast.

The per-row `canEdit` from `calendar.list` (set on each EventInstance, line 360-363) is the right gate — it correctly evaluates `createdBy === callerId || role === 'technical_director'`. CalendarView should use that per-event flag for drag, not the page-level union.

**Fix:**
In `CalendarView.fcEvents`, pass `editable: e.canEdit` per event:
```ts
const fcEvents = useMemo<EventInput[]>(() =>
  initialEvents.map((e) => ({
    …,
    editable: e.canEdit && !isMobile,  // per-event override
    durationEditable: e.canEdit && !isMobile,
    startEditable: e.canEdit && !isMobile,
    …
  })),
  [initialEvents, isMobile],
);
```
And drop the top-level `editable={canEdit && !isMobile}` so the per-event flag wins.

---

### WR-09: `filterOptions.list` runs `ILIKE %query%` with no `active=true` filter, no ORDER BY, and no input-character escaping

**File:** `src/server/trpc/routers/calendar.ts:1004-1054`

**Issue:**
Three sub-issues:

1. **No `active=true` filter on players/trainers.** Inactive entities (deactivated users) still appear as filter options. They're not in the active player pool but show in the typeahead. The academy branch correctly applies `WHERE active = true` (line 1042); the player/trainer branches do not.

2. **No `ORDER BY` on player/trainer searches.** With `LIMIT 50`, the returned set is non-deterministic — Postgres returns the first 50 by physical row order. Same query twice may return different subsets if the players table grows beyond 50 matches.

3. **`%` and `_` are not escaped in user input.** A user typing `Jan%` searches with effective wildcard `%Jan%%`; functionally a no-op match for `_`, but for `%` it widens the match unexpectedly. Not a security issue (Drizzle parameterises the LIKE value) but a UX/correctness gap.

**Fix:**
```ts
const escapeForLike = (s: string) =>
  s.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
const likeArg = `%${escapeForLike(input.query)}%`;
const result = await db.execute(sql`
  SELECT user_id AS id, (first_name || ' ' || last_name) AS label
    FROM players
   WHERE active = true
     AND (first_name || ' ' || last_name) ILIKE ${likeArg} ESCAPE '\\'
   ORDER BY last_name, first_name
   LIMIT ${MAX_OPTIONS}
`);
```
(`players` may not have an `active` column — check Phase 2 schema; if it's on the `users` parent row, JOIN it.)

---

### WR-10: Error key `errors.calendar.conflictDetected` thrown by server but missing from every i18n catalog

**File:** `src/server/trpc/routers/calendar.ts:544, 697` (throws)
**Missing in:** `messages/nl.json`, `messages/en.json`, `messages/fr.json` (under `errors.calendar.*`)

**Issue:**
```ts
throw new TRPCError({
  code: 'CONFLICT',
  message: 'errors.calendar.conflictDetected',
  cause: { conflicts, blocked: false },
});
```
This message key is not defined anywhere in the i18n catalogs. The Create/Edit sheets handle CONFLICT inline via `<ConflictWarning>` and ignore `message`, so today the missing key is silent. But:
- The generic toast error path (in `EventDeleteDialog`, `EventDetailSheet`, the Decline mutation) does use `tToast('error')` from `calendar.event.toast.error` — if an unexpected error flow ever resolves `errors.calendar.conflictDetected`, the UI will render the literal i18n key.
- The Phase 2 helper `useZodErrorMessage` (referenced in `schemas/calendar.ts` docstring line 5) falls back to the raw key when not found.
- Compliance: a logged error key that doesn't map to any user-facing string is a maintenance smell.

**Fix:**
Either:
(a) Add the key to all three catalogs:
```json
"calendar": {
  "conflictDetected": "Er bestaat al een afspraak met overlap",
  …
}
```
(b) Or drop the message and rely on the structured `cause.conflicts` payload exclusively. The UI already does (b); the server message is dead. Removing the i18n string entirely is cleaner — pass an empty message or use a sentinel like `'CONFLICT'`.

---

### WR-11: `EventCreateSheet` and `EventEditSheet` cast the buildPayload return through `as any` and bypass the discriminated-union TypeScript check at the client

**File:** `src/components/calendar/event-create-sheet.tsx:264-266` + `src/components/calendar/event-edit-sheet.tsx:287-290`

**Issue:**
```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
await createMutation.mutateAsync(payload as any);
```
The `buildCreatePayload` return type is `Record<string, unknown>` — by construction. The cast through `any` to `mutateAsync` bypasses the tRPC client's typed input validation. If the discriminated-union schema changes (e.g., a new required field on `event_type_training`), TypeScript will not catch the omission at the call site.

Worse: the per-type branches construct payloads that include or omit type-specific fields by `switch`. There is no exhaustive check on the switch, so a future EventTypeCode added to `EVENT_TYPE_CODES` (Phase 4 — sparring partner type?) would silently fall through to the `default` branch and send an under-specified payload.

**Fix:**
Replace the loose `Record<string, unknown>` return with the typed discriminated union directly. tRPC's `inferProcedureInput` lets you derive the input type:
```ts
type CreatePayload = inferProcedureInput<AppRouter['calendar']['event']['create']>;
function buildCreatePayload(v: FormShape, force: boolean): CreatePayload {
  switch (v.type) {
    case 'event_type_training':
      return { type: v.type, … } satisfies CreatePayload;
    …
    default: {
      const _exhaustive: never = v.type;
      throw new Error(`unreachable: ${_exhaustive}`);
    }
  }
}
await createMutation.mutateAsync(buildCreatePayload(values, force));  // no cast
```
This makes future type additions a compile error instead of a silent omission.

---

## Info

### IN-01: Lookup namespace drift — Phase 1/2 uses `lookups.*` (plural), Phase 3 introduces `lookup.eventType.*` (singular)

**File:** `messages/{nl,en,fr}.json` line 57 (`"lookups"`) vs line 241 (`"lookup"`)
**Issue:** Phase 3 adds a new top-level `"lookup"` (singular) namespace for `eventType` while Phase 1/2 used `"lookups"` (plural) for status/academy/ageCategory/tournamentType/etc. Both namespaces co-exist with no comment explaining why.
**Fix:** Move `lookup.eventType` under `lookups.eventType` for consistency; update `useTranslations('lookup.eventType')` → `useTranslations('lookups.eventType')` in `event-chip.tsx`, `event-create-sheet.tsx`, `event-edit-sheet.tsx`, `event-detail-sheet.tsx`, `event-filter-bar.tsx`, `conflict-warning.tsx`, `conflict-banner.tsx`.

---

### IN-02: `event.delete` snapshot caps `exceptions` at 1000 but does not cap `participants` — asymmetric guard

**File:** `src/server/trpc/routers/calendar.ts:811-818`
**Issue:** `exceptions: exceptionRows.slice(0, MAX_EXCEPTIONS)` + `exceptionsTotalCount: exceptionRows.length` for partial-snapshot honesty. But `participants: participantRows` has no equivalent slice. A pathological event with millions of participants (theoretical; not reachable today) would inflate the audit row JSONB.
**Fix:** Apply the same `slice(0, 1000)` + `participantsTotalCount` pattern. Or remove the asymmetry by capping all collections uniformly.

---

### IN-03: `RruleEditor` ignores its `value` prop — accepted for API symmetry but the comment says so

**File:** `src/components/common/rrule-editor.tsx:74-76`
**Issue:** The widget rebuilds the rrule from local pickers every render, never consuming the parent's `value` prop. The Edit Sheet relies on the `recurring` checkbox to gate the editor, but the editor itself doesn't round-trip an existing rrule into its picker state. Editing an existing weekly event always defaults to "WEEKLY interval=1 endMode=never" — even if the stored rrule was `MONTHLY interval=2 UNTIL=…`.
**Fix:** Parse `value` into `{ freq, interval, endMode, endDate, endCount }` on mount and seed the local state. Phase 4 reuses this widget and will hit the bug as soon as it loads.

---

### IN-04: `DateTimePicker.setTimePart` accepts invalid hours/minutes and silently rolls over to the next day

**File:** `src/components/common/date-time-picker.tsx:71-79`
**Issue:** A user typing `25:99` into the time input produces `setHours(25, 99, 0, 0)` → JS Date overflow → moves the date forward 1 day and adds 1h39m. No validation, no error. The native `<input type="time">` typically prevents this, but custom clients or scripted input could bypass.
**Fix:** Clamp the parsed hour to 0–23 and minute to 0–59; on out-of-range, ignore the input.

---

### IN-05: `parseRrule` rejects a multi-rrule string (RRuleSet) but uses the wrong i18n key

**File:** `src/lib/rrule.ts:104-109`
**Issue:** When the input rrule string parses as an `RRuleSet` (e.g., contains both RRULE and EXRULE), the code throws `errors.calendar.rruleHorizonExceeded`. The actual condition is "compound rrule rejected" — a categorically different failure from horizon. Same root cause as WR-04.
**Fix:** Use `errors.calendar.rruleInvalid` (introduced via WR-04).

---

### IN-06: `event.declineParticipation` returns NOT_FOUND when the row is missing — collapses two distinct cases

**File:** `src/server/trpc/routers/calendar.ts:854-867`
**Issue:** A `NOT_FOUND` is returned when:
- The event itself is invisible to the caller (correct, D-36).
- The event is visible but the caller isn't a participant (arguably should be 409 or 403).
- The row was already declined (idempotent — should return 200 OK).
Distinguishing cases would help debugging.
**Fix:** SELECT first; if visible AND already declined, return `{ ok: true }` (idempotent). If visible but caller not in participants, throw `BAD_REQUEST` with `errors.calendar.notAParticipant`. Otherwise NOT_FOUND.

---

### IN-07: Conflict-banner re-uses `renderMarkdownBold` defined identically in two files

**File:** `src/components/calendar/conflict-warning.tsx:63-74` + `src/components/calendar/conflict-banner.tsx:60-69`
**Issue:** The 12-line helper is duplicated verbatim between the two components. If the XSS-safety contract changes (e.g., to support italic markers), both copies need updating in lock-step.
**Fix:** Extract `src/lib/markdown-bold.tsx` exporting `renderMarkdownBold(s)` and import from both.

---

### IN-08: Calendar `event.get` does not return the read-time computed `canEdit`/`canDelete` flags — clients re-derive role checks

**File:** `src/server/trpc/routers/calendar.ts:941-963`
**Issue:** `event.list` enriches each EventInstance with `canEdit` and `canDelete` (lines 360-363) — single source of truth. `event.get` returns only `{ event, extension, participants, exceptions }` — clients must independently re-compute `canEdit` based on the role the client knows about. The Detail Sheet always shows the Edit/Delete buttons (lines 181-186) and lets the server reject; a role-aware UI would hide them.
**Fix:** Return `canEdit`/`canDelete` from `event.get` too, computed server-side (creator OR TD).

---

### IN-09: Empty hint and create sheets default to `training_type_group` / `org_academy` magic strings hard-coded in client

**File:** `src/components/calendar/event-create-sheet.tsx:124-125`
**Issue:**
```ts
trainingTypeCode: 'training_type_group',
organisationCode: 'org_academy',
```
These literals depend on lookup-table seed rows existing with those codes. If the seed changes (Phase 1/Phase 2 already added/renamed lookup rows mid-project), the form will submit invalid codes and the server returns a FK violation, not a friendly i18n message. They should at minimum be derived from a server-fetched lookup list, or extracted into a shared const exported from `@/server/trpc/schemas/calendar.ts` (next to `EVENT_TYPE_CODES`).
**Fix:** Either remove the defaults (force the user to pick) or fetch the active lookup list and pick the first row's code. Same applies to extension-field text inputs which are entirely free-text in v1 (lines 437-520) and rely on the user knowing the exact lookup code — a Phase 5 polish item but worth noting.

---

_Reviewed: 2026-05-15T12:45:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
