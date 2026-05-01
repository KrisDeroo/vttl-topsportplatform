# Roadmap — VTTL Topsportplatform

*Aangemaakt: 2026-05-01 | Bron: PROJECT.md + REQUIREMENTS.md + research/SUMMARY.md*

---

## Overzicht

| Fase | Naam | UI? | Parallel? | Vereisten |
|------|------|-----|-----------|-----------|
| 1 | Fundament | Beperkt | Nee | AUTH-01..05, USER-01..05, GDPR-01..08, SEC-01..09, OPS-01..06, MIG-01..05, I18N-01..05, I18N-07, I18N-09, I18N-11 |
| 2 | Identiteit & Bestanden | Ja | Nee | PLAYER-01..07, TRAINER-01..03, FILE-01..05, VALID-01..06, DOM-CAT-01..02, I18N-06, I18N-08 |
| 3 | Kalender | Ja | Nee | CAL-01..08, VALID-07..08 |
| 4 | Kerndomein | Ja | Ja (intern) | TRAIN-01..06, TOURN-01..06, RANK-01..07, DOM-RESULT-01..04, DOM-RANK-01 |
| 5 | Uitgebreid domein | Ja | Ja (intern) | SPAR-01..04, AMB-01..04, EVAL-01..06, MED-01..06, AGE-01..04, DOM-SPAR-AVAIL-01, DOM-MED-CONFLICT-01..02, DOM-EVAL-VIS-01..02 |
| 6 | Communicatie | Ja | Nee | MSG-01..05, MSG-CHANNEL-01..03 |
| 7 | Synthese | Ja | Nee | VIEW-01..05, SEARCH-01..02, GDPR-05..06 |
| 8 | Kwaliteit & Release | Nee | Ja (intern) | CAL-06 (ICS), OPS-07..12, I18N-10 (catalog coverage), productieklaar |

**Stack-update:** Database, Storage en Realtime draaien op **Supabase (Pro tier, EU/Frankfurt)**. App-deployment blijft op **Coolify/Hetzner**. Alle migraties, RLS-policies en schema-definities staan in **Drizzle-code** (geen Supabase Dashboard-config) zodat de portabiliteit behouden blijft. Auth blijft **Better Auth** (tegen de Supabase Postgres database).

**Talen-update:** Het platform is **drietalig (nl/en/fr)** met `nl` als default. UI-strings via **`next-intl`** message catalogs (`messages/nl.json`, `messages/en.json`, `messages/fr.json`). Lookup-tabellen slaan codes op (geen labels); display via i18n-keys. Eigennamen (academies, clubs, personen) niet vertaald. Backend-logs en source-code blijven Engels. Consent-tekst per locale versioned (team-drafted in Fase 1; juridische review per taal vóór productie-livegang als release-gate in Fase 8). Volledige i18n-infrastructuur (DB-kolom, e-mailtemplates × 3, consent × 3) wordt in Fase 1 gebouwd om latere migratie + re-consent te vermijden.

**E-mail-update:** Transactionele e-mail via **Resend (EU-region, Frankfurt)** met React Email templates per locale. Achter `lib/email.ts` interface zodat een latere swap (Mailgun EU, SendGrid EU, AWS SES eu-west-1) een 1-bestand-wijziging is. DPA + EU-region-bevestiging vóór eerste productie-mail (release-gate Fase 8).

---

## Phase 1: Fundament

### Doel
Het fundament is klaar wanneer een technisch directeur kan inloggen met een gescopede sessie, RLS alle data afschermt op databaseniveau, en het GDPR-schema klaar staat voor alle vervolgfasen.

### Plans

**Plans:** 18 plans in 8 waves (parallel-able where files don't overlap; see each plan's `depends_on` and `files_modified` for the precise ordering).

Plans:
- [ ] 01-01-setup-tooling-PLAN.md — Next.js 15 init + TypeScript + ESLint + env validation + Drizzle Kit config
- [ ] 01-02-drizzle-schema-migration-001-core-PLAN.md — Migration 001: users (locale + role enums), sessions, lookups, memberships, consent_records, audit_log, idempotency_keys + Postgres role separation
- [ ] 01-03-drizzle-schema-migration-002-medical-PLAN.md — Migration 002: medical_events, medical_documents, medical_access_audit + pgcrypto + write-time audit trigger
- [ ] 01-04-rls-policies-and-functions-PLAN.md — Migration 002b: current_user_id/role STABLE wrappers, players_visible_to SECURITY DEFINER, RLS policies on every sensitive table
- [ ] 01-05-better-auth-config-PLAN.md — Better Auth config (SEC-01..06) + permissions matrix + CSRF middleware + log-redact-paths constant
- [ ] 01-06-better-auth-i18n-emails-PLAN.md — Localized transactional email via Resend (EU region) + React Email templates — 4 templates × 3 locales
- [ ] 01-07-next-intl-routing-and-catalogs-PLAN.md — next-intl routing + locale resolution chain + 3 message catalogs + 9 consent HTML files (team-drafted; legal review tracked in Phase 8)
- [ ] 01-08-locale-switcher-and-preferred-locale-flow-PLAN.md — Globe-icon LocaleSwitcher + setUserLocale Server Action + responsive header/hamburger placement
- [ ] 01-09-upstash-cache-abstraction-ratelimit-PLAN.md — lib/cache.ts (D-14 abstraction) + JWT revocation list (D-09) + rate-limit middleware (SEC-07/08/09)
- [ ] 01-10-bullmq-worker-template-PLAN.md — BullMQ Queue + Worker on ioredis; example consent-version-bump job; Coolify two-service hint
- [ ] 01-11-callercontext-trpc-middleware-PLAN.md — tRPC bootstrap + CallerContext + requireAuth (revocation + staleness) + withRlsContext + freshSession + audit + requireConsent + procedure presets
- [ ] 01-12-consent-flow-and-minor-gate-PLAN.md — lib/consent (CURRENT_POLICY + sha256 snapshot) + canActivate (Belgian < 16 minor gate) + consent tRPC router + ReConsentBanner
- [ ] 01-13-observability-pino-sentry-PLAN.md — pino with REDACT_PATHS + Sentry EU beforeSend PII strip + Drizzle slow-query helper + retention doc
- [ ] 01-14-health-endpoints-PLAN.md — /api/health/live (process-only) + /api/health/ready (DB + Redis with 2s timeout)
- [ ] 01-15-td-admin-ui-user-management-PLAN.md — admin.user.* router (CRUD + activate/deactivate/role/parent/academy) + UserTable Server Component + tRPC client
- [ ] 01-16-drizzle-push-blocking-PLAN.md — **[BLOCKING]** Apply migrations 0000–0003 to dev/staging Supabase + 8 post-migration smoke checks
- [ ] 01-17-wave-0-test-infrastructure-PLAN.md — Vitest + Playwright + testcontainers + RBAC matrix (D-11) + RLS direct-query + chaos rate-limit + e2e specs (RED on day one)
- [ ] 01-18-migration-governance-docs-PLAN.md — Migration runbook + erasure strategy + backfill utility + protect-migrations CI guard + TIMESTAMPTZ ESLint rule


