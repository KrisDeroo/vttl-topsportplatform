# Pitfalls — Additions from Critical Review

*Generated: 2026-05-01 | Source: Haiku 4.5 critical review of PITFALLS.md, validated and curated*

This document **supplements** `.planning/research/PITFALLS.md`. The original document remains the primary reference; this file captures additional pitfalls and corrections identified during the multi-model review pass.

---

## Reclassifications from Original

### CRIT-4 → HIGH-CRIT-4: Timezone storage
The original classified naive datetime storage as critical. It is high-risk but not project-killing — timezone bugs are caught in QA when testing with international tournament data, not in production after months of operation. Reclassify to HIGH; the prevention strategy in the original is correct as-is.

### HIGH-9 → UX-9: Calendar mobile rendering
The original treats responsive calendar layout as a high-risk pitfall requiring fundamental redesign. Reality: FullCalendar 6 supports `windowResizeDetect` and view-switching out of the box — this is a 2-hour UI feature, not architectural rework. Reclassify to UX consideration. The actual risk is choosing to build native mobile separately from the web app — that is the trap.

### HIGH-7 → simplify for v1: Messaging unread count
The original recommends async group expansion + denormalized counts + cache layer. For v1 (50–200 users, < 100k messages in year 1), an indexed partial query is sufficient: `CREATE INDEX ... ON message_recipients (user_id) WHERE read_at IS NULL`. Add caching only if metrics show > 100ms response time after launch.

---

## Missing Critical Pitfalls

### CRIT-6: Authentication and session security
**What goes wrong.** No CSRF tokens on state-changing endpoints. Session fixation: an attacker pre-sets a session cookie before a parent logs in, then replays the parent's authenticated requests. Auth tokens leak into application logs or error responses. Sensitive actions (linking parent-child, accessing medical data, changing email) do not require re-authentication.

**Warning signs.**
- No CSRF token validation on POST/PUT/DELETE endpoints (Better Auth handles cookie-based session security; CSRF still must be checked for cross-origin protection)
- Auth headers (Authorization, Cookie) appear in log payloads without redaction
- A single login session has access to all sensitive operations indefinitely
- Password reset links never expire

