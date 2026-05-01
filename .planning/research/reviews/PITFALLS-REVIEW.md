# Pitfalls Review — Critical Pass

## Disputed Pitfalls (questionable)

### HIGH-9 is overstated
The original claims calendar week view on mobile is a "High-Risk" pitfall requiring fundamental redesign. This is wrong. The pitfall exists but the severity is mischaracterized. The prevention strategy itself undermines the claim: "week view collapses to single-day view on mobile" is a 2-hour front-end feature, not a multi-week rework. FullCalendar handles this with a single `windowResizeDetect` hook. The warning signs are weak (responsiveness is basic design, not a pitfall). Reclassify to a **UI/UX consideration**, not a high-risk pitfall. Actual risk: "decided NOT to support mobile calendar" is legitimate. Actual rework: building two separate implementations (web calendar + separate native mobile app) is the real trap, not the responsive design itself.

### HIGH-7 is presented as more complex than it needs to be
The original spends effort on async group expansion and denormalized counts. For v1, this is premature optimization. If messaging is Phase 2/3, the unread count will touch a small table (< 100k rows in early months). A simple partial index on `(user_id, read_at)` solves the problem. The cache and async expansion are good long-term practices but should not block the feature. The pitfall is real (group sends becoming slow as the platform grows), but the prevention strategy includes over-engineering that contradicts the project's stated philosophy. Recommend: "Phase v1: indexed query only. Phase v2/3: add cache and async if metrics show > 100ms response."

### CRIT-4 timezone language is overly dramatic
"breaks when a tournament is abroad" — yes, true. But the prevention strategy is correct and straightforward. This is not a pitfall that is easy to retrofit; it is a well-understood architectural decision. The warning signs are clear. The issue: the pitfall doesn't belong in "CRIT" (critical failure). A timezone mixup delays a feature by 3–5 days and is caught in QA when testing with international data. CRIT pitfalls are things that break the entire project (medical data leaking, permissions bypassed, erasure impossible). Timezone bugs are important but should be HIGH or MEDIUM, not CRIT. Reclassify to HIGH-10 (or rename CRIT-4 category).

---

## Missing Critical Pitfalls

### CRIT-6: Session/Token Fixation and CSRF
The document is silent on authentication pitfalls. For an elite athlete management platform with parental access, medical data, and tournament entry:
- **Session fixation**: An attacker tricks a parent into using a pre-set session token, then watches the parent's requests. The platform never validates that the session was initiated by the user themselves (e.g., no post-login re-authentication for sensitive actions like changing parent-child links or accessing medical data).
- **CSRF on state-changing actions**: Modifying tournament results, accepting/declining calendar events, updating evaluation scores via a simple POST with no CSRF token. An attacker embeds `<img src="https://topsport.vttl/api/evaluate/123?score=2">` on a forum post; any trainer viewing the post submits the form.
- **Token leakage in logs/errors**: Auth tokens appear in error messages, browser console logs, or application logs (not redacted).

**Prevention**: (a) Use httpOnly, Secure, SameSite=Strict cookies for session tokens. (b) CSRF tokens on every state-changing action (change, delete, create, update). (c) No sensitive data (tokens, user IDs) in error responses; log to server only. (d) Re-authenticate on sensitive actions (linking parent-child, accessing medical data, changing email).

### CRIT-7: Audit Logging and Accountability for Medical Access
The original mentions access-logging as part of HIGH-6 (medical data isolation) but buried. GDPR Art. 32(b) and recital 32 require documented access control. Art. 5 requires accountability. If a parent's request for their child's medical data is not logged (who, when, which records, outcome), the platform cannot prove compliance or investigate a breach.

**Warning signs**: 
- No `access_log` table or separate audit facility for medical endpoints.
- Medical data access is logged at the general application level (no distinction from reading a calendar event).
- No way to answer "who accessed player 123's medical records in the last 30 days?"

**Prevention**: Separate audit table for medical access only: `medical_access_audit (id, user_id, player_id, record_type, action, timestamp, ip_address, outcome)`. Automatic on every medical endpoint; cannot be disabled. Tie to the consent record (the parent-child link or explicit consent) — if the link is deleted, the access log is preserved.

### CRIT-8: Data Backup and Disaster Recovery Not Mentioned
The brief specifies GDPR compliance, but no mention of data retention, backup strategy, or recovery procedure. If the database is corrupted or lost:
- Medical records are unrecoverable (breach notification required).
- Historical rankings cannot be restored (affects player progression tracking).
- Tournament results are lost (impacts federation reporting).

**Warning signs**: No mention of backup testing, RTO/RPO, or recovery procedures.