### Vereisten
AUTH-01..05, USER-01..05, GDPR-01..04, GDPR-07, GDPR-08, SEC-01..09, OPS-01..06, MIG-01..05, I18N-01..05, I18N-07, I18N-09, I18N-11

> GDPR-05 en GDPR-06 (portabiliteitsexport + wissing-UI) worden technisch ontworpen in deze fase maar als UI afgewerkt in Fase 7.
> OPS-07..12 (backup-drills, monitoring-alerts, SPF/DKIM/DMARC, transactionele e-mail) worden in Fase 8 als release-kwaliteit afgewerkt; de infrastructuur (Supabase Pro PITR, Pino logging, structuur) staat hier al.
> I18N-06 (proper-noun handling) en I18N-08 (Zod-error i18n keys) komen in Fase 2 zodra de eerste echte forms verschijnen. I18N-10 (catalog-coverage gate) komt in Fase 8.

### Succescriteria
1. Een technisch directeur kan inloggen; na browserherstart is de sessie nog actief.
2. Een gebruiker met de rol 'trainer' krijgt een 403-respons bij directe API-aanroep naar data van een andere academie — ook zonder omzeiling via de UI.
3. Een directe PostgreSQL-query als niet-eigenaar op `medical_events` retourneert nul rijen — RLS blokkeert zonder uitzondering.
4. De `audit_log` bevat een leesregistratie bij elke toegang tot een medisch record, met actor, actie, tijdstip en IP.
5. Een testgebruiker jonger dan 16 jaar kan geen account voltooien zonder een gekoppeld ouderaccount met gegeven toestemming.
6. Een gebruiker registreert in nl/en/fr; bevestigingse-mail komt aan in de gekozen taal; consent-records bevatten de exacte tekst van die taal en versie. Wisselen van locale na login update `users.preferred_locale` en past direct aan voor volgende e-mails.

### Kerntaken

**Infrastructuur (Supabase + Coolify):**
- Supabase Pro project aanmaken in EU/Frankfurt-regio; PITR inschakelen; databasen-credentials in Coolify Secrets
- Coolify-applicatie configureren voor de Next.js-app op Hetzner CX31 — verbindt met Supabase via Postgres-URL
- Drizzle Kit initialiseren tegen Supabase Postgres (geen Supabase JS SDK in app-code; portabel blijven)
- Supabase Storage buckets aanmaken: `profiles/`, `evaluations/`, `medical/`, `messages/` — RLS-policies in Drizzle-migraties

**Database & schema:**
- Migratie 001: kerntabellen — `users`, `sessions`, `roles`, `academy_memberships`, `parent_child_links`, lookup-tabellen (status A/B/C, academies, tornooitypes, rankingtypes, trainingtypes, organisaties, uitkomstlevels), `consent_records`, `audit_log`, `medical_access_audit`
- Migratie 002: medisch-geïsoleerde tabelgroep — `medical_events`, `medical_documents` met eigen RLS-policies, `pgcrypto`-encryptie op gevoelige velden, audit-trigger voor schrijfacties (lees-audit via app-laag in Fase 5)
- Migratie 003: idempotentie-tabel — `idempotency_keys (key, user_id, created_at)` voor VALID-08
- PostgreSQL RLS inschakelen op alle gevoelige tabellen; `players_visible_to(caller_id, caller_role)` SQL-functie volgens PITFALLS-ADDITIONS.md schema
- `TIMESTAMPTZ` + UTC-conventie afdwingen via Drizzle-schema-helpers + lint-regel

**Auth & sessies (Better Auth):**
- Better Auth configureren tegen Supabase Postgres: e-mail+wachtwoord login, sessiemanagement, wachtwoordreset
- SEC-01: cookies `httpOnly`, `Secure`, `SameSite=Lax` (Better Auth defaults — auditeren)
- SEC-02: CSRF-bescherming op alle state-changing tRPC-mutaties
- SEC-03: re-auth-vereiste voor gevoelige acties (parent-child koppelen, medische records bekijken, data exporteren, wissing uitvoeren)
- SEC-05: wachtwoordreset-links 1 uur geldig; magic links 15 min; eenmalig gebruik
- SEC-06: 5 mislukte logins per account per 15 min lockout (Better Auth)

**CallerContext:**
- tRPC-middleware: `{ userId, role, academyIds, linkedPlayerIds }` — academyIds en linkedPlayerIds gecached in JWT-claim, ververst bij login en bij expliciete invalidatie (max staleness 15 min)
- Integratietests per rol-resource-combinatie verplicht voor Fase 2 mag starten

**Rate limiting (SEC-07..09):**
- tRPC-middleware `rateLimit` gebruikt Upstash Redis (EU) of in-memory token-bucket op Coolify
- Per-user 100 req/min, per-IP 1000 req/min
- File upload 10/min per user, 100/dag
- Broadcast 1/uur per user, max 5 gelijktijdig platformbreed

**GDPR-fundament:**
- Gelaagde toestemming bij registratie: operationele data, medische verwerking, foto/video-gebruik — opslaan met versie + tijdstip + actor
- Belgisch minderjarigen-toestemmingspad (< 16 jaar): ouderaccount verplicht vóór activering speleraccount
- Erasurestrategie (anonimiseer vs. verwijder) vastleggen in tech-doc vóór eerste migratie

**Observability-fundament (OPS-01..06):**
- Pino structured logging met redact-filter op `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.email`, `*.phone`, `*.medical_*`
- Logflare/Axiom EU-configuratie of self-hosted Loki op Hetzner — toepassingslogs uit de DB
- Sentry EU configureren met `beforeSend` PII-stripper
- Drizzle query-interceptor voor latency-metrics; basisalerting in Better Stack/UptimeRobot voor `/api/health`
- Supabase slow-query-log inschakelen op 500ms threshold

**Migratie-governance (MIG-01..05):**
- Drizzle-migraties versiebeheer-policy: nooit committed migraties bewerken; altijd nieuwe migratie
- Expand-contract-pattern documenteren met voorbeeld in tech-doc
- Backfill-script-template (batches van 1000, 100ms delay) als utility

**TD UI (beperkt):**
- AUTH-04/05: gebruikersbeheer-paneel — accounts aanmaken, activeren, deactiveren, rollen toewijzen, parent-child koppelen, trainer-academie koppelen