**Prevention.**
- Cookie-based sessions: `httpOnly`, `Secure`, `SameSite=Lax` (Better Auth defaults)
- CSRF protection on state-changing tRPC mutations (built into tRPC's CSRF helper)
- Re-authentication required for: linking parent-child, viewing full medical record, exporting data, executing erasure
- Auth tokens never logged; pino redact filter on `req.headers.authorization` and `req.headers.cookie`
- Password reset links expire in 1 hour; magic links in 15 minutes

**Phase to address.** Phase 1 (auth implementation).

---

### CRIT-7: Backup and disaster recovery not designed
**What goes wrong.** PostgreSQL on a single Supabase instance is corrupted, accidentally truncated, or hit by ransomware. There is no defined RTO (recovery time objective) or RPO (recovery point objective). Backups exist but have never been tested with a restore drill — when a real incident happens, the team discovers the backup was incomplete or unrestorable.

**Warning signs.**
- Supabase automatic backups enabled but no documented restore procedure
- No periodic restore drill (monthly, to a staging environment)
- No geographic backup redundancy (only one region)
- Medical records backup retention not documented (Belgian law requires 30 years for patient health records)

**Prevention.**
- Supabase Pro tier: daily automatic backups, point-in-time recovery (PITR) enabled
- Documented RTO ≤ 4 hours, RPO ≤ 1 hour
- Monthly restore drill: restore latest backup to a staging Supabase project, validate row counts and data integrity, document timing
- Geographic redundancy: enable Supabase backup replication to a second region
- Medical records archival: monthly cold export to encrypted S3-compatible storage with 30-year retention policy (separate from operational backups)

**Phase to address.** Phase 1 (initial Supabase setup) for backup configuration; Phase 8 for restore drills and DR documentation.

---

### CRIT-8: Audit log for medical access scoped narrowly and tested
**What goes wrong.** GDPR Art. 32(b) and recital 32 require documented access control for special-category data. The original document mentions audit logging but does not specify: which fields, retention, who can query, write performance under load.

**Warning signs.**
- Medical access events go to a generic application log mixed with calendar reads and login events
- No way to answer "who accessed player X's medical records in the last 30 days?"
- Audit log table is the same shape and access controls as application logs

**Prevention.**
- Dedicated `medical_access_audit` table, append-only, separate access controls (TD-only read access via dedicated tRPC procedure)
- Schema: `(id, actor_user_id, subject_player_id, record_type, action, timestamp, ip_address, request_id, outcome)`
- PostgreSQL trigger on every read of `medical_events` and `medical_documents` (note: SELECT triggers don't exist in vanilla PostgreSQL — must implement via application-layer middleware on `medicalProcedure`)
- Retention: 6 years minimum for medical access (GDPR + Belgian medical data law); partition by year for query performance
- Async write via background job to avoid blocking medical record reads; never block the user response on audit log persistence
- Test that audit log cannot be deleted or updated by application user (only INSERT permitted via Postgres role separation)

**Phase to address.** Phase 1 (medical schema + audit log table); Phase 5 (audit log enforcement on medical reads).

---

## Missing High-Risk Pitfalls

### HIGH-10: PII in logs and unbounded log growth
**What goes wrong.** Application logs contain player names, emails, phone numbers because they are passed through pino as part of structured logging metadata. Log retention is uncapped — after one year, logs are 500GB and increasingly slow to query. Sensitive headers (Authorization, Cookie, X-API-Key) end up in logs because the team forgot to configure redaction.

**Prevention.**
- Pino redact filter configured globally: `['req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]', '*.password', '*.email', '*.phone', '*.medical_*']`
- Structured logging: never log full request/response bodies for authenticated endpoints — log entity IDs only
- Log rotation: 30 days for application logs, 90 days for audit logs, 6 years for medical access audit
- Use external log aggregation (Logflare or Axiom for EU residency) — do not store logs in the application database

**Phase to address.** Phase 1 (logging configuration before any feature ships).

---

### HIGH-11: Email deliverability and SPF/DKIM/DMARC
**What goes wrong.** Notifications are sent from `noreply@vttl.be` via Mailgun without SPF, DKIM, or DMARC records configured. Deliverability is poor: 30% of password reset emails land in spam. Phishing emails spoofing `noreply@vttl.be` reach users because there is no DMARC policy. A bulk notification (broadcast to all 200 players) trips the SMTP rate limit.

**Prevention.**
- Configure SPF record: `v=spf1 include:mailgun.org -all`
- Configure DKIM with the email provider before first send
- Configure DMARC: `v=DMARC1; p=quarantine; rua=mailto:dmarc@vttl.be` (start with `none`, escalate to `quarantine` then `reject` after monitoring 30 days)
- Use a transactional email service (Mailgun EU, SendGrid EU) — never send from the application server SMTP
- Bulk sends batched and rate-limited at the API level (max 100 emails/min per process)
- Test deliverability before launch: send to test inboxes on Gmail, Outlook, Apple Mail; check spam classification

**Phase to address.** Phase 8 (release prep, but configure DNS records during Phase 1).

---

### HIGH-12: Concurrency / race conditions on participation entry
**What goes wrong.** Two trainers simultaneously add a player to a session — both succeed, creating a duplicate participation row. A player submits the same tournament result twice in quick succession. Two parents simultaneously confirm their child for an evaluation conversation — both writes succeed, but the second one silently overwrites the first.

**Warning signs.**
- No unique constraints on natural keys (player_id + session_id)
- No optimistic concurrency check (`updated_at` versioning)
- No idempotency key on user-submitted writes

**Prevention.**
- Unique constraints: `UNIQUE (player_id, session_id)` on `training_session_participations`; `UNIQUE (player_id, tournament_id, round, opponent, date)` on tournament match results
- Idempotency keys on POST endpoints — client sends a UUID; server rejects duplicate UUIDs within 24h window
- Optimistic concurrency: every editable record has `updated_at` and `version`; updates check `WHERE id = X AND version = Y`
- Database-level constraints over application-level checks — application checks have race windows

**Phase to address.** Phase 4 (training participation), Phase 4 (tournament results), Phase 5 (evaluation conversations).

---

### HIGH-13: Zero-downtime migration strategy
**What goes wrong.** A schema migration adds a `NOT NULL` constraint to an existing column without a default — the migration succeeds in dev (empty rows) but fails in production (existing rows). A column rename breaks live traffic during deployment because old code reads the old column. A backfill query updates 100k rows in a single transaction, locking the table and blocking reads for 90 seconds.

**Prevention.**
- Expand-contract pattern for schema changes: add new column → backfill in batches → switch reads → drop old column (each step is a separate deploy)
- Backfill in batches: 1000 rows per transaction with 100ms delay between batches
- Test all migrations against a production-sized staging database before deploy
- Drizzle Kit migrations are versioned and idempotent — never edit a committed migration; always add a new one
- Document a migration playbook: `1. Test on staging, 2. Deploy with `--skip-pending` (manual approval), 3. Monitor query times during migration, 4. Rollback procedure if migration runs > 5 min`

**Phase to address.** Phase 1 (migration tooling); enforce throughout all phases.

---

### HIGH-14: File upload validation beyond access control
**What goes wrong.** A trainer uploads a 2GB video as a "medical scan" — Supabase Storage quota is exhausted within hours. A user uploads `malware.exe` renamed to `scan.pdf`; the application checks the extension and stores it. Later, when another user downloads the file, the browser receives a `Content-Type: application/pdf` header but the file is actually JavaScript — the browser may execute it.

**Prevention.**
- File size limits enforced at the API level: 5MB for medical documents, 2MB for profile photos, 50MB for video links (v1 = external URLs only, no upload — defer this limit to v2)
- File type validation by magic bytes (file signature), not extension — use `file-type` npm package
- Whitelist of allowed MIME types per upload endpoint: PDFs and images for medical, images only for profile, none for v1 video
- Malware scanning: integrate with VirusTotal API or ClamAV daemon — file is quarantined until scan passes
- Serve uploads with strict `Content-Type` headers and `Content-Disposition: attachment` for downloads (prevents browser execution of mislabeled files)
- Storage path uses UUID, never the original filename or the user's input

**Phase to address.** Phase 2 (file upload infrastructure for profile photos).

---

### HIGH-15: API rate limiting and brute-force protection
**What goes wrong.** No rate limiting at the API level. An attacker brute-forces login by submitting 1000 password guesses per second — Better Auth's built-in lockout helps, but the API server is also overloaded. A user discovers they can spam tournament result submissions at 100/s, polluting another player's record. A single broken client polls the calendar endpoint at 10Hz, consuming database connections.

**Prevention.**
- Login rate limit: 5 failed attempts per account per 15 minutes (Better Auth handles this)
- API rate limit: 100 requests/minute per user, 1000 requests/minute per IP (use Upstash Redis or in-memory token bucket on Coolify)
- Broadcast rate limit: 1 broadcast per user per hour, max 5 concurrent broadcasts platform-wide
- Tournament/match result entry: 10 submissions per player per hour
- File upload rate limit: 10 uploads per user per minute, 100 per day
- Implement at the tRPC middleware level: `rateLimitMiddleware({ key: ctx.userId, max: 100, window: '1m' })`

**Phase to address.** Phase 1 (rate limit infrastructure); enforce in each feature phase.

---

## Missing Domain-Specific Pitfalls

### DOM-8: Tournament result dispute and edit history
**What goes wrong.** A player enters a tournament result as "lost in laatste 16" but later realizes they actually won the match (typo in the result entry). They cannot edit the entry — the system treats results as append-only. A trainer at the tournament has the official scoreboard but cannot enter the result on the player's behalf because the API only accepts results from the linked player.

**Prevention.**
- Players can edit their own results within 48 hours of entry; after that, edits require TD approval
- Edit history table: `(result_id, edited_by, old_values, new_values, edit_reason, timestamp)`
- Result lifecycle: `draft` (player entered) → `confirmed` (TD approved) → `published` (feeds into rankings comparison)
- Only `confirmed` and `published` results count in ambition vs. actuals comparison
- Trainers in the player's academy can also enter results (with `entered_by` field showing the trainer's ID, not the player's) — this loosens TOURN-05 from "player only" to "player or assigned trainer or TD"

**Phase to address.** Phase 4 (tournament results); coordinate with REQUIREMENTS.md TOURN-05 update.

---

### DOM-9: Federation ranking vs. internal ranking source-of-truth
**What goes wrong.** A player's Senior World Ranking from ITTF is 250 (official). A player or TD enters 245 in the platform's `ranking_entries` table. The dashboard shows 245. Months later, ITTF publishes an updated ranking of 240 — the platform now has stale data, but no mechanism to reconcile.

**Prevention.**
- Mark each `ranking_entries` row with `source` column: `'manual'` (entered by player or TD), `'federation_official'` (synced from external API)
- Display "Source: ITTF official, last synced 2026-05-01" on the dashboard ranking widget
- Future v2: scheduled job to sync from ITTF API (when API access is confirmed); flag conflicts to TD if manual entry disagrees with official
- v1 acceptance: manual entry is the source of truth; document this clearly in user-facing copy ("Rankings ingegeven manueel; controleer tegen officiële bron")

**Phase to address.** Phase 4 (rankings); update REQUIREMENTS.md RANK-01 to include `source` field.

---

### DOM-10: Age category mid-season transitions
**What goes wrong.** A player born in March 2010 is `cadet` (U17) for the 2025–2026 season. On June 1, 2026, the new season begins and they should transition to `junior`. The system has stored `age_category = 'cadet'` since registration; without an explicit update, all queries continue to treat them as cadet, and they appear in cadet-category tournament filters that they should no longer be in.

**Prevention.**
- `age_category_history` table: `(player_id, age_category, category_year, effective_from, effective_to)` — append-only history
- TD initiates "season rollover" at season start: a job suggests new categories per player based on DOB and current category year; TD reviews and confirms
- All queries that filter by age category JOIN to the history table with the relevant date — never read the current category in isolation for historical analysis
- Tournament entry validates against the player's category for the tournament's date (not the player's current category)

**Phase to address.** Phase 2 (player profile schema), Phase 4 (tournament category validation).

---

### DOM-11: Sparring partner availability conflicts
**What goes wrong.** Sparring partner A is linked to a Tuesday session at 17:00. After the linkage, A marks Tuesday afternoon as unavailable on their personal calendar. The session still lists A as a sparring partner; the trainer arrives expecting A to attend.

**Prevention.**
- Sparring partner has their own availability calendar (subset of full calendar — only "available / unavailable" blocks)
- Session creation form checks sparring partner availability before confirming linkage; warns trainer if partner is unavailable
- If partner marks a date unavailable AFTER linkage, system sends notification to the session organizer: "Sparring partner X has marked Tuesday afternoon unavailable; please reassign or confirm exception"
- Allow override with explicit reason ("Partner confirmed verbally for this session")

**Phase to address.** Phase 5 (sparring partners + session linkage).

---

### DOM-12: Medical event vs. training session calendar overlap
**What goes wrong.** Player is scheduled for a medical event (physio session) at 14:00–15:00 on Tuesday. A training session is also scheduled at 14:30–16:00 on Tuesday. The calendar shows both; the trainer expects the player to attend training. The player goes to physio. The trainer marks them absent. The participation quality score is 1 ("did not attend"), unfairly affecting the player's metrics.

**Prevention.**
- When a training session is created with participants, system checks for overlapping medical events (or any other player-blocking events) for each participant
- If overlap exists: warn the trainer with names and times; require explicit confirmation ("Speler X heeft een medische afspraak van 14:00–15:00 op deze datum — bevestig deelname of pas tijden aan")
- When an attendance is marked, if the player has an overlapping medical event, default to "afwezig met geldige reden" (absent with valid reason) instead of standard absent

**Phase to address.** Phase 5 (medical events + training sessions integration).

---

### DOM-13: Evaluation feedback visibility per role
**What goes wrong.** A trainer writes an evaluation for a 14-year-old player including: "lacks focus, attention span limited, parents may be over-pushing." The player sees this in their evaluation tab. The parent (linked to the minor) also sees this. The feedback was intended for internal coach discussion only.

**Prevention.**
- Evaluation record has visibility flags: `visible_to_player`, `visible_to_parent`, `visible_to_other_trainers`
- Default visibility on creation: trainer + TD only
- Trainer or TD must explicitly set `visible_to_player = true` (and optionally `visible_to_parent`) before the player/parent sees it
- Sensitive observations stored in a separate `evaluation_internal_notes` field — never visible to player or parent under any visibility flag
- TD can configure default visibility per evaluation point (technical points may be auto-shared with player; personal observations stay internal)

**Phase to address.** Phase 5 (evaluations); update REQUIREMENTS.md EVAL-01 to include visibility model.

---

## Weak Prevention Strategies (Original) — Improvements

### CRIT-3 (centralized authorization): make `players_visible_to()` concrete
The original recommends a `players_visible_to(user)` function but doesn't specify implementation. Define it concretely in the Phase 1 deliverable:

```sql
CREATE OR REPLACE FUNCTION players_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(player_id UUID) AS $$
  SELECT id FROM players WHERE user_id = caller_id AND caller_role = 'player'
  UNION
  SELECT player_id FROM parent_child_links WHERE parent_user_id = caller_id AND caller_role = 'parent'
  UNION
  SELECT pal.player_id FROM player_academy_links pal
    JOIN trainer_academy_links tal ON tal.academy_id = pal.academy_id
    WHERE tal.trainer_user_id = caller_id AND caller_role IN ('trainer', 'academy_manager')
  UNION
  SELECT id FROM players WHERE caller_role = 'technical_director'
  UNION
  SELECT cep.player_id FROM calendar_event_participants cep
    JOIN calendar_training_session_sparring_partners cstsp ON cstsp.calendar_event_id = cep.event_id
    WHERE cstsp.sparring_partner_id = caller_id AND caller_role = 'sparring_partner';
$$ LANGUAGE SQL STABLE SECURITY DEFINER;
```

This function is the **single source of truth** — every query that needs player scoping uses `WHERE player_id IN (SELECT player_id FROM players_visible_to(current_setting('app.user_id')::UUID, current_setting('app.user_role')))`.

### HIGH-3 (recurring events): change strategy field
Recurring event edits must specify retroactive vs. future-only behavior. Add `recurrence_change_strategy` field to edit operations: `'future_only'` (default) | `'retroactive'`. Future-only updates create a new RRULE branch from the edit date. Retroactive updates are flagged as "modifies historical data" and require explicit confirmation from the trainer with a reason.

### HIGH-6 (signed URLs): refresh + revocation flow
Original mentions "short TTL" without specifying. Define explicitly:

| Resource | TTL | Refresh allowed? | Revocation mechanism |
|----------|-----|-----------------|----------------------|
| Profile photo | 1 hour | Yes (no limit) | Bucket-level RLS check on every signed URL request |
| Evaluation attachment | 30 min | Yes (3 refreshes max per session) | Same as above |
| Medical document | 5 min | Yes (1 refresh max, requires re-auth) | If player consent withdrawn, all signed URLs invalidated immediately via short TTL + RLS deny |
| Match video link | N/A (external URL) | N/A | N/A — v1 stores YouTube/Vimeo URLs only |

When a record is marked for erasure, the underlying file is deleted from Supabase Storage; existing signed URLs return 404 immediately because the object is gone.

---

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| Reclassifications | 3 | Adjust priority |
| New Critical | 3 | CRIT-6, CRIT-7, CRIT-8 |
| New High-Risk | 6 | HIGH-10..15 |
| New Domain-Specific | 6 | DOM-8..13 |
| Strengthened Prevention | 3 | CRIT-3, HIGH-3, HIGH-6 |

**Total additions:** 18 new pitfalls + 3 strengthened prevention strategies.

These additions should be folded into Phase planning. Critical and High-risk items must be addressed in their assigned phase or earlier; domain-specific items inform feature design.

---

*Last updated: 2026-05-01 after multi-model review pass*