**Prevention**: (a) Daily automated backups to geographically separate storage (not on the same server). (b) Tested recovery procedure: monthly restore a backup to a test database and verify data integrity. (c) Document RTO (recovery time objective: < 4 hours) and RPO (recovery point objective: < 1 day of data loss). (d) For medical records: separate immutable archive (once written, cannot be deleted except by explicit erasure request).

### HIGH-10: Logging Pitfalls (PII in logs, Unbounded Log Growth)
Not mentioned. For a GDPR-sensitive platform with medical data and parental relationships:
- **PII in application logs**: A trainer debugs a slow query and logs `SELECT * FROM evaluations WHERE player_id = 123 AND player_name = 'Jan Hendrik van der Perre'` — the log file now contains PII.
- **Unbounded log growth**: The application logs every training session participant lookup. After one year, logs are 500 GB and log rotation is not configured.
- **Sensitive headers in logs**: Request headers (Authorization, Cookie) are logged for debugging; tokens leak into production logs.

**Prevention**: (a) Redact PII from logs (names, emails, phone numbers replaced with `[REDACTED]` or user IDs). (b) Do not log full request/response bodies for authenticated endpoints. (c) Configure log rotation by size and retention (e.g., 30 days for app logs, 90 days for audit logs). (d) Use structured logging (JSON) and filter sensitive fields at the logger configuration level, not in application code.

### HIGH-11: Email Delivery and SPF/DKIM for Notifications
Notifications (calendar invites, message alerts, reset links) are in scope but no mention of email infrastructure:
- **No SPF/DKIM**: Emails from `noreply@vttl.be` are spoofable if SPF record missing. Phishing attacks bypass filters.
- **Deliverability**: A mass reset link email to 500 players is sent from the application server. The ISP rate-limits or rejects the batch. Players don't receive reset links.
- **Reset link expiration not enforced**: A password reset link is valid forever if the `expires_at` field is not checked.

**Prevention**: (a) Configure SPF, DKIM, DMARC on the domain before the first email is sent. (b) Use a transactional email service (SendGrid, Mailgun) for outbound notifications — never send from the app server. (c) Password reset links expire after 1 hour; other links (calendar invites) after 7 days. (d) Do not send sensitive tokens (reset codes) in the email body; use a time-limited link that validates on click.

### HIGH-12: Search Index Staleness and Partial Matches
If full-text search is planned (find tournaments, find players in academy):
- **Stale index**: A player is added to the database but doesn't appear in search results until a manual reindex.
- **Partial match confusion**: Searching "van der" should find "Jan van der Perre" but the index stores only complete words.
- **Ranking search weight**: Searching "player" returns results in random order, not sorted by relevant ranking (staff comes before active players).

**Prevention**: (a) Set up automatic index updates on row insert/update (done by the search library automatically if done right). (b) Test search with realistic data; define minimum match threshold. (c) Define result weighting (staff role, active player, archived player) and sort by relevance score first, then alphabetically.

### HIGH-13: Concurrency and Race Conditions on Participation Entry
A player can register for a sparring session that has a limited number of spots (e.g., 10 max). Two players click "Join" simultaneously:
- Player A query: SELECT COUNT(*) FROM participation WHERE sparring_session_id = 5 → 9 (< 10, go ahead).
- Player B query: SELECT COUNT(*) FROM sparring_session_participation WHERE session_id = 5 → 9 (< 10, go ahead).
- Both insert. Now 11 people are registered for a 10-person session.

Also relevant for duplicate tournament result entry: a player submits the same result twice in quick succession.

**Prevention**: (a) Use database-level constraints: `CHECK (participants <= 10)` or trigger that enforces the limit. (b) Use explicit locking: `SELECT count(*) FROM participation WHERE session_id = 5 FOR UPDATE` before insert. (c) Make the insert operation idempotent: if the same result is submitted twice, the second insert is a no-op (unique constraint on player_id + tournament_id + date + opponent).

### HIGH-14: Data Migration and Zero-Downtime Deployment
Once the platform is live, changing the schema (e.g., adding the `parent_child_links` table or renaming a column) while the application serves traffic is error-prone:
- A migration adds a `NOT NULL` constraint to a column without a default. Old application code that doesn't provide the value fails.
- A backfill query updates 100k rows in a long transaction, blocking read queries.
- The migration succeeds but the application still uses the old column name — data diverges.

**Prevention**: (a) Use the expand-contract pattern: add the new column, backfill with a separate background job, switch application code to the new column, then drop the old column (all in separate deploys). (b) Backfill in small batches (1000 rows per transaction) with a delay between batches to avoid locking. (c) Test migrations on a production-like database before deploying (size, indexes, live traffic simulation).