**i18n-fundament (I18N-01..05, I18N-07, I18N-09, I18N-11):**
- `next-intl` configureren in App Router; `messages/nl.json`, `messages/en.json`, `messages/fr.json` aanmaken (login/auth/registratie/consent + algemene chrome-strings volstaan voor Fase 1)
- Migratie 001 uitbreiden met `users.preferred_locale` enum (`nl`/`en`/`fr`, default `nl`, NOT NULL)
- Locale-resolutie middleware: explicit user pref → session locale (anonymous switcher) → `Accept-Language` → `nl`
- Better Auth e-mailtemplates per locale (verify-email, password-reset, magic-link) — 3 sets met gedeelde merge-vars
- Consent-flow: `consent_records` schema bevat `policy_version`, `locale`, en de exacte getoonde tekst (snapshot voor GDPR-bewijs); 3 versies van elk consent-document opstellen (operationeel, medisch, foto/video) — team-drafted in Fase 1; juridische review per taal ingepland vóór productie-livegang (release-gate Fase 8, RISK-I18N-LEGAL)
- `Intl` / `date-fns` locale-config in app: `nl-BE`, `en-GB`, `fr-BE`; weekstart maandag in alle drie
- Locale-switcher in chrome (header of footer); bij login update direct `users.preferred_locale`
- Convention: source-code, comments, pino-logs en error-codes blijven Engels; geen NL/FR strings in backend-code

### Afhankelijkheden
Geen — dit is de basis.

### Risico's
- **RISK-SCHEMA**: Elke fout in de RLS-policies of het medisch isolatieontwerp vereist latere migraties die geïmplementeerde features kunnen doorbreken. Het schema moet in één keer goed zijn.
- **RISK-CALLERCONTEXT**: Een onjuist gevulde CallerContext lekt data via later gebouwde routers. Valideer met integratietests per rol vóór Fase 2.
- **RISK-CONSENT**: Het toestemmingsmodel moet GDPR Art. 7 + 8 dekken; juridische review aanbevolen vóór productie.
- **RISK-RLS-PERF**: Genest `EXISTS` in RLS-policies kan N²-gedrag veroorzaken. Beperk policy-nesting tot 1–2 niveaus; voor diepere hiërarchieën val terug op service-laag-filtering. Loadtest met realistische dataset vóór Fase 2.
- **RISK-SUPABASE-LOCK**: Supabase als managed dienst introduceert lock-in. Mitigatie: alle schemas/RLS/migraties in Drizzle-code; geen Supabase JS SDK in app-code; standaard Postgres-URL connectie. Migratie naar Neon of self-hosted blijft bounded (< 1 dag).
- **RISK-I18N-LEGAL**: Consent-tekst per taal moet juridisch geldig zijn onder Belgische GDPR-implementatie. Een vertaling die afwijkt van de NL-tekst kan toestemming ongeldig maken. Mitigatie: brontekst in NL definitief opstellen; vertaling door of geverifieerd door juridisch geschoolde NL→FR/EN-vertaler; alle drie versies parallel ondertekenen in versie 1.0 vóór livegang.
- **RISK-I18N-DRIFT**: Drie message catalogs raken uit sync zodra strings worden toegevoegd zonder vertaling. Mitigatie: CI-gate (I18N-10) in Fase 8; tot die tijd ontbrekende keys zichtbaar maken via fail-loud fallback in dev (geen stille EN-fallback).

### Parallelliseerbaar?
Nee — alle teams werken op hetzelfde kritieke pad: Supabase-setup → schema → RLS → auth → CallerContext → SEC/OPS/MIG-fundament.

### UI?
Beperkt — alleen de login-pagina, wachtwoordreset-flow, en het TD-gebruikersbeheer-paneel. Geen complexe UI.

---

## Phase 2: Identiteit & Bestanden

### Doel
Het platform heeft volledige speler- en trainerprofielen met foto-upload en correct gescopede bestandstoegang, zodat het dagelijks beheer van de spelerslijst operationeel is.

### Vereisten
PLAYER-01..07, TRAINER-01..03, FILE-01..05, VALID-01..06, DOM-CAT-01..02, I18N-06, I18N-08

### Succescriteria
1. Een technisch directeur kan een volledig spelerprofiel aanmaken met foto; het profiel is direct zichtbaar in de spelerslijst.
2. Een trainer ziet alleen spelers van de academies waaraan hij/zij is toegewezen — niet de volledige lijst.
3. Een speler kan zijn eigen niet-gevoelige velden bewerken (adres, telefoon, e-mail) maar niet zijn status of academie.
4. Profielfoto's zijn alleen opvraagbaar via getekende URL's; een directe bucket-URL geeft een 403.
5. Noodcontactgegevens zijn aanwezig op het profiel van elke minderjarige speler — het systeem blokkeert opslaan als dit ontbreekt.

### Kerntaken

**Schema:**
- Drizzle-schema voor `players` en `trainers` (alle velden uit PLAYER-01..04, TRAINER-01..02)
- Junction-tabel `trainer_academy_links` (N-op-N)
- `age_category_history (player_id, age_category, category_year, effective_from, effective_to)` — DOM-CAT-01
- Schema-constraint: `players.club` (vrij tekst) en `players.academy_id` (FK naar lookup) zijn aparte velden — DOM-CAT-02 + PLAYER-03

**Bestandsopslag (Supabase Storage):**
- Buckets `profiles/` (semi-publiek, geauthenticeerde toegang) en `medical/` (Fase 5, strikt) — al aangemaakt in Fase 1
- Bucket-RLS-policies in Drizzle-migraties: profielfoto's zichtbaar voor eigen + TD + scope-trainer; nooit publiek
- Server-side getekende URL-generatie via Supabase SDK (server-only) voor alle downloads — TTL 1 uur voor profielfoto's (FILE-01)
- Upload-flow: client → server-side validatie → upload via Supabase Storage server-side client → UUID-bestandsnaam (FILE-04)

**File validation (VALID-01..06):**
- Server-side bestandsgrootte-validatie: 2MB voor profielfoto's
- Magic-bytes-validatie via `file-type` npm-package — extensie-vertrouwen verboden (VALID-02)
- MIME-whitelist per endpoint: alleen JPEG en PNG voor profielfoto-upload (VALID-03)
- Malware-scan integratie via VirusTotal API of ClamAV daemon — bestand quarantaine tot scan slaagt (VALID-04)
- Headers `Content-Type` strikt + `Content-Disposition: attachment` op downloads (VALID-05)
- Zod-schema-validatie op alle tRPC-mutaties; geen client-side trust (VALID-06)

**tRPC-routers:**
- `player.create`, `player.update`, `player.get`, `player.list` — CallerContext-scoped
- `trainer.create`, `trainer.update`, `trainer.get`, `trainer.list`
- `file.upload` — server-side validatie + Supabase Storage upload + DB-record
- `file.getSignedUrl` — RBAC-check vóór URL-generatie

**Leeftijdscategorie-historiek:**
- Bij update van `age_category` op een speler: nieuwe rij in `age_category_history`, vorige rij krijgt `effective_to`
- Tournament-validatie in Fase 4 leest van deze historiek voor de tournooi-startdatum

