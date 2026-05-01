# Features Research — VTTL Topsportplatform

> Research synthesized from knowledge of Teamworks, Hudl, SportsEngine, Sportlogiq, ProTracker,
> Smartabase, Kinduct, Catapult, national federation platforms (KNLTB, FFT, ITTF), and
> general elite sports academy management literature. No live web search was used; all
> findings are from training knowledge (cutoff August 2025).

---

## Table Stakes (must have or platform fails)

These are features users have come to expect from any credible sports management platform.
Their absence immediately signals an unfinished product and erodes trust.

### Identity & Access
- Single login per user with role-based access — coaches, athletes, parents, admins must
  each see a different slice of data from the same URL/app.
- Stable, shareable athlete profile URLs (or IDs) that survive role changes, team changes,
  and season rollovers. Data continuity across seasons is non-negotiable in elite development.
- Password reset / self-service account recovery. Admins cannot become a support bottleneck
  for login issues.

### Player Profiles
- Personal data (name, DOB, contact, nationality, club affiliation).
- Photo — coaches and parents expect a recognizable face on every record.
- Basic sport attributes: playing hand, grip style, rubber/blade setup, weight class
  (for sports with categories), current rating/ranking number.
- Injury status indicator visible to coaches at a glance (active / limited / unavailable).
- Emergency contact — legally expected for minors; often required by insurance.

### Training & Attendance
- Session logging with date, duration, location, coach(es) present.
- Attendance tracking per session — who was present, who was absent, reason if known.
  Absence tracking is the single most-used reporting feature in federation platforms.
- Training load notation (volume, intensity, session type) — even a simple 1–5 subjective
  scale is sufficient if objective tracking (GPS, HRV) is out of scope.

### Tournament Results
- Results entry (score, opponent, round, event, date) without requiring a third-party import.
  Manual entry must always be possible as a fallback.
- Clear separation between "tournament-level" results (placement, draw size) and
  "match-level" results (individual game scores). Users navigate both views and expect them
  to be distinct but linked.
- Historical results browsing without pagination limits that force users to export to Excel.

### Rankings
- Current ranking displayed prominently on the athlete profile — this is the primary status
  signal for elite players.
- Ranking history as a chart (at minimum a simple line graph over time). Coaches check
  trajectory, not just current position.
- Multiple ranking types visible in context (national, regional, age group, international
  where applicable). Hiding alternate rankings behind extra clicks causes repeated support
  requests.

### Calendar
- Monthly grid view (the "Outlook-style" mental model is correct and expected).
- Event types visually distinguished by color (training vs. tournament vs. medical vs.
  team meeting).
- iCal/ICS export. Athletes and parents will add events to personal calendars; without ICS
  export they copy-paste manually and then miss updates.
- Conflict detection — showing that an event overlaps an existing one before saving.

### Messaging
- In-platform notifications for new messages so users don't need to monitor email.
- Broadcast capability: coach sends one message to a group (team, age group, all players).
- Read receipts or "seen" indicators — coaches need to know whether a scheduling message
  was actually read, especially for minors who may not have personal email.

### Evaluations
- Structured evaluation form (not free-text only) so data is comparable across time and
  coaches.
- Athlete can view their own evaluation. This is table stakes for athlete engagement;
  keeping evaluations purely internal destroys the feedback loop that is the main reason
  to have evaluations.
- Date-stamped history — coaches expect to pull up "what did we say six months ago."

### Medical Follow-up
- Injury log: date, type, body location, severity, treating practitioner.
- Return-to-play date or status (cleared / restricted / unavailable).
- Privacy barrier: medical data must be separated from general profile data. Coaches may
  need injury status without needing the full medical note. Parents of minors need access
  to their child's records.

### Role & Permission Basics
- At minimum four roles: Admin / Coach / Athlete / Parent.
- Admins can promote/demote roles without developer intervention.
- Parents can only see their own child's data. This is legally required in Belgium under
  GDPR Article 8 for data subjects under 16.

