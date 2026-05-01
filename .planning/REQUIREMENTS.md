# Requirements — VTTL Topsportplatform

*Generated: 2026-05-01 | Source: PROJECT.md + research synthesis*

---

## v1 Requirements

### AUTH — Authentication & Session

- [ ] **AUTH-01**: User can log in with email + password and maintain session across browser restarts
- [ ] **AUTH-02**: User can reset password via email link without admin intervention
- [ ] **AUTH-03**: Session carries role + academy scoping (CallerContext) — enforced by Better Auth + tRPC middleware
- [ ] **AUTH-04**: Technical director can create, activate, and deactivate user accounts
- [ ] **AUTH-05**: Technical director can assign and change user roles

---

### USER — User Management & Role Assignments

- [ ] **USER-01**: Technical director can link a parent account to a specific player (parent_child_links table)
- [ ] **USER-02**: Technical director can link a trainer account to one or more academies
- [ ] **USER-03**: Technical director can link a sparring partner to one or more training sessions
- [ ] **USER-04**: System enforces that each user role sees only data within its defined scope (player → own; parent → own child; trainer → assigned academy players; academy manager → own academy; sparring partner → own sessions; TD → all)
- [ ] **USER-05**: All data access is enforced at the API + database layer (PostgreSQL RLS), not only in the UI

---

### GDPR — Compliance & Data Rights

- [ ] **GDPR-01**: Layered consent recorded at user/guardian registration: operational data, medical data processing, photo/video use — each item stored with who consented, when, and policy version
- [ ] **GDPR-02**: Belgian minor consent rule enforced: players under 16 require parental guardian account linked and consent granted
- [ ] **GDPR-03**: Medical data stored in isolated table family (`medical_events`, `medical_documents`) with audit log on every read
- [ ] **GDPR-04**: Every read of a medical record appended to append-only `audit_log` (actor, action, resource, timestamp, IP)
- [ ] **GDPR-05**: User can request export of all their personal data in JSON format (GDPR Art. 20 — data portability)
- [ ] **GDPR-06**: Technical director can execute erasure request: anonymize personal identifiers while retaining aggregate statistics (GDPR Art. 17)
- [ ] **GDPR-07**: Medical records can be fully deleted independently of player profile on erasure request
- [ ] **GDPR-08**: All datetime fields stored as `TIMESTAMPTZ` (UTC); events carry IANA timezone field

---

### PLAYER — Player Profiles

- [ ] **PLAYER-01**: Player profile stores: naam, voornaam, foto, geboortedatum, geslacht, school, adres, postcode, gemeente, provincie, land, telefoon, e-mail
- [ ] **PLAYER-02**: Player profile stores sport attributes: club (vrij tekst), statuut (A/B/C), academie (lookup: 6 waarden), leeftijdscategorie (lookup), categoriejaar (numeriek)
- [ ] **PLAYER-03**: Club and academy are distinct fields — never merged (schema-enforced)
- [ ] **PLAYER-04**: Age category and category year stored as explicit fields (not derived live from DOB)
- [ ] **PLAYER-05**: Player profile photo uploaded and displayed; stored in private bucket, accessible to authenticated users with appropriate role
- [ ] **PLAYER-06**: Emergency contact stored on player profile (required for minors)
- [ ] **PLAYER-07**: Technical director and academy manager can view and edit player profiles in their scope; player can view and edit own non-sensitive fields

---

### TRAINER — Trainer Profiles

- [ ] **TRAINER-01**: Trainer profile stores: naam, voornaam, foto, geboortedatum, geslacht, adres, postcode, gemeente, provincie, land, telefoon, e-mail
- [ ] **TRAINER-02**: Trainer profile stores: trainerdiploma (none/A/B/A-in-opleiding/B-in-opleiding), pedagogische kwalificatie (toggle)
- [ ] **TRAINER-03**: Trainer can be linked to one or more academies; this scoping determines which players' data the trainer can access

---

### SPAR — Sparring Partners

- [ ] **SPAR-01**: Sparring partner register stores: naam, voornaam, foto, telefoon, e-mail
- [ ] **SPAR-02**: Sparring partners are linked to training sessions via a junction table (N-to-N) — no free-text name field on sessions
- [ ] **SPAR-03**: Only technical director can create and manage sparring partner profiles
- [ ] **SPAR-04**: Sparring partner account can see only the calendar events of sessions they are linked to

---

### CAL — Calendar

