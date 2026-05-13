# Phase 3: Kalender - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**UI design contract:** locked — `03-UI-SPEC.md` approved 2026-05-13 (6/6 dimensions pass, 12 UI3-D* defaults stamped)

<domain>
## Phase Boundary

Fase 3 levert de centrale kalender-werkvlakte van het platform. Aan het einde van deze fase: (1) een polymorf evenementen-schema (`calendar_events` basistabel + 6 getypeerde extensietabellen met **volledige domeinkolommen per type**) is operationeel; (2) recurrente evenementen met server-side RRULE-expansie en single-occurrence overrides werken; (3) een rolgescopede `calendar.list` query met participant-junction levert het juiste set evenementen per gebruiker; (4) FullCalendar 6.x toont week (default) / dag / maand / jaar met de zes evenementtype-kleurtokens; (5) een filterbar (event-type chips + 4 type-ahead combos voor speler/trainer/sparring-partner/academie) verfijnt de view; (6) een conflict-detectiedienst waarschuwt bij participant-overlap zonder ooit te blokkeren — met role-gated detail-redactie zodat medische privacy bewaard blijft; (7) mobile single-day view met swipe-navigatie. De Phase 4/5 _operationele_ uitbreidingen (training quality scores, tournament results, ranking entries, sparring-partner register) blijven uit scope — alleen de evenementen-schemas zelf landen hier.

**Critically:** Phase 3 schrijft de volledige type-specifieke evenement-kolommen (TRAIN-01 / TOURN-01 / MED-01 / etc.) naar de extensietabellen. Phase 4 voegt daarboven de _operationele_ laag (`session_participants` voor kwaliteitsscores, `tournament_results` voor eindrangschikkingen, `match_results` voor wedstrijdresultaten, `ranking_entries`, `session_sparring_partners` met sparring-entiteit) — geen wijzigingen aan de Phase-3 evenement-schemas.

</domain>

<decisions>
## Implementation Decisions

### A. Schema scope + polymorphism + participants

- **D-47 (event types in Phase 3):** Alle 6 evenementtypen krijgen volledige CRUD in Phase 3 met al hun domein-specifieke velden per `REQUIREMENTS.md`. Dat betekent: `training_sessions` met TRAIN-01 velden (datum, starttijd, duur, training_type_code, organisation_code, trainer_id, locatie); `tournaments` met TOURN-01 (naam, startdatum, stad, land, leeftijdscategorie_code, tournament_type_code); `meetings` (basis + invitees); `stages` (naam, locatie, land, start-/einddatum, players, trainers); `eval_conversations` (evaluator, player); `medical_appointments` (type vrij tekst, is_injury, doctor vrij tekst, start-/einddatum). Reden: gebruiker moet bij het aanmaken van een evenement ALLE type-specifieke informatie kunnen invullen. Dit is een **bewuste scope-uitbreiding ten opzichte van de ROADMAP-framing** (waarin schema voor training_sessions/tournaments in Phase 4 stond) — Phase 4 reduceert daardoor tot puur de operationele/result-laag boven deze schemas.

- **D-48 (create-permissies per evenementtype):**
  - **TD:** alle 6 typen
  - **Trainer:** `training_sessions` + `meetings`
  - **Player:** `meetings` (alleen aanmaken; eigen evenementen via Phase 4 trainings)
  - **Academy_manager:** `meetings` (Phase 3 baseline — uitbreiding naar academie-events optioneel; planner kiest conservatief)
  - **Sparring_partner / parent:** geen create-rechten in Phase 3
  - **Meetings = "iedereen kan aanmaken"** is een Phase 3 expliciete regel; servergate hangt aan tRPC `calendar.event.create({type: 'meeting'})`.
  - tRPC procedure-preset matrix per type wordt in `src/server/trpc/middleware/calendarCreate.ts` gedefinieerd; planner mag de exacte preset-naam kiezen (`anyAuthenticatedProcedure` voor meetings; `trainerOrTdProcedure` voor trainings; `tdProcedure` voor tournament/stage/eval/medical).

