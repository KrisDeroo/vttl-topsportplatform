# Architecture Research — VTTL Topsportplatform

---

## Recommended Architecture Pattern

### Decision: Modular Monolith

For a single-org platform at this scale (dozens to low-hundreds of concurrent users, one federation, one deployment), a **modular monolith** is the correct choice. The reasoning:

**Why not microservices:**
- Microservices solve deployment independence and team scaling. This platform has one team, one deployment target, and domain boundaries that share data constantly (a calendar event references a player, a trainer, an academy, a session, a tournament — cutting that across service boundaries creates distributed joins and saga complexity with zero operational benefit at this scale).
- Medical GDPR enforcement across service boundaries requires network-level trust, distributed audit logs, and inter-service auth — all avoidable complexity here.
- Operational overhead (container orchestration, service mesh, distributed tracing) is disproportionate for a sports federation platform.

**Why not a traditional monolith:**
- A single-file, unstructured codebase will make role-scoped visibility impossible to audit and maintain. GDPR enforcement needs clear module boundaries so you can answer "where is medical data accessed?" unambiguously.

**Why modular monolith:**
- Enforces internal domain boundaries (modules cannot reach into each other's database tables directly — they call each other's service layer).
- Single deployment, single database (with schema namespacing or separate schemas per module).
- If a module ever needs to be extracted (e.g., AI video analysis in v2), the interface boundary already exists.
- Aligns well with Next.js App Router + tRPC: route groups map cleanly to modules; tRPC routers map to domain boundaries.

**Concrete structure:**

```
src/
  modules/
    auth/          # session, JWT, role claims
    users/         # user accounts, role assignments
    players/       # player profiles, academic info
    trainers/      # trainer profiles, academy links
    calendar/      # unified calendar, event aggregation
    training/      # sessions, participation, recurring logic
    tournaments/   # tournaments, results, match records
    rankings/      # time-series ranking entries
    evaluations/   # evaluations, evaluation points
    medical/       # medical events, GDPR-sensitive
    messaging/     # inbox, threads, attachments
    stages/        # training camps
    files/         # file/media storage abstraction
    notifications/ # push/email notification dispatch
    ai-analysis/   # v2 placeholder, isolated from day 1
  shared/
    db/            # Prisma client, migrations
    rbac/          # permission definitions, enforcement helpers
    audit/         # GDPR audit log
    config/        # env, feature flags
```

Each module owns its Prisma models (or schema-namespaced tables), its tRPC router, and its service layer. Cross-module calls go through the service layer, never direct DB joins across module boundaries.

---

## Component Map

| Component | Description | Dependencies | Build Order |
|-----------|-------------|--------------|-------------|
| Auth & Session | NextAuth.js + JWT with role claims baked in | None | 1 |
| User accounts | User table, role assignments, academy/player links | Auth | 2 |
| RBAC engine | Permission matrix, RLS policies, middleware guards | Users | 2 (parallel) |
| Player profiles | Core player record, lookups | Users, RBAC | 3 |
| Trainer profiles | Trainer record, academy links | Users, RBAC | 3 (parallel) |
| File storage | S3/Supabase Storage abstraction, signed URLs | Auth | 3 (parallel) |
| Academy/lookup data | Static lookup tables (academies, status, etc.) | None | 1 (parallel) |
| Calendar engine | Event aggregation layer, week/month views | Players, Trainers, RBAC | 4 |
| Training sessions | Session CRUD, recurring logic, participation | Calendar, Players, Trainers | 5 |
| Sparring partners | SP register, N-to-N session links | Training sessions | 6 |
| Tournaments | Tournament CRUD, results, match records | Players, RBAC | 5 (parallel) |
| Rankings | Time-series entries per player per type | Players | 5 (parallel) |
| Ambitions | Per-player/year/type target + comparison | Players, Tournaments, Rankings | 6 |
| Evaluations | Eval records, configurable eval points | Players, Trainers, Files | 6 (parallel) |
| Medical follow-up | Medical events, GDPR audit, file links | Players, Files, RBAC | 6 (parallel) |
| Meetings | Meeting CRUD, invites, recurring, accept/decline | Calendar, Users | 6 (parallel) |
| Stages | Training camp records, player/trainer links | Calendar, Players, Trainers | 6 (parallel) |
| Eval conversations | Date/time/evaluator/player link | Calendar, Players, Trainers | 6 (parallel) |
| Messaging | Inbox, threads, group addressing, attachments | Users, Files, Notifications | 7 |
| Notifications | Email/push dispatch, delivery tracking | Users | 5 (parallel, thin layer) |
| Player dashboard | Aggregated stats view, chart data endpoints | All domain modules | 8 |
| AI video analysis | Video link in v1; ML pipeline in v2 | Files, Tournaments | 9 (v2) |