- [ ] **CAL-01**: Calendar week view (default): days horizontal, hours vertical, Outlook-style — powered by FullCalendar timeGrid plugin
- [ ] **CAL-02**: Calendar month view and year view available; week view is the default
- [ ] **CAL-03**: All event types are visually color-coded and distinguishable (trainingen: blauw, toernooien: oranje, vergaderingen: groen, stages: paars, evaluatiegesprekken: geel, medische afspraken: rood)
- [ ] **CAL-04**: Calendar shows only events within the caller's scope (player → own events; trainer → own + academy scope; sparring partner → own sessions; academy manager → academy players' events; TD → all)
- [ ] **CAL-05**: Calendar has filters: by player, trainer, sparring partner, academy, event type
- [ ] **CAL-06**: Calendar supports ICS/iCal export per user (for Outlook/Google Calendar sync)
- [ ] **CAL-07**: Calendar shows conflict warning when a new event overlaps an existing one
- [ ] **CAL-08**: Mobile calendar renders correctly: single-day column view on narrow screens with swipe navigation

---

### TRAIN — Training Sessions

- [ ] **TRAIN-01**: Training session fields: datum, starttijd, duur (minuten), trainingtype (Groep/Individueel/Fysiek/Mentaal), organisatie (Privé/KBTTB/Topsportschool/Academie/Provinciaal/Club), trainer, locatie (vrij tekst)
- [ ] **TRAIN-02**: Training sessions can be created by: technical director, trainer, player
- [ ] **TRAIN-03**: Training sessions support recurring patterns (RRULE-based — not materialized occurrences); individual occurrences can be cancelled or modified
- [ ] **TRAIN-04**: Participation entity per player per session: quality score (structured, trainer only) + free text feedback (trainer only)
- [ ] **TRAIN-05**: Attendance tracked per session: who participated, trainer can mark attendance from the calendar event
- [ ] **TRAIN-06**: Sparring partners linked to sessions via junction table (SPAR-02)

---

### TOURN — Tournaments & Results

- [ ] **TOURN-01**: Tournament record: naam, startdatum, stad, land, leeftijdscategorie, tornooitype (WTT/WTT Star/ETTU/EJK/WK/Internationaal/Belgium)
- [ ] **TOURN-02**: Only technical director can create and edit tournaments
- [ ] **TOURN-03**: Tournament final ranking per player (level 1 result): winnaar/finalist/laatste 4/laatste 8/laatste 16/laatste 32/laatste 64/laatste 128/groepsfase
- [ ] **TOURN-04**: Per-match result (level 2): ronde (finale/.../groepsfase), tegenstander (vrij tekst), ranking (numeriek), datum, score, gewonnen/verloren (toggle), optionele video link
- [ ] **TOURN-05**: Tournament results (both levels) entered by the player themselves only, for own results only — enforced at API layer
- [ ] **TOURN-06**: Historical results browsable without pagination forcing export; both levels separately queryable

---

### RANK — Rankings

- [ ] **RANK-01**: Rankings stored as time series: player, ranking_type, datum, rangwaarde — one row per entry
- [ ] **RANK-02**: Ranking types: Senior World Ranking, Youth World Ranking, Senior European Ranking, Youth European Ranking, Belgium Ranking
- [ ] **RANK-03**: Ranking type carries direction metadata (lager = beter for world/European; confirm for Belgium ranking)
- [ ] **RANK-04**: Multiple parallel ranking series per player, each independently chartable
- [ ] **RANK-05**: Current ranking derived from latest time-series entry — never stored as flat field on player
- [ ] **RANK-06**: Rankings can be entered by: technical director, or player (own rankings only)
- [ ] **RANK-07**: Ranking evolution shown as line chart per type per player

---

### AMB — Ambitions

- [ ] **AMB-01**: Ambition defined per player, per year, per tournament type with a minimum expected result (same 9-level lookup as TOURN-03)
- [ ] **AMB-02**: System shows ambition vs. actual results per player per year per tournament type
- [ ] **AMB-03**: Ambition comparison handles missing results gracefully (LEFT JOIN — shows "nog niet gespeeld", not an error)
- [ ] **AMB-04**: Technical director can set ambitions; player can view own ambitions

---

### EVAL — Evaluations

- [ ] **EVAL-01**: Evaluation fields: evaluator (trainer or TD), speler, vrije tekst, lijst van evaluatiepunten met score 1–10 per punt, optionele bijlage
- [ ] **EVAL-02**: Evaluation points are configurable by technical director (add/edit/soft-delete — never hard-delete to preserve history)
- [ ] **EVAL-03**: Evaluation point label is snapshotted onto each score record at creation (score stores both FK and text label at time of evaluation)
- [ ] **EVAL-04**: Evaluations created by trainer or technical director
- [ ] **EVAL-05**: Players can view their own evaluations (timely notification on new evaluation)
- [ ] **EVAL-06**: Date-stamped history; multiple evaluations per year per player