**UI:**
- Spelersprofiel-UI: formulier met alle velden, foto-upload-widget, academie-dropdown (lookup), statusveld, noodcontactsectie
- Trainerprofiel-UI: formulier, diploma-dropdown, pedagogische kwalificatie-toggle, academiekoppelingen
- Spelerslijst-UI: tabelweergave met scoping op basis van CallerContext

**Validatie-regels:**
- Club ≠ academie schema-afdwinging (PLAYER-03)
- Noodcontact verplicht voor minderjarigen (PLAYER-06)
- Leeftijdscategorie en categoriejaar expliciet opgeslagen, niet afgeleid (PLAYER-04 — DOM-CAT-01 historiek)

**i18n in Fase 2 (I18N-06, I18N-08):**
- Lookup-codes voor academies, leeftijdscategorieën, statuut, trainerdiploma's worden in `messages/{nl,en,fr}.json` voorzien als display-labels (codes blijven taal-neutraal in DB)
- Eigennamen-conventie afdwingen: academienamen ("Topsportschool", "Academy Antwerpen") en clubnamen worden 1× opgeslagen in canonical vorm en niet vertaald — coachnaam in fr-UI ziet er identiek uit als in nl-UI
- Zod-validatieboodschappen voor speler-/trainerformulieren als i18n-keys (geen hardcoded strings); client rendert in actieve locale
- Datepickers gebruiken `date-fns` met user locale; placeholder en formaat vary per locale (`dd/MM/yyyy` voor nl-BE en fr-BE, `dd/MM/yyyy` voor en-GB)

### Afhankelijkheden
Fase 1 volledig afgerond — CallerContext, RLS, en auth zijn vereist.

### Risico's
- **RISK-FILE-SCOPE**: Getekende URL-generatie heeft server-side rolvalidatie nodig bij elke URL-aanvraag. Toegangscontrole mag niet vertrouwen op URL-vervalingtijden alleen.
- **RISK-PHOTO-PII**: Profielfoto's zijn persoonsgegevens onder GDPR; apart opslaan in `profiles/`-prefix met eigen policy (FILE-03) is verplicht — niet samen met medische documenten.
- **RISK-MALWARE**: Bestandsuploads zonder magic-byte-validatie en malware-scan zijn een aanvalsvector. Lever VALID-02 + VALID-04 vóór de eerste upload-endpoint live gaat.
- **RISK-CAT-HISTORY**: Leeftijdscategorie-wijzigingen midden in een seizoen (DOM-CAT-01) moeten correct doorwerken in tornooi-validatie. Test grenswaarden: speler die op tornooi-startdatum exact 17 wordt.

### Parallelliseerbaar?
Nee — speler- en trainerprofielen zijn fundamenteel voor alle vervolgdomeinen.

### UI?
Ja — spelersprofiel-formulier, trainerprofiel-formulier, spelerslijst, foto-upload-interactie.

---

## Phase 3: Kalender

### Doel
De kalender is de centrale dagelijkse werkvlakte van het platform; na deze fase kunnen alle gebruikersrollen hun gescopede agenda zien en kunnen de eerste evenementtypen worden aangemaakt.

### Vereisten
CAL-01, CAL-02, CAL-03, CAL-04, CAL-05, CAL-07, CAL-08

> CAL-06 (ICS-export) is een release-quality feature en wordt afgewerkt in Fase 8.

### Succescriteria
1. Een TD opent de kalender en ziet alle evenementen van alle spelers en trainers in een weekweergave (standaard), correct kleurgecodeerd per type.
2. Een speler ziet alleen zijn/haar eigen evenementen — andere spelers zijn niet zichtbaar, ook niet via directe API-aanroep.
3. Een sparring partner ziet alleen de sessies waaraan hij/zij gekoppeld is.
4. De kalender geeft een conflictwaarschuwing wanneer een nieuw evenement overlapt met een bestaand evenement van dezelfde persoon.
5. Op een scherm smaller dan 480px toont de kalender één dag per kolom met swipe-navigatie.

### Kerntaken
- Polymorfisch kalendermodel: `calendar_events` basistabel + typed extensietabellen (`training_sessions`, `tournaments`, `meetings`, `stages`, `eval_conversations`, `medical_appointments`) — geen single-table inheritance
- RRULE-veld op `calendar_events` voor herhalende evenementen (niet-gematerialiseerd); herhalingexpansie in de serviclaag voor het weergavevenster
- tRPC-router `calendar.list`: accepteert `{ from, to, callerContext }` — retourneert alleen evenementen binnen de scope
- FullCalendar 6.x integratie: `timeGridWeek` als standaardview, `timeGridDay`, `dayGridMonth`, `multiMonthYear`
- Kleurcodering per evenementtype: trainingen blauw, toernooien oranje, vergaderingen groen, stages paars, evaluatiegesprekken geel, medische afspraken rood
- Filterbalk: op speler, trainer, sparring partner, academie, evenementtype (CAL-05)
- Conflictdetectie: server-side overlap-query bij aanmaken/wijzigen evenement (CAL-07)
- Mobiele responsivestrategie: FullCalendar `timeGridDay` op smalle schermen + swipe-navigatie (CAL-08)
- Zoneconversie: alle tijden opslaan als `TIMESTAMPTZ` UTC, weergeven in lokale timezone van de gebruiker

### Afhankelijkheden
Fase 1 (CallerContext, RLS) en Fase 2 (speler-/trainersrecords bestaan) volledig afgerond.

### Risico's
- **RISK-RRULE**: RRULE-expansie buiten de database kan memory/performance problemen geven bij grote bereiken (bijv. jaarsoverzicht). Begrens expansie tot max. 2 jaar vooruit; implementeer server-side paginering voor maandweergave.
- **RISK-MOBILE**: FullCalendar mobiele weergave vereist specifieke configuratie-opties; test vroeg op iOS Safari en Android Chrome.
- **RISK-POLYMORPH**: De polymorfische join-query (`calendar_events` + extensietabellen) kan traag worden bij grote datasets. Samengestelde index op `(user_id, starts_at, ends_at)` is verplicht.

### Parallelliseerbaar?
Nee — de kalenderinfrastructuur is een blokkering voor alle evenementtypen in Fasen 4 en 5.

### UI?
Ja — de meest complexe UI-component van het hele project (FullCalendar-integratie, kleurcodering, filters, mobiele weergave).

---

## Phase 4: Kerndomein

### Doel
De drie centrale sportdomeinen — trainingen, toernooien en rankings — zijn volledig operationeel, zodat een speler zijn dagelijkse training kan registreren, toernooiresultaten kan invoeren en de rangschikking-evolutie kan zien.

### Vereisten
TRAIN-01..06, TOURN-01..06, RANK-01..07, DOM-RESULT-01..04, DOM-RANK-01