---

## Data Architecture

### Role-scoped visibility (RBAC at data layer)

The golden rule: **role scoping must be enforced at the database query layer, not just the UI**. Two complementary mechanisms:

**1. PostgreSQL Row Level Security (RLS)**

Enable RLS on all sensitive tables. Policies are written in SQL and enforced by the database engine regardless of which application code path hits the table. This is the GDPR enforcement backstop.

```sql
-- Example: players table
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_own_access ON players
  FOR SELECT
  USING (
    auth.user_id() = user_id                          -- own record
    OR auth.role() = 'technical_director'             -- TD sees all
    OR EXISTS (
      SELECT 1 FROM trainer_academy_links tal
      JOIN player_academy_links pal ON pal.academy_id = tal.academy_id
      WHERE tal.user_id = auth.user_id()
        AND pal.player_id = players.id
    )                                                  -- trainer scoped to academy
    OR EXISTS (
      SELECT 1 FROM parent_player_links ppl
      WHERE ppl.parent_user_id = auth.user_id()
        AND ppl.player_id = players.id
    )                                                  -- parent sees own child
  );
```

Medical data gets its own tighter policy — only the player themselves, the technical director, and explicitly granted medical staff.

**2. Service layer query scoping (application layer)**

RLS is the backstop; the service layer should also scope queries explicitly. Every service method receives a `CallerContext` (userId + role + academyIds + linkedPlayerIds) and appends WHERE clauses accordingly. This makes the scoping visible in code reviews and prevents accidental over-fetching.

```typescript
// CallerContext injected via tRPC middleware
type CallerContext = {
  userId: string;
  role: UserRole;
  academyIds: string[];      // for trainers/academy managers
  linkedPlayerIds: string[]; // for parents, sparring partners
};
```

**3. Medical data isolation**

Medical data is GDPR special category (Art. 9). Additional controls:
- Separate `medical_events` table with its own strict RLS policy.
- All reads to the medical module are recorded in an `audit_log` table (who, what, when, IP — non-deletable append-only).
- File uploads linked to medical records use separate storage bucket with restricted access policy.
- Consent records stored in `gdpr_consents` table (player/guardian consent for medical data processing).

**Entity relationship for role scoping:**

```
users (id, email, role)
  ↕ (1:1)
player_profiles (user_id, ...)   -- or trainer_profiles
  ↕ (N:N)
academy                          -- trainers linked to ≥1 academy
  ↕ (N:N)
player_profiles                  -- players linked to 1 academy

parent_player_links (parent_user_id, player_id)  -- parent ↔ child
trainer_academy_links (trainer_id, academy_id)   -- trainer ↔ academy
player_academy_links (player_id, academy_id)     -- player ↔ academy
```

---

### Calendar event type model

The calendar is the central daily surface. It must aggregate heterogeneous event types into one unified view while preserving type-specific data.

**Pattern: Polymorphic events with a shared base + type-specific extension tables**

This is superior to a single "events" table with nullable columns (which becomes unmaintainable) and superior to fully separate tables (which makes calendar queries require UNION across 6 tables for every view render).

```sql
-- Shared base table (all calendar events)
CREATE TABLE calendar_events (
  id              UUID PRIMARY KEY,
  event_type      TEXT NOT NULL,  -- 'training_session' | 'tournament' | 'meeting' | 'stage' | 'eval_conversation' | 'medical'
  title           TEXT NOT NULL,
  start_at        TIMESTAMPTZ NOT NULL,
  end_at          TIMESTAMPTZ NOT NULL,
  all_day         BOOLEAN DEFAULT false,
  color_code      TEXT,           -- per event type, set by system
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  is_recurring    BOOLEAN DEFAULT false,
  recurrence_rule TEXT            -- iCal RRULE format
);

-- Extension: training session specifics
CREATE TABLE calendar_training_sessions (
  calendar_event_id UUID PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
  training_type     TEXT,  -- Group/Individual/Physical/Mental
  organisation      TEXT,  -- Private/KBTTB/etc
  location          TEXT,
  trainer_id        UUID REFERENCES trainer_profiles(id)
);

-- Extension: meeting specifics
CREATE TABLE calendar_meetings (
  calendar_event_id UUID PRIMARY KEY REFERENCES calendar_events(id),
  name              TEXT
);

-- Participants (reusable join for all event types)
CREATE TABLE calendar_event_participants (
  event_id  UUID REFERENCES calendar_events(id),
  user_id   UUID REFERENCES users(id),
  role      TEXT,  -- 'organizer' | 'participant' | 'invited'
  status    TEXT,  -- 'accepted' | 'declined' | 'pending'
  PRIMARY KEY (event_id, user_id)
);
```