---

### MED — Medical Follow-up

- [ ] **MED-01**: Medical event fields: medisch event (vrij tekst), blessure (ja/nee toggle), dokter (vrij tekst), startdatum, einddatum
- [ ] **MED-02**: Medical data stored in isolated table (`medical_events`) — not on the player profile
- [ ] **MED-03**: Medical data access logged to audit_log on every read (GDPR-01 applies)
- [ ] **MED-04**: Coaches see injury status indicator (traffic light: active/limited/unavailable) — NOT the full medical record
- [ ] **MED-05**: Full medical record visible only to: player themselves, technical director (and designated medical staff if role extended)
- [ ] **MED-06**: Open question for v1: medical scan/document upload (see RISK-01)

---

### AGE — Agenda Item Types (Calendar Events)

- [ ] **AGE-01**: Stage record: naam, plaats, land, startdatum, einddatum, deelnemende spelers, deelnemende trainers — created by TD only
- [ ] **AGE-02**: Meeting record: naam, datum, startuur, einduur, uitgenodigde personen — created by anyone; supports recurring patterns; invitees can accept or decline
- [ ] **AGE-03**: Evaluation conversation record: datum, startuur, einduur, evaluator (trainer/TD), speler — linked to calendar
- [ ] **AGE-04**: Tournaments appear on calendar (TOURN-01 linked to calendar)

---

### MSG — Messaging

- [ ] **MSG-01**: Internal messaging: inbox, sent messages, read/unread status, reply, forward, attachments
- [ ] **MSG-02**: Messages can be sent to individual users or to predefined groups: statuut A/B/C, per academie, all players, all trainers, all sparring partners, per leeftijdscategorie
- [ ] **MSG-03**: Group recipients resolved to individual `message_recipients` rows at send time (materialized delivery — inbox queries stay simple)
- [ ] **MSG-04**: Unread count cached and indexed; group send is async (does not block sender)
- [ ] **MSG-05**: Message received notification delivered in-app; email notification for users who prefer it

---

### FILE — File Management

- [ ] **FILE-01**: File access via server-side signed URLs only — never public bucket URLs
- [ ] **FILE-02**: Medical documents stored in a separate storage bucket/prefix with stricter access policies
- [ ] **FILE-03**: Profile photos stored separately, accessible to authenticated users with appropriate role
- [ ] **FILE-04**: All files named with UUIDs (not predictable IDs or patient names)
- [ ] **FILE-05**: Evaluation attachments accessible to trainer + TD + subject player

---

### VIEW — Player View & Dashboard

- [ ] **VIEW-01**: Player view is the central workspace per player with tabs: Basisgegevens, Kalender (default tab), Resultaten, Trainingen, Ambities, Rankings, Medische info, Evaluaties, AI-videoanalyses (placeholder), Dashboard
- [ ] **VIEW-02**: For a player, own player view is the only main interface — no other players' data accessible
- [ ] **VIEW-03**: Player dashboard tab shows: training stats + quality score evolution, tournament results vs ambitions, ranking evolution chart, evaluation summary — all in one endpoint (no N+1 per widget)
- [ ] **VIEW-04**: Dashboard uses aggregation queries (GROUP BY, COUNT, AVG in SQL) — not loading all rows into application memory
- [ ] **VIEW-05**: Dashboard data cache: 5-minute TTL (does not need to be real-time)

---

### SEARCH — Global Search

- [ ] **SEARCH-01**: Global search finds players by name, tournaments by date, trainers by name — scoped to caller's visibility
- [ ] **SEARCH-02**: Dutch full-text search with accent-insensitive matching (`pg_trgm` + `unaccent` extensions)

---

## v2 Requirements (deferred — important, not v1)

- **AI-VIDEO**: AI video analysis pipeline (Cloudflare Stream upload → webhook → analysis job → annotations stored)
- **AI-VIDEO-02**: Video tag schema aligned with v1 evaluation rubrics (so v2 tagging maps onto existing data structures)
- **SPAR-STYLE**: Sparring partner filterable by playing style (left-handed, penhold, etc.)
- **COHORT**: Anonymous cohort benchmarking per age category
- **CAL-IMPORT**: VTTL competition calendar CSV import template
- **PHYSICAL**: Physical testing module beyond count + free text
- **ICS-SUBSCRIBE**: Live ICS calendar subscription URL per user (push updates vs. one-time export)
- **NOTIFICATION-PREFS**: Per-user notification preferences (email/in-app digest settings)

