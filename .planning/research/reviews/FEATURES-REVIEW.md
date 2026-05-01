# Features Review — Critical Pass

## Critical Issues (must address)

### 1. Sparring Partner Discovery Positioned Wrong for V1
**Claim:** "Sparring Partner Register (as a discovery tool, not just a directory)" is flagged as a **Differentiator** with "filtering by playing style" and "availability signaling."

**Reality:** 
- PROJECT.md defines sparring partners as "Defined and managed by technical director only"
- This is a closed-loop system for a ~50-200 person federation, not a marketplace
- "Discovery tool" implies self-service filtering and opt-in availability — the opposite of TD-managed
- Filtering by "left-handed penhold attackers" requires structured style/playing-hand data on every sparring partner; the project spec only lists name/photo/phone/email
- This feature should not be a V1 differentiator — it's either a V2 complexity (if VTTL wants self-service partner booking) or a mischaracterization (if it's just "TD can tag partners by style internally")

**Fix needed:** Either clarify that V1 sparring partner management is read-only directory for coaches, or move style-filtering to V2/research phase. As written, it's over-scoped.

---

### 2. "Longitudinal Training-Load-vs-Ranking Overlay" Has Unclear Data Source
**Claim:** "Ranking trajectory overlaid with training load and tournament calendar — coaches can see whether a peak in ranking correlates with a period of high training density."

**Reality:**
- Training load in the project is defined as a subjective quality score (1–5) per participation, plus free text
- Aggregating quality scores into a "training density" metric requires defining the aggregation logic (average per week? total sessions per week? weighted by session type?)
- No sports science backend exists; VTTL doesn't run HRV/GPS monitoring
- At a ~50-200 user scale over 1–2 seasons, the statistical noise in subjective 1–5 scores will swamp any correlation signal
- This is positioned as a differentiator but will likely produce misleading patterns (e.g., "high ranking after light week" noise)
- The feature conflates "we stored the data" with "we can meaningfully analyze it"

**Fix needed:** This is a V2/V3 feature. For V1, store training load subjectively but don't claim correlation analysis until VTTL has 2+ years of comparable data or objective tracking infrastructure.

---

### 3. Missing Role: Sparring Partner as System Actor
**Claim:** The research acknowledges 6 roles: "TD + trainers + players + parents + sparring partners + academy managers."

**Reality:**
- PROJECT.md requires "Sparring partners see only sessions they participate in" — a legitimate use case
- FEATURES.md provides zero UX patterns for sparring partner role
- No mention of: Can sparring partners log their own training data? Accept/decline session invites? See opponent performance? View schedule?
- The role is mentioned in messaging (groups: "all sparring partners") but is otherwise invisible

**Fix needed:** Add a "Sparring Partners" section under "UX Patterns by Role" with at least: dashboard scope (sessions attended), messaging, calendar visibility, data they can/cannot see.

---

### 4. Email-as-Primary-Channel for Parents Is Undersupported
**Claim:** "Email as primary notification channel — many parents do not install sports apps but will read an email summary."

**Reality:**
- PROJECT.md requires "Internal Messaging — Inbox, sent, read/unread, reply, forward" (in-app messaging system)
- FEATURES.md pushes email for parents but doesn't specify:
  - How often do email digests go out? (Daily? Weekly? Event-triggered?)
  - Does coach need to explicitly send a digest, or is it automatic?
  - What content should be in the parent email digest? (Upcoming schedule only, or attendance too?)
  - How are read receipts handled if parent primarily reads via email?
- The "Notification Architecture" section mentions "athletes can choose push vs. email vs. in-app" but doesn't address enforcement per role
- At 50–200 users, sending triggered email per action is manageable; designing and maintaining a quality email digest template is not trivial and is not detailed

**Fix needed:** Clarify notification strategy: is in-app messaging primary with email as fallback, or email primary for parents? If email digest, define cadence and content before V1 ships. If not, don't claim "email as primary" for parents.

---

### 5. "Read Receipts" Claimed as Table Stakes but Not Feasible for Parent Email Channel
**Claim:** "Read receipts or 'seen' indicators — coaches need to know whether a scheduling message was actually read, especially for minors who may not have personal email."

**Reality:**
- Read receipts only work for in-platform messaging, not email
- If parents primarily consume via email (as the research advocates), read receipts are unavailable
- Coaches cannot rely on "message read" for safety-critical communications (e.g., injury updates, schedule changes) — they need affirmative acknowledgment (RSVP, checkbox)
- The claim contradicts the email-first parent strategy