### HIGH-15: Mobile and Browser Compatibility Beyond Calendar
- **Missing mobile API endpoints**: The API returns full tournament objects with all fields. A mobile client with slow 4G loads > 5 MB per request.
- **No API versioning**: UI and API are tightly coupled. Adding a new field to the player response breaks older mobile app versions.
- **Browser feature assumptions**: The frontend assumes localStorage, WebGL (for rankings graph), or ES6 features unsupported in older browsers.

**Prevention**: (a) API should support a `?fields=id,name,ranking` query parameter to return only requested fields. (b) Versioning: `/api/v1/players/123` (or use Accept headers). (c) Test on real mobile (not just browser dev tools) and at least two browser versions back (Chrome N and N-1).

### HIGH-16: Caching Pitfalls
- **Stale dashboard data**: Player's ranking is cached for 5 minutes. They enter a new tournament result. The dashboard still shows the old ranking until the cache expires.
- **Cache invalidation on related changes**: A player's academy is updated. The "players by academy" list is cached but not invalidated. Old academy still shows the player.
- **Cache key collisions**: Two trainers with similar IDs end up seeing the same cached "my students" list.

**Prevention**: (a) Define what data is safe to cache (rankings, static lookups) vs. what requires fresh reads (medical data, participation status). (b) Invalidate caches explicitly on write: if a ranking is entered, invalidate the player's dashboard cache. (c) Include user ID in cache keys: `dashboard:player:123:trainer:456` not `dashboard:player:123`.

### HIGH-17: File Upload Pitfalls Beyond Access Control
HIGH-6 addresses access control but misses:
- **File size limits not enforced**: A trainer uploads a 2 GB video file; storage quota is exhausted.
- **Malware in uploads**: A medical scan upload is a JavaScript file disguised as a PDF. If the file is served with `Content-Type: application/pdf` but is actually JS, browsers may execute it.
- **File type validation only on extension**: User renames `malware.exe` to `scan.pdf` and uploads. The application checks the extension and stores it.

**Prevention**: (a) Enforce file size limits (5 MB for medical scans, 50 MB for videos) at the API level. (b) Validate file type by magic bytes (file signature), not extension. (c) Scan uploads with a malware scanner (ClamAV) or an external service (VirusTotal API). (d) Serve uploads with strict `Content-Type` headers and `Content-Disposition: attachment` to prevent browser execution.

---

## Missing Domain-Specific Pitfalls

### DOM-8: Tournament Result Entry Retroactive Changes and Dispute Resolution
The brief says players can enter their own tournament results. But what happens when:
- A player enters a result as a loss but later realizes they won (e.g., typo in opponent name)?
- An opponent (another player) disputes the result ("No, you lost, not won")?
- A TD needs to correct a result because it conflicts with the federation's official record?

Current state: no mention of edit permissions, version history, or dispute workflow.

**Warning signs**:
- Result entry is one-way (insert, not edit).
- No "edit history" visible to trainers or the TD.
- No dispute/approval workflow.
- Results are immediately published to ranking calculations.

**Prevention**: (a) Allow players to edit their own results within 48 hours. (b) Store edit history (who changed what, when). (c) Results have a `status` field: `'draft'` (player entered), `'confirmed'` (TD approved), `'disputed'` (opponent flags it). Only confirmed results feed into rankings. (d) The TD has a dispute resolution page showing all flagged results with evidence (photo, opponent testimony).

### DOM-9: Ranking Source-of-Truth Conflicts (Federation vs. Internal Entry)
VTTL reports to international federations (ITTF, European federation). Rankings come from multiple sources:
- **ITTF world ranking**: official source, updated weekly.
- **European ranking**: official source, updated monthly.
- **Belgium national ranking**: VTTL-managed (players enter their own, TD confirms).
- **Internal VTTL academy ranking**: derived from local tournament results.

The brief specifies all four. But no mention of:
- What happens if the internal ranking contradicts the ITTF official ranking (e.g., player entered a fake result).
- Which ranking is used for ambitions comparison and "on track" status.
- How does the platform handle a player's federation ranking changing after they've already set an ambition?