**Calendar query pattern:** The calendar view queries `calendar_events` with a date range filter plus participant join (for visibility scoping), then does a single LEFT JOIN per event type to fetch extension data only for the types present. This keeps calendar queries O(1) per view render regardless of event type count.

**Recurring events:** Store the series rule on the base event; generate occurrences on-the-fly in the query layer (or via a background job that materializes future occurrences up to N months ahead). The materialization approach is simpler for display and filtering. Use `recurrence_parent_id` to link instances to their series for bulk edit/delete operations.

**Color coding** (Dutch UI reference):
- Trainingen: blauw
- Toernooien: oranje  
- Vergaderingen: groen
- Stages: paars
- Evaluatiegesprekken: geel
- Medische afspraken: rood

---

### Ranking time series model

Rankings are explicitly time series: multiple types per player, date-stamped, must support charting over time.

```sql
CREATE TABLE ranking_entries (
  id           UUID PRIMARY KEY,
  player_id    UUID REFERENCES player_profiles(id) NOT NULL,
  ranking_type TEXT NOT NULL,  -- 'senior_world' | 'youth_world' | 'senior_european' | 'youth_european' | 'belgium'
  entry_date   DATE NOT NULL,
  rank_value   INTEGER NOT NULL,  -- lower = better
  entered_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (player_id, ranking_type, entry_date)  -- one entry per type per day
);

-- Index for time-series queries (charting)
CREATE INDEX idx_rankings_player_type_date
  ON ranking_entries (player_id, ranking_type, entry_date DESC);
```

**Query patterns:**
- Latest ranking per type per player: `SELECT DISTINCT ON (ranking_type) * FROM ranking_entries WHERE player_id = $1 ORDER BY ranking_type, entry_date DESC`
- Ranking evolution for chart: `SELECT entry_date, rank_value FROM ranking_entries WHERE player_id = $1 AND ranking_type = $2 ORDER BY entry_date ASC`
- Best ranking ever: aggregate query with MIN(rank_value) per type

**No separate "current ranking" field needed** — always derive from the time series. This avoids the dual-write consistency problem.

---

### File/media storage architecture

Three categories with different access patterns and sensitivity:

| Category | Examples | Sensitivity | Storage | Access |
|----------|----------|-------------|---------|--------|
| Profile photos | Player/trainer photos | Low | Public bucket | Public CDN URL |
| Documents | Evaluations, medical scans | High (medical = Art. 9) | Private bucket | Signed URL, short TTL |
| Match videos | Video links (v1), uploads (v2) | Medium | Private bucket or external URL | Signed URL or passthrough |

**Recommended stack:** Supabase Storage (if using Supabase) or AWS S3 + CloudFront. Supabase Storage is preferable because it integrates natively with RLS policies — a storage bucket policy can reference the same user/role context as the database, meaning file access control is consistent with data access control.

**File metadata table:**