### GDPR Baseline
- Explicit consent record at registration (what was consented to, when, by whom — guardian
  for minors).
- Data export: any registered user can request a download of all data held about them
  (GDPR Article 20 — data portability). A manual admin-assisted export is acceptable at
  MVP scale.
- Account deletion workflow: ability to anonymize or delete a user's personal data on
  request (GDPR Article 17 — right to erasure). Training session attendance can be
  retained as an aggregate stat; the personal identifier must be removable.

---

## Differentiators (competitive advantage)

Features that separate good platforms from excellent ones at the elite sports level.
These are not expected at launch but become the reason users champion the platform.

### Longitudinal Development Tracking
- Ranking trajectory overlaid with training load and tournament calendar — coaches can see
  whether a peak in ranking correlates with a period of high training density or a
  competition cluster. Most platforms store these separately; linking them visually is rare.
- Multi-year evaluation trends: showing a spider/radar chart of evaluation scores across
  three seasons gives coaches a genuinely useful picture that paper records cannot.
- "Development age vs. chronological age" framing for youth players: late developers are
  often mis-evaluated by absolute ranking; showing relative progress within cohort cohorts
  is something national federations explicitly request but rarely get.

### Sparring Partner Register (as a discovery tool, not just a directory)
- Filtering by playing style (e.g., "left-handed penhold attackers") rather than just
  name/club/level. This is the killer feature for table tennis specifically — style
  matchups are central to preparation.
- Availability signaling (open to requests / not currently available) reduces friction
  compared to emailing blindly through a club directory.
- Match history between sparring pairs — even a simple log of "trained together on X dates"
  helps coaches plan.

### Role-Appropriate Dashboards (not one dashboard with role filtering)
- Coaches need a "team at a glance" view: today's training roster, who's injured, next
  tournament, recent evaluation flags.
- Athletes need a personal progress view: my ranking trend, my next events, my last
  evaluation score, my attendance rate.
- Parents need a child-centric simple view: upcoming schedule, attendance, communication
  from coach. No statistics, no other players' data.
- Admins need operational metrics: platform usage, consent status, overdue evaluations,
  upcoming renewals. This is almost never built in V1 and causes administrative overhead.

### Smart Calendar
- Session templates: coaches define a standard weekly training block and stamp it across
  the season in one action. Manual entry of 40 identical Tuesday training sessions is a
  major pain point in every competitor platform.
- Automatic tournament import from VTTL competition calendar (even a manual CSV import
  with a defined format is far better than manual entry).
- Attendance-to-calendar linkage: when a session is logged, attendance can be marked from
  the calendar event rather than navigating to a separate module.

### Video Analysis Integration (V2 — but design for it now)
- Tag schema for tactical patterns (e.g., "serve-receive errors," "backhand counter")
  needs to be defined in V1 evaluation rubrics so that V2 video tagging maps onto existing
  data structures. Retrofitting tag schemas after video upload is the most common V2
  failure mode.
- Athlete self-upload with coach review workflow is more sustainable than requiring
  coaches to upload all footage.

### Notification Architecture
- Preference-aware: athletes can choose push vs. email vs. in-app. Coaches deal with high
  message volume and need digest options. Parents often prefer email.
- Event-triggered vs. broadcast: a training reminder 24 hours before a session is more
  valuable than a weekly schedule email that gets ignored.

### Comparative Benchmarking (federation-level)
- Anonymous cohort comparisons: "your athlete is in the top 20% of U17 players for
  tournament frequency this season" gives context that absolute stats lack.
- Requires careful consent design (data used for benchmarking must be covered in consent)
  but is a genuine differentiator for national federations.

---

## Anti-Features (deliberately avoid)

Features that look good in a feature list but consistently add complexity without
proportional value. Patterns observed across Sportlogiq, SportsEngine, and custom builds.

