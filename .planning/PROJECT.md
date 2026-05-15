# VTTL Topsportplatform

## What This Is

An operational elite sports management platform for the Flemish Table Tennis League (VTTL — Vlaamse Tafeltennis Liga). It supports the full lifecycle of elite player development: training management, tournament tracking, rankings, evaluations, medical follow-up, calendar coordination, internal communication, and AI-assisted video analysis. Primary users are the technical director, coaches, players, parents, academy managers, and sparring partners.

## Core Value

Every player's complete development picture — training quality, competition results, rankings, evaluations, and ambitions — is visible in one place, accessible by the right people, and actionable in daily sports operations.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**User Management & Access Control**
- [ ] Role-based access: technical director, trainer, player, parent, sparring partner, academy manager
- [ ] Technical director has full access + user/authorization management
- [ ] Players see only own data; parents see only own child's data
- [ ] Trainers scoped to assigned academies; academy managers scoped to own academy
- [ ] Sparring partners see only sessions they participate in

**Player Profile**
- [ ] Full player record: name, photo, DOB, gender, school, address, club, status (A/B/C), academy, age category, category year
- [ ] Club ≠ academy (separate fields, not interchangeable)
- [ ] Academy lookup: Topsportschool, Academy Antwerpen, Academy West-Vlaanderen, Academy Oost-Vlaanderen, Academy Limburg, Academy Brabant

**Trainer Profile**
- [ ] Full trainer record: name, photo, DOB, gender, address, diploma (none/A/B/A in training/B in training), pedagogical qualification toggle
- [ ] Trainer can be linked to one or more academies

**Calendar — Central Interface**
- [ ] Week view (default, Outlook-style with days horizontal, hours vertical), month view, year view
- [ ] All event types visually color-coded and distinguishable
- [ ] Role-scoped visibility: players see own events, trainers see own + scope, TD sees all
- [ ] Filters: by player, trainer, sparring partner, academy, event type

**Training Sessions**
- [ ] Fields: date, start time, duration (minutes), training type (Group/Individual/Physical/Mental), organisation (Private/KBTTB/Topsportschool/Academy/Provincial/Club), trainer, location
- [ ] Creatable by: technical director, trainer, player
- [ ] Recurring session support
- [ ] Participation entity per player per session: quality score + free text (trainer only)

**Sparring Partners**
- [ ] Own register (not a session attribute): name, photo, phone, email
- [ ] N-to-N link with training sessions
- [ ] Defined and managed by technical director only

**Tournaments & Results**
- [ ] Tournament types: WTT, WTT Star, ETTU, EJK, WK, Internationaal, Belgium
- [ ] Tournament record: name, start date, city, country, age category, type
- [ ] Tournaments created by technical director only
- [ ] Tournament final ranking per player: winner → group phase (9 levels)
- [ ] Match result per match: round, opponent (text), ranking, date, score, won/lost, optional video link
- [ ] Results entered by player only (own results only)

**Rankings (Time Series)**
- [ ] Multiple parallel ranking series per player
- [ ] Ranking types: Senior World, Youth World, Senior European, Youth European, Belgium
- [ ] Each entry: player, type, date, value
- [ ] Entry by: technical director or player (own only)

**Ambitions**
- [ ] Per player, per year, per tournament type: minimum expected result
- [ ] Same 9-level lookup as tournament final ranking
- [ ] System compares ambitions vs. actual results

**Evaluations**
- [ ] Multiple per year; by trainer or technical director
- [ ] Fields: evaluator, player, free text, list of scored evaluation points (1–10), optional attachment
- [ ] Evaluation points configurable by technical director

**Medical Follow-up**
- [ ] Medical events: type (free text), is_injury toggle, doctor (free text), start date, end date
- [ ] Scan/document upload: scoped as open question for v1 (see risks)

**Meetings**
- [ ] Anyone can create; fields: name, date, start/end time, invited users
- [ ] Recurring meeting support
- [ ] Invite accept/decline workflow
- [ ] Invitees can be any system user

**Stages (Training Camps)**
- [ ] TD only; fields: name, location, country, start date, end date, players, trainers

**Evaluation Conversations**
- [ ] Fields: date, start/end time, evaluator (trainer or TD), player