```sql
CREATE TABLE files (
  id              UUID PRIMARY KEY,
  storage_key     TEXT NOT NULL UNIQUE,  -- bucket/path/filename
  bucket          TEXT NOT NULL,         -- 'profiles' | 'documents' | 'videos'
  original_name   TEXT,
  mime_type       TEXT,
  size_bytes      BIGINT,
  uploaded_by     UUID REFERENCES users(id),
  linked_entity   TEXT,    -- 'evaluation' | 'medical_event' | 'match_result'
  linked_entity_id UUID,
  is_sensitive    BOOLEAN DEFAULT false,  -- true for medical
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

**Signed URL generation:** Server-side only, short TTL (15 minutes for medical documents, 1 hour for others). Never expose raw storage keys to the client. The tRPC `files.getSignedUrl` procedure checks RBAC before generating the URL.

**v1 constraint:** Match videos are stored as external URLs (YouTube, etc.) — no upload required. The `files` table handles this via a nullable `storage_key` + non-null `external_url` column. This defers video storage cost/complexity to v2.

---

## API Design

### Recommendation: tRPC

For a Next.js full-stack app with TypeScript throughout, tRPC is the correct choice over REST or GraphQL at this scale.

**Why tRPC over REST:**
- End-to-end type safety: the client knows the exact return type of every procedure without codegen or OpenAPI contracts. For a complex domain with 6 roles and many entity types, this eliminates a large class of frontend bugs.
- No boilerplate: no route files, no controllers, no serializers. One tRPC router per module maps directly to the modular monolith structure.
- Automatic request batching: multiple calendar event fetches in a single page load are automatically batched into one HTTP request.

**Why tRPC over GraphQL:**
- GraphQL solves the N+1 and overfetching problems that arise when multiple independent clients (mobile apps, third-party integrations) hit the same API with unpredictable query shapes. This platform has one client (the Next.js app) with predictable query shapes — GraphQL complexity is not justified.
- GraphQL's schema definition layer duplicates what TypeScript already provides.
- RBAC enforcement in GraphQL requires field-level resolvers or schema directives — harder to audit than tRPC middleware.

**tRPC structure:**

```typescript
// src/server/routers/_app.ts
export const appRouter = router({
  auth:         authRouter,
  players:      playersRouter,
  trainers:     trainersRouter,
  calendar:     calendarRouter,
  training:     trainingRouter,
  tournaments:  tournamentsRouter,
  rankings:     rankingsRouter,
  evaluations:  evaluationsRouter,
  medical:      medicalRouter,      // extra RBAC middleware
  messaging:    messagingRouter,
  files:        filesRouter,
  notifications: notificationsRouter,
});
```

**RBAC enforcement in tRPC middleware:**

```typescript
// Role guard middleware
const requireRole = (...roles: UserRole[]) =>
  t.middleware(({ ctx, next }) => {
    if (!roles.includes(ctx.user.role)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next({ ctx });
  });

// Medical procedures add extra audit logging
const medicalProcedure = t.procedure
  .use(requireAuth)
  .use(requireMedicalAccess)
  .use(auditLog);
```

**External API consideration:** If VTTL ever needs to expose data to external systems (federation, third-party apps), a thin REST layer can be added alongside tRPC without refactoring — tRPC and REST can coexist in Next.js API routes.

---

## Messaging Architecture

### Pattern: Threaded message model with group addressing

Internal messaging for a sports platform does not require real-time pub/sub infrastructure (Slack-level concurrency). A database-backed polling model with optional real-time via Supabase Realtime is sufficient.

**Data model:**

```sql
-- Message threads
CREATE TABLE message_threads (
  id          UUID PRIMARY KEY,
  subject     TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Messages within threads
CREATE TABLE messages (
  id          UUID PRIMARY KEY,
  thread_id   UUID REFERENCES message_threads(id),
  sender_id   UUID REFERENCES users(id),
  body        TEXT NOT NULL,
  sent_at     TIMESTAMPTZ DEFAULT now(),
  parent_id   UUID REFERENCES messages(id)  -- for reply threading
);

-- Recipients (individual or expanded from group)
CREATE TABLE message_recipients (
  message_id  UUID REFERENCES messages(id),
  user_id     UUID REFERENCES users(id),
  is_read     BOOLEAN DEFAULT false,
  read_at     TIMESTAMPTZ,
  folder      TEXT DEFAULT 'inbox',  -- 'inbox' | 'sent' | 'archived'
  PRIMARY KEY (message_id, user_id)
);

-- Message attachments
CREATE TABLE message_attachments (
  id          UUID PRIMARY KEY,
  message_id  UUID REFERENCES messages(id),
  file_id     UUID REFERENCES files(id)
);
```

**Group addressing:** When a message is sent to a group (e.g., "all A-status players"), the server resolves the group to individual user IDs at send time and creates one `message_recipients` row per recipient. The group definition is stored for display purposes but the delivery list is materialized. This keeps inbox queries simple (no group expansion at read time).

**Predefined groups:**
- By status: A-spelers, B-spelers, C-spelers
- By academy: per academy name
- All players, all trainers, all sparring partners
- By age category

**Notification dispatch:** After a message is persisted, a background job dispatches email notifications to recipients who have email notifications enabled. This is fire-and-forget from the message send path — message send is not blocked on email delivery.

**Real-time (optional):** Supabase Realtime can subscribe to new rows in `message_recipients` filtered by `user_id = current_user`. This gives live inbox updates without polling infrastructure. Can be added after core messaging works.

---

## Build Order (dependency graph)

The build order is determined by hard dependencies (a module cannot be built without its dependencies existing) and soft prioritization (build the daily-use surfaces early so the platform is usable from day 1).

```
Phase 1 — Foundation (nothing works without these)
├── Database schema + migrations (Prisma)
├── Lookup/reference data (academies, statuses, ranking types, tournament types)
├── Auth (NextAuth.js, session, role claims in JWT)
└── RBAC engine (permission matrix, middleware, RLS policies)

Phase 2 — Identity (who is in the system)
├── User account management (create, assign roles)
├── Player profiles (CRUD, photo upload)
└── Trainer profiles (CRUD, academy links)

Phase 3 — Infrastructure services (needed by most modules)
├── File storage abstraction (signed URLs, bucket policies)
└── Notification dispatch (email, thin layer — plug in later)

Phase 4 — Calendar engine (central daily surface, needed by training/meetings/stages)
└── Calendar: base event model, week/month/year views, color coding, role-scoped visibility, filters

Phase 5 — Core domain modules (can be built in parallel after Phase 4)
├── Training sessions (CRUD, recurring, participation entity, quality scores)
├── Tournaments (CRUD, final rankings, match results, video links)
└── Rankings time series (entry CRUD, chart data endpoint)

Phase 6 — Secondary domain modules (depend on Phase 5, buildable in parallel)
├── Sparring partners (register + N:N session links)
├── Ambitions (per player/year/type + results comparison)
├── Evaluations (eval records, configurable eval points, attachments)
├── Medical follow-up (medical events, GDPR audit, file links)
├── Meetings (CRUD, invites, recurring, accept/decline)
├── Stages (training camp CRUD, participant links)
└── Evaluation conversations (CRUD + calendar link)

Phase 7 — Communication
└── Messaging (inbox, threads, group addressing, attachments, notifications)

Phase 8 — Synthesis views
└── Player dashboard (aggregated chart data from all domain modules)

Phase 9 — v2 (deferred)
└── AI video analysis pipeline
```

**Critical path:** Auth → RBAC → Player Profiles → Calendar → Training Sessions. Everything else is parallel after Phase 4.

**Day 1 operational target:** Phases 1–6 must all be complete. The platform is only operationally useful when the calendar is populated (training + tournaments + meetings) and player profiles + evaluations exist. Messaging (Phase 7) is highly desirable for day 1 but technically is not a dependency of the core operations.

---

## Scalability Considerations

### Current scale expectations
A Belgian federation elite program has O(50–200) active users. PostgreSQL on a single managed instance (Supabase Pro, Railway, Render) handles this trivially — no sharding, no read replicas, no caching layer needed for v1.

### What to avoid building prematurely
- Redis/caching layer: not needed until you have measurable N+1 query issues or >500 concurrent users
- Message queue (BullMQ, etc.): notification dispatch can be synchronous fire-and-forget for v1; add a queue if delivery reliability becomes an issue
- CDN for profile photos: add only if image load times become a complaint; Supabase Storage has built-in CDN

### What to build correctly from day 1 (cannot be retrofitted cheaply)
- **RLS policies**: retrofitting row-level security onto an existing schema without them is a major audit and migration effort
- **Audit log for medical data**: GDPR Art. 9 compliance requires this from first write; it cannot be added retroactively
- **Signed URL pattern for file access**: once clients have raw storage URLs cached, migrating to signed URLs breaks existing links
- **tRPC caller context / RBAC middleware**: retrofitting role scoping into procedures written without it requires touching every endpoint
- **Ranking as time series**: converting a "current ranking" field to a time series after data exists requires migration and loses history

### Future scale triggers
- **>500 users or public-facing**: Add CDN, connection pooling (PgBouncer), and consider read replicas
- **AI video analysis pipeline (v2)**: Add object storage with lifecycle policies, async job queue (BullMQ or Inngest), separate worker process — this is why the `ai-analysis` module is isolated from day 1
- **External integrations**: ITTF rankings API, external calendar sync (iCal export) — add a REST adapter layer alongside tRPC, no refactoring required

### GDPR-specific scalability
- Implement a **data subject request handler** (right to access, right to erasure) from day 1 as a service, even if it's manual in v1. When volume grows, automate. The data model (all user data linked via `user_id` FK) makes this straightforward if the model is clean.
- **Data retention policies**: define per-category (medical data, training logs, tournament results) — PostgreSQL partitioning by year can support automated archival if needed.

---

*Research date: 2026-05-01*