**Fix needed:** Either eliminate email as primary for parents (they must use in-app messaging) OR replace read receipts with affirmative confirmation (RSVP, "I acknowledge this message"). Read receipts are not feasible if email is the primary channel.

---

## Significant Concerns

### 6. "Monthly Grid as Anchor View" Conflicts with Outlook-Style Week View Requirement
**Claim (in FEATURES.md):** "Monthly grid is the anchor view. Every tested elite sports platform that moved away from a monthly grid toward timeline/agenda-only views received negative feedback."

**Reality:**
- PROJECT.md explicitly requires: "Week view (default, Outlook-style with days horizontal, hours vertical), month view, year view"
- **Week view is the default, not month view**
- The research cites best practices from other platforms but contradicts the validated domain requirement
- These are not exclusive — week + month views can coexist — but the framing that "monthly grid is the anchor" is wrong for this project

**Fix needed:** Acknowledge that VTTL's Outlook-style week view (per PROJECT.md) is the primary default, with month/year views available as secondary views. The research's general principle (multi-view support) is sound, but the claim about what should be "anchor" is overruled by the project spec.

---

### 7. Evaluation Visibility Claim Needs Belgian Context Check
**Claim:** "Athlete can view their own evaluation. This is table stakes for athlete engagement; keeping evaluations purely internal destroys the feedback loop."

**Reality:**
- PROJECT.md lists "Evaluaties" as a player-visible tab but does not specify whether evaluations are visible to:
  - The player (athlete themselves)
  - The player's parent (if minor)
  - Other stakeholders
- Belgian sports culture (especially table tennis, a highly competitive individual sport) may have different norms about feedback timing and format
- The research assumes a single evaluation visibility model but doesn't explore: Should parents see evaluations for minors? Should players see evaluations before coach review/approval?
- At elite level, coaches may withhold evaluations pending discussion with athlete (not automatic visibility)

**Fix needed:** Research Belgian table tennis culture on evaluation transparency. Clarify in project spec: Are evaluations immediately visible, or does the coach have a review period? Do parents see minor athlete evaluations?

---

### 8. "Bulk Operations" Flagged as Essential Admin Feature but Not Scoped
**Claim:** "Bulk operations are essential: batch-update squad assignments, export all athlete data for a season, archive graduated athletes without deleting their history."

**Reality:**
- PROJECT.md TD requirements do not mention bulk operations
- At 50–200 users, the frequency of bulk changes is low (squad reassignment at season start, graduation at year end)
- No specification of: What data can be bulk-updated? Which operations require approval? Are there undo/rollback capabilities?
- This is scope creep waiting to happen — "bulk update" sounds simple until you need form validation, conflict resolution, and audit logging across hundreds of records

**Fix needed:** Defer bulk operations to V2. For V1, support single-record role/squad changes via web UI. Acknowledge the gap but don't claim it as table stakes yet.

---

### 9. Audit Log Described as Essential but Not in PROJECT.md
**Claim:** "Audit log access: who changed what, when. This matters for GDPR accountability (Article 5(2) — accountability principle) and for resolving disputes about data."

**Reality:**
- PROJECT.md does not include an audit log requirement
- GDPR Article 5(2) requires *organizations* to maintain records of processing, not necessarily user-facing audit logs
- A full audit log (every field change, timestamp, user) is a complex feature in a newly built platform
- For V1, platform developers should log at application level (for security incident response), but users don't need to query it

**Fix needed:** Clarify: Is this a V1 requirement for VTTL compliance, or a V2 nice-to-have? If required, scope it precisely (what events to log, retention, access control). As written, it's vague and over-scoped.

---

### 10. "Comparative Benchmarking (federation-level)" Requires Consent Design Not Yet Addressed
**Claim:** "Anonymous cohort comparisons: 'your athlete is in the top 20% of U17 players for tournament frequency this season' gives context that absolute stats lack. Requires careful consent design but is a genuine differentiator."

**Reality:**
- PROJECT.md does not mention cohort benchmarking or comparative data use
- GDPR Article 6(1)(a) (consent) or Article 6(1)(f) (legitimate interest) must cover this
- "Anonymous" is not magic — re-identification is possible with small cohorts (e.g., "top 20% of U17 players" in a single province may identify 1–2 athletes)
- This feature requires legal review and explicit consent checkboxes at registration
- At VTTL scale, publishing "your athlete ranks in top 20%" is common knowledge; the value is unclear