- **D-49 (polymorphism = class-table inheritance):** `calendar_events` basistabel met gemeenschappelijke kolommen (`id uuid PK`, `type_code text FK event_type`, `title text NOT NULL`, `starts_at timestamptz NOT NULL`, `ends_at timestamptz NOT NULL`, `all_day boolean DEFAULT false`, `location text NULL`, `description text NULL`, `rrule text NULL`, `created_by uuid FK users NOT NULL`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at` weggelaten — zie D-58); plus 6 getypeerde extensietabellen die elk een 1:1 FK naar `calendar_events.id` (`event_id uuid PK REFERENCES calendar_events(id) ON DELETE CASCADE`) hebben met hun domeinkolommen. `calendar.list` JOINt naar de juiste extensietabel op basis van `type_code`. ROADMAP's "geen single-table inheritance" voorschrift wordt zo gerespecteerd; "polymorphism met typed extension tables" eveneens.

- **D-50 (participant-junction):** Eén polymorfische junction `calendar_event_participants (event_id uuid FK calendar_events ON DELETE CASCADE, user_id uuid FK users, role_in_event text CHECK ('organizer'|'participant'|'invitee'), rsvp_status text CHECK ('pending'|'accepted'|'declined') DEFAULT 'pending', created_at timestamptz)` met `PRIMARY KEY (event_id, user_id)`. Indexen: `(user_id, event_id)` voor scope-queries (`calendar.list` filterkant); impliciet `(event_id)` via PK voor detail-sheet-laden. RLS `calendar_events_visible_to(uid, role)` SECURITY DEFINER unionneert: TD = alles; player/trainer = `EXISTS (SELECT 1 FROM calendar_event_participants WHERE event_id = ce.id AND user_id = uid)` OR `created_by = uid`; academy_manager = via `academy_memberships` → `players` → events waar players participants zijn; parent = via `parent_child_links` → child → events. **Sparring-partner-visibility (CAL-04) is in Phase 3 een no-op rule** (geen sparring-partner entity bestaat — Phase 4 voegt de SPAR tabel + `session_sparring_partners` toe en breidt de RLS UNION uit).

- **D-51 (Phase 4-handover):** Phase 4 voegt **alleen** operationele tabellen toe: `session_participants(event_id, user_id, quality_score int 1-10, feedback_text text)` parallel aan de junction (geen vervanging); `session_sparring_partners(event_id, sparring_partner_id)`; `tournament_results(event_id, player_user_id, outcome_level_code, ...)`; `match_results`; `ranking_entries`. **Geen wijzigingen aan Phase 3 evenement-schemas.** Documenteer dit hard in de Phase 3 PLAN.md zodat Phase 4 niet per ongeluk extension tables herschrijft.

### B. RRULE expansion strategy

- **D-52 (library):** **`rrule` npm package** (pure TypeScript, MIT, RFC 5545 compliant) als single source voor parse + expand. Geen `rrule-rust` (overkill voor v1 schaal), geen client-only `@fullcalendar/rrule` (server moet sowieso expanderen voor conflict-detectie + scope-filtering). Wrapper helper in `src/lib/rrule.ts` die `parseRrule(string)` en `expandRrule(rrule, from, to, exceptions[])` exposes.

- **D-53 (server-side expansion):** `calendar.list({from, to})` haalt base rows op binnen het range, voor elke row met `rrule != null` expandeert het server-side via `rrule.between(from, to)` en emit een vlakke event-instances stream (één row per occurrence). Exceptions worden toegepast: skip cancelled; apply override fields. FullCalendar ontvangt nooit raw RRULE — alleen concrete instances. Mobiele clients en alternative front-ends krijgen gratis dezelfde correcte data.

- **D-54 (exceptions table — full single-occurrence override in Phase 3):** Schip `calendar_event_exceptions (id uuid PK, event_id uuid FK calendar_events ON DELETE CASCADE, occurrence_date date NOT NULL, cancelled boolean NOT NULL DEFAULT false, override_starts_at timestamptz NULL, override_ends_at timestamptz NULL, override_title text NULL, override_location text NULL, override_description text NULL, created_by uuid FK users NOT NULL, created_at timestamptz)` met `UNIQUE (event_id, occurrence_date)`. UI3-D12's "Deze afspraak"-keuze schrijft een exception-rij bij edit van een enkele occurrence. Cancel = `cancelled=true`. Move = override_starts_at + override_ends_at. Title/location/description override per-occurrence. Phase 4 voegt "Deze en toekomstige" (split-and-rewrite series) + "Alle afspraken in de reeks" (edit series root) bovenop dezelfde tabel.

- **D-55 (2-jaar horizon — defense in depth):** **Write-time:** `calendar.event.create/update` valideert de rrule — als `UNTIL` ontbreekt of buiten `created_at + 2y` valt → reject met `errors.calendar.rruleHorizonExceeded`. Helper auto-injecteert `UNTIL = created_at + 2y` wanneer de gebruiker "Eindigt: Nooit" kiest in UI3-D12's RruleEditor (transparant getoond: "In v1 herhaalt deze afspraak tot {date}"). **Read-time:** `calendar.list({from, to})` rejecteert ranges > 2y met 400; expansie wordt geclamped op `expandedRange = min(to, event.starts_at + 2y)`. Beide gates aanwezig — een crafted RRULE kan de read-time gate niet omzeilen; een policy-change kan oude rows niet onverwacht laten exploderen.

### C. Conflict detection

- **D-56 (overlap-definitie — per-participant):** Conflict = elke gebruiker in `calendar_event_participants` (alle rollen `organizer/participant/invitee`) van event A komt OOK voor in event B EN de tijdsbereiken overlappen. Geen locatie-conflict (free-text "locatie" is te fragiel; v2 zaalboeking-feature is een aparte capability). Geen "creator-only" conflict (mist double-bookings tussen verschillende organisatoren — onacceptabel voor een topsport-coordinatie-tool). Recurrent: server expandeert event B's RRULE ±15 dagen rond event A's range om RRULE-conflicten te vangen.

- **D-57 (soft warning + cross-scope detection + role-gated redactie):**
  - **Nooit blokkeren** — UI-SPEC's "Toch opslaan / Tijden aanpassen" pattern is correct. Server returnt `{ conflicts: [...], blocked: false }`. Gebruiker kan altijd doorgaan via expliciete "Toch opslaan" → bevat `force: true` in de mutate → server logt override naar `audit_log` (action `calendar_event_conflict_override`, refs to beide event ids).
  - **Conflict-overlap query draait cross-scope:** SECURITY DEFINER functie `overlapping_events_for_users(uids[] uuid, from timestamptz, to timestamptz)` omzeilt RLS om ALLE overlaps voor de kandidaat-participanten te detecteren. Reden: een academy_manager die een training plant moet weten dat speler X dubbel geboekt is — ook als de tegen-event een medische afspraak is die de academy_manager normaal niet ziet.
  - **Detail-redactie role-gated, uniform over alle 6 types:** De waarschuwingstekst wordt op de server samengesteld; de service-laag inspecteert per conflict-row of de caller volledige zichtbaarheid heeft. Volledige zichtbaarheid = `is_td(caller)` OR `caller IN participants(conflicting_event)` OR `caller = created_by(conflicting_event)`. Bij volledige zichtbaarheid: full title + type-label + location + tijd. Anders: alleen lookup-type-label + participant-naam + tijdsbereik. Voorbeeld redacted: "Speler A is al geboekt voor een **Medische afspraak** 11:00–12:00." Voorbeeld full: "Speler A is al geboekt voor **Knie-controle Dr. Janssens** (Medische afspraak, Topsportschool) 11:00–12:00."

- **D-57b (copy-refinement — overrides UI-SPEC):** UI-SPEC's `calendar.conflict.body` ("Conflicteert met **{title}** op {start} – {end}.") wordt aangescherpt naar een participant-genoemde vorm. Geef de planner deze drie locales als kanonieke tekst (override UI-SPEC):
  - **nl:** `**{participant}** is al geboekt voor {detail} {start}–{end}. Toch opslaan?`
  - **en:** `**{participant}** is already booked for {detail} {start}–{end}. Save anyway?`
  - **fr:** `**{participant}** est déjà réservé pour {detail} {start}–{end}. Enregistrer quand même ?`
  - `{detail}` = full = `**{title}** ({typeLabel})`; redacted = `een/een **{typeLabel}**` (locale-specifieke article).
  - Update de Copywriting Contract tabel in UI-SPEC's volgende revisie (out-of-band; geen blocker voor planning).

### D. Delete + cancel behavior

- **D-58 (drie verschillende operaties — semantisch gescheiden):**

  **Operatie 1 — Globale delete (hard, met confirmation popup):**
  - **Rechten:** `created_by` van het event OR TD. Trainer mag eigen `training_sessions` hard-deleten; player mag eigen `meetings` hard-deleten; TD mag alles. Andere participanten krijgen niet de "Verwijderen"-knop — zij zien wél "Ik kan niet aanwezig zijn" (operatie 2).
  - **Schema:** `calendar_events` heeft **geen** `deleted_at` kolom. Delete = `DELETE FROM calendar_events WHERE id = ?` met FK CASCADE → drop extensie-row + alle `calendar_event_participants` + alle `calendar_event_exceptions`.
  - **Audit:** vóór de DELETE schrijft een service-laag pre-snapshot een complete JSONB row-family (base + extension + participants + exceptions) naar `audit_log.meta` (Phase 1 audit-pattern), met `action='calendar_event_deleted'`, `actor_id`, `resource_id=event.id`, `resource_type='calendar_event'`. Forensische herstelling is mogelijk vanuit het audit-log; geen tweede schemalaag nodig.
  - **Confirmation popup:** UI gebruikt shadcn `<AlertDialog>` (al beschikbaar in Phase 1/2). Geen "binnen 30 dagen omkeerbaar"-promise.

  **Operatie 2 — Ik kan niet aanwezig zijn (RSVP decline):**
  - **Rechten:** elke participant kan zichzelf declinen. tRPC mutation `calendar.event.declineParticipation({eventId})` zet `rsvp_status='declined'` op `calendar_event_participants` voor de calling user. Het event blijft globaal bestaan voor alle anderen.
  - **UI:** aparte knop "Ik kan niet aanwezig zijn" in `EventDetailSheet`, visueel onderscheiden van "Verwijderen" (alleen zichtbaar voor creator/TD).
  - **Effect op de eigen kalender:** declined events blijven zichtbaar maar krijgen strikethrough title + 50% opacity (hergebruik van het "cancelled" overlay-pattern uit UI-SPEC's Event Chip Contract); per-user hide-decline toggle deferred naar v2.

  **Operatie 3 — Cancel single occurrence (recurring):**
  - Reeds afgedekt door D-54 — schrijf `calendar_event_exceptions(event_id, occurrence_date, cancelled=true)`. Andere participants zien die specifieke occurrence niet meer (de expansie skip't 'm).

- **D-58b (UI-SPEC copy override voor delete):** UI-SPEC's `calendar.event.delete.body` ("De afspraak wordt verwijderd uit de kalender van alle deelnemers. Dit is omkeerbaar binnen 30 dagen via de TD.") is **incorrect** voor Phase 3 en moet worden aangepast. Kanonieke vervanging (override UI-SPEC):
  - **nl:** `Deze afspraak wordt definitief verwijderd voor alle deelnemers.`
  - **en:** `This event will be permanently deleted for all participants.`
  - **fr:** `Ce rendez-vous sera supprimé définitivement pour tous les participants.`
  - Update UI-SPEC Copywriting Contract regel `calendar.event.delete.body` in volgende UI-SPEC revisie. Planner ships de nieuwe tekst direct in `messages/{nl,en,fr}.json` zonder te wachten op de UI-SPEC update.

- **D-58c (cascade-orde + audit-volgorde):** Service-laag wrapper:
  1. Open RLS-bound transaction.
  2. SELECT base + extension + participants + exceptions FOR UPDATE (lock).
  3. INSERT in `audit_log` met JSONB snapshot van de hele row-family.
  4. DELETE FROM calendar_events WHERE id = ? → FK CASCADE doet de rest.
  5. Commit. Alles atomisch — geen risico op snapshot-zonder-delete of delete-zonder-snapshot.

- **D-59 (soft-deleted events in conflict-detectie?):** N/A — hard delete betekent de row is weg. Conflict-detectie ziet het niet meer (en zou er ook niet voor moeten waarschuwen — het event bestaat niet meer). Geen extra rule nodig.

### Claude's Discretion

- **Exacte tRPC router file-layout:** één file `src/server/trpc/routers/calendar.ts` met sub-procedures (`event.create`, `event.update`, `event.delete`, `event.declineParticipation`, `event.get`, `list`, `filterOptions.list`, `event.detectConflicts`) — planner kiest of dit in één file blijft of in `calendar/event.ts` + `calendar/filterOptions.ts` wordt opgesplitst. Beide passen bij Phase 1/2 conventies.
- **Migratie-volgorde:** vermoedelijk 3 migraties — `0009_phase3_calendar_events_base.sql` (base + lookups), `0010_phase3_calendar_extension_tables.sql` (6 extension tables), `0011_phase3_calendar_rls_policies.sql` (`calendar_events_visible_to()` + `overlapping_events_for_users()` SECURITY DEFINER + policies on participants/exceptions). Planner mag groeperen anders zolang elk migratie zelfstandig rollbacked kan worden.
- **Filter-combobox preload cardinality:** `trpc.calendar.filterOptions.list({ kind, query })` retourneert hoeveel opties per query? Suggestie: max 50 met server-side limit + 200ms debounce in client. Planner mag tunen op basis van Phase 2 patroon.
- **`event_type` lookup-tabel naam:** UI-SPEC schrijft `event_type_*` codes (UI3-D11). Concrete lookup-tabelnaam kan `event_type` (consistent met `tournament_type`, `training_type`) — planner kiest. Seed-migratie schrijft de 6 codes met sortOrder.
- **Composite indexen:** ROADMAP suggereert `(user_id, starts_at, ends_at)` op een gebruiker-table. In ons model komt de equivalent op `calendar_event_participants(user_id, event_id)` + `calendar_events(starts_at, ends_at)`. Planner valideert exacte indexen via EXPLAIN ANALYSE op een seed-dataset.
- **BullMQ recurring jobs in Phase 3:** geen — geen pg_cron of recurring worker nodig. Conflict-override audit gaat synchroon. Phase 5 voegt medical-read async audit toe (CRIT-7), Phase 3 raakt het niet.
- **next-intl message-key path:** UI-SPEC declareert het `calendar.*` namespace. Planner schrijft `messages/{nl,en,fr}.json` keys volgens UI-SPEC Copywriting Contract — met de twee overrides hierboven (D-57b conflict copy, D-58b delete copy).
- **Locale-loader voor FullCalendar:** dynamische import van `@fullcalendar/core/locales/{nl,en-gb,fr}` op basis van de actieve locale uit `next-intl`. Planner mag de exacte loader-strategie kiezen (dynamic import in `<CalendarView>` Client Component vs preload via Next.js `next/dynamic`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Core value, drietalige constraint, GDPR-constraints
- `.planning/REQUIREMENTS.md` §CAL (CAL-01..08), §TRAIN (TRAIN-01..06) — Phase 3 schrijft de schemas, Phase 4 de operationele laag; §TOURN (TOURN-01..04) — idem; §STAGE (STAGE-01..04 of equivalent); §MEET (MEET-01..02 of equivalent), §EVAL_CONV, §MED-EVENT (medische afspraken event-schema, niet medical_events!); §USER (USER-04 scope), §GDPR-04 (audit), §GDPR-08 (TIMESTAMPTZ UTC), §I18N (I18N-05/06/07/08)
- `.planning/ROADMAP.md` Phase 3 — Doel, 5 Succescriteria, Kerntaken, Risico's (RISK-RRULE, RISK-MOBILE, RISK-POLYMORPH); Phase 4 — Trainingsmodule + Toernooimodule + Rankingmodule kerntaken (Phase 3 levert hun schema-fundament)
- `.planning/STATE.md` — projectstatus en cross-phase constraints; Phase 1+2 ✅ complete

### Phase 1 carry-forward (built infrastructure)
- `drizzle/0000_initial.sql` — base schema: `users`, `academy_memberships`, `parent_child_links`, lookups taxonomy, audit_log
- `drizzle/0002_rls_functions_and_policies.sql` — RLS-fundament + SECURITY DEFINER pattern; Phase 3 breidt uit met `calendar_events_visible_to()` en `overlapping_events_for_users()`
- `src/server/trpc/middleware/freshSession.ts` — `protectedProcedure`, `tdProcedure`, `sensitiveProcedure`, `medicalProcedure` presets; Phase 3 voegt `trainerOrTdProcedure` of inline `requireRole(...)` toe per D-48
- `src/server/trpc/middleware/audit.ts` — `writeAudit(ctx, entry)`; gebruikt voor delete-snapshot (D-58c) en conflict-override (D-57)
- `src/server/trpc/middleware/rls.ts` — RLS-bound transactions per request; alle calendar-mutaties erven dit
- `src/lib/cache.ts` — Upstash abstractie; Phase 3 raakt het niet (geen cache nodig)
- `src/server/db/schema/audit.ts` — audit_log met JSONB meta-kolom voor snapshot
- `src/server/db/schema/lookups.ts` — lookup-pattern; Phase 3 voegt `event_type` tabel toe in stijl van `tournament_type` / `training_type`
- `src/lib/i18n-format.ts` — date-fns + nl-BE/en-GB/fr; reused voor alle datum-renders in EventDetailSheet en recurrence-summary

### Phase 2 carry-forward (built infrastructure)
- `drizzle/0006_phase2_profiles_and_files.sql` — `players`, `trainers`, `uploaded_files`, `age_category_history` schemas (Phase 3 refereert er FK's naar in extensietabellen — trainer_id, player participants, etc.)
- `drizzle/0007_phase2_rls_policies.sql` — RLS-policies voor players/trainers; pattern voor Phase 3 nieuwe policies
- `drizzle/0008_phase2_lookup_seed.sql` — pattern voor Phase 3 lookup-seeds (event_type codes)
- `src/server/db/schema/players.ts`, `trainers.ts` — FK-targets voor extension tables (`training_sessions.trainer_id`, `stages.players[]` of via junction)
- `src/components/admin/user-table.tsx` — DataTable pattern; reused alleen indirect (calendar gebruikt FullCalendar, niet DataTable)
- `src/components/players/` formulierpatroon — react-hook-form + zod resolver; `EventCreateSheet` volgt dit pattern
- `messages/{nl,en,fr}.json` — Phase 1/2 catalog basis; Phase 3 voegt `calendar.*`, `lookup.eventType.*`, `errors.calendar.*` toe

### Phase 3 UI design contract (LOCKED — MUST READ)
- `.planning/phases/03-kalender/03-UI-SPEC.md` — **875-regelige design contract**, status: approved (2026-05-13). Locks: FullCalendar 6.x configuratie, 6 nieuwe `--cal-event-{type}-{bg,fg,border}` tokens (light + dark), 5 nieuwe shadcn componenten (`sheet`, `alert`, `command`, `toggle`, `toggle-group`, `scroll-area`), event-chip contract, filter-bar contract (desktop inline + mobile bottom Sheet), conflict-UI surfaces (inline Alert + top banner + chip hint icon), mobile strategy 640px breakpoint + swipe via vanilla pointerevents, URL state (view/date/filter), 12 UI3-D* locked design decisions. **Twee overrides in dit CONTEXT.md:** D-57b sharpens `calendar.conflict.body` copy met participant-naam; D-58b vervangt `calendar.event.delete.body` (geen 30-dagen-restore-promise). Andere UI-SPEC keuzes blijven binding.

### Stack-specifiek
- FullCalendar v6 docs — `https://fullcalendar.io/docs` — timeGrid, dayGrid, multiMonth, interaction, rrule plugin docs; per-locale files
- FullCalendar React wrapper — `https://fullcalendar.io/docs/react`
- `rrule` npm package — `https://github.com/jakubroztocil/rrule` — RFC 5545 parser/generator
- Drizzle ORM relations en transactions — `https://orm.drizzle.team/docs/rqb` (relational query) en `https://orm.drizzle.team/docs/transactions`
- PostgreSQL SECURITY DEFINER pattern — Phase 1's `0002_rls_functions_and_policies.sql` als referentie-implementatie
- shadcn Sheet, Alert, Command, ToggleGroup, ScrollArea — `https://ui.shadcn.com/docs/components`

### GDPR & legal
- `.planning/PITFALLS-ADDITIONS.md` §CRIT-7 (medical access audit pattern; Phase 3 raakt het basis-schema voor medical_appointments — geen reads van pgcrypto cipher kolommen, alleen non-Article-9 metadata)
- Phase 1 D-21..D-30 patterns (rate limit, audit, RLS) — herbruikbaar

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (gebouwd in Phase 1 + 2)
- **`src/server/db/schema/audit.ts`** — `audit_log` met JSONB `meta` kolom; D-58c snapshot-pattern hangt eraan
- **`src/server/db/schema/lookups.ts`** — lookup-pattern (code PK, sort_order, active); Phase 3 voegt `event_type` toe; volgt `tournament_type`/`training_type` stijl letterlijk
- **`src/server/db/schema/players.ts`, `trainers.ts`** — FK-targets voor extensietabellen (`training_sessions.trainer_id` → trainers, deelnemers in junction → users)
- **`src/server/trpc/middleware/*`** — `requireFreshSession`, `requireRole`, `withRlsContext`, `writeAudit` — alle calendar routes erven deze
- **`src/lib/i18n-format.ts`** — date-fns formatters per locale (`formatDate`, `formatTime`, monday-first); FullCalendar `<CalendarView>` componenten herbruiken het in recurrence-summaries en empty-state strips
- **`src/components/common/empty-state.tsx`** — Phase 2 `<EmptyState>` blijft beschikbaar maar **niet gebruikt op /calendar** (UI-SPEC: de grid IS de empty state)
- **`src/components/ui/calendar.tsx`** — shadcn date-picker calendar (≠ FullCalendar); hergebruikt in `<DateTimePicker>` compound voor start/end datum-velden in event create/edit forms
- **`src/lib/cache.ts`** — beschikbaar, maar Phase 3 vereist geen caching laag (`calendar.list` query is < 200ms voor week-range volgens RISK-POLYMORPH budget); Phase 4+ kan caching toevoegen als nodig

### Established Patterns
- **Drizzle migratie-discipline:** elke nieuwe migratie heeft een `_*.rollback.md` companion met `**Risk:** / **Procedure:** / **Verification:**` markers (MIG-05); `tests/unit/migration-format.test.ts` enforceert dit
- **tRPC router file = één per domein in `src/server/trpc/routers/<domain>.ts`:** Phase 3 kiest `calendar.ts` (mogelijk splitsen — Claude's discretion)
- **Zod schema's gedeeld tussen server (input) en client (form resolver):** `src/server/trpc/schemas/calendar.ts` exporteert `eventCreateInputSchema`, `eventUpdateInputSchema`, etc.
- **Zod messages = i18n keys** (D-46 uit Phase 2): `errors.calendar.endBeforeStart`, `errors.calendar.rruleHorizonExceeded`, etc. Phase 3 voegt de `errors.calendar.*` namespace toe
- **Server Component voor lijst-pagina's; Client Component voor formulieren + FullCalendar:** UI-SPEC's CalendarPage = Server Component, CalendarView = Client (waar `'use client'` boundary leeft); andere event-sheets ook Client
- **TIMESTAMPTZ overal** (GDPR-08); enforced via `tstz()` helper in schemas
- **RLS-bound transaction op elke tRPC request** (`withRlsContext`); calendar routes erven dit
- **Audit-log op elke mutation:** create/update/delete event + decline-participation + conflict-override + exception-create

### Integration Points
- **Phase 4 schema-handover:** Phase 3 PLAN.md moet expliciet vermelden dat Phase 4 alleen `session_participants`, `session_sparring_partners`, `tournament_results`, `match_results`, `ranking_entries` toevoegt — geen wijzigingen aan de evenement-schemas. Anders dreigt Phase 4 per ongeluk de extension tables te herschrijven.
- **Sparring partner entity in Phase 4:** RLS `calendar_events_visible_to()` heeft een placeholder voor `role='sparring_partner'` die in Phase 3 lege resultaten retourneert; Phase 4 voegt de SPAR tabel + `session_sparring_partners` junction toe en breidt de UNION uit.
- **Phase 5 medical-event audit:** `medical_appointments` extension shipt in Phase 3 met non-Article-9 metadata (geen pgcrypto cipher columns daar — die zitten in Phase 1's `medical_events` tabel). Bevestig met Phase 5 dat de extension table _geen_ medical body bevat — alleen een verwijzing naar de medische context (doctor naam vrij tekst is grensgeval; valideer met legal of dit veld in cipher moet).
- **CI:** RBAC-matrix tests uitbreiden (7 rollen × 6 evenementtypen × create/read/update/delete = 168 cases — sample met representative subset). Existing Phase 1/2 test pattern.
- **shadcn components installen:** `npx shadcn@latest add sheet alert command toggle toggle-group scroll-area` (in één run; UI-SPEC declaratie 1:1).
- **FullCalendar package install:** `npm install @fullcalendar/core @fullcalendar/react @fullcalendar/timegrid @fullcalendar/daygrid @fullcalendar/interaction @fullcalendar/rrule @fullcalendar/multimonth rrule`.

</code_context>

<specifics>
## Specific Ideas

- **Class-table inheritance over JSONB extension** — gebruiker koos expliciet de typed-extension-table aanpak; geen escape hatches naar JSONB voor type-specifieke velden.
- **Soft-warning never hard-block** — gebruiker bevestigde dat ALLE conflicten een waarschuwing zijn met "Toch opslaan" optie, nooit een blokkering; ook voor medische conflicten.
- **Cross-scope conflict-detection met role-gated detail-redactie** — operationele scheduling-correctness wint van detail-privacy (existence-privacy is preserved: anyone you're double-booking IS already in your scope omdat je hen toevoegt aan je event).
- **"Ik kan niet aanwezig zijn" ≠ "Verwijderen"** — gebruiker maakte het onderscheid expliciet: decline-participation is geen delete; delete is voor creator/TD met confirmation popup en GEEN restore-window.
- **30-dagen-restore-promise uit UI-SPEC verwijderen** — UI-SPEC copy bevat een gelofte die Phase 3 niet waarmaakt; CONTEXT override D-58b heeft de vervangende copy.
- **Phase 3 schrijft volledige evenement-schemas voor 6 types** — bewuste scope-shift ten opzichte van ROADMAP-framing (was "alleen base in Phase 3"); Phase 4 reduceert tot operationele/result-laag.

</specifics>

<deferred>
## Deferred Ideas

- **"Deze en toekomstige" + "Alle afspraken in de reeks" RRULE-edit scope** → Phase 4 (training-session RRULE polish per RISK-RRULE-EXCEPTION uit UI-SPEC).
- **BYDAY / BYMONTHDAY pickers in RRULE editor** → Phase 4.
- **TD restore-UI voor hard-deleted events** → niet gebouwd; forensische recovery via `audit_log.meta` JSONB snapshot alleen (PostgreSQL recovery, geen UI in v1).
- **Per-user "verberg gedeclineerde events"-toggle** → v2; declined events tonen met strikethrough + 50% opacity in Phase 3.
- **Locatie-conflict-detectie (zaalboeking)** → v2 capability; v1 locatie is free text.
- **Per-event-type RBAC-fijngradering voor academy_manager** → planner-discretion in Phase 3 baseline (meetings + possibly per-academie events); finetuning kan in Phase 4 of v1.1.
- **Sparring-partner entity + `session_sparring_partners` junction + RLS-uitbreiding** → Phase 4 (samen met SPAR-01..04).
- **Realtime calendar updates (Supabase Realtime)** → v2 (`NOTIFICATION-PREFS`); Phase 6 brengt Realtime alleen voor messaging.
- **ICS / iCal export** → Phase 8 (CAL-06 release-quality).
- **Per-user timezone setting** → Phase 8; v1 = Europe/Brussels + browser-local rendering.
- **Right-click context menu op events** → deferred.
- **Print stylesheet voor calendar** → deferred.
- **Color customization per user** → out of scope (color contract is system-owned).
- **UI-SPEC revisie voor D-57b en D-58b copy-overrides** → out-of-band UI-SPEC revisie; geen blocker voor Phase 3 planning.

</deferred>

---

*Phase: 03-Kalender*
*Context gathered: 2026-05-14*