## Out of Scope

- League standings — VTTL already publishes these publicly
- In-platform payments / registration fees — PCI-DSS scope, separate product
- Slack-style channels / threaded chat — broadcast + 1:1 covers 95% of use cases
- Public athlete profile pages — creates GDPR surface area
- Gamification / badges — condescending in elite sport
- Customizable drag-and-drop dashboards — high complexity, low value
- Wearable / biometric integration — requires sports science team, out of scope
- Multi-language UI (FR/EN) — Dutch only; externalize strings in single `nl.json` for future extraction
- Automated training plan generation — liability, insufficient data density in v1
- External ITTF API integration — confirm API access terms before building

---

## Traceability

| REQ-ID | Roadmap Phase | Notes |
|--------|--------------|-------|
| AUTH-01 | Phase 1 — Fundament | |
| AUTH-02 | Phase 1 — Fundament | |
| AUTH-03 | Phase 1 — Fundament | CallerContext middleware |
| AUTH-04 | Phase 1 — Fundament | TD user management panel |
| AUTH-05 | Phase 1 — Fundament | TD role assignment |
| USER-01 | Phase 1 — Fundament | parent_child_links schema |
| USER-02 | Phase 1 — Fundament | trainer_academy_links schema |
| USER-03 | Phase 1 — Fundament | session_sparring_partners junction |
| USER-04 | Phase 1 — Fundament | RLS policies per role |
| USER-05 | Phase 1 — Fundament | PostgreSQL RLS enforcement |
| GDPR-01 | Phase 1 — Fundament | consent_records schema + registration flow |
| GDPR-02 | Phase 1 — Fundament | Belgian minor consent path (< 16) |
| GDPR-03 | Phase 1 — Fundament | medical_events table family + audit trigger |
| GDPR-04 | Phase 1 — Fundament | append-only audit_log on medical reads |
| GDPR-05 | Phase 7 — Synthese | /mijn-gegevens export UI |
| GDPR-06 | Phase 7 — Synthese | TD erasure workflow UI |
| GDPR-07 | Phase 1 — Fundament | medical delete path in erasure strategy |
| GDPR-08 | Phase 1 — Fundament | TIMESTAMPTZ + IANA tz convention |
| PLAYER-01 | Phase 2 — Identiteit & Bestanden | |
| PLAYER-02 | Phase 2 — Identiteit & Bestanden | lookup tables from Phase 1 |
| PLAYER-03 | Phase 2 — Identiteit & Bestanden | schema-enforced club ≠ academy |
| PLAYER-04 | Phase 2 — Identiteit & Bestanden | explicit age category field |
| PLAYER-05 | Phase 2 — Identiteit & Bestanden | R2 + signed URL |
| PLAYER-06 | Phase 2 — Identiteit & Bestanden | emergency contact, required for minors |
| PLAYER-07 | Phase 2 — Identiteit & Bestanden | scoped edit permissions |
| TRAINER-01 | Phase 2 — Identiteit & Bestanden | |
| TRAINER-02 | Phase 2 — Identiteit & Bestanden | diploma + pedagogical qualification |
| TRAINER-03 | Phase 2 — Identiteit & Bestanden | trainer_academy_links junction |
| FILE-01 | Phase 2 — Identiteit & Bestanden | signed URLs only, no public bucket |
| FILE-02 | Phase 2 — Identiteit & Bestanden | separate medical bucket/prefix |
| FILE-03 | Phase 2 — Identiteit & Bestanden | profiles/ prefix, role-gated |
| FILE-04 | Phase 2 — Identiteit & Bestanden | UUID filenames |
| FILE-05 | Phase 5 — Uitgebreid domein | evaluation attachments (trainer+TD+player) |
| CAL-01 | Phase 3 — Kalender | FullCalendar timeGridWeek |
| CAL-02 | Phase 3 — Kalender | month + year views |
| CAL-03 | Phase 3 — Kalender | color coding per event type |
| CAL-04 | Phase 3 — Kalender | CallerContext-scoped event list |
| CAL-05 | Phase 3 — Kalender | filter bar |
| CAL-06 | Phase 8 — Kwaliteit & Release | ICS/iCal export |
| CAL-07 | Phase 3 — Kalender | server-side conflict detection |
| CAL-08 | Phase 3 — Kalender | mobile single-day + swipe |
| TRAIN-01 | Phase 4 — Kerndomein | |
| TRAIN-02 | Phase 4 — Kerndomein | creator roles |
| TRAIN-03 | Phase 4 — Kerndomein | RRULE recurring + exceptions |
| TRAIN-04 | Phase 4 — Kerndomein | session_participants entity |
| TRAIN-05 | Phase 4 — Kerndomein | attendance tracking |
| TRAIN-06 | Phase 4 — Kerndomein | sparring partner junction (see SPAR-02) |
| TOURN-01 | Phase 4 — Kerndomein | |
| TOURN-02 | Phase 4 — Kerndomein | TD-only creation |
| TOURN-03 | Phase 4 — Kerndomein | 9-level outcome lookup |
| TOURN-04 | Phase 4 — Kerndomein | per-match result entity |
| TOURN-05 | Phase 4 — Kerndomein | player-own-results API gate |
| TOURN-06 | Phase 4 — Kerndomein | browsable history, dual-level query |
| RANK-01 | Phase 4 — Kerndomein | time series schema |
| RANK-02 | Phase 4 — Kerndomein | 5 ranking types |
| RANK-03 | Phase 4 — Kerndomein | direction metadata per type (see RISK-02) |
| RANK-04 | Phase 4 — Kerndomein | parallel series per player |
| RANK-05 | Phase 4 — Kerndomein | current = latest entry, no flat field |
| RANK-06 | Phase 4 — Kerndomein | TD + own-player entry |
| RANK-07 | Phase 4 — Kerndomein | line chart per type |
| SPAR-01 | Phase 5 — Uitgebreid domein | sparring partner register |
| SPAR-02 | Phase 5 — Uitgebreid domein | N-to-N junction table |
| SPAR-03 | Phase 5 — Uitgebreid domein | TD-only management |
| SPAR-04 | Phase 5 — Uitgebreid domein | scoped calendar visibility |
| AMB-01 | Phase 5 — Uitgebreid domein | ambitions schema |
| AMB-02 | Phase 5 — Uitgebreid domein | ambition vs. results comparison |
| AMB-03 | Phase 5 — Uitgebreid domein | LEFT JOIN — "nog niet gespeeld" |
| AMB-04 | Phase 5 — Uitgebreid domein | TD sets, player views own |
| EVAL-01 | Phase 5 — Uitgebreid domein | evaluation fields |
| EVAL-02 | Phase 5 — Uitgebreid domein | configurable evaluation points |
| EVAL-03 | Phase 5 — Uitgebreid domein | label snapshot at creation |
| EVAL-04 | Phase 5 — Uitgebreid domein | trainer + TD creation |
| EVAL-05 | Phase 5 — Uitgebreid domein | player view + notification |
| EVAL-06 | Phase 5 — Uitgebreid domein | date-stamped history |
| MED-01 | Phase 5 — Uitgebreid domein | medical event fields |
| MED-02 | Phase 5 — Uitgebreid domein | isolated table (designed Phase 1) |
| MED-03 | Phase 5 — Uitgebreid domein | audit_log on every read |
| MED-04 | Phase 5 — Uitgebreid domein | traffic-light only for coaches |
| MED-05 | Phase 5 — Uitgebreid domein | full record: player + TD only |
| MED-06 | Phase 5 — Uitgebreid domein | scan upload — pending RISK-01 decision |
| AGE-01 | Phase 5 — Uitgebreid domein | stages (TD only) |
| AGE-02 | Phase 5 — Uitgebreid domein | meetings + recurring + invite workflow |
| AGE-03 | Phase 5 — Uitgebreid domein | evaluation conversations |
| AGE-04 | Phase 5 — Uitgebreid domein | tournaments on calendar |
| MSG-01 | Phase 6 — Communicatie | inbox, sent, reply, forward, attachments |
| MSG-02 | Phase 6 — Communicatie | individual + group recipients |
| MSG-03 | Phase 6 — Communicatie | materialized delivery rows at send time |
| MSG-04 | Phase 6 — Communicatie | cached unread count + async group send |
| MSG-05 | Phase 6 — Communicatie | in-app + optional email notification |
| VIEW-01 | Phase 7 — Synthese | tabbed player view |
| VIEW-02 | Phase 7 — Synthese | player sees own view only |
| VIEW-03 | Phase 7 — Synthese | dashboard: all widgets in one query |
| VIEW-04 | Phase 7 — Synthese | SQL aggregation, no N+1 |
| VIEW-05 | Phase 7 — Synthese | 5-min dashboard cache |
| SEARCH-01 | Phase 7 — Synthese | global search, caller-scoped |
| SEARCH-02 | Phase 7 — Synthese | pg_trgm + unaccent, accent-insensitive |

---

*Last updated: 2026-05-01 after research synthesis*