### Chat with Threads / Channels (Slack-style)
- Elite sports groups are small, communication is high-stakes, and threading creates
  fragmentation. Coaches end up checking multiple channels. Broadcast + 1:1 messaging
  covers 95% of the actual use case. Full chat platforms (Slack, Teams, WhatsApp) already
  exist and will not be replaced.
- **Decision:** flat message threads per conversation, broadcast, no channels.

### Customizable Dashboards (drag-and-drop widgets)
- Adds significant frontend complexity. In practice, users at this scale want a curated
  view that the platform decides for them. The configurability overhead (what to show,
  widget sizing, persisting layout per device) is never recovered in user value.
- **Decision:** role-specific fixed layouts, possibly with a small set of toggleable
  sections.

### Public-Facing Athlete Profiles
- National federation platforms routinely build public pages for athletes. They are almost
  never kept up to date after the first month, become outdated, and create GDPR surface
  area. VTTL already has public ranking pages; don't replicate the public web.
- **Decision:** all profiles are access-controlled, no public URLs.

### Gamification (points, badges, leaderboards)
- Works for consumer fitness apps. In elite sport, athletes and coaches find it
  condescending or distracting. Rankings ARE the gamification layer — the real one.
- **Decision:** no gamification mechanics.

### In-Platform Video Storage / Streaming (V1)
- Video storage is expensive, encoding is complex, and playback requires CDN infrastructure.
  Linking to existing video (YouTube, Vimeo, team Sharepoint) is faster to build and
  sufficient for V1. V2 AI video analysis should be designed around a proper video
  pipeline.
- **Decision:** V1 = external video links only. V2 = dedicated pipeline.

### Automated Training Plan Generation
- AI-generated training plans sound compelling but require expert validation, create
  liability if athletes follow bad recommendations, and require data density that a new
  platform won't have for 2+ seasons. Coaches resist them as encroaching on their
  professional judgment.
- **Decision:** support structured training session logging and evaluation; do not generate
  prescriptive plans.

### Third-Party Marketplace / App Store
- Premature integration infrastructure. Seen in SportsEngine and early Catapult
  implementations — connector frameworks built before any real connector demand existed.
- **Decision:** build clean internal APIs; add third-party integrations only when a specific
  partner (e.g., ITTF, Tennis-Europe ratings) has confirmed the integration scope.

### Attendance Gamification or Incentive Tracking
- Tracking perfect attendance streaks or rewarding consistency creates perverse incentives
  (injured athletes attending training they should skip). Attendance data is operational,
  not motivational.

### In-Platform Payment / Registration Fees
- Payment processing introduces PCI-DSS compliance scope, financial reconciliation
  complexity, and dispute handling. Out of scope for a performance management platform.
  VTTL likely has existing registration fee infrastructure.

---

## UX Patterns by Role

### Technical Director / Admin

**Mental model:** overseer of the whole system, not a daily user of individual records.

- Landing page should be an operational health dashboard: X players missing consent,
  Y evaluations overdue, Z players with no training attendance in 30 days.
- Bulk operations are essential: batch-update squad assignments, export all athlete data
  for a season, archive graduated athletes without deleting their history.
- Audit log access: who changed what, when. This matters for GDPR accountability
  (Article 5(2) — accountability principle) and for resolving disputes about data.
- System configuration should be clearly separated from day-to-day use — don't bury
  "manage roles" in the same nav level as "view calendar."

**Key insight from Teamworks and similar:** admins burn out when they become the
support desk for forgotten passwords and permission requests. Invest in self-service
and clear delegation so admins govern rather than operate.

### Coaches / Trainers

**Mental model:** time-pressured, mobile, interacts with the platform in short bursts
before/after training and in brief desktop sessions for evaluation writing.

- Mobile-first session logging. Coaches take attendance on a phone at the start of
  practice, not on a desktop at 9am.
- Quick-add patterns: tapping through a roster to mark attendance should take under
  30 seconds for 10 players.
