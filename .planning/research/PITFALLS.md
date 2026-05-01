# Pitfalls Research — VTTL Topsportplatform

---

## Critical Pitfalls (will cause project failure if ignored)

### CRIT-1: UI-only permission enforcement

**What goes wrong.** Developers hide buttons or menu items for unauthorized roles and consider access control done. The API layer returns whatever the authenticated user's session requests. Any player who inspects network traffic or replays a request with a modified record ID can read another player's medical data, rankings, or evaluation feedback.

**Why it matters here.** This platform stores GDPR Art. 9 special-category medical data. A parent reading another child's injury scan, or a sparring partner reading any player's evaluation, is a reportable breach. With 6 roles and fine-grained visibility rules (player sees own only; parent sees own child only; trainer scoped to assigned academies) the attack surface is wide.

**Warning signs.**
- Authorization logic lives only in frontend components or route guards.
- API endpoints accept `player_id` or `session_id` as a URL parameter without ownership validation.
- Test suite has no cross-role data-access tests.
- A user can increment a record ID in the URL and get data back.

**Prevention strategy.**
- Enforce ownership at the data layer (row-level policy in Postgres / query filter in ORM) — not in the controller, and certainly not in the UI.
- Every query that fetches player-scoped data must be `WHERE player_id IN (players_visible_to(current_user))`. That function is the single source of truth for visibility.
- Write an automated test for every sensitive entity (medical_event, evaluation, ranking, match_result) that proves a player cannot read another player's record even with a direct API call.
- Medical data endpoints get an extra middleware check that verifies `can_access_medical(requester, subject)` regardless of general role.

**Phase to address.** Architecture (before any feature is built). Retrofitting row-level security to an existing schema that wasn't designed for it is extremely expensive.

---

### CRIT-2: Medical data not isolated from general player data

**What goes wrong.** Medical fields are added to the player profile table (`injury_type`, `doctor`, `scan_url`, etc.) or to a loosely scoped `medical_events` table that participates in the same visibility rules as training sessions. Any query join that pulls player context inadvertently pulls medical fields along.

**Why it matters here.** GDPR Art. 9 requires special-category data to be processed under a separate legal basis, access-logged, and protected with additional technical measures. If medical data is co-mingled with general profile data, you cannot satisfy Art. 9(1) without retrofitting the entire schema.

**Warning signs.**
- `players` table has columns like `last_injury`, `current_medication`, or `physical_notes`.
- Medical data is readable by anyone who can read the player record.
- No separate consent record for medical data processing.
- `SELECT *` from the player table in any dashboard query silently includes medical fields.