**Prevention**: (a) Separate columns and tables: `world_ranking` (synced from ITTF API weekly), `belgium_ranking` (internal entry), `academy_ranking` (calculated from sessions). (b) The "on track" dashboard uses `belgium_ranking` or `academy_ranking`, not the federation ranking (which the player doesn't control). (c) If a federation ranking updates and conflicts with the player's ambition, flag it to the TD for review, don't silently update the ambition.

### DOM-10: Age Category Mid-Year Changes and Category-Year Boundaries
The brief says age categories (U11, U13, etc.) have a "category year" that changes annually. But:
- A player born in March 2010 is U15 during the 2024–2025 season (category year 2024: born 2009+). On June 1, 2025, they turn U17 (born 2008+) even though the 2025–2026 season hasn't started.
- Tournament entry is open (player selects their category). An error in the online form: player enters U15 despite being U17 by age. Do they compete as U15 (age-fraudulent) or get moved to U17 (lost their entry)?

**Prevention**: (a) Store `age_category` as a snapshot with `effective_date`: if the TD updates category on June 1, 2025, tournaments after that date use the new category. (b) Tournament entry: category selection is required but validated against the player's age and the tournament's date. (c) If a player is entered in the wrong category, the form must flag it; allow the TD to override with a comment.

### DOM-11: Sparring Partner Availability Conflicts
A training session can have multiple sparring partners. Each sparring partner has their own schedule. But:
- Sparring partner A is added to a Tuesday session, then later the sparring partner marks Tuesday as unavailable (vacation, injury, conflicting match). The session still lists A as a sparring partner.
- Two sessions on the same day both request the same sparring partner. Who goes?

**Prevention**: (a) Sparring partner availability is a separate calendar (like a personal calendar). Before confirming a session with a sparring partner, check their availability. (b) Session creation validates: "Sparring partner X is not available on this date" and offers to remove them or suggest an alternative date. (c) If a sparring partner marks a date unavailable after being assigned to a session, the system sends a notification to the trainer: "Sparring partner X marked Tuesday as unavailable; re-assign or cancel?"

### DOM-12: Medical Event Conflicts with Training Schedule
A player is entered into a training session, but a medical appointment (injury recovery, scan, therapy) is scheduled at the same time. The platform stores both in the calendar but doesn't detect the conflict.

**Prevention**: (a) When a training session is created, check for overlapping medical events. (b) Flag the conflict: "Player X has a medical appointment (shoulder PT) at 14:00 on Tuesday; the training session starts at 14:15." (c) Require the trainer to explicitly confirm the overlap (the player is cleared to train) or reschedule.

### DOM-13: Evaluation Feedback Sharing and Participant List
An evaluation is conducted (e.g., trainer scores a player on 8 points). The brief doesn't specify:
- Who can read the evaluation feedback? (Player only? Parent? All trainers? TD?)
- Can the player see the raw scores or only a summary?
- If a trainer writes sensitive feedback ("lacks focus", "attention span poor"), is that visible to parents?

**Prevention**: (a) Evaluation permissions: player sees own scores (anonymized numeric), parent sees own child's scores (detail level configurable by TD), trainer sees all evaluations they created, TD sees all evaluations. (b) Sensitive fields (trainer notes) are visible only to TD and the player's own trainer, not to the player or parent. (c) Evaluation history: player sees their own evaluation over time (e.g., "improvement in techniek from 6 to 7 over 3 sessions"), not individual scores.

---

## Weak Prevention Strategies

### CRIT-3: The "single policy function" is vague
The original says: "`players_visible_to(user)` function is the single source of truth." But:
- Does the function return a list of player IDs, a subquery, or a predicate?
- How does it handle circular dependencies (if a trainer manages an academy whose TD is also a trainer, does the function recurse)?
- What language/ORM is it written in? If it's in Postgres, it can't be used by a frontend API filter.

**Improvement**: Be more specific. For Postgres:
```sql
CREATE FUNCTION players_visible_to(user_id UUID) RETURNS TABLE(player_id UUID) AS $$
SELECT player_id FROM players WHERE owner_id = user_id  -- players who are the user themselves
UNION
SELECT child_player_id FROM parent_child_links WHERE parent_user_id = user_id  -- children
UNION
SELECT p.id FROM players p
  JOIN academy_assignments a ON p.academy_id = a.academy_id
  WHERE a.trainer_user_id = user_id  -- players in assigned academies
$$ LANGUAGE SQL;
```
All queries filter: `WHERE player_id IN (SELECT player_id FROM players_visible_to(current_user_id))`.

### HIGH-3: Recurring event prevention is incomplete
The original recommends RRULE but doesn't address:
- **Versioning of the parent event**: If a trainer creates a weekly training for a year, then realizes the training needs to move 30 minutes earlier mid-season, does the RRULE change retroactively (breaking the schedule before the change) or only for future occurrences?
- **Cancellations vs. rescheduling**: If Tuesday's session is cancelled, is the date in `exception_dates`, or is there a separate `rescheduled_to` field?
- **Participant impact**: If a recurring session is edited, do all past and future occurrences need to notify participants?

**Improvement**: Define a `recurrence_change_strategy` field (RETROACTIVE / FUTURE_ONLY). Default to FUTURE_ONLY. Require explicit confirmation from the trainer if RETROACTIVE.

### HIGH-6: Signed URL expiration is mentioned but not detailed
The original says "short-lived signed URLs." But:
- How short? (5 minutes? 1 hour?)
- Does the URL include a rate limit (prevent brute-force downloads of all medical scans)?
- If a medical record is marked for deletion (right to erasure), are existing signed URLs still valid?

**Improvement**: Signed URLs expire after 5 minutes. Rate limit: 10 downloads per URL. If the record is deleted, all signed URLs become invalid immediately (issue a 403 or redirect to an erasure confirmation page).

### HIGH-8: Dashboard cache invalidation strategy is absent
The original recommends "cache for 5 minutes." But which endpoints trigger invalidation?
- If a ranking is entered, invalidate the player's dashboard. But what if a new training session is created? Does that invalidate the dashboard (if training count is displayed)?
- Cache key strategy: is the cache shared across all trainers viewing the same player's dashboard?

**Improvement**: List cache invalidation triggers explicitly:
- Player ranking entered → invalidate `dashboard:player:X:*`
- Training session created/updated → invalidate `dashboard:player:X:*` if X was a participant
- Evaluation created → invalidate `dashboard:player:X:*`

### DOM-2: Tournament result entry API check is correct but needs test specification
The original says: "assert `player_id == current_user.linked_player_id`." But:
- What if the user is a trainer (not a player)? Trainers can enter results for their assigned players. The check should be: `assert player_id in (players_managed_by(current_user))`.
- What's the error response? 403 Forbidden? 400 Bad Request?

**Improvement**: Expand to all roles:
```
Endpoint: POST /api/tournament-results
- If user is a player: player_id must equal their own player_id
- If user is a trainer: player_id must be in their assigned academy's player list
- If user is TD: any player_id is allowed
Otherwise: 403 Forbidden
```

---

## What the Original Got Right

### 1. **CRIT-1, CRIT-2, CRIT-3 are genuinely critical**
The emphasis on row-level security, medical data isolation, and centralized authorization is correct. These are not easily retrofitted and will cause serious problems if missed.

### 2. **CRIT-5 (Right to Erasure) is appropriately scary**
The distinction between anonymization and deletion, and the special handling of medical records, shows understanding of GDPR's nuance. "Cascading deletion silently breaks historical records" is exactly right.

### 4. **HIGH-2 (Single-Table Inheritance) is the right pitfall at the right severity**
The recommendation to use polymorphic tables is sound. Rails STI is a common trap, and the document correctly identifies that it solves the model layer but not the query layer.

### 5. **HIGH-3 (Recurring Events) is well-researched**
The mention of RRULE, exception_dates, and modified_occurrences shows familiarity with the iCalendar standard. This is the correct approach.

### 6. **Domain pitfalls (DOM-*) show strong understanding of the problem space**
DOM-1 (club vs. academy), DOM-3 (ranking direction), DOM-6 (age category as a snapshot), and DOM-7 (evaluation point versioning) are all from experience. They are not generic software engineering pitfalls; they are specific to sports management.

### 7. **Over-Engineering Traps (OE-*) are pragmatic**
OE-1 (notification system), OE-2 (role admin UI), and OE-4 (over-indexing) show restraint and experience. The advice to "build the first type directly" is right.

### 8. **Reference table is useful and comprehensive**
The final table serves as a quick-reference checklist for the team. The structure (Pitfall | Warning Signs | Prevention | Phase) is clear.

---

## Summary

**Strengths**: The document correctly identifies the real show-stoppers (permissions, medical data, GDPR), understands the domain (sports management pitfalls are nuanced and specific), and avoids over-engineering advice. The prevention strategies are mostly concrete.

**Gaps**: Authentication/session security, audit logging, backup/disaster recovery, logging PII, email deliverability, search indexes, concurrency, data migrations, caching invalidation, and several domain-specific gotchas (ranking source-of-truth, evaluation privacy, tournament result disputes).

**Soft spots**: A few HIGH pitfalls (HIGH-7, HIGH-9) are either premature optimization or overstated. Prevention strategies for CRIT-3 and HIGH-3 lack implementation specifics.

**Recommendation**: Keep the core document. Add a second document (PITFALLS-ADDITIONS.md) covering the missing critical and high-risk pitfalls. Do not merge them into this one; the original is well-structured and focused. Provide the additions as a supplement for Phase 1 review.