**Fix needed:** Do not implement federation-level benchmarking in V1 without explicit consent design and legal review. This is a V2 feature contingent on VTTL's willingness to share anonymized cohort data for analysis.

---

## Missing Considerations

### 11. Video Analysis Tag Schema Needs Domain Input
**Claim:** "Tag schema for tactical patterns (e.g., 'serve-receive errors,' 'backhand counter') needs to be defined in V1 evaluation rubrics so that V2 video tagging maps onto existing data structures."

**Reality:**
- PROJECT.md mentions "AI-videoanalyses" as a player tab but does not define evaluation point rubrics or tactical categories
- The research suggests "define the schema now in evaluations," but evaluations in V1 are coach free-text + configurable scored points
- Table tennis is different from team sports — errors are point-loss patterns, not tactical breakdowns like "defensive positioning"
- Without input from VTTL coaches/trainers, proposed tags like "serve-receive errors" or "backhand counter" may not match how coaches think

**Fix needed:** Before V1 ships, conduct a working session with VTTL trainers to define: (1) What are the top 5–10 decision points coaches evaluate in a match? (2) What video moments matter for feedback? (3) How do these map to training session design? Then embed these categories into V1 evaluation points.

---

### 12. Session Template Complexity Under-Specified
**Claim:** "Session templates: coaches define a standard weekly training block and stamp it across the season in one action."

**Reality:**
- PROJECT.md specifies "Recurring session support" but not "session templates"
- A true template system allows defining:
  - Default duration, trainer, location, training type (Group/Individual/Physical/Mental)
  - Recurring pattern (every Tuesday and Thursday)
  - Exception handling (skip week 15–16, move to alternative date)
  - Template versioning (if a coach updates the template, does it affect past sessions or future only?)
- This is non-trivial UI/data design, especially for exception handling
- At VTTL scale (5–20 coaches), manual entry of 40 Tuesday sessions is painful but manageable; template logic may introduce more bugs than it solves if over-engineered

**Fix needed:** Clarify scope: Is this recurring sessions (simple repeat pattern) or true templates (reusable configuration)? For V1, simple recurrence is sufficient. Templates defer to V2.

---

### 13. Notification Preference System Scope Not Defined
**Claim:** "Preference-aware: athletes can choose push vs. email vs. in-app. Coaches deal with high message volume and need digest options. Parents often prefer email."

**Reality:**
- PROJECT.md does not mention notification preferences or digests
- "Athletes can choose push" implies mobile app push notifications — in-scope? Or PWA? Not specified in project
- "Coaches need digest options" — what is a digest? Daily summary at 6pm? Weekly? Configurable?
- At ~5–20 coaches, high message volume is unlikely in V1; this may be V3 scope after scale

**Fix needed:** For V1, define: (1) In-app notifications are default. (2) Email is available but not configurable (sent per event). (3) Push notifications are out of V1 scope. Defer digest/preference architecture to V2.

---

### 14. Medical Data Access Control Not Detailed
**Claim:** "Medical data must be separated from general profile data. Coaches may need injury status without needing the full medical note. Parents of minors need access to their child's records."

**Reality:**
- PROJECT.md requires medical events (type, is_injury, doctor, start/end date) and allows parent access ("Medical follow-up — Scan/document upload: scoped as open question for v1")
- But the spec does not detail:
  - Can coaches see injury status (red/yellow/green traffic light) without seeing the full medical note?
  - Can parents see the full medical record, or only injury status?
  - Who can add medical events? (Trainer, TD, medical staff, player, parent?)
  - Is a doctor's note required, or can a coach flag "ankle strain, rest 2 weeks"?
- The FEATURES.md section on medical is vague; implementers will need to guess

**Fix needed:** Before V1 sprint planning, create a medical data access matrix:
| Role | Can Create | Can View (Full) | Can View (Status Only) |
|------|-----------|-----------------|----------------------|
| Coach | No | No | Yes |
| Trainer | Yes | Yes | Yes |
| Parent (minor) | No | Yes | Yes |
| Player | No | Yes | Yes |
| TD | Yes | Yes | Yes |

---

### 15. Consent Tracking Model Needs Clarification
**Claim:** "Layered consent at registration. Separate consents for: 1. Operational data, 2. Health/medical data, 3. Photo/video use, 4. Benchmarking."

