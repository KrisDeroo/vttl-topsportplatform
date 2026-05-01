# Architecture Review — Critical Pass

## Executive Summary

The research document presents a solid foundation for a sports federation platform but has **material gaps in production readiness**, **underspecified RLS gotchas**, **messaging at scale issues**, and **missing operational concerns**. The modular monolith choice is sound, but the implementation details require hardening.

---

## Critical Issues (must address)

### 1. RLS Policy Recursion and Performance Not Addressed
**Original claim:** "RLS policies are written in SQL and enforced by the database engine regardless of which application code path hits the table."

**The problem:** The example `player_own_access` policy uses `EXISTS (SELECT 1 FROM trainer_academy_links ...)` inside a database policy. This creates a hidden performance cliff:
- Each row evaluated by the RLS policy triggers a subquery evaluation
- If you query 100 players and each row evaluation hits a subquery join, you're doing 100 subqueries per query
- Compound this across linked tables (player → academy → trainer) and you get N-squared behavior on common queries
- RLS policies also **cannot use prepared statements** — they're recompiled on every query with new context
- **Debugging RLS policy performance is extremely difficult** — EXPLAIN ANALYZE cannot show you the policy cost directly; the overhead is hidden

**Missing from original:** Any guidance on RLS performance limits, when to fall back to application-layer filtering, or when the RLS pattern becomes a liability.

**Recommendation:** 
- Document the RLS recursion limit: policies should not nest more than 1–2 levels of EXISTS (player → academy is OK; player → academy → trainer → facility starts breaking)
- Add a fallback: for deep hierarchies, compute visibility at the service layer, not via RLS
- Require: RBAC middleware to pre-fetch `linkedPlayerIds` and `academyIds` so they're available without subqueries
- Add query performance testing: include RLS in load testing; track slow query logs for RLS-induced N+1

---

### 2. Message Recipient Materialization at Scale Has No Limits
**Original claim:** "When a message is sent to a group (e.g., 'all A-status players'), the server resolves the group to individual user IDs at send time and creates one `message_recipients` row per recipient."

**The problem:** If you broadcast a message to 500 recipients (federation-wide notification), you:
- Create 500 rows in `message_recipients` in a single transaction
- Trigger 500 rows of INSERT → triggers → audit logs → potential RLS policy checks
- On read, every user's inbox query joins `messages` ← `message_recipients` ← filters
- If you have 10 concurrent broadcasts, that's 5,000 row inserts in parallel, with cascade implications

**The original doesn't address:**
- Insert timeout on large broadcasts
- Cascading lock contention (the messages table row is locked while 500 recipient rows are inserted)
- What happens if the broadcast fails at row 247 (partial insert, no rollback, orphaned recipients)
- Inbox query performance degradation when a user is in hundreds of threads × hundreds of recipients

**Recommendation:**
- Add async materialization: broadcast accepts a group_id, inserts one `message_group_broadcasts` row, then a background job materializes recipients incrementally (batch 50 at a time)
- Add a `message_recipient_views` table that pre-materializes "my inbox" per user, updated by trigger but with batching
- Set a hard limit: no single broadcast to >100 recipients synchronously; use async for larger groups
- Add cleanup: implement a retention policy to archive old message_recipients rows (e.g., >2 years old)

---

### 3. Recurring Event RRULE Generation On-the-Fly Has No Performance Bounds
**Original claim:** "Generate occurrences on-the-fly in the query layer (or via a background job that materializes future occurrences up to N months ahead)."

**The problem:** "up to N months ahead" is hand-waved:
- If N=24 (two years), you're generating 52+ occurrences per weekly event on every calendar view render
- If someone queries the calendar and there are 50 recurring events, that's 50 × 52 = 2,600 row expansions per query
- The document doesn't specify WHERE the expansion happens: in SQL (window functions + CTEs), in the application layer (fetch rules, expand in memory), or a hybrid
- No mention of **iCal RRULE complexity**: `FREQ=MONTHLY;BYWEEKDAY=TH;COUNT=36` with exceptions is non-trivial to expand correctly
- No mention of library choice (e.g., `rrule.js` has bugs with certain edge cases)