### Succescriteria
1. Een trainer kan een wekelijks terugkerende groepstraining aanmaken; individuele afwijkingen (annulering, tijdswijziging) zijn mogelijk zonder de hele reeks te verwijderen.
2. Een trainer kan per sessie de aanwezigheid afvinken en een kwaliteitsscore + feedback invullen per aanwezige speler.
3. Een speler kan zijn toernooiresultaat invoeren (eindrangschikking + per wedstrijd); een TD of andere speler krijgt een 403 bij poging hetzelfde te doen.
4. De ranking-evolutie van een speler is zichtbaar als lijndiagram per rankingtype; het huidige niveau is afgeleid van de meest recente tijdreekswaarde — niet opgeslagen als apart veld.
5. Historische toernooiresultaten zijn volledig doorbladerbaar zonder exportplicht; beide niveaus (eindrangschikking en per wedstrijd) zijn afzonderlijk opvraagbaar.

### Kerntaken

**Trainingsmodule (parallel uitvoerbaar):**
- Schema: `training_sessions`, `session_participants` (kwaliteitsscore + feedback), `session_sparring_partners` (junction)
- tRPC-routers: `training.create`, `training.update`, `training.delete`, `training.get`, `training.list`, `training.markAttendance`, `training.setParticipantScore`
- RRULE-integratie met kalender: herhaalsessies aanmaken via `calendar_events.rrule`; individuele annulering via `calendar_event_exceptions`
- UI: trainingssessie-formulier (alle velden TRAIN-01), aanwezigheidslijst per sessie, kwaliteitsscore-invoer per speler

**Toernooimodule (parallel uitvoerbaar):**
- Schema: `tournaments`, `tournament_results` (eindrangschikking niveau 1), `match_results` (per wedstrijd niveau 2)
- 9-niveaus uitkomst-lookup: winnaar/finalist/laatste 4/8/16/32/64/128/groepsfase — centrale lookup-tabel
- Resultaat-lifecycle (DOM-RESULT-04): `status` enum `'draft' | 'confirmed' | 'published'` — alleen `confirmed`+ tellen mee in ambitievergelijking
- Edit-historiek (DOM-RESULT-03): `result_edit_history (result_id, edited_by, old_values, new_values, edit_reason, timestamp)`
- tRPC-routers: `tournament.create` (TD only), `tournament.list`, `result.enterFinalRanking`, `result.enterMatchResult`, `result.edit` (binnen 48u door speler; daarna TD-approval), `result.confirmDraft` (TD)
- API-gate (DOM-RESULT-02): toelaatbare invoerders zijn de speler zelf, een trainer in de academie van de speler, of de TD — `entered_by` veld traceert wie
- VALID-07: unieke index `(player_id, tournament_id, round, opponent, date)` op match_results — voorkomt dubbele invoer
- VALID-08: idempotency key check op POST-endpoint
- UI: toernooilijst, eindrangschikking-invoer, per-wedstrijd invoer (ronde, tegenstander, score, video-link), edit-binnen-48u-knop, TD-confirm-paneel

**Rankingmodule (parallel uitvoerbaar):**
- Schema: `ranking_entries` (speler, type, datum, waarde, **source**) — pure tijdreeks; `source` enum `'manual' | 'federation_official'` (DOM-RANK-01); v1 = `manual` only
- Rankingtype-metadata: richting (lager = beter voor wereld/Europees; te bevestigen voor België — RISK-02)
- tRPC-routers: `ranking.addEntry`, `ranking.getHistory`, `ranking.getCurrentByType`
- UI: ranking-invoerformulier, lijndiagram per type (recharts of chart.js); duidelijke label "Manueel ingevoerd, controleer tegen officiële bron"

### Afhankelijkheden
Fase 1 en Fase 3 (kalenderinfrastructuur en polymorfisch event-model volledig operationeel).

### Risico's
- **RISK-RRULE-EXCEPTION**: Individuele afwijkingen op herhaalsessies (annulering/tijdswijziging) vereisen een `calendar_event_exceptions`-tabel. Dit ontwerp moet vóór implementatie worden vastgelegd.
- **RISK-RESULT-GATE**: De API-gate "speler kan alleen eigen resultaten invoeren" is een securityvereiste (TOURN-05). Automatische integratietests per rol zijn verplicht.
- **RISK-RANKING-DIRECTION**: RANK-03 stelt de richting van de België Ranking als onbevestigd. Gebruik een configureerbaar veld per rankingtype; implementeer niet hardcoded.

### Parallelliseerbaar?
Ja — trainingen, toernooien en rankings kunnen parallel door drie taakverdeling worden gebouwd nadat het schema is goedgekeurd.

### UI?
Ja — drie aparte formulieren + lijst-UI's + één lijndiagram.

---

## Phase 5: Uitgebreid domein

### Doel
Alle ondersteunende sportdomeinen — sparringpartners, ambities, evaluaties, medische opvolging, vergaderingen, stages en evaluatiegesprekken — zijn operationeel, waarmee het dagelijkse sportbeheerpakket compleet is.

### Vereisten
SPAR-01..04, AMB-01..04, EVAL-01..06, MED-01..06, AGE-01..04, DOM-SPAR-AVAIL-01, DOM-MED-CONFLICT-01..02, DOM-EVAL-VIS-01..02

### Succescriteria
1. Een TD kan een sparringpartner aanmaken en koppelen aan meerdere trainingssessies; een sparringpartner ziet na login alleen zijn/haar eigen kalenderevents.
2. Een TD stelt ambities in voor een speler per jaar per tornooitype; het systeem toont automatisch de vergelijking ambitie vs. werkelijk resultaat — inclusief "nog niet gespeeld" voor toernooien zonder resultaat.
3. Een trainer maakt een evaluatie aan met gescoorde evaluatiepunten; de labeltekst op elk punt is vastgelegd als snapshot op het moment van aanmaak — wijzigingen aan de configuratie van de TD raken bestaande evaluaties niet.
4. Een coach ziet alleen het rood/oranje/groen blessure-indicatielampje voor een speler; de volledige medische fiche is onzichtbaar zonder de bijbehorende rol.
5. Een stage is aangemaakt door de TD met deelnemende spelers en trainers; het event verschijnt correct op de kalender van alle deelnemers.

### Kerntaken

**Sparringpartners (parallel uitvoerbaar):**
- Schema: `sparring_partners`-tabel (naam, foto, telefoon, e-mail); junction `session_sparring_partners` al aangemaakt in Fase 4
- Beschikbaarheidsblokken: `sparring_partner_availability (partner_id, blocked_from, blocked_until, reason)` — DOM-SPAR-AVAIL-01
- tRPC-routers: `sparringPartner.create` (TD only), `sparringPartner.update`, `sparringPartner.list`, `sparringPartner.setAvailability`, `sparringPartner.checkAvailability(partnerId, dateRange)`
- SPAR-04: CallerContext-check in `calendar.list` voor sparringpartnerrol — alleen eigen sessies
- Sessie-aanmaakflow waarschuwt bij overlap met onbeschikbaarheid; vereist expliciete bevestiging om te overschrijven
- Notificatie wanneer een sparringpartner een datum blokkeert die al gekoppeld is aan een sessie
- UI: sparringpartner-register (lijst + formulier), beschikbaarheidskalender, koppeling aan sessies