**Reality:**
- PROJECT.md requires "Explicit consent record at registration (what was consented to, when, by whom — guardian for minors)"
- FEATURES.md specifies 4 consent categories but does not address:
  - What happens if a minor reaches 16 and should transition to personal consent?
  - Can parents withdraw consent later (e.g., withdraw video consent but keep operational)?
  - If a parent withdraws consent, what happens to existing photos/evaluations already recorded?
  - Is consent version-tracked? (Privacy policy changes, old consent becomes invalid)
- The research mentions "age gating enforced in data model" but PROJECT.md does not require this

**Fix needed:** Create a consent lifecycle diagram before V1 build:
1. Under 16: parental consent required for all categories
2. At 16: system prompts athlete to provide own consent; parental consent transitions
3. Over 16: athlete consent required; parents can withdraw only if they were the original consenters
4. Withdrawal: define what happens to existing data per category (e.g., photos anonymized, evaluations retained but photo removed)

---

### 16. "Session Quality Score" Evaluation Method Not Specified
**Claim (in PROJECT.md):** "Participation entity per player per session: quality score + free text (trainer only)"

**Reality:**
- FEATURES.md mentions "Training load notation (volume, intensity, session type) — even a simple 1–5 subjective scale is sufficient"
- But does not specify:
  - Is quality score 1–5 (poor–excellent)? Or different scale?
  - Is it always mandatory, or optional?
  - Does the trainer score all players in a session, or just notable ones?
  - Is this player-level feedback ("Alice had poor form") or session-level ("The session was poorly planned")?
- At elite level, quality scoring can be interpreted as performance criticism — tone matters for younger athletes

**Fix needed:** Define in project spec: Quality score is (1–5 scale: 1=did not attend, 2=below expectations, 3=met expectations, 4=good, 5=exceptional). Optional field. Free text required if score ≤2 or ≥5. Trainer sees guidance: "This feedback is visible to the athlete; be constructive."

---

### 17. Tournament Result Entry Permissions Are Conflicted
**Claim (in PROJECT.md):** "Results entered by player only (own results only)"

**Reality:**
- FEATURES.md states: "Results entry (score, opponent, round, event, date) without requiring a third-party import. Manual entry must always be possible as a fallback."
- Who enters is not specified in FEATURES.md (it says "without requiring third-party import" but not "who can do this")
- Coaches at tournaments often log results on behalf of players (especially younger athletes)
- If only players can enter, then coaches must rely on players to manually entry results after the tournament ends
- This is a UX friction point: coach is at the tournament, has the scores, but cannot enter them

**Fix needed:** Clarify permissions: Players can enter their own results. Coaches can also enter results on behalf of players at their academy. TD can import/enter results for any player. This requires API permission design but is essential for practical workflow.

---

## Disputed Claims (need verification)

### 18. "iCal Export" as Table Stakes
**Claim:** "iCal/ICS export. Athletes and parents will add events to personal calendars; without ICS export they copy-paste manually and then miss updates."

**Reality:**
- True for team sports where entire squads share a calendar
- For elite table tennis with individualized schedules (some athletes in 3 tournaments, others in 1), ICS export per-athlete is valuable
- But at VTTL scale (~50–200 users), the adoption curve for ICS subscriptions may be slow — many athletes/parents will check the app instead
- ICS export is a V1 feature, yes, but is it truly table stakes or a V1.5 nice-to-have?

**Verdict:** ICS export is worth building but not blocking V1. If the platform ships without ICS export, it's incomplete but functional. Push for V1 or V1.1, not critical path.

---

### 19. "Evaluation Notifications Must Be Timely" — What Is Timely?
**Claim:** "Evaluation notifications must be timely: an athlete who gets an evaluation notification 3 weeks after the session has lost the developmental context."

**Reality:**
- This is true but not operationally scoped
- If a coach writes an evaluation same day as the session, notification goes immediately ✓
- But in practice, coaches batch-write evaluations weekly or monthly
- No specification of: Should the system auto-notify when a coach completes an evaluation? Or does the athlete only see it in the app?
- "Timely" for a coach's written evaluation is within 7 days; for immediate feedback it's same-day

**Fix needed:** Specify notification trigger: Coach completes an evaluation → system sends in-app notification + email to athlete (and parent, if minor) within 1 hour. This is technically simple and ensures "timely" within reason.