**Prevention strategy.**
- Isolate medical data in its own schema or table family (`medical_events`, `medical_documents`) with a separate permission bit (`can_access_medical`).
- Never `SELECT *` on player tables. Explicitly project columns in every query.
- Add access-logging (who read which patient's record, when) from day one.
- Define and record the GDPR legal basis and consent for medical processing before writing the first medical model.
- Scan uploads (the open question in the brief) must be stored in a separate bucket/prefix with tighter access policies than profile photos.

**Phase to address.** Data model design (Phase 1). Cannot be retrofitted cleanly.

---

### CRIT-3: Authorization model not encoded as data — hard-coded role checks scattered across codebase

**What goes wrong.** Developers write `if role == 'trainer'` checks in dozens of controllers, serializers, and service functions. When a new edge case emerges (e.g., a trainer who is also a sparring partner for some sessions) there is no single place to update — the fix must be hunted across the codebase and inevitably misses some paths.

**Why it matters here.** This project has 6 roles with overlapping scopes. Trainer-to-academy scoping, parent-to-child linking, and sparring-partner session scoping are all relationship-based constraints that cannot be expressed as simple role equality checks.

**Warning signs.**
- Authorization logic appears in serializers, view functions, and frontend components simultaneously.
- Permission changes require searching for role name strings across the codebase.
- A new role or a new relationship type requires changes in 15+ files.

**Prevention strategy.**
- Encode authorization as a policy layer (e.g., a `Policy` class or Postgres RLS policy per entity) that is the only place a visibility decision is made.
- Represent "player X is visible to user Y" as a derived table or function that joins roles, academy assignments, and parent-child links. All queries go through this.
- For Django: use a permission backend. For Node: use a centralized ability/policy library (CASL, Casbin). For Postgres: row-level security policies.

**Phase to address.** Architecture (Phase 1).

---

### CRIT-4: Timezone handling not established from day one

**What goes wrong.** Dates and times are stored as naive datetimes or as local time strings. The application works during development (everyone is in the same timezone), breaks when a tournament is abroad, and produces wrong calendar rendering when daylight saving time transitions occur (Belgium switches twice per year).

**Why it matters here.** Calendar is the central interface. Training sessions, tournaments, meetings, and stages all have start/end times. Match result dates come from international competitions in different timezones (WTT events in Asia, etc.). A single wrongly-stored timestamp means a training session appears on the wrong day in the calendar week view.

**Warning signs.**
- Database columns are `DATETIME` without timezone (`naive`) or `VARCHAR`.
- Application code uses `new Date()` or `datetime.now()` without `.utcnow()` or `timezone.now()`.
- No timezone field on tournament records.
- Frontend renders times without `toLocaleString` with explicit locale/timezone.

**Prevention strategy.**
- Store all datetimes as UTC in the database (`TIMESTAMPTZ` in Postgres).
- The only place local time appears is in the UI rendering layer.
- Tournament records carry a `timezone` field (IANA tz string, e.g. `Europe/Brussels`).
- Use a date library (Luxon, date-fns-tz, Python's `zoneinfo`) that handles DST transitions correctly. Never use raw JS `Date` arithmetic for duration calculations.
- Write a test that creates a training session at 23:00 CEST and verifies it renders on the correct calendar day after UTC round-trip.

**Phase to address.** Architecture (Phase 1, before calendar feature).

---

### CRIT-5: GDPR right to erasure not designed for

**What goes wrong.** User data is spread across 20+ tables with hard foreign key constraints. When a player requests deletion (Art. 17), the application either crashes (FK violation) or deletes the player row and silently breaks historical records (training sessions with null trainer, tournaments with null participants, rankings with orphaned entries).

**Why it matters here.** Players are minors. Parents have stronger erasure rights for their children's data. The platform stores medical data (highest erasure obligation). VTTL will eventually receive erasure requests.

**Warning signs.**
- All foreign keys to `users`/`players` are hard `ON DELETE RESTRICT` or `ON DELETE CASCADE` with no thought given to which is correct.
- No erasure run-book or tested procedure exists.
- Historical aggregate data (training counts, ranking history) would be destroyed by cascade deletion.

**Prevention strategy.**
- Design erasure from the start: distinguish between identity erasure (PII removed: name, photo, contact details replaced with anonymous token) and record deletion (the event itself is removed).
- For most entities: anonymize rather than delete — keep the historical record, replace identifying fields with `[verwijderd]` / a stable anonymous ID.
- Medical records: full deletion on request (no historical analytics justification overrides Art. 9 erasure).
- Consent records themselves must be retained (proof of lawful processing).
- Document the erasure procedure as a first-class feature, not a note-to-self.

**Phase to address.** Data model design (Phase 1). Cascades are set at schema creation.

---

## High-Risk Pitfalls (significant rework if hit)

### HIGH-1: N+1 queries on the calendar week view

**What goes wrong.** The calendar week view loads 7 days × potentially 20+ events per day. Each event render triggers a separate query for participants, trainer details, location lookup, and participation status. On a week with 50 events the page makes 250+ queries. The calendar — the most-used screen — is unusably slow.

**Warning signs.**
- Calendar API endpoint response time > 500ms in development with realistic data.
- ORM query log shows repeated identical queries in a loop.
- No `select_related` / `JOIN` / `include` / `preload` on event queries.
- Dashboard and calendar share no query optimization strategy.

**Prevention strategy.**
- Design a single calendar events query that returns all events for the requested date range, including all display fields, in one or at most a handful of queries.
- Use `BETWEEN` on indexed `start_time` columns.
- Eager-load participants, trainers, and location data in one join.
- Add a DB index on `(start_time, end_time, type)` for every event table from day one.
- Set a query count limit in tests: the calendar endpoint must not execute more than 5 queries regardless of event count.

**Phase to address.** Backend API design (Phase 2, calendar feature). Test with realistic seed data (200+ events across a month).

---

### HIGH-2: Single-table inheritance for event types

**What goes wrong.** To avoid complexity, all calendar event types (training session, tournament, meeting, stage, evaluation conversation, medical appointment, etc.) are stored in a single `events` table with a `type` discriminator column and 40+ nullable columns where most columns apply to only one type. Querying "all training sessions for trainer X" requires filtering a massive table. Adding a new event type requires ALTER TABLE. Validation rules per type are impossible to express in DB constraints.

**Why it matters here.** The brief specifies 8+ distinct event types with very different field sets (a training session has `training_type`, `organisation`, `quality_scores`; a stage has `country`, `player list`, `trainer list`; a tournament has its own model).

**Warning signs.**
- An `events` table with 30+ columns where most are NULL for any given row.
- `type` column with values like `'training'`, `'meeting'`, `'stage'`.
- Nullable foreign keys like `trainer_id` (NULL for meetings), `tournament_id` (NULL for training).

**Prevention strategy.**
- Use a polymorphic approach: a lean `calendar_items` table with common fields only (`id`, `start_time`, `end_time`, `created_by`, `visibility_scope`), then separate typed tables (`training_sessions`, `meetings`, `stages`, `evaluation_conversations`) that reference it. The calendar view queries `calendar_items` for the week view and lazy-loads type-specific details.
- Alternatively: entirely separate tables with no shared parent, and a UNION query for the calendar range. Simpler integrity, slightly more complex calendar query.
- Avoid ORM-level STI (Rails STI, Django polymorphic) — they solve the model layer but not the query performance layer.

**Phase to address.** Data model design (Phase 1).

---

### HIGH-3: Recurring event implementation done naively

**What goes wrong.** Recurring events are implemented by materializing all occurrences on creation (inserting 52 rows for a weekly training for one year). Editing "this and all future occurrences" becomes a bulk UPDATE. Cancelling one occurrence requires either deleting a row (loses the "cancelled" state) or adding a flag (complicates queries). The training schedule changes every 6 weeks due to tournament periods and all future occurrences need manual correction.

**Warning signs.**
- Recurring events create N database rows per occurrence.
- No `recurrence_rule` (iCal RRULE) field exists.
- "Edit single occurrence" is not possible without data model changes.
- Calendar query for next week must scan a table that contains 3 years of pre-generated occurrences.

**Prevention strategy.**
- Store recurrence as an RRULE string on the parent event record (RFC 5545). Expand occurrences in the application layer (not in the DB) for the requested date range.
- Maintain an `exception_dates` field (array of dates) for cancellations and a `modified_occurrences` table for per-occurrence overrides.
- This is the iCalendar/Google Calendar model — it is the proven approach. Libraries exist for every stack (rrule.js, python-dateutil RRULE).
- Test: edit "this and future" on a recurring training that has already had two individual overrides. Verify the overrides before the edit date are preserved.

**Phase to address.** Training session feature (Phase 2). Must be designed before building recurring support — retrofitting is a full rewrite.

---

### HIGH-4: Rankings time series stored as flat player fields

**What goes wrong.** Rankings are stored as `player.world_senior_ranking`, `player.belgium_ranking`, etc. — single current values. Historical tracking requires a separate table, which is added later and doesn't match the initial data. The ranking evolution graph on the dashboard has no data before the migration.

**Why it matters here.** The brief explicitly specifies rankings as time series (5 types per player, date-stamped). This is non-negotiable. But the mistake still happens because "let's start simple" leads to a flat field.

**Warning signs.**
- `players` table has columns named `*_ranking` or `current_ranking_*`.
- No `player_rankings` table with a `recorded_at` date.
- Dashboard ranking graph only shows the current value.

**Prevention strategy.**
- `player_rankings (id, player_id, type ENUM, value INT, recorded_at DATE, entered_by)` — this is the only rankings table, used for both current and historical. "Current" ranking is simply the latest entry per type per player.
- Never denormalize current ranking onto the player row. A view or materialized view can provide current rankings efficiently if needed.
- Seed with at least 12 months of historical data in the dev fixture to validate graph rendering from day one.

**Phase to address.** Data model design (Phase 1).

---

### HIGH-5: Parent-child account link not enforced at data layer

**What goes wrong.** The parent-to-child relationship is recorded in the UI but not enforced in queries. Parents see their child's data because the UI shows only the linked child — but the API accepts any `player_id` parameter. A parent who modifies the request can read any other player's profile.

**Warning signs.**
- Parent role check is `if role == 'parent' and player_id == request.player_id` in the controller.
- No `parent_child_links` table — parent's child ID is stored on the player row or in a session variable.
- No test verifying a parent cannot access a non-linked player's record.

**Prevention strategy.**
- `parent_child_links (parent_user_id, child_player_id, linked_at, linked_by)` — explicit table.
- `players_visible_to(user)` function (from CRIT-3) includes a subquery: `UNION SELECT child_player_id FROM parent_child_links WHERE parent_user_id = user.id`.
- Parents of minors (GDPR Art. 8) must have consent to process explicitly recorded — the link table is also the consent record.

**Phase to address.** User management feature (Phase 1).

---

### HIGH-6: File upload stored as raw URL strings with no access control

**What goes wrong.** Medical scan uploads are stored as public S3/storage URLs on the `medical_events` record. Anyone with the URL can access the file — no authentication required. URL enumeration (predictable filenames) exposes all medical documents.

**Why it matters here.** Medical scans are Art. 9 special-category data. A public URL is a GDPR breach by definition.

**Warning signs.**
- File URLs are `https://bucket.s3.amazonaws.com/uploads/scan_123.pdf`.
- The storage bucket has public-read ACL.
- Downloading a file does not require authentication.
- Files are named after patient IDs or incrementing integers.

**Prevention strategy.**
- All files in private storage. Access via short-lived signed URLs generated server-side, only when the requesting user has passed the `can_access_medical` check.
- Files named with UUIDs, not predictable IDs.
- Separate storage bucket/prefix for medical documents vs. profile photos vs. evaluation attachments — each with appropriate access policies.
- Profile photos: can be semi-public (only accessible to authenticated users, not the general internet).
- Evaluation attachments: accessible to trainer + TD + player subject.

**Phase to address.** File upload feature design (before first upload endpoint ships).

---

### HIGH-7: Messaging unread counts as synchronous query

**What goes wrong.** Inbox renders with a query: `SELECT COUNT(*) FROM message_recipients WHERE user_id = ? AND read_at IS NULL`. This runs on every page load (the unread badge appears in the nav). With group messages that expand to 50 recipients, inserts on send are slow (50 rows), and the count query scans a large table.

**Warning signs.**
- Unread count query takes > 50ms on a realistic dataset.
- Sending a group message to "all players" blocks the request thread for > 1 second.
- `message_recipients` table has no index on `(user_id, read_at)`.

**Prevention strategy.**
- Index `message_recipients (user_id, read_at)` from day one (partial index where `read_at IS NULL` is even better).
- Cache unread count per user in Redis/memory cache; invalidate on mark-read and on message receipt.
- Expand group recipients asynchronously (background job on send) — never synchronously in the request.
- Consider a denormalized `unread_count` field on the user record, incremented/decremented atomically.

**Phase to address.** Messaging feature design (Phase 2/3).

---

### HIGH-8: Dashboard N+1 on player view tabs

**What goes wrong.** The player view has 10 tabs. The dashboard tab tries to render training stats, ranking evolution, tournament results vs ambitions, evaluation summary, and medical/physical tracking simultaneously. Each widget makes its own separate API call (or worse, each widget is a separate ORM query triggered by template rendering). On a player with 3 years of history, the dashboard makes 15+ queries and is slow.

**Warning signs.**
- Each dashboard widget is a separate React component with its own `useEffect(() => fetch(...))`.
- No aggregation query — counts and stats are computed by loading all rows into application memory.
- Dashboard is fast in development (small dataset) but slow with production data.

**Prevention strategy.**
- Design a single `GET /players/:id/dashboard` endpoint that returns all widget data in one response, computed with aggregation queries.
- Use `GROUP BY` and `COUNT`/`AVG` in SQL rather than loading all records.
- For ranking evolution: query only the last 24 months of entries, not all-time history.
- Cache dashboard responses for 5 minutes (or invalidate on data write) — dashboard data does not need to be real-time.

**Phase to address.** Dashboard feature (Phase 3). Must be benchmarked with realistic multi-year player data before release.

---

### HIGH-9: Calendar week view mobile rendering

**What goes wrong.** The Outlook-style week view (7 columns × 16+ hour rows) is inherently a wide layout. On mobile (360px width) each column is ~45px — not enough to read event titles. Teams either abandon mobile support entirely (users complain) or add a "mobile calendar" that is a separate implementation with its own bugs.

**Warning signs.**
- Calendar component has no responsive breakpoint handling.
- Event cards truncate to unreadable lengths on mobile.
- Overlapping events (two sessions at the same time) are invisible on narrow columns.
- No design mockup for mobile calendar exists before development starts.

**Prevention strategy.**
- Decide the mobile strategy before writing calendar code, not after: (a) week view collapses to single-day view on mobile with swipe navigation, or (b) agenda/list view is the mobile default with a "switch to week" toggle.
- Option (a) is less work — a single-day column is just the week view with columns=1.
- Use a calendar library that supports both views (FullCalendar, react-big-calendar) rather than building from scratch, then customize theming.
- Test on 360px and 390px viewport widths during development, not as a final QA step.

**Phase to address.** Calendar feature (Phase 2). UI library selection must happen before development starts.

---

## Common Over-Engineering Traps

### OE-1: Building a generic notification system instead of targeted notifications

**What goes wrong.** A developer designs a fully generic notification system (notification types, templates, delivery channels, user preferences, read/unread per notification type) before any feature that actually needs notifications is built. This takes 3 weeks and delivers no user-visible value. When the first feature needs a notification, the generic system turns out not to fit.

**For this project.** v1 needs: calendar invite accept/decline notifications, message received alerts, and possibly training schedule changes. That's 2–3 notification types. Build them directly; generalize later if needed.

**Prevention.** Build the first notification type as a simple targeted email/in-app alert. Extract a pattern only when the second type is needed. Do not design a notification engine before knowing what you need to notify.

---

### OE-2: Building role/permission administration UI before the permission model is stable

**What goes wrong.** A dynamic role editor (create roles, assign permissions to roles, manage role assignments) is built in Phase 1. The permission model then changes 4 times during feature development. The admin UI must be rebuilt each time, or the model is frozen prematurely to avoid breaking the admin UI.

**For this project.** Roles are fixed (6 defined roles, not user-definable). The only role management needed is: assign a user to a role, link a trainer to academies, link a parent to a child. That's 3 data management screens.

**Prevention.** Do not build a generic permission editor. Build the specific assignment screens only.

---

### OE-3: Premature i18n infrastructure for a single-language app

**What goes wrong.** The Dutch-only app gets a full i18n framework (translation files, locale switching, pluralization rules, RTL support) set up before any UI is built. This adds complexity to every UI string and slows development. If a second language is never added, the infrastructure is pure waste.

**For this project.** The brief specifies Dutch UI only. VTTL is Flemish — a second language (French) might eventually be needed, but it is not in scope.

**Prevention.** Use a single translation file (`nl.json`) from day one to centralize all UI strings (this costs almost nothing and prevents hard-coded string proliferation). Do not build locale-switching infrastructure until a second language is actually required. The single translation file is enough for future extraction.

---

### OE-4: Over-indexing the database on day one

**What goes wrong.** Every table gets indexes on every column that could conceivably be queried. Write performance degrades. Index maintenance during bulk tournament result imports takes seconds. Developers believe they have solved performance; they have created a new problem.

**Prevention.** Add indexes driven by actual query patterns. Required from day one: primary keys, foreign keys, `start_time`/`end_time` on event tables, `(player_id, type, recorded_at)` on rankings, `(user_id, read_at)` on message recipients. Everything else: add when a slow query is identified.

---

### OE-5: Building audit logging before you know what needs auditing

**What goes wrong.** A comprehensive audit log (every INSERT/UPDATE/DELETE on every table, stored in an `audit_log` table) is built as a generic trigger. The audit table grows to millions of rows within months, slowing writes. The specific auditing GDPR requires (who accessed medical data, who changed a permission) is buried in noise.

**Prevention.** Build targeted audit logging for specifically required events: medical record access (GDPR requirement), permission changes, and erasure requests. A generic trigger on all tables is premature.

---

## Domain-Specific Pitfalls (Sports Management)

### DOM-1: Confusing club and academy — treating them as the same concept

**What goes wrong.** A player's "club" (stamclub — the affiliated recreational club, e.g. TTC Boom) and "academy" (the elite training structure, e.g. Academy Antwerpen) are merged into a single field. UI shows one club selector. Data integrity breaks: a player's club changes when they transfer to a different academy, or academy filtering by club returns wrong results.

**Warning signs.**
- Single `club_id` foreign key on the player record.
- Dropdown labeled "club/academie" in the UI.
- Academy manager's scope query uses the club field.

**Prevention.** Separate fields as specified in the brief. Academy is a lookup from the fixed list of 6 VTTL academies. Club is a free-text or separate lookup. They are never interchangeable. Enforce this distinction in the schema and the UI labels from day one.

---

### DOM-2: Tournament result entry not gated to the correct player

**What goes wrong.** The brief says players can only enter their own tournament results. If this is enforced only in the UI (not the API), any authenticated player can POST a result for a different player by modifying the `player_id` in the request. A player could manipulate another player's ranking-relevant result history.

**Prevention.** On the match result creation endpoint: `assert request.body.player_id == current_user.linked_player_id`. This is not just a UI concern — it is a data integrity rule that must be API-enforced.

---

### DOM-3: Ranking value type and direction not defined

**What goes wrong.** World and European rankings are ordinal (lower = better: rank 1 is the best). Belgium ranking may be a point score (higher = better). The dashboard graph renders "ranking improvement" — but without a defined direction per type, a drop from 150 to 120 could render as improvement or decline depending on which direction the code assumes.

**Warning signs.**
- `ranking_type` enum has no associated `direction` or `display_format` metadata.
- Graph Y-axis is the same for all ranking types.
- "Best" ranking is calculated with `MAX(value)` regardless of type.

**Prevention.** The `ranking_type` lookup table (or enum metadata) must carry: `direction ENUM('asc_is_better', 'desc_is_better')` and `display_label`. All ranking comparison logic (ambitions vs actuals, graph trends, "best ever") uses this direction field.

---

### DOM-4: Ambitions comparison not handling missing results

**What goes wrong.** The "ambition vs actual" comparison queries the latest tournament result for a player in a given tournament type for the current year. If the player hasn't competed yet, there is no result row, and the comparison query either errors, shows NULL, or (worst) silently omits the player from the ambitions overview.

**Prevention.** The ambitions query is a LEFT JOIN between ambitions and results, grouped by player/year/type. Missing results display as "not yet competed" — not as NULL or an error. This is a UX specification, not just a query correctness concern.

---

### DOM-5: Sparring partner treated as a session attribute at implementation time despite being modeled as first-class entity

**What goes wrong.** The data model correctly has a `sparring_partners` table. But when building the training session form, a developer adds a `sparring_partner_name` text field to the session (convenient for quick entry), bypassing the relation. Data diverges: some sessions reference the entity, others have a free-text name. Session filtering by sparring partner fails for the text-field entries.

**Prevention.** Enforce the relation at the database level: no `sparring_partner_name` text column on sessions. The only way to associate a sparring partner with a session is through the `session_sparring_partners` junction table. The UI must use a selector, not a text field.

---

### DOM-6: Age category calculated at query time from DOB, not stored

**What goes wrong.** Player age category (U11, U13, U15, U17, U19, Senior) is computed from DOB on every render. The category boundary year (the "category year" field in the brief) changes annually. A player who was U17 last season appears in the wrong filter when the code recalculates their current age instead of their competition-season age.

**Prevention.** Store `age_category` and `category_year` as explicit fields on the player record (as the brief specifies). Update them at the start of each season via a deliberate data update, not a derived calculation. Allow the TD to override them manually. Never derive age category live from DOB alone.

---

### DOM-7: Evaluation point scores not versioned

**What goes wrong.** The TD configures 8 evaluation points (e.g., "Techniek Forehand", "Mentale weerbaarheid", etc.) and trainers score them 1–10 on each evaluation. Later, the TD renames or reorders the evaluation points. Historical evaluations now show scores against wrong labels, or labels that no longer exist.

**Warning signs.**
- `evaluation_point_scores` stores only `evaluation_point_id` and `score` — no snapshot of the point name.
- Renaming an evaluation point updates the label for all historical evaluations.
- Deleting an evaluation point orphans its scores.

**Prevention.** Snapshot the evaluation point name onto the score record at the time of evaluation creation (store both the FK and the text label). Alternatively, soft-delete evaluation points (never update or hard-delete them), so historical evaluations always resolve to the original label. Deleting a point only hides it from future evaluations.

---

## Pitfall Reference Table

| # | Pitfall | Warning Signs | Prevention | Phase |
|---|---------|--------------|------------|-------|
| CRIT-1 | UI-only permission enforcement | Role checks only in frontend/route guards; no API-layer ownership validation | Row-level security or ownership filter in every query; cross-role automated tests | Architecture (P1) |
| CRIT-2 | Medical data not isolated | Medical fields on player table; no separate consent record; SELECT * on player | Separate table family; explicit column projection; access logging; separate storage bucket | Data model (P1) |
| CRIT-3 | Hard-coded role checks scattered | `if role == 'trainer'` in 15+ files; no central policy | Single `players_visible_to(user)` function; policy layer per entity | Architecture (P1) |
| CRIT-4 | Naive datetime/timezone storage | `DATETIME` columns without tz; `datetime.now()` without UTC; no tz on tournament | `TIMESTAMPTZ`; UTC storage; IANA tz on events; tz-aware date library | Architecture (P1) |
| CRIT-5 | Right to erasure not designed for | Hard CASCADE deletes; no anonymization strategy; medical data not deletable independently | Anonymize vs. delete distinction; erasure procedure as first-class feature | Data model (P1) |
| HIGH-1 | N+1 queries on calendar week view | 200+ queries per page load; no JOIN/preload; slow with realistic data | Single range query with eager load; index on start_time; query count test | Calendar feature (P2) |
| HIGH-2 | Single-table inheritance for events | 40+ nullable columns; type discriminator; ALTER for new event type | Lean shared table + typed child tables; or separate tables with UNION | Data model (P1) |
| HIGH-3 | Materializing recurring event occurrences | N rows per occurrence; no RRULE field; "edit single occurrence" not possible | RRULE string on parent; expand in app layer; exception_dates for cancellations | Training feature (P2) |
| HIGH-4 | Rankings as flat player fields | `player.world_ranking` column; no `player_rankings` table | Dedicated time-series table from day one; no denormalization | Data model (P1) |
| HIGH-5 | Parent-child link not enforced at API | Controller checks session variable; no `parent_child_links` table | Explicit link table; include in `players_visible_to` function | User management (P1) |
| HIGH-6 | File uploads stored as public URLs | Public S3 bucket; predictable filenames; no auth on download | Private storage; signed URLs; UUID filenames; separate medical bucket | File upload design (P2) |
| HIGH-7 | Messaging unread count as synchronous query | Slow nav badge; group send blocks request; no index on (user_id, read_at) | Indexed partial index; cached count; async group expansion | Messaging feature (P2/3) |
| HIGH-8 | Dashboard N+1 widgets | Each widget fetches separately; loads all rows for counts; fast in dev only | Single dashboard endpoint; aggregation queries; 5-min cache | Dashboard (P3) |
| HIGH-9 | Calendar week view not mobile-ready | No responsive breakpoints; 45px columns; no mobile strategy decided | Decide mobile strategy before coding; single-day collapse or agenda view | Calendar feature (P2) |
| OE-1 | Over-engineered notification system | 3 weeks on notification engine with no user feature yet | Build first 2–3 types directly; extract pattern on third | Any feature phase |
| OE-2 | Role admin UI before permission model is stable | Dynamic role editor in P1; model changes 4x | Build only the 3 specific assignment screens | P1 |
| OE-3 | Full i18n for Dutch-only app | Locale-switching infrastructure; RTL support | Single `nl.json` file; no switching infrastructure | Any UI phase |
| OE-4 | Over-indexing database on day one | Index on every column; slow bulk inserts | Index driven by actual queries; required set is small | Any DB phase |
| OE-5 | Generic audit log via triggers | Millions of audit rows; GDPR-required logging buried | Targeted audit for medical access, permission changes, erasure | Any phase |
| DOM-1 | Club/academy conflation | Single `club_id` FK; merged UI dropdown | Separate fields, separate lookups; schema enforced | Data model (P1) |
| DOM-2 | Tournament result entry not API-gated | Only UI check on player_id | Assert `player_id == current_user.linked_player_id` in endpoint | Results feature (P2) |
| DOM-3 | Ranking direction undefined | No direction metadata; `MAX(value)` for all types | `direction` field on ranking_type lookup; all comparison logic uses it | Data model (P1) |
| DOM-4 | Ambitions comparison failing on no result | NULL/error for players without results yet | LEFT JOIN; "not yet competed" display state | Ambitions feature (P2/3) |
| DOM-5 | Sparring partner bypassed as text field | Free-text name on session record; relation only on some sessions | No text column; junction table only; UI uses selector | Training feature (P2) |
| DOM-6 | Age category derived live from DOB | `getAgeCategory(player.dob)` called in queries | Explicit stored field; season-start update; TD override | Data model (P1) |
| DOM-7 | Evaluation point scores not versioned | Renaming a point changes historical labels | Snapshot label on score record or soft-delete points only | Evaluation feature (P2/3) |

---

*Research date: 2026-05-01*
*Based on: software engineering practice, GDPR regulatory requirements (Art. 7, 8, 9, 17, 25), database design patterns, sports platform architecture analysis, and review of the VTTL Topsportplatform PROJECT.md specification.*