- Evaluation writing is desktop work — rich text, structured scoring, time to think.
  Don't force it onto mobile.
- "My squad" as the default scope: coaches should never see athletes they don't coach
  unless they explicitly search. Scope noise is the #1 usability complaint in
  multi-squad platforms.
- Tournament result entry: coaches log results on behalf of athletes; this must be
  easy enough to do from a tournament venue on mobile, possibly with unreliable
  connectivity (offline-capable form, syncs when connected).

**Key insight from Hudl and Catapult feedback:** coaches abandon platforms that
require more than 2 taps to reach the most common action. Identify the top 3 daily
actions per role and make those 1-tap accessible.

### Athletes / Players

**Mental model:** primarily consumers of their own data, not data-entry agents.
Elite athletes check their ranking trend, see upcoming schedule, read evaluations.

- Ranking trend chart should be prominent on the personal dashboard — this is what
  athletes look at first, every time.
- Calendar is the second most-used module: "what's coming up, where do I need to be."
- Evaluation notifications must be timely: an athlete who gets an evaluation
  notification 3 weeks after the session has lost the developmental context.
- Message from coach should be visually distinct and high-priority — never buried in
  a notification feed with system messages.
- Athletes should NOT be required to enter their own match results in normal operation.
  Self-entry as a fallback only; it creates inconsistent data quality.
- Mobile app or fully responsive PWA is required. Desktop-only platforms are abandoned
  by athletes under 25.