---

### 20. Video Analysis Integration Scope Creep Risk
**Claim:** "Design for [video analysis] now" in V1 evaluations so V2 can add video tagging without data model retrofit.

**Reality:**
- This is forward-thinking but assumes video analysis is confirmed for V2
- VTTL has not confirmed: (1) Do we want AI video analysis? (2) What provider (Hudl, Wyscout, custom)? (3) How much will it cost? (4) Legal issues with filming minors?
- Designing for "future use" without confirmed demand is a form of scope creep
- Better approach: Build evaluation tags now for coach observations; video linking happens separately in V2 without retrofitting

**Fix needed:** Do not design V1 evaluations around "V2 video integration." Build evaluations to meet V1 coaching needs. If/when V2 video analysis is approved, video links can be bolted on without data model changes.

---

## What the Original Got Right

### Strengths

1. **Role-Specific UX Framing:** The detailed breakdown by role (TD, Coach, Athlete, Parent, Academy Manager, Sparring Partner) is excellent. Each role's mental model and primary use cases are well-researched.

2. **Anti-Features Discipline:** The decision to avoid Slack-style chat, customizable dashboards, public profiles, gamification, and in-app video storage is sound for this scale and domain. Especially strong: "Ranked ARE the gamification layer — the real one."

3. **GDPR/Privacy Rigor:** The section on legal context (Belgium, GBA, Articles 6–20) is thorough and specific. The distinction between operational data (Art. 6 legitimate interest) and medical data (Art. 9 special category) is correct.

4. **Table Stakes vs. Differentiators Split:** Generally well-reasoned. The table stakes section correctly identifies identity, player profiles, training/attendance, calendar, messaging, evaluations, and rankings as non-negotiable.

5. **Calendar Flexibility (Multi-View):** The advocacy for month + week + year views with color coding and event filters is sound. The specific criticism of "drag-and-drop on mobile" and "overlapping event display beyond 3" is practical.

6. **Under-Engineered Warnings:** The section on audit logs, notification delivery reliability, offline resilience, and role-based permissions is excellent forward-looking risk management. These are the things V1 should underinvest in without regret.

7. **Comparative Benchmarking Caution:** The disclaimer that "anonymous" is not magic and requires legal review is wise. Avoids the trap of treating aggregated stats as inherently safe.

8. **Domain Specificity on Table Tennis:** Sparring partner matching by playing style is genuinely table-tennis-specific (not a team sports pattern). The emphasis on ranking as the primary status signal is accurate for elite individual sports.

9. **Mobile-First Coaching Pattern:** "Quick-add patterns: tapping through a roster to mark attendance should take under 30 seconds for 10 players" is accurate. Coaches will abandon platforms that require 3 taps for a daily action.

10. **Clarity on What Platforms Commonly Mess Up:** The observations on customizable evaluation templates, in-platform forums, wearable integration, and league standings replication show deep experience with real platform failures.

---

## Summary: Before V1 Sprint Planning

**Critical must-resolve issues:**
1. Sparring partner role: clarify scope (TD-managed vs. self-service discovery) and add UX patterns
2. Training-load-ranking overlay: defer to V2 or reframe as "data storage, not analysis"
3. Email-as-primary for parents: resolve messaging strategy (in-app vs. email primary)
4. Read receipts: remove claim if parents use email; add RSVP confirmation instead
5. Tournament result entry: clarify who can enter (player-only vs. coach-also)

**Before design phase:**
1. Conduct working session with VTTL trainers on evaluation points and video tag taxonomy
2. Create consent lifecycle diagram (under/over 16, withdrawal scenarios)
3. Create medical data access matrix (coach visibility, parent visibility, creation permissions)
4. Clarify notification trigger architecture (in-app notification, email digest, push preference)
5. Audit log: confirm if required by VTTL/GBA or defer to V2

**Recommendations for V1 cutoff:**
- Drop: Bulk operations, comparative benchmarking, customizable notification preferences, session templates (use simple recurrence)
- Defer: Video analysis integration design (add it in V2 scope review, not V1 data model)
- Clarify: "Longitudinal training-load" claim (it's data storage, not meaningful correlation analysis at V1 scale)

The research is solid on platform patterns and GDPR, but mixes V1 must-haves with V2 differentiators and over-specifies some features. The next phase should separate clear V1 scope from future ambitions and ground all claims in VTTL's specific domain constraints.