**Internal Messaging**
- [ ] Inbox, sent, read/unread, reply, forward, attachments
- [ ] Individual and group recipients
- [ ] Groups: by status (A/B/C), academy, all players, all trainers, all sparring partners, age category

**Player View (central workspace)**
- [ ] Tabs: Basisgegevens, Kalender (default), Resultaten, Trainingen, Ambities, Rankings, Medische info, Evaluaties, AI-videoanalyses, Dashboard
- [ ] For the player themselves: only own view is accessible

**Player Dashboard**
- [ ] Graphical overview: training stats, quality score evolution, tournament results vs ambitions, ranking evolution, evaluation summary, medical/physical tracking (privacy-scoped)

**AI Video Analysis**
- [ ] Link match video to match result
- [ ] Analysis elements: service types used/won/lost, forehand/backhand winners, unforced errors, point-loss patterns, tactical observations
- [ ] First release: manual video linking; AI analysis may be phased

### Out of Scope

- Session builder with exercise library — deferred to v2; v1 uses free text + quality score only
- Physical testing beyond count + free text — deferred to v2
- Advanced physiological tracking — deferred to v2
- Full AI video analysis pipeline — v1 ships video link attachment; AI analysis is v2
- External integrations (ITTF rankings API, etc.) — deferred

## Context

**Domain:** Elite table tennis development, Flemish league (VTTL). Multi-academy structure with a central topsport school plus provincial academies.

**Language:** Three-language UI — Nederlands (nl, default), English (en), Frans (fr). VTTL is the Flemish federation, but elite sport involves French-speaking athletes/coaches and international visitors. Default for new accounts and anonymous visitors is `nl`; browser `Accept-Language` used as fallback hint.

**Regulatory:** GDPR compliance mandatory. Medical data is sensitive personal data (special category under GDPR Art. 9). Role-scoped visibility must be technically enforced, not just UI-level.

**Key structural rules (fixed):**
- Club ≠ academy (two distinct concepts — club is home club, academy is training structure)
- Sparring partner is a first-class entity, not a session attribute
- Training participation (player ↔ session) is its own entity with quality score + feedback
- Rankings are time series (multiple types per player, date-stamped values)
- Ambitions are per player / per year / per tournament type with comparison to results
- Tournament results exist at two levels: final ranking (per tournament) and per-match results

**Scope-spanning open question:** Blessure-scan uploads — mentioned as deferred in physical tracking section, but required in medical events section. Must be resolved before v1 ships.

## Constraints

- **Language**: Multilingual UI — Nederlands (nl, default), English (en), Frans (fr). All user-facing labels, copy, validation messages, transactional emails, and consent text must be available in all three locales before production. Per-user `preferred_locale` persisted; lookup display via i18n message catalogs (codes in DB, labels in catalogs); proper nouns (academy names, club names, person names) not translated. Backend logs and source code remain English.
- **Privacy/GDPR**: Medical data, parent-child links, and role scoping must be technically enforced; consent tracking required (consent text versioned per locale; legal review per language)
- **Usability**: Platform must be operationally strong from day one — not an MVP skeleton. Calendar and player view are the two most critical daily-use surfaces
- **Calendar**: Week view (Outlook-style) is mandatory for v1; must support all event types with color coding
- **Data integrity**: Lookups (status, academy, tournament type, ranking type, etc.) must be centrally managed, not free-text
- **Authorization**: Role scoping is a hard constraint, not a soft guideline — enforced at API/data layer

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Sparring partner = first-class entity (not session attribute) | Sparring partners can be linked to multiple sessions and academies; treating as attribute would lose this | — Pending |
| Club vs academy as separate fields | VTTL domain constraint — stamclub ≠ trainingsstructuur; conflating causes data integrity issues | — Pending |
| Training participation as separate entity | Enables per-player quality scoring and feedback per session, which is a core evaluation workflow | — Pending |
| Rankings as time series | Multiple ranking types evolve over time; single-value field would lose history | — Pending |
| Ambitions at player/year/tournament-type level | Enables meaningful comparison: ambition vs. actual result per competition type | — Pending |
| AI video analysis deferred from full v1 | Complex ML infrastructure; video linking (manual) ships in v1, analysis in v2 | — Pending |
| Scan uploads: open question | Conflicting signals in brief — deferred in physical section, required in medical section | — Pending |
| Database on Supabase Postgres (EU) | Managed Postgres with built-in RLS support, EU residency (Frankfurt), automatic backups, pg_cron and pgcrypto available; Storage and Realtime on same platform reduce operational surface | — Pending |
| Tournament result entry expanded beyond player-only | Operational reality: trainers at tournaments often log results on player's behalf; enforce ownership at API but allow player + assigned trainer + TD | — Pending |
| Sparring partner v1 = TD-managed register only | "Discovery / style filtering" features deferred to v2 — out of v1 scope per critical review | — Pending |
| Training-load × ranking correlation overlay deferred | Statistical noise too high at v1 data density (subjective 1–5 scores, ~50–200 users, < 2 seasons of history) | — Pending |
| Email is fallback channel, in-app messaging is primary | Resolves contradiction between email-as-primary-for-parents claim and in-app messaging requirement; read receipts work in-app only | — Pending |
| Three-language UI: nl/en/fr with nl default | Belgium is multilingual — VTTL is the Flemish federation but elite sport involves French-speaking athletes/coaches and international visitors. Dutch-only would exclude valid users. | — Pending |
| Lookups: codes-in-DB + i18n message catalogs | Language-neutral keys (`status_a`, `tournament_wtt_star`) decoupled from display labels; proper nouns (academy/club/person names) stored once, not translated. Cleaner schema, no per-locale denormalization. | — Pending |
| i18n infrastructure built in Phase 1 (not deferred) | `users.preferred_locale`, Better Auth email templates per locale, consent text versioned per locale must exist before first user registers — otherwise migration + re-consent is required later. | — Pending |