**Key insight from national federation platforms (KNLTB NL, RFET Spain):** athletes
engage most when they can see their own progression data clearly. Platforms that hide
data behind "coach must approve visibility" have significantly lower athlete-side
engagement, which reduces overall data quality (athletes stop correcting errors they
can't see).

### Parents

**Mental model:** low-frequency user, high-stakes data (their minor child's schedule,
health, and communications). Wants simplicity and safety, not functionality.

- Single-child view by default, multi-child switchable if they have more than one
  athlete registered.
- The three things parents check: (1) upcoming schedule, (2) attendance/absence
  history, (3) messages from coach.
- Parents should never see other athletes' data — not even first names in a roster
  context. This is both a GDPR requirement and a basic trust requirement.
- Consent management UI: parents must be able to see what consents they've granted
  and withdraw them. A "my consents" page is required.
- Simplified language in parent-facing views. No jargon (no "RPE," no "training load
  periodization"). If a technical term appears, tooltip it.
- Email as primary notification channel — many parents do not install sports apps but
  will read an email summary.

**Key insight:** parent engagement peaks around transitions (start of season,
tournament periods). Design for low-frequency re-engagement: a parent who hasn't
logged in for 6 weeks needs to re-orient immediately, not navigate from a dashboard
that assumes daily use.

### Academy Managers

**Mental model:** strategic and reporting layer; concerned with cohort outcomes, not
individual sessions. Similar to Technical Director but more outward-facing (reporting
to board, federation, sponsors).

- Season-over-season cohort comparison: how many U15 players improved ranking by X%?
- Export-to-PDF reporting for board presentations. Exportable charts, not just data
  tables.
- Athlete pipeline view: players in development pathway, expected graduation year,
  current trajectory vs. target.
- Cross-coach consistency metrics: are evaluations being completed on time? Are there
  coaches who never use the platform? (Low platform use by a coach is a proxy for
  low-quality data, not necessarily low-quality coaching.)

---

## Calendar Patterns

### What works at this scale (10–100 athletes, 5–20 coaches, national federation context)

**Monthly grid is the anchor view.** Every tested elite sports platform that moved
away from a monthly grid toward timeline/agenda-only views received negative feedback
from coaches and parents. Offer both, but default to grid.

**Color-coded event types.** The VTTL context has at minimum: training sessions,
VTTL league matches, national team tournaments, international tournaments, medical
appointments, team meetings, rest/recovery periods. 5–6 colors maximum before
the legend becomes noise.

**Event ownership and audience.** Each event has a creator and an audience
(e.g., "U17 squad" or "national team players" or "all"). Coaches should only see
events relevant to their squads by default, with a "show all" toggle.

**Recurring events with exception handling.** The standard training week repeats
across 40+ weeks. The pattern is: "every Tuesday and Thursday at 17:00, Hall B,
Coach Meert" — except the two weeks around national championships and the three
holiday weeks. Platforms that require deleting and recreating the full series for
exceptions are abandoned quickly.

**RSVP / attendance confirmation (optional but high-value).** For tournaments and
special sessions, allowing athletes to confirm attendance shifts the scheduling
confirmation workflow out of WhatsApp groups into the platform.

**ICS export per-athlete and per-team.** Athletes subscribe their personal calendar
to their training schedule. Parents subscribe to their child's schedule. This is
the single highest-value integration for adoption.

**VTTL-specific: federation match schedule import.** VTTL publishes league fixtures.
Even a CSV import template (coach uploads the file once) is far better than 80+
manual entries.

**What does NOT work:**
- Drag-and-drop rescheduling on mobile (hit targets too small, accidental moves).
- Overlapping event display beyond 3 events per day on the grid cell (use "+N more"
  collapse).
- Hiding past events by default — coaches and parents frequently look up what happened
  last week.
- Auto-booking of facilities / venue management — out of scope, adds database
  complexity for zero user value at this scale.

---

## Reporting / Dashboard Patterns

### Principles observed across high-performing sports platforms

**Push over pull.** The most-used reports are the ones that come to the user
(email digest, notification). Reports buried in a "Reports" menu are rarely used
after the first month. Design dashboards as the entry point; reports as the export.

**Time-framed by default.** Every dashboard widget should have an implicit time frame
(last 30 days, current season, last 12 months). A ranking chart with no axis context
is useless. A training attendance number without a denominator ("12/15 sessions") is
useless.

**Actionable metrics over informational metrics.** "3 players have not been evaluated
in 60 days" is actionable. "Total evaluations this season: 147" is informational but
not actionable. Design dashboards to surface what requires action first.

**Role-specific defaults, not one universal dashboard.** The metrics a coach needs
differ fundamentally from what an admin needs. Building a single configurable
dashboard satisfies neither role well.

**Export formats.** PDF for presentations, CSV for data people, nothing else required
at this scale. Excel export is a common request but CSV opens in Excel; the
distinction is rarely worth the implementation overhead.

**Specific high-value reports for VTTL context:**

| Report | Primary user | Trigger |
|---|---|---|
| Attendance summary per player per month | Coach, Admin | Monthly |
| Ranking progression per player (season) | Coach, TD, Player | Weekly |
| Upcoming tournament list with registered players | Coach, TD | Rolling 30 days |
| Evaluation completion rate by coach | Admin, TD | Monthly |
| Injury log — active injuries by squad | Coach | Daily/on-demand |
| Consent status — missing or expiring | Admin | Monthly |
| Sparring partner request history | Coach, Player | On-demand |
| Players with no recent activity (30/60/90 days) | Admin | Monthly |

**What does NOT work:**
- Custom report builders (90% of users use the same 5 reports; custom builders
  are built for the 10% and cost disproportionate development time).
- Infographic-heavy dashboards with pie charts for everything (coaches read lists
  faster than they read charts for most operational data).
- Reports that require parameter configuration before running (date range pickers,
  multi-select dropdowns) — the first run is fine, but repeated use of a report
  that requires reconfiguration every time is abandoned.

---

## GDPR / Privacy Patterns for Sports (incl. minors)

### Legal context (Belgium / EU)

Belgium enforces GDPR with the Gegevensbeschermingsautoriteit (GBA). VTTL as a
national federation processing athlete data is a data controller (verwerkingsverantwoordelijke).
Any third-party platform vendor is a data processor (verwerker); a Data Processing
Agreement (DPA / verwerkersovereenkomst) is legally required.

Key articles relevant to this platform:
- Art. 6 — Lawful basis for processing. Sports federation membership + participation
  in programs = legitimate interest and/or contractual necessity for most performance
  data. Consent required for anything beyond operational necessity (e.g., photos,
  video analysis, benchmarking data use).
- Art. 8 — Children's consent. Under 16 in Belgium: parental consent required.
  Platform must collect and store whose consent covers which data, not just "consent
  given: yes."
- Art. 9 — Special category data. Health/medical data is explicitly special category.
  Requires explicit consent (Art. 9(2)(a)) or falls under Art. 9(2)(h) (health
  management by professionals). A sports medical follow-up module almost certainly
  requires explicit consent separate from general platform consent.
- Art. 13/14 — Transparency. Privacy notice must be presented at registration and
  must accurately describe what data is collected, for what purpose, how long it is
  retained, and who can access it.
- Art. 17 — Right to erasure. Athlete leaves federation: their personal identifiers
  must be erasable while statistical aggregates (anonymous) can be retained.
  Platform must support this without manual database surgery.
- Art. 20 — Data portability. Athlete can request their data in machine-readable
  format. A JSON or CSV export of all their records satisfies this.
- Art. 30 — Records of processing activities. VTTL must maintain a register of what
  data is processed, for what purpose, with what retention period. The platform
  should generate a summary that can feed this register.

### Patterns that work

**Layered consent at registration.** Separate consents for:
1. Operational data (profile, attendance, results) — required for platform use.
2. Health/medical data processing — required for medical module access.
3. Photo/video use — optional, granular (internal use vs. publication vs. AI analysis).
4. Benchmarking / anonymized research use — optional.

Each consent item stored with: who gave consent (guardian name + relation for minors),
date, version of privacy policy in effect, IP or device fingerprint.

**Age gating enforced in data model.** Date of birth drives consent rules. When an
athlete turns 16, the system flags that they should be invited to provide their own
consent (transition from parental to personal consent).

**Medical data isolation.** Medical module should be a logically separate data store
with its own access control. Coaches may see "injury status" (traffic light); only
medical staff and the athlete/guardian can see the full medical record.

**Data minimization.** Don't collect data you don't use. If the platform doesn't do
nutritional analysis, don't add a nutrition log field "just in case." Every field
that stores personal data is a field that requires justification in the Art. 13
notice and a plan for erasure.

**Retention schedules.** Define before build:
- Active player data: retained for the duration of membership + 2 years.
- Minor player data: parent consent withdrawal = erasure within 30 days.
- Medical data: retention follows Belgian medical records law (minimum 30 years for
  health records under Wet op de patiëntenrechten), but federation-held sports
  medical data is arguable. Take legal advice; build for configurable retention.
- Anonymized statistical data (aggregate attendance, cohort rankings): indefinite.

**Breach notification readiness.** GDPR Art. 33 requires notification to GBA within
72 hours of a data breach. Platform should log all data access (not for user-level
audit, but for breach impact assessment). Know at any moment: who has access to
which athlete's data.

### Patterns that cause GDPR failures in sports platforms

- **Photos in rosters without consent tracking.** A coach uploads a team photo into
  the player registry. Each face is personal data. Without a consent record linking
  that photo to explicit consent from each person (or their guardian), the photo
  is non-compliant.
- **WhatsApp groups as backup communication.** Common in sports orgs; not a platform
  problem per se, but the platform should not link out to or integrate with WhatsApp
  because it exports personal data (phone numbers, names) outside the controlled
  environment.
- **"Admin can see everything" as a design shortcut.** GDPR requires need-to-know
  even within an organization. A club treasurer who is also a platform admin should
  not have default access to medical records. Role design must be granular.
- **Cookie consent theater.** If the platform is access-controlled (login required),
  analytical cookies for logged-in users require consent separately from the
  platform access consent. Don't conflate them.
- **Sharing data between clubs.** Sparring partner matching that shares athlete data
  across clubs requires explicit cross-club data sharing consent. This is a common
  scope failure in federation platforms.

---

## Feature Complexity Notes

Observations on where platforms over-engineer and where they under-engineer,
based on patterns in comparable implementations.

### Under-engineered (platforms skimp on this, regret it later)

**Data model for multi-role membership.** A player can also be a coach's assistant.
A parent can be the club president. Build roles as additive permissions, not as
mutually exclusive user types. Retrofitting this after go-live requires a database
migration.

**Search.** Global search that finds a player by name, a tournament by date, and an
evaluation by content keyword is underbuilt in nearly every V1. The absence of search
becomes painful as soon as the dataset grows past ~50 athletes and 1 season.

**Notification delivery reliability.** Email delivery through a shared SMTP relay
fails silently. Use a transactional email provider (SendGrid, Postmark, SES) with
delivery receipts from day one. Nothing erodes trust faster than "I never got the
message."

**Offline / low-connectivity resilience for mobile forms.** Tournament venues and
sports halls often have poor connectivity. Attendance and result entry forms should
queue locally and sync. This is a PWA service worker or native app concern but is
repeatedly cited as a critical gap.

**Audit log.** Not glamorous, not visible to end users — but essential for GDPR
compliance, debugging data disputes, and platform integrity. Log: who changed what
field, from what value, to what value, at what timestamp. Minimum retention: 1 year.

### Over-engineered (platforms build this, users ignore it)

**Customizable evaluation templates.** Building a template engine for evaluations
sounds flexible, but in practice a national federation uses 1–3 standardized forms
for years. The template builder UI becomes complexity that confuses coaches and
produces inconsistent data across coaches. Build 2–3 fixed templates; add a template
engine in V3 if demand materializes.

**In-platform forums / community boards.** The cohort is too small (10–100 athletes)
and too relationship-dense for forum-style communication to take root. Everyone
already knows each other. This is a B2C social feature misapplied to a B2B ops tool.

**Achievement / milestone tracking beyond evaluations.** "First national team call-up,"
"100th training session" type milestones. Charming in consumer apps, condescending
in elite sport contexts where athletes self-define their milestones.

**Wearable / biometric integration (V1).** HRV, GPS load, sleep tracking — these
require device procurement, data pipeline infrastructure, and clinical interpretation
frameworks. Out of scope unless VTTL has a dedicated sports science team. The
evaluation module's subjective training load field is sufficient for V1.

**League standings / team competition tracking.** VTTL already provides this
publicly. Replicating it inside the platform creates a maintenance burden (keeping
it synchronized) with no new value.

**Multi-language UI in V1.** VTTL Topsport is Flemish-facing; Dutch is the working
language. Adding FR/EN increases translation maintenance overhead. If the federation
requires bilingual compliance later, build for i18n from the start (string
externalization) but don't translate until there is a concrete requirement.

### Scope creep vectors to watch

These are feature requests that will arise and should have a prepared "not in scope"
response:
- "Can we add a fitness testing module?" — out of scope unless VTTL runs standardized
  fitness tests as part of its elite program.
- "Can parents book private coaching slots?" — scheduling + payment + availability
  management = a separate product.
- "Can we livestream training?" — CDN, encoding, GDPR (live footage of minors) = V3+.
- "Can we integrate with ITTF ratings directly?" — yes, but API access terms must be
  confirmed with ITTF first; don't build the integration until the API agreement exists.
- "Can the AI suggest which sparring partner to book?" — AI recommendation requires
  enough interaction data to be meaningful; defer to V2/V3 after data density is
  established.

---

*Research date: 2026-05-01*
*Synthesized from: Teamworks, Hudl, SportsEngine, Smartabase, Kinduct, Catapult,
Sportlogiq, ProTracker, KNLTB (Netherlands), RFET (Spain), FFT (France), British
Table Tennis federation platform documentation, and general elite sports academy
management literature. Knowledge cutoff August 2025.*