**Ambities (parallel uitvoerbaar):**
- Schema: `ambitions` (speler, jaar, tornooitype, minimum-uitkomstniveau)
- tRPC-router: `ambition.set`, `ambition.compareWithResults` — LEFT JOIN op `tournament_results`
- AMB-03: "nog niet gespeeld"-geval expliciet behandeld in query (LEFT JOIN retourneert NULL → vertaald naar tekst in serviclaag)
- UI: ambities-formulier per jaar per tornooitype, vergelijkingstabel (ambitie vs. resultaat)

**Evaluaties (parallel uitvoerbaar):**
- Schema: `evaluations` met visibility-vlaggen (`visible_to_player`, `visible_to_parent`, `visible_to_other_trainers` — alle default `false` per DOM-EVAL-VIS-01), `evaluation_internal_notes` (apart veld, nooit gepubliceerd — DOM-EVAL-VIS-02), `evaluation_scores` (FK naar `evaluation_points` + snapshot-labelveld), `evaluation_points` (configureerbaar, soft-delete)
- tRPC-routers: `evaluation.create` (default privé), `evaluation.publish` (vereist expliciete keuze welke flags aan), `evaluation.list` (gefilterd op visibility + caller), `evaluationPoint.configure` (TD only)
- EVAL-03: snapshot-logica — bij aanmaken evaluatie, kopieer huidige label naar `evaluation_scores.label_snapshot`
- Bijlage-upload: via Supabase Storage `evaluations/`-bucket, getekende URL, toegankelijk voor trainer + TD + betrokken speler (FILE-05)
- UI: evaluatieformulier met visibility-keuze bij publiceren, configuratiescherm evaluatiepunten (TD), spelersevaluatielijst (alleen gepubliceerde zichtbaar voor speler/ouder)

**Medische opvolging (parallel uitvoerbaar):**
- Schema: `medical_events` (al ontworpen in Fase 1, nu gevuld); `medical_documents` (bijlagen, Supabase Storage `medical/`-prefix met strikte RLS)
- tRPC-routers: `medical.create`, `medical.update`, `medical.list` — alleen eigen of TD-scope; SEC-03 re-authentication-check voor volledige fiche
- `medicalProcedure` middleware schrijft elke read naar `medical_access_audit` (CRIT-7) — async via job queue om medische reads niet te blokkeren
- MED-04: `medical.getInjuryStatus`-endpoint retourneert uitsluitend traffic-light enum (groen/oranje/rood); nooit medische vrije tekst — voor coachrol
- DOM-MED-CONFLICT-01: bij aanmaken trainingssessie, server-side check op overlappende `medical_events` voor elke deelnemer; waarschuwing aan trainer met namen + tijden, expliciete bevestiging vereist
- DOM-MED-CONFLICT-02: aanwezigheidsmarkering defaultwaarde "afwezig met geldige reden" bij overlappende medische events
- Getekende URL TTL voor medische scans: 5 min, max 1 refresh per sessie, vereist re-authenticatie bij refresh
- MED-06: scan/document-upload — beslissing RISK-01 afdwingen vóór implementatie

**Agenda-evenementtypen (parallel uitvoerbaar):**
- Schema: `stages`, `meetings`, `meeting_invitations`, `eval_conversations` — extensietabellen van `calendar_events`
- tRPC-routers: `stage.create` (TD only), `meeting.create` (iedereen), `meeting.respond` (accept/decline), `evalConversation.create`
- AGE-02: terugkerende vergaderingen via RRULE; uitnodigings-accept/decline-workflow
- AGE-04: toernooien verschijnen al op kalender via `tournament` → `calendar_events` koppeling (gecreëerd in Fase 4)
- UI: stage-formulier, vergadering-formulier met uitnodigingslijst, accept/decline-knoppen, evaluatiegesprek-formulier

### Afhankelijkheden
Fase 1 (GDPR/medisch schema), Fase 2 (speler-/trainersrecords), Fase 3 (kalenderinfrastructuur), Fase 4 (toernooiresultaten voor ambitievergelijking).

### Risico's
- **RISK-MEDICAL-ACCESS**: MED-04 vereist een strikt gescheiden query-pad voor de traffic-light-status vs. het volledige medisch record. Implementeer als twee aparte tRPC-procedures — nooit als één procedure met conditonele filtering.
- **RISK-EVAL-SNAPSHOT**: Als de snapshot-logica wordt vergeten, breken bestaande evaluaties wanneer de TD een evaluatiepuntnaam aanpast. Valideer met een integratietest.
- **RISK-SCAN-UPLOAD**: MED-06 is een open vraag (RISK-01). Als het besluit "opnemen" is, heeft dit impact op het R2-bucket-beleid en de RLS van `medical_documents`. Neem de beslissing voor het begin van deze fase.

### Parallelliseerbaar?
Ja — sparringpartners, ambities, evaluaties, medische opvolging en agenda-evenementtypen kunnen parallel worden gebouwd door vijf taakverdeling, nadat het schema per module is goedgekeurd.

### UI?
Ja — vijf afzonderlijke formuliersets + de vergadering accept/decline-flow.

---

## Phase 6: Communicatie

### Doel
Intern berichtenverkeer is operationeel — trainers en de TD kunnen spelers en groepen bereiken; spelers ontvangen in-app-meldingen en optionele e-mailmeldingen.

### Vereisten
MSG-01..05, MSG-CHANNEL-01..03

### Succescriteria
1. Een TD stuurt een bericht naar "alle spelers met status A"; alle betrokken spelers ontvangen het bericht in hun inbox zonder dat de zender wacht.
2. Een trainer beantwoordt een bericht; de reply-thread is zichtbaar voor beide partijen.
3. Een bericht met bijlage is verzendbaar; de bijlage is downloadbaar via een getekende URL (niet publiek).
4. Het ongelezen-tellertje in de navigatie werkt correct na ontvangst van een nieuw bericht — zonder pagina-verversing.
5. Groepsverzending naar een groep van 50 personen blokkeert de UI niet; de berichten worden asynchroon bezorgd.