## Open Questions Requiring Resolution Before / During Phase 1

1. **Scope-spanning blessure-scan upload** (RISK-01)
   - Brief is contradictory: deferred in physical-tracking section, required in medical-events section
   - V1 proposed: allow scan uploads in medical events with strict access (Art. 9 isolation, signed URLs, 5-min TTL) — defer "physical scan library" to v2

2. **Belgium Ranking direction** (RISK-02)
   - World/European rankings: lower value = better (rank 1 is best)
   - Belgium ranking: confirm with VTTL whether stored as rank position (lower = better) or as a points value (higher = better) — affects all comparison logic

3. **Medical data access matrix** (NEW)
   - Define explicitly per role × per medical record type:
     - Coach (trainer): traffic-light injury status only? Or full event metadata?
     - Parent of minor: full record? Or summary?
     - Player: own full record always
     - Sparring partner: never any medical visibility
   - Required before Phase 5 (medical follow-up implementation)

4. **Consent lifecycle** (NEW)
   - Under-16 → 16 transition: prompt athlete to provide own consent on 16th birthday; preserve guardian consent record as historical proof of lawful processing
   - Withdrawal of consent: defines what happens to existing data per category (photos anonymized, evaluations retained but minus photo, medical events anonymized but events retained for sport safety)
   - Required before Phase 1 (schema design)

5. **Tournament result dispute workflow** (NEW)
   - Player edits own result within 48h: allowed
   - After 48h: requires TD approval
   - Trainer enters result on player's behalf at tournament: allowed if linked to player's academy
   - Result lifecycle: `draft → confirmed → published`; only `confirmed`+ feed into rankings comparison
   - Required before Phase 4 (tournaments + results)

6. **Federation ranking vs. internal ranking source-of-truth** (NEW)
   - V1: manual entry is source of truth; UI labels rankings as "Manueel ingevoerd, controleer tegen officiële bron"
   - V2: ITTF API sync (pending API access agreement)
   - Required: `source` column on `ranking_entries` table from Phase 4

7. **Evaluation visibility per role** (NEW)
   - Default: trainer + TD only
   - Trainer/TD explicitly publishes to player and/or parent
   - Internal observations field never published, regardless of visibility flag
   - Required before Phase 5 (evaluations)

8. **Sparring partner availability calendar** (NEW)
   - V1: sparring partners maintain their own availability blocks; session creation warns on overlap
   - Required before Phase 5 (sparring partners)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-15 after Phase 3 (kalender) execution — polymorphic calendar schema, 9 tRPC procedures with RLS-context, FullCalendar 6 UI with 6 color-coded event types, RRULE expansion anchored on Europe/Brussels wall clock, cross-scope conflict detection with redaction, GDPR audit logging on every mutation.*