**Missing from original:**
- Performance testing of calendar queries with 50 recurring events
- Test coverage for RRULE edge cases (leap years, daylight saving time transitions)
- What happens when a user deletes a single occurrence and wants to keep the series (requires exception tracking)

**Recommendation:**
- Materialization is mandatory, not optional: pre-generate occurrences up to 12 months ahead in a background job (nightly cron), store in `calendar_event_occurrences` table
- Use a battle-tested RRULE library with good exception handling (e.g., `rrule` npm package, or PostgreSQL extension `pgcron` + stored procedure)
- Add an API to "expand this RRULE to N occurrences" for client-side UI expansion (date picker showing next 5 instances of a recurring training session)
- Set a hard limit: no single recurring event generates >365 occurrences per year; reject RRULEs that violate this
- Add exception tracking: `calendar_event_exceptions` table to mark "this particular Tuesday session is cancelled" without deleting the recurring rule

---

### 4. CallerContext Injection Performance Not Analyzed
**Original claim:** "Every service method receives a CallerContext (userId + role + academyIds + linkedPlayerIds) and appends WHERE clauses accordingly."

**The problem:**
- The original doesn't specify **how CallerContext is computed** on every request
- `linkedPlayerIds` for a parent with 5 children requires a lookup query
- `academyIds` for a trainer requires another lookup
- If this lookup happens synchronously on every request, you've added 1–2 database queries before the actual user query
- With 100 concurrent users, that's 100–200 context lookups per second, competing for database resources
- The document claims this is "visible in code reviews" but doesn't mention caching or TTL

**Missing from original:**
- Where does CallerContext caching live? (JWT claim, Redis, in-memory per request?)
- What's the staleness tolerance? (If a trainer is unlinked from an academy, how long until the CallerContext reflects this?)
- How does CallerContext validation interact with RLS? (Is CallerContext redundant with RLS, or is there a gap?)
- Performance impact: measure time to compute context for each role type

**Recommendation:**
- Include CallerContext in the JWT token (signed, verifiable): `role`, `userId`, `academyIds` as a static claim
- Recompute only on session refresh (login, logout) or manual cache invalidation
- For dynamic data (linkedPlayerIds), fetch once per request and cache in-memory for the request lifecycle (not across requests)
- Add monitoring: log when CallerContext lookup exceeds 100ms
- Document: "CallerContext is computed at auth time and must be refreshed within 15 minutes of role/academy changes" (accept eventual consistency)

---

### 5. File Signed URL TTL Handling Is Vague
**Original claim:** "Server-side only, short TTL (15 minutes for medical documents, 1 hour for others). Never expose raw storage keys to the client."