### Kerntaken
- Schema: `messages`, `message_recipients` (gematerialiseerde leveringsrijen — één rij per ontvanger per bericht), `message_attachments`
- Groepsresolutie bij verzending: groepsdefinities (status A/B/C, academie, alle spelers, enz.) worden server-side omgezet naar individuele `message_recipients`-rijen op verzendtijd (MSG-03)
- Asynchroon groepsverzenden via job queue (geen blocking HTTP-request); bevestig verzending als "in behandeling" aan zender
- Ongelezen-teller: gecachete kolom `unread_count` op gebruiker, bijgewerkt via database-trigger of job — geïndexeerd (MSG-04)
- tRPC-routers: `message.send`, `message.reply`, `message.forward`, `message.listInbox`, `message.listSent`, `message.markRead`
- In-app-melding via **Supabase Realtime**: client abonneert op nieuwe rijen in `message_recipients` gefilterd op eigen user_id; RLS-aware (geen lekken)
- E-mailmelding: fallback per gebruiker, via Resend (EU-region) — gebruikersvoorkeur opgeslagen; in-app blijft primaire kanaal (MSG-CHANNEL-01); systeemnotificatie-templates per locale via React Email components (`users.preferred_locale` van ontvanger bepaalt template — niet die van zender)
- MSG-CHANNEL-02: leesbevestigingen werken alleen in-app; e-mail bevat link "open in app om te bevestigen"
- MSG-CHANNEL-03: veiligheidskritieke berichten (blessure-updates, dringende roosterwijzigingen) sturen in-app + e-mail + vereisen affirmative RSVP, niet alleen leesbevestiging
- Bijlage-upload: Supabase Storage `messages/`-prefix + getekende URL
- UI: inbox, verzonden berichten, berichtopsteller met ontvangerselectie (individueel + groep), reply/forward, bijlage-upload, ongelezen-badge in navigatie

### Afhankelijkheden
Fase 1 (gebruikers en rollen), Fase 2 (speler-/trainersprofielen voor ontvangerselectie), Fase 5 (groepsdefinities volledig gevuld).

### Risico's
- **RISK-GROUP-SEND**: Groepsverzending naar grote groepen (bijv. alle spelers + alle trainers) kan honderden rijen genereren. Job queue is verplicht; synchrone verzending is geen optie.
- **RISK-REALTIME**: Supabase Realtime is managed maar vereist correcte RLS-policies; subscriptions die geen rijen mogen lezen falen stil. Loadtest met realistische rolmix.

### Parallelliseerbaar?
Nee — berichtenverkeer vereist de volledige gebruikers-, profiel- en groepsinfrastructuur.

### UI?
Ja — de volledige berichteninterface is een substantieel UI-onderdeel.

---

## Phase 7: Synthese

### Doel
De spelersweergave brengt alle domeinen samen op één werkblad per speler met tabbladen; het globale zoekvenster en de GDPR-export/wissingsinterface zijn operationeel.

### Vereisten
VIEW-01, VIEW-02, VIEW-03, VIEW-04, VIEW-05, SEARCH-01, SEARCH-02, GDPR-05, GDPR-06

### Succescriteria
1. Een trainer opent een speler en ziet alle tabbladen geladen met correct gescopede data — de medische info-tab is leeg/verborgen tenzij de trainer de juiste rol heeft.
2. Het dashboard-tabblad toont grafieken voor trainingsfrequentie, kwaliteitsscore-evolutie, rangschikking-evolutie en toernooiresultaten vs. ambities — geladen via één samengestelde query-aanroep, niet per widget afzonderlijk.
3. Een speler ziet alleen zijn eigen spelersweergave; URL-manipulatie naar een andere speler-ID retourneert 403.
4. Globaal zoeken op "Van Damme" retourneert overeenkomende spelers, trainers en toernooien — met accentongevoelige matching ("van damme" = "Van Damme").
5. Een speler vraagt zijn volledige gegevensexport aan; het systeem genereert een JSON-bestand met alle persoonsgegevens inclusief trainingshistorie, rankings en toernooiresultaten.
6. Een TD voert een wissingverzoek uit; persoonlijke identificatoren worden geanonimiseerd, trainings-/rankingstatistieken blijven behouden als aggregate data.

### Kerntaken
- Spelersweergave-layout: tabblad-router met lazy-loading per tabblad (Basisgegevens, Kalender, Resultaten, Trainingen, Ambities, Rankings, Medische info, Evaluaties, AI-videoanalyses placeholder, Dashboard)
- Tabscoping: Medische info-tabblad conditioneel zichtbaar op basis van CallerContext-rol — server-side gehandhaafd
- Dashboard-query: één tRPC-procedure `playerDashboard.get(playerId)` die alle widgetdata retourneert via SQL GROUP BY + CTEs — geen N+1 (VIEW-04)
- Dashboard-cache: 5-minuten TTL op server-side (Redis of in-memory cache afhankelijk van Coolify-configuratie) (VIEW-05)
- VIEW-02: URL-guard op spelersweergave — spelerrol ziet alleen eigen profiel-ID
- Globaal zoeken: `pg_trgm` + `unaccent` extensies inschakelen; gecombineerde trigram-index op naam-velden (SEARCH-02)
- tRPC-router `search.query`: scoped op CallerContext — retourneert geen resultaten buiten de rol-scope
- GDPR-05 UI: `/mijn-gegevens`-pagina met exportknop; server-side JSON-generatie per gebruiker
- GDPR-06 UI: TD-paneel voor wissingverzoeken — anonimiseringsworkflow + bevestigingsstap + auditlogging
- AI-videoanalyses-tabblad: placeholder met "Beschikbaar in v2"-boodschap — geen functionaliteit, geen dode links

### Afhankelijkheden
Alle voorgaande fasen (1–6) volledig afgerond — de spelersweergave aggregeert alle domeinen.

### Risico's
- **RISK-DASHBOARD-PERF**: De dashboard-query raakt meerdere grote tabellen. Valideer met EXPLAIN ANALYZE op realistische testdata; voeg partiële indices toe indien nodig.
- **RISK-TAB-AUTH**: Elk tabblad laadt data via een aparte tRPC-aanroep; elk eindpunt moet zelfstandig autoriseren. Vertrouw niet op de tabblad-zichtbaarheid als beveiligingscontrole.
- **RISK-GDPR-ERASURE**: De anonimiseringsworkflow moet atomisch zijn (alles of niets); gebruik een databasetransactie. Gedeeltelijk geanonimiseerde records zijn een GDPR-risico.

### Parallelliseerbaar?
Nee — vereist alle domeindata uit Fasen 1–6.

### UI?
Ja — de meest samengestelde UI van het project: tabblad-router, dashboard met grafieken, zoekresultatenweergave, GDPR-formulieren.

---

## Phase 8: Kwaliteit & Release

### Doel
Het platform is productierijp: ICS-export werkt, prestatietests zijn geslaagd, de GDPR DPIA is uitgevoerd, de beveiligingsaudit is afgerond, en de applicatie draait stabiel op Coolify/Hetzner.

### Vereisten
CAL-06 (ICS-export), OPS-07..12, plus niet-functionele vereisten: prestaties, beveiliging, GDPR DPIA, productie-deployment.

> Alle v1 functionele vereisten zijn afgedekt in Fasen 1–7. Fase 8 is de kwaliteitspoort naar productie.

### Succescriteria
1. ICS-export per gebruiker genereert een geldig `.ics`-bestand dat correct importeert in Outlook, Google Calendar en Apple Calendar.
2. Een loadtest simuleert 50 gelijktijdige gebruikers; P95-responstijd voor de kalenderweergave < 800ms; dashboardquery < 2s.
3. De GDPR DPIA is gedocumenteerd en ondertekend; verwerkingsactiviteiten, gegevenscategorieën, bewaartermijnen en rechtsgrondslagen zijn volledig ingevuld.
4. De beveiligingsaudit (OWASP Top 10 beoordeling) heeft geen openstaande High of Critical bevindingen.
5. De productieomgeving op Hetzner/Coolify draait met automatische HTTPS, databaseback-ups elke 6 uur, en een gedocumenteerd rollback-procedure.

### Kerntaken

**ICS-export (CAL-06):**
- ICS/iCal-exportendpoint per gebruiker — genereer `.ics` op basis van `calendar_events` binnen de CallerContext-scope
- Valideer ICS-output in Outlook 365, Google Calendar, Apple Calendar
- Per-user persistent feed-URL voor live abonnementen (vs. eenmalige download) — v1 = eenmalige download; live feed v2 (ICS-SUBSCRIBE)

**Performance:**
- Loadtest met k6: kalenderweergave (50 concurrent users, 200 events/week), broadcast-send, dashboard-query, RBAC-RLS-doorlooptijden — P95-drempelwaarden documenteren
- Database query-analyse: EXPLAIN ANALYZE op kritieke queries (kalender, dashboard, zoeken); indices toevoegen/aanpassen
- RLS-loadtest expliciet: geneste `EXISTS`-policies onder realistische dataset (200 spelers, 5 jaar history) — bevestig N²-gedrag uit RISK-RLS-PERF afwezig

**Backup & DR (OPS-07..10):**
- OPS-07: Supabase Pro PITR-configuratie geverifieerd; dagelijkse snapshots actief
- OPS-08: RTO ≤ 4u, RPO ≤ 1u gedocumenteerd in runbook
- OPS-09: Restore-drill uitvoeren — backup naar staging Supabase project, integriteitsvalidatie, timing geregistreerd; documenteer als maandelijkse routine
- OPS-10: Medische records archiveringsroute naar versleutelde offsite-opslag (S3-compatibel met 30-jaar retention) — `pg_cron`-job

**Email-infra (OPS-11..12):**
- SPF, DKIM, DMARC DNS-records configureren op `vttl.be` vóór eerste transactionele e-mail
- Resend (EU-region) configureren met geverifieerde domain `vttl.be` + SPF/DKIM/DMARC; nooit vanuit applicatieserver SMTP
- Deliverability-test: testberichten naar Gmail, Outlook, Apple Mail; spamclassificatie controleren

**GDPR DPIA & beveiligingsaudit:**
- DPIA: documenteer verwerkingsactiviteiten, gegevenscategorieën, bewaartermijnen, rechtsgrondslagen, betrokken verwerkers (**Supabase**, Hetzner, **Resend**, Sentry, ggf. Cloudflare), betrokkenenrechten
- DPA-verificatie: ondertekende DPA's met Supabase, Hetzner, e-maildienst, Sentry EU
- Beveiligingsaudit: OWASP Top 10 — focus op injectie, broken access control, security misconfiguration, cryptographic failures, IDOR-tests per rol

**Productie-deployment:**
- Coolify-configuratie: SSL/TLS (Let's Encrypt), Secrets via Coolify, health checks, automatic deploys vanaf `main`
- Database = Supabase Pro (geen lokale Postgres in productie)
- Monitoring-dashboards in Better Stack of Grafana — alle alerts uit OPS-04..06 actief
- Documenteer rollback-procedure (Coolify rollback + database PITR)

**i18n release-gate (I18N-10):**
- CI-check op 100% catalog-coverage voor `nl`, `en`, `fr` (geen ontbrekende keys, geen stille EN-fallback in user-facing surfaces)
- ICS-export `SUMMARY` en `DESCRIPTION` velden gebruiken de locale van de ontvanger
- Deliverability-test transactionele e-mail in alle 3 locales (NL, EN, FR templates testen op Gmail/Outlook/Apple Mail per taal)
- Juridisch ondertekende consent-tekst in alle 3 locales (final review met DPO en juridische adviseur)

**Closure:**
- Definitieve UX-revisie: taalconsistentie per locale (NL/EN/FR), foutberichten in actieve locale, formuliervalidatieteksten via i18n-keys
- Documenteer alle open vragen uit PROJECT.md (1–8) als opgeloste of uitgestelde v2-items
- Documenteer RISK-01 (scan-uploads), RISK-02 (Belgium Ranking-richting), RISK-I18N-LEGAL en RISK-I18N-DRIFT als opgeloste of uitgestelde v2-items

### Afhankelijkheden
Alle Fasen 1–7 volledig en productioneel stabiel.

### Risico's
- **RISK-DPIA-DELAY**: De DPIA vereist juridische input en kan niet volledig intern worden uitgevoerd. Plan externe DPO-review minimaal 2 weken voor de geplande livegang.
- **RISK-ICS-COMPAT**: ICS-formaat heeft subtiele compatibiliteitsproblemen tussen kalenderclients. Test vroeg in de fase; gebruik een gevalideerde ICS-bibliotheek.
- **RISK-PERF-SURPRISE**: Prestatieknelpunten verschijnen vaak pas bij realistisch testdatavolume. Vul de database met representatief volume (bijv. 100 spelers × 3 jaar data) vóór de loadtest.
- **RISK-RESTORE-UNTESTED**: Backups zonder restore-drill zijn theorie. Voer minstens één volledige drill uit vóór livegang en documenteer de timing.
- **RISK-EMAIL-DELIVERABILITY**: Eerste batches transactionele e-mail kunnen in spam belanden zonder correcte SPF/DKIM/DMARC-instellingen. Test 2 weken vooraf, niet op livegang-dag.

### Parallelliseerbaar?
Ja — ICS-implementatie, loadtesting, DPIA-documentatie en beveiligingsaudit kunnen parallel lopen.

### UI?
Nee — geen nieuwe UI. Alleen verfijning, foutberichten en taalconsistentie.

---

## Kritieke paden samengevat

```
Fase 1 (Fundament)
  └── Fase 2 (Identiteit & Bestanden)
        └── Fase 3 (Kalender)
              └── Fase 4 (Kerndomein) ──────────────────┐
                    └── Fase 5 (Uitgebreid domein)       │
                          └── Fase 6 (Communicatie)      │
                                └── Fase 7 (Synthese) ◄──┘
                                      └── Fase 8 (Kwaliteit & Release)
```

Parallellisering binnen fasen:
- **Fase 4**: trainingen / toernooien / rankings gelijktijdig na schema-goedkeuring
- **Fase 5**: sparringpartners / ambities / evaluaties / medisch / agenda-types gelijktijdig na schema-goedkeuring
- **Fase 8**: ICS / loadtest / DPIA / beveiligingsaudit gelijktijdig

---

*Laatste update: 2026-05-01 na initialisatie*