**The problem:**
- Medical documents with 15-minute TTL: what happens if a player opens a PDF and reads it for 30 minutes?
- No mention of **refresh token pattern**: can the client request a new signed URL if the first expires?
- If medical documents are PDFs served in an `<iframe>`, the browser may cache it; how does expired TTL interact with browser cache?
- No mention of **signed URL revocation**: if you want to instantly revoke access (e.g., a player's account is suspended), signed URLs issued before revocation are still valid until they expire
- The document says "files.getSignedUrl checks RBAC" but doesn't specify: does it re-check RLS policies every time, or trust the caller?

**Missing from original:**
- Refresh flow for long-reading documents
- Revocation mechanism for immediately-invalid URLs
- Interaction with browser caching and CORS
- What happens if a signed URL leaks? (15-minute window is short but not zero-risk)

**Recommendation:**
- For medical documents, use a "read token" pattern: client requests token + gets a short-lived pointer, server maintains a session-backed store of active readers
- Implement signed URL refresh: client can request a new URL if the previous one expired (requires proving they still have RBAC access)
- Add a revocation list: maintain a table of revoked signed URLs (hash of the URL) with expiry; on refresh, check revocation before issuing new URL
- For PDFs, serve via a custom endpoint (`/api/files/view/[id]?token=[ephemeralToken]`) instead of redirecting to S3; this gives you control over caching headers and revocation

---

### 6. Ambitions / Ranking Comparison Logic Not Designed
**Original mention in build order:** "Ambitions (per player/year/type + results comparison)"

**The problem:** The document defines `ranking_entries` but doesn't define how ambitions work:
- Is an ambition a target ranking? (`player wants to reach rank 100 by 2026-12-31`)
- How is "comparison" computed? (ranking on date X vs. ambition on date X?)
- What if a player has no ranking entries yet? (Can you set an ambition before the first ranking is recorded?)
- The data model is completely absent — is this a feature that got deferred to Phase 6 without a schema?

**Recommendation:**
- Define the data model:
  ```sql
  CREATE TABLE player_ambitions (
    id UUID PRIMARY KEY,
    player_id UUID REFERENCES player_profiles(id),
    ranking_type TEXT,  -- 'senior_world' | etc.
    target_rank INTEGER,
    target_date DATE,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  );
  ```
- Define comparison logic: on dashboard, show "rank now vs. target + time remaining" as a visual bar
- Define the query: `SELECT DISTINCT ON (ranking_type) * FROM ranking_entries WHERE player_id = ? ORDER BY ranking_type, entry_date DESC` (latest per type) joined with `player_ambitions` on (ranking_type)

---

## Significant Concerns

### 1. GDPR Consent Model Is Underspecified
**Original claim:** "Consent records stored in `gdpr_consents` table (player/guardian consent for medical data processing)."

**The problems:**
- No schema for `gdpr_consents`: is it one row per player per consent type? Per event? Per year?
- No audit trail: when a consent is withdrawn, is the old record kept (for audit) or deleted (losing history)?
- No definition of **who can give consent**: the document mentions players and guardians but doesn't define rules (e.g., "parent/guardian consent required if player is under 16")
- No handling of **expired or withdrawn consent**: if consent is withdrawn, what happens to existing medical records? (GDPR right to erasure may not apply retroactively, but there must be a clear retention policy)
- No mechanism for **proof of consent**: how do you prove that a parent gave consent on date X for medical data processing?

**Recommendation:**
- Schema:
  ```sql
  CREATE TABLE gdpr_consents (
    id UUID PRIMARY KEY,
    player_id UUID REFERENCES player_profiles(id),
    consent_type TEXT,  -- 'medical_processing' | 'medical_storage' | 'medical_sharing'
    given_by_user_id UUID REFERENCES users(id),  -- the player or a guardian
    given_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ,  -- null = no expiry, or auto-renew yearly
    withdrawn_at TIMESTAMPTZ,  -- null = active, non-null = withdrawn
    evidence_url TEXT,  -- link to signed form or recording
    PRIMARY KEY (player_id, consent_type, given_at)
  );
  ```
- Require: every write to `medical_events` checks active consent (not withdrawn, not expired)
- Add: a "consent status" dashboard showing all players' consent states (expiring soon, withdrawn, missing)

---

### 2. Notifications Architecture Is Fire-and-Forget With No Reliability
**Original claim:** "After a message is persisted, a background job dispatches email notifications to recipients who have email notifications enabled. This is fire-and-forget from the message send path."

**The problem:**
- "fire-and-forget" means emails may not be delivered, and there's no retry mechanism
- No mention of **email delivery failure**: what if the SMTP provider is down? The message is persisted but no one is notified
- No mention of **unsubscribe link**: GDPR and most email laws require an easy way to opt out. Is this built in, or a future concern?
- No mention of **double opt-in**: how do you prevent accidentally sending to a wrong email address?
- No email template versioning: if you change a notification template, does it affect already-pending notifications?

**Recommendation:**
- Use a dedicated notification service (SendGrid, Mailgun, AWS SES) with webhooks for delivery tracking
- Add a `notification_jobs` queue table:
  ```sql
  CREATE TABLE notification_jobs (
    id UUID PRIMARY KEY,
    recipient_user_id UUID REFERENCES users(id),
    notification_type TEXT,  -- 'message_sent' | 'eval_scheduled' | etc.
    related_entity_id UUID,
    status TEXT,  -- 'pending' | 'sent' | 'failed' | 'bounced' | 'unsubscribed'
    created_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivery_error TEXT
  );
  ```
- Implement retry: exponential backoff for failed jobs (retry up to 3 times over 24 hours)
- Add unsubscribe tracking: `notification_unsubscribes(user_id, notification_type, unsubscribed_at)`
- Require: before sending, check `notification_unsubscribes` and honor opt-outs

---

### 3. Tournament Results and Match Records Are Completely Absent
**Original build order:** "Tournaments (CRUD, final rankings, match results, video links)"

**The problem:** The document never defines the data model for tournaments or match results:
- Is a tournament a single event with multiple matches, or a series of rounds?
- How are match results recorded? (player A beat player B with sets 11-9, 11-7, etc.?)
- How do results feed into rankings? (Manual entry by administrator, or automatic calculation?)
- The "final rankings" — are these the same as `ranking_entries`, or a separate tournament ranking?
- Video links — are these stored as external URLs in the `files` table, or is there a specific `match_video` model?

**Recommendation:**
- Define tournament structure:
  ```sql
  CREATE TABLE tournaments (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    tournament_date DATE NOT NULL,
    location TEXT,
    organizer_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ
  );
  
  CREATE TABLE tournament_categories (
    id UUID PRIMARY KEY,
    tournament_id UUID REFERENCES tournaments(id),
    category TEXT,  -- 'U11' | 'U13' | 'Senior' | etc.
    PRIMARY KEY (tournament_id, category)
  );
  
  CREATE TABLE tournament_results (
    id UUID PRIMARY KEY,
    tournament_id UUID REFERENCES tournaments(id),
    category TEXT,  -- matches tournament_categories.category
    player_id UUID REFERENCES player_profiles(id),
    rank_achieved INTEGER,  -- 1st, 2nd, etc. in category
    recorded_by UUID REFERENCES users(id),
    recorded_at TIMESTAMPTZ
  );
  
  CREATE TABLE match_records (
    id UUID PRIMARY KEY,
    tournament_id UUID REFERENCES tournaments(id),
    player_a_id UUID REFERENCES player_profiles(id),
    player_b_id UUID REFERENCES player_profiles(id),
    sets_a INTEGER,  -- sets won by player A
    sets_b INTEGER,
    points_a INTEGER,  -- total points in match
    points_b INTEGER,
    winner_id UUID REFERENCES player_profiles(id),
    video_url TEXT,  -- external link or file_id
    recorded_at TIMESTAMPTZ
  );
  ```

---

### 4. Evaluation Conversations Are Poorly Defined
**Original mention:** "Evaluation conversations (CRUD + calendar link)"

**The problems:**
- Is an evaluation conversation a single meeting, or a series of notes over time?
- How does it link to the calendar? (One row in `calendar_events` per evaluation conversation?)
- Who can see the evaluation? (Trainer + player? Player + parent? Trainer only?)
- How are "configurable eval points" stored and linked to conversations?
- The document defines `evaluations` but never defines what an evaluation record contains

**Recommendation:**
- Define evaluation structure:
  ```sql
  CREATE TABLE evaluation_templates (
    id UUID PRIMARY KEY,
    name TEXT,  -- 'Technical skills' | 'Fitness' | etc.
    created_by UUID REFERENCES users(id)
  );
  
  CREATE TABLE evaluation_criteria (
    id UUID PRIMARY KEY,
    template_id UUID REFERENCES evaluation_templates(id),
    criterion TEXT,  -- 'Forehand drive' | 'Footwork' | etc.
    PRIMARY KEY (template_id, criterion)
  );
  
  CREATE TABLE evaluation_conversations (
    id UUID PRIMARY KEY,
    player_id UUID REFERENCES player_profiles(id),
    evaluator_id UUID REFERENCES trainer_profiles(id),
    calendar_event_id UUID REFERENCES calendar_events(id),
    template_id UUID REFERENCES evaluation_templates(id),
    scheduled_for TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    notes TEXT
  );
  
  CREATE TABLE evaluation_scores (
    id UUID PRIMARY KEY,
    conversation_id UUID REFERENCES evaluation_conversations(id),
    criterion TEXT,
    score INTEGER,  -- 1–10
    comment TEXT
  );
  ```

---

### 5. Sparring Partners Register Is Mentioned Once and Never Defined
**Original mention in build order:** "Sparring partners (register + N:N session links)"

**The problems:**
- Is a sparring partner a player who plays against another player in a training session?
- Does a sparring partner have their own profile, or are they just referenced in a join table?
- How do you distinguish between "Player A is training with Player B" (same academy) vs. "Player A had a match with Player B" (tournament)?
- Are sparring partners limited to registered VTTL players, or can external players be recorded?

**Recommendation:**
- Define:
  ```sql
  CREATE TABLE training_session_sparring_partners (
    training_session_id UUID REFERENCES calendar_training_sessions(calendar_event_id),
    player_a_id UUID REFERENCES player_profiles(id),
    player_b_id UUID REFERENCES player_profiles(id),
    result TEXT,  -- 'player_a_won' | 'player_b_won' | 'draw' | 'incomplete'
    sets_a INTEGER,
    sets_b INTEGER,
    notes TEXT,
    PRIMARY KEY (training_session_id, player_a_id, player_b_id)
  );
  ```

---

### 6. Stages (Training Camps) Have No Defined Structure
**Original mention:** "Stages (training camp records, player/trainer links)"

**The problems:**
- Is a stage a single day or a multi-day event?
- How do stages relate to the calendar? (One event per stage, or one event per day within a stage?)
- What data is specific to a stage? (Location? Trainer assignments? Accommodation?)
- How do "player/trainer links" work? (Who is assigned to what role during the stage?)

**Recommendation:**
- Define:
  ```sql
  CREATE TABLE stages (
    id UUID PRIMARY KEY,
    name TEXT,
    start_date DATE,
    end_date DATE,
    location TEXT,
    organizer_id UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMPTZ
  );
  
  CREATE TABLE stage_participants (
    id UUID PRIMARY KEY,
    stage_id UUID REFERENCES stages(id),
    user_id UUID REFERENCES users(id),
    role TEXT,  -- 'trainer' | 'participant' | 'organizer'
    PRIMARY KEY (stage_id, user_id, role)
  );
  
  -- Link stages to calendar as multi-day events
  -- One calendar_event per stage, with start_date and end_date
  ```

---

## Missing Considerations

### 1. Backups and Disaster Recovery
**Not mentioned:** Backup strategy, recovery time objective (RTO), recovery point objective (RPO), or backup testing.

**Critical for GDPR:** If you lose player data, you may need to notify the player and authorities. Recovery time matters.

**Recommendation:**
- Use Supabase or Railway managed backups (automatic, tested)
- Define: RPO = 1 hour (acceptable data loss), RTO = 2 hours (time to restore to production)
- Monthly restore drill: restore to a staging environment, validate data integrity
- Keep backups for 30 days minimum (so you can recover from ransomware/accidental deletion)
- Document: backup locations (geographic redundancy), encryption (at rest and in transit), access control (who can restore?)

---

### 2. Observability and Logging
**Not mentioned:** How to debug production issues, monitor performance, alert on failures.

**Critical for RLS debugging:** If an RLS policy silently blocks a query, how will you know?

**Recommendation:**
- Centralized logging: all application logs, database slow queries, RLS policy rejections sent to a log aggregation service (e.g., Datadog, LogRocket, or open-source ELK stack)
- Structured logging: every log entry includes context (userId, role, request_id, affected entity)
- Slow query monitoring: PostgreSQL slow query log enabled (log queries >500ms)
- RLS rejection tracking: every RLS policy rejection should emit a log entry with the row ID and policy name
- Alerting: pages on errors, data anomalies (e.g., 1000 emails sent in 1 minute = potential broadcast loop)

---

### 3. Rate Limiting and DDoS Protection
**Not mentioned:** How to protect against abuse (brute-force login, broadcast spam, file upload DoS).

**Recommendation:**
- API rate limiting: per-user, per-IP (e.g., 100 requests per minute per user, 1,000 per IP)
- Login rate limiting: max 5 failed attempts per account per 15 minutes
- Broadcast rate limiting: max 1 broadcast per user per hour, max 5 concurrent broadcasts
- File upload size limits: 50 MB per file (medical documents are typically PDFs <5 MB)
- WAF (Web Application Firewall): use Vercel's built-in protection or Cloudflare

---

### 4. CSRF and Session Security
**Not mentioned:** How to prevent cross-site request forgery, session hijacking, or token theft.

**Recommendation:**
- NextAuth.js provides CSRF tokens automatically (use it)
- Secure session cookies: HttpOnly, Secure, SameSite=Lax (default in NextAuth)
- JWT token rotation: issue new token on every refresh (not just at login)
- Token expiry: short-lived access tokens (15 min), long-lived refresh tokens (7 days, rotated)
- Logout revocation: maintain a token blacklist (Redis) for revoked tokens; check it on every request

---

### 5. Data Export and Subject Access Requests (GDPR Article 15)
**Not mentioned:** How to handle a player requesting "give me all my data in a portable format."

**Critical for GDPR:** You have 30 days to respond.

**Recommendation:**
- Build a "data export" service: given a `user_id`, fetch all rows across all tables where `user_id` is a participant, foreign key, or creator
- Output format: JSON or CSV, structured by entity type
- Audit log: record every export request, when it was fulfilled, who reviewed it
- Implementation: service layer method that takes `userId` and returns a data dump; tRPC endpoint protected by "only accessible to the user or a TD"

---

### 6. Right to Erasure (GDPR Article 17)
**Not mentioned:** How to delete a player's data when they request it.

**The problem:** You can't just `DELETE FROM players WHERE user_id = X` — there are cascades (tournament results, rankings, medical records). What's erasable vs. what must be retained?

**Recommendation:**
- Define retention policy per entity:
  - Medical events: never erase (required for athlete health/safety, can anonymize)
  - Tournament results: anonymize instead of erase (for historical integrity; change player name to "Deleted User")
  - Training session records: anonymize
  - Messages: erase (no operational need to retain)
  - Audit logs: never erase (required for GDPR audit trail)
- Implement a "soft delete" (anonymization) for most entities: add `is_erased` flag, set user info to null, but keep the row for referential integrity
- Add a background job: monthly erasure of marked-for-deletion users' data (after 30-day grace period)

---

### 7. Audit Logging Specifics Are Vague
**Original claim:** "All reads to the medical module are recorded in an `audit_log` table (who, what, when, IP — non-deletable append-only)."

**Missing details:**
- How is "what" captured? (Just the entity ID, or full before/after values?)
- Who can query the audit log? (Only TD? Only system admins?)
- Retention: how long is the audit log kept? (GDPR requires it for 6 years for medical data)
- Triggering: is audit logging automatic (database triggers) or manual (application code)?
- Performance: audit logging on every select is expensive; is there a sampling strategy?

**Recommendation:**
- Schema:
  ```sql
  CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action TEXT,  -- 'read' | 'create' | 'update' | 'delete'
    entity_type TEXT,  -- 'player' | 'medical_event' | etc.
    entity_id UUID,
    old_values JSONB,  -- for updates; null for reads
    new_values JSONB,  -- for updates/creates
    ip_address INET,
    user_agent TEXT,
    occurred_at TIMESTAMPTZ DEFAULT now()
  );
  
  -- Immutable: no UPDATE or DELETE permitted (only INSERT)
  ```
- Access control: audit logs visible only to TD via a dedicated read-only procedure
- Retention: 6 years minimum for medical-related reads; 2 years for non-medical
- Implementation: PostgreSQL trigger on `medical_events` INSERT/UPDATE/DELETE; application-layer audit for SELECT (cannot be done via trigger)

---

### 8. Performance Monitoring and Metrics
**Not mentioned:** How to track query performance, identify bottlenecks, or predict when scaling is needed.

**Recommendation:**
- Database metrics: track queries per second, slow query ratio, index hit ratio, connection count
- Application metrics: track response time per endpoint, error rate, tRPC batch size
- Business metrics: track active users per day, calendar events created per day, messages sent per day
- Alerting: page if error rate exceeds 1%, p95 response time exceeds 1 second, slow queries exceed 10% of traffic

---

### 9. Testing Strategy Is Completely Absent
**Not mentioned:** How to test RLS policies, RBAC enforcement, calendar queries, or GDPR compliance.

**Recommendation:**
- Unit tests: every service method with mocked `CallerContext`
- Integration tests: test RLS policies by creating users with different roles, verifying they can't see forbidden rows
- E2E tests: test calendar view render with 50 recurring events (performance)
- Load tests: 100 concurrent users, verify RLS policy performance
- GDPR tests: verify medical reads are audited, verify audit logs can't be deleted, verify erasure works

---

### 10. Deployment and Infrastructure
**Not mentioned:** Where the database is hosted, how to deploy code, how to handle database migrations.

**Recommendation:**
- Use Supabase (PostgreSQL + auth + storage) or Railway (PostgreSQL + auto-deploys)
- Migrations: Prisma migrations, versioned and tested, applied on every deployment
- Deployment pipeline: test → stage → production, with smoke tests on production
- Blue-green deployments: zero downtime on new releases
- Database connection pooling: PgBouncer or managed connection pooler (critical for >50 concurrent users)

---

### 11. Version Control and API Stability
**Not mentioned:** How to handle breaking API changes, version management, or backward compatibility.

**Recommendation:**
- tRPC versioning: include version in procedure name if breaking change required (e.g., `calendar.v2.eventsForDateRange`)
- Deprecation: add deprecation warnings to old endpoints, give 2-release notice before removal
- Client versioning: track which client version is in use; prevent old clients from connecting if breaking changes exist

---

## Recommendations to Add or Change

### 1. RLS Complexity Matrix
Add a table showing which entity combinations are safe for RLS vs. require application-layer filtering:

| Entity | Visibility Rule | RLS Safe? | Notes |
|--------|---|---|---|
| players | Own + trainer's academy + parent | ✓ | 2 levels (player → academy), manageable |
| medical_events | Own + TD + medical staff | ✓ | Explicit per-user grant, shallow |
| messages | Sender + all recipients | ✗ | Requires message_recipients join; use application filtering |
| calendar_events | Own + academy visibility | ✓ | Join via academy is acceptable |

---

### 2. CallerContext Validation Pattern
Add pseudocode showing how CallerContext is computed and cached:

```typescript
// On every tRPC request
async function buildCallerContext(userId: string): CallerContext {
  // Check JWT claim (fast path)
  const jwtClaim = ctx.session.callerContext;
  if (jwtClaim && isRecentlyIssued(jwtClaim)) {
    return jwtClaim; // Trust the JWT
  }
  
  // Recompute from database (slow path, max once per 15 min)
  const user = await db.user.findUnique({ where: { id: userId } });
  const academyIds = await db.trainerAcademyLinks.findMany({
    where: { trainerId: user.trainerId },
    select: { academyId: true },
  }).then(rows => rows.map(r => r.academyId));
  
  const linkedPlayerIds = await db.parentPlayerLinks.findMany({
    where: { parentUserId: userId },
    select: { playerId: true },
  }).then(rows => rows.map(r => r.playerId));
  
  return {
    userId,
    role: user.role,
    academyIds,
    linkedPlayerIds,
  };
}
```

---

### 3. Materialization Strategy for Recurring Events
Define the background job:

```typescript
// Nightly cron job
async function materializeRecurringEvents() {
  const today = new Date();
  const oneYearFromNow = addMonths(today, 12);
  
  const recurringEvents = await db.calendarEvent.findMany({
    where: { isRecurring: true, recurrenceRule: { not: null } },
  });
  
  for (const event of recurringEvents) {
    const occurrences = rruleToOccurrences(
      event.recurrenceRule,
      event.startAt,
      today,
      oneYearFromNow,
    );
    
    for (const occurrence of occurrences) {
      await db.calendarEventOccurrence.upsert({
        where: { seriesId_start_at: { seriesId: event.id, startAt: occurrence.startAt } },
        create: { seriesId: event.id, startAt: occurrence.startAt, endAt: occurrence.endAt },
        update: { endAt: occurrence.endAt },
      });
    }
  }
}
```

---

### 4. Signed URL Refresh Pattern
Add an example of the refresh flow:

```typescript
// Client-side
const { data: initialUrl } = await trpc.files.getSignedUrl.mutate({ fileId: '...' });
// Open file, but if request fails with 403...
if (response.status === 403) {
  const { data: refreshedUrl } = await trpc.files.getSignedUrl.mutate({ fileId: '...' }); // Re-request
  // Retry with new URL
}

// Server-side
// Add to payload: expiresAt, allowRefresh count
const signedUrl = s3.getSignedUrl(fileId, { expiresIn: '15 minutes' });
return { url: signedUrl, expiresAt: Date.now() + 15 * 60 * 1000, maxRefreshes: 2 };
```

---

### 5. Define the Critical Path Explicitly
Clarify that the build order depends on:
- Hard dependencies (Phases 1–3 must be done before 4+)
- Soft dependencies (Phase 5 domains can be built in parallel after Phase 4)
- Day 1 MVP: Phases 1–4 + any 2 of Phase 5 (e.g., training + tournaments)

---

## What the Original Got Right

### 1. Modular Monolith Choice
The decision is well-justified for a 50–200 user, single-organization platform. Avoids microservices complexity without sacrificing code organization. Excellent.

### 2. tRPC Over GraphQL
Correct. The platform has one predictable client (Next.js app), not multiple independent clients. tRPC's end-to-end typing is a massive win.

### 3. Polymorphic Calendar Events with Extension Tables
The base + extension pattern is sound. Avoids UNION-based queries on every calendar render. Much better than nullable columns or fully separate tables.

### 4. RLS as the Backstop
Correct principle: database-level enforcement prevents application bugs from exposing data. The implementation details need work (as noted above), but the strategy is right.

### 5. Ranking as Time Series
Storing historical rankings is the right call. Avoids the "current ranking" dual-write problem. Enables charting. Good.

### 6. Medical Data Isolation
Recognizing medical data as special (Art. 9, audit logging, separate bucket) is correct. The specifics need more detail, but the principle is sound.

### 7. File Signed URL Pattern
Correct: never expose raw storage keys, always validate access on server-side, use short TTL. Implementation needs refinement but the pattern is solid.

### 8. Phase Build Order Thinking
The dependency graph is thoughtful. Phases 1–4 are correctly sequenced. Good scaffolding for implementation.

### 9. Avoiding Premature Optimization
Correct: no Redis, no message queues for v1, no caching layer until needed. Pragmatic.

### 10. Module Boundary Enforcement
Requiring cross-module calls to go through service layers (not direct DB joins) is the right architecture. Makes code auditable and easier to refactor later.

---

## Summary Table

| Category | Status | Severity |
|----------|--------|----------|
| RLS performance | Under-specified | High |
| Message broadcasts at scale | No limits defined | High |
| Recurring events RRULE | On-the-fly expansion unchecked | High |
| CallerContext caching | Not addressed | Medium |
| File signed URL TTL/refresh | Vague | Medium |
| Ambitions feature | No schema | Medium |
| GDPR consent model | Incomplete | Medium |
| Notifications reliability | Fire-and-forget only | Medium |
| Tournament results model | Absent | Medium |
| Evaluation conversations | Poorly defined | Low-Medium |
| Sparring partners | One-sentence mention | Low |
| Stages (camps) | One-sentence mention | Low |
| Backups & DR | Completely missing | High |
| Observability | Completely missing | High |
| Rate limiting | Completely missing | High |
| CSRF/session security | Briefly mentioned (good) | Low |
| Audit logging details | Vague specifics | High |
| Data export (Article 15) | Missing | High |
| Right to erasure (Article 17) | Missing | High |
| Testing strategy | Missing | Medium |
| Deployment/infrastructure | Missing | Medium |

---

## Next Steps for Author

1. **Immediate (before code starts):**
   - Define RLS recursion limits and fallback patterns
   - Specify message recipient materialization as async + batch
   - Commit to recurring event pre-materialization (nightly job)
   - Add CallerContext JWT claim + caching strategy
   - Define signed URL refresh flow

2. **Before Phase 1 (auth + DB setup):**
   - Add audit log schema to Prisma
   - Define GDPR consent table + withdrawal logic
   - Add `is_erased` soft-delete field to user-linked tables
   - Specify backup/recovery procedures

3. **Before Phase 5 (tournaments + rankings):**
   - Define tournament + match result schemas
   - Define ambitions schema
   - Add evaluation conversation + scores schema
   - Define sparring partners join table + result tracking

4. **Ongoing:**
   - Add load testing for RLS policies, calendar queries, message broadcasts
   - Define alerting/monitoring for observability
   - Create deployment checklist (migrations, backups, smoke tests)
   - Build GDPR compliance checklist (consent, audit, export, erasure)

