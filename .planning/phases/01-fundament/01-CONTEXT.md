# Phase 1: Fundament - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 levert het authenticatie-, autorisatie- en datafundament op waar elke latere fase op steunt. Aan het einde van deze fase kan een technisch directeur inloggen met een gescopede sessie, blokkeert PostgreSQL RLS alle data-toegang buiten de rol, staat het GDPR-schema (medische isolatie, consent, audit-log) klaar, en is de drietalige (nl/en/fr) infrastructuur — `users.preferred_locale`, locale-resolutie, e-mailtemplates per taal, consent per locale — operationeel. Geen domeinfunctionaliteit (spelers, kalender, toernooien); alleen het fundament en het minimaal benodigde TD-gebruikersbeheer.

</domain>

<decisions>
## Implementation Decisions

### A. Locale-switcher UX
- **D-01:** Taalkiezer rechtsboven in de header op elke pagina (incl. login en wachtwoordreset). Compact dropdown-component met **wereldbol-icoon** (lucide `Globe`) en tweeletterige locale-code (NL/EN/FR). Op viewport < 768px verhuist de switcher naar het hamburger-menu — icoon blijft zichtbaar in de header als hint.
- **D-02:** Anonieme bezoekers krijgen locale via Accept-Language detectie (fallback `nl`); switcher wijzigt session-cookie. Na login wordt de keuze gepersisteerd op `users.preferred_locale` en overschrijft alle volgende sessies van die gebruiker.
- **D-03:** Locale-wissel direct effectief zonder pagina-refresh — `next-intl` provider re-rendert client-side. Server-side translations gebruiken de nieuwe locale bij de eerstvolgende request.

### B. Consent-tekst versionering & juridische review-timing
- **D-04:** NL-brontekst voor alle drie consent-categorieën (operationele data, medische verwerking, foto/video-gebruik) wordt **vóór migratie 001 gelockt en juridisch ondertekend**. Dit is een hard gate; geen schemamigratie zonder definitieve NL-tekst.
- **D-05:** EN- en FR-vertalingen worden parallel met Fase 1-implementatie aangemaakt; juridische verificatie EN/FR uiterlijk in Fase 8 release-gate (samen met DPIA). EN/FR-locales staan in dev/staging beschikbaar maar productie-livegang per locale vereist juridische sign-off voor die taal.
- **D-06:** `consent_records` schema bevat `policy_version` (semver, bv. `1.0.0`), `locale` (`nl`|`en`|`fr`), en `consent_text_snapshot` (volledige tekst zoals getoond op consent-moment) — niet een FK naar een policies-tabel. Reden: GDPR-bewijs vereist dat we exact de tekst kunnen tonen die de gebruiker zag, ook als de policies-tabel later wordt gewijzigd. Bij text-correctie of vertaal-bugfix wordt `policy_version` verhoogd; oude consent-records blijven juridisch geldig met hun snapshot.
- **D-07:** Bij majeure tekst-wijziging (Belgische DPA-richtlijn-update, juridische correctie) wordt re-consent geforceerd via een banner; gebruiker kan niet verder zonder herbevestiging. Bij minor wijziging (typo) geen re-consent, alleen versie-bump op nieuwe consents.

### C. CallerContext caching strategie
- **D-08:** `CallerContext = { userId, role, academyIds[], linkedPlayerIds[], locale }` wordt gevuld in JWT-claim bij login en bij expliciete invalidatie. Max staleness: **15 minuten**. Vervalt automatisch bij JWT-expiry (sessie-cookie); ververst bij re-auth voor SEC-03-acties.
- **D-09:** Voor scope-inperking (rol verlaagd, academie-link verbroken, parent-child-link verbroken) wordt user-id direct op een **Redis-revocation-lijst** geplaatst (Upstash, key `revoked:{user_id}` met TTL = JWT-expiry). tRPC-middleware checkt deze lijst per request — sub-millisecond lookup. Gebruiker met gerevokeerde JWT krijgt 401 en wordt gedwongen tot re-auth.
- **D-10:** Voor scope-uitbreiding (extra academie toegewezen, parent-link toegevoegd) is staleness van max 15 min acceptabel — de gebruiker ziet de extra scope na volgende JWT-refresh of bij re-auth.
- **D-11:** Integratietests per rol-resource-combinatie zijn verplicht **vóór Fase 2 mag starten**. Test-matrix: 7 rollen × 5 resource-types = 35 tests minimum, met expliciete expectaties (200/403). Geautomatiseerd in CI; falen blokkeert merge.

### D. Rate limit + Redis backend
- **D-12:** **Upstash Redis (managed, EU-regio)** wordt de gedeelde primitive voor: SEC-07/08/09 rate limiting (token-bucket), JWT-revocation-lijst (D-09), async job queue via BullMQ (D-15), en optioneel dashboard-cache (VIEW-05) in Fase 7. Connectie via `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` als Coolify-secrets.
- **D-13:** Rate limit-middleware in tRPC: per-user 100 req/min, per-IP 1000 req/min (SEC-07); file-upload 10/min per user, 100/dag (SEC-08); broadcast 1/uur per user, max 5 platformbreed (SEC-09). Implementatie via `@upstash/ratelimit` package — sliding window algorithm.
- **D-14:** Vendor-lock-in mitigatie: rate limit en revocation-logica geabstraheerd achter `lib/cache.ts` interface; vervangen door Hetzner Redis container of self-hosted Redis is een 1-bestand-wijziging. Geen Upstash-specifieke API's (HASH, PUBSUB) gebruiken zonder review.

### E. Async job queue
- **D-15:** **BullMQ op Upstash** wordt nu in Fase 1 opgezet — worker-process-template + één voorbeeld-job (consent-versie-bump notificatie). Latere fasen voegen alleen jobs toe zonder nieuwe primitive. Worker draait als apart Coolify-service (`web` + `worker`); zelfde codebase, andere entrypoint.
- **D-16:** Eerste echte productie-jobs komen in Fase 5 (medical-read-audit async write) en Fase 6 (group-message fan-out). Fase 1-template moet beide patterns kunnen dragen: korte taken (< 1s) en burst-jobs (honderden in batch).

### F. Health endpoints
- **D-17:** Twee gescheiden endpoints — `/api/health/live` (alleen process-check, geen externe afhankelijkheden, voor UptimeRobot) en `/api/health/ready` (Postgres + Upstash bereikbaarheid, voor Coolify deploy-gate en interne monitoring). Beide retourneren JSON met component-status.

### G. i18n-fundament (uit decisions in /gsd-discuss-phase startup)
- **D-18:** `next-intl` als enige i18n-laag; `messages/nl.json`, `messages/en.json`, `messages/fr.json` in repo. Fase 1-scope: auth/registratie/consent/error-chrome strings. Latere fasen voegen domein-strings toe per feature.
- **D-19:** Lookup-codes language-neutraal in DB (`status_a`, `tournament_wtt_star`); display-labels via i18n-keys. Eigennamen (academies, clubs, personen) niet vertaald, opgeslagen in canonical vorm.
- **D-20:** Dev-omgeving heeft **fail-loud fallback** voor ontbrekende keys (toont `MISSING_KEY:nl.auth.login.title` ipv. stille EN-fallback). Productie heeft graceful fallback: vertaling-locale → nl → key-naam. CI-gate (I18N-10) blokkeert deploys bij ontbrekende keys vanaf Fase 8.

### Claude's Discretion
- Concrete naamgeving van migration-files, tRPC-router-organisatie, en de file-tree-structuur (`src/app/`, `src/server/`, `src/lib/i18n/` etc.) — kiezen tijdens planning op basis van Next.js 15 App Router conventies en Drizzle-codepatterns.
- Exacte schema-namen voor lookup-tabellen — in lijn met REQUIREMENTS.md taxonomie maar concrete kolomnamen (snake_case) tijdens implementatie.
- BullMQ-worker concurrency en retry-policy — sensible defaults (concurrency 5, retry 3× met exp backoff) tot we metriek hebben.
- Sentry `beforeSend` PII-stripper-regels — geïnformeerd door pino-redact-config; details tijdens implementatie.
- Coolify-deployment configuratiedetails (gezondheidscheck-paden, secrets-mapping) — afhankelijk van Coolify-versie op de Hetzner box.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Core value, constraints (incl. drietalig), open questions 1–8
- `.planning/REQUIREMENTS.md` §AUTH, §USER, §GDPR, §SEC, §OPS, §MIG, §I18N, §VALID — alle Fase 1 vereisten met traceability
- `.planning/ROADMAP.md` Phase 1 — Doel, Succescriteria (6×), Kerntaken, Risico's (RISK-SCHEMA, RISK-CALLERCONTEXT, RISK-CONSENT, RISK-RLS-PERF, RISK-SUPABASE-LOCK, RISK-I18N-LEGAL, RISK-I18N-DRIFT)
- `.planning/STATE.md` — huidige projectstatus en cross-phase constraints

### Architecture & pitfalls
- `.planning/PITFALLS-ADDITIONS.md` §CRIT-6 (auth/session security), §CRIT-7 (medical access audit), §CRIT-8 (RLS performance), reclassifications — Haiku critical review additions
- `.planning/research/PITFALLS.md` — primaire pitfall-referentie (CRIT-1..5 en lager)
- `.planning/research/ARCHITECTURE.md` — initiële architectuurschets (lees alvorens schema te ontwerpen om dubbel werk te vermijden)
- `.planning/research/STACK.md` — stack-rationale per laag, alternatieven en motivatie voor elke "Why NOT"

### GDPR & legal
- Belgische GDPR-implementatie (Wet 30 juli 2018 betreffende de bescherming van natuurlijke personen met betrekking tot de verwerking van persoonsgegevens) — geen interne doc; juridische adviseur bij consent-tekst-finalisatie
- Patient Rights Act (België) — 30-jaar retentie medische records (OPS-10)

### Stack-specifiek
- Better Auth docs — `https://better-auth.com/docs` — `https://better-auth.com/docs/basic-usage`, `https://better-auth.com/docs/concepts/session-management`, `https://better-auth.com/docs/plugins/organization` (RBAC plugin patroon)
- Drizzle ORM docs — `https://orm.drizzle.team/docs/overview`, `https://orm.drizzle.team/docs/rls` voor PostgreSQL RLS-integratie
- Supabase Storage RLS — `https://supabase.com/docs/guides/storage/security/access-control`
- next-intl docs — `https://next-intl-docs.vercel.app/` — App Router setup, server-side translation, locale-routing
- Upstash Redis + Ratelimit — `https://upstash.com/docs/redis/sdks/ratelimit-ts/overview`, `https://upstash.com/docs/redis/howto/connectfromfunctions`
- BullMQ docs — `https://docs.bullmq.io/`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
Geen — dit is de eerste implementatie-fase. De `.planning/` map bevat alleen documenten, geen code. Geen bestaande Next.js/Drizzle/Better Auth setup om op voort te bouwen.

### Established Patterns
- **Markdown documenten in Nederlands voor UX-content** (ROADMAP, PROJECT) maar **Engelse identifiers** (REQUIREMENTS REQ-IDs, file/folder-paden, code-conventions) — deze tweetaligheid trekken we door in code: backend-symbolen Engels, UI-strings Nederlands/Engels/Frans via `next-intl`.
- **GSD workflow conventies** (CLAUDE.md): elke wijziging via `/gsd-quick`, `/gsd-execute-phase` of `/gsd-debug`; geen directe edits buiten een GSD-flow.

### Integration Points
- **Coolify deploy**: Fase 1-output moet als Next.js app deploybaar zijn op Coolify met Postgres-URL + Upstash-credentials als secrets. Geen lokale Postgres in productie; alle migraties draaien tegen Supabase Pro.
- **Supabase Storage buckets**: `profiles/`, `evaluations/`, `medical/`, `messages/` worden in Fase 1 aangemaakt met RLS-policies in Drizzle-migraties (geen Supabase Dashboard-config). Fase 2+ vullen ze.
- **Drizzle migraties versiebeheer**: nooit committed migraties bewerken (MIG-01); altijd nieuwe migratie. Expand-contract pattern verplicht voor schemawijzigingen na livegang (MIG-02).

</code_context>

<specifics>
## Specific Ideas

- **Wereldbol-icoon voor taalkiezer** — lucide `Globe` icoon (consistent met shadcn/ui icoon-library), niet vlaggen (vlaggen-iconografie is politiek geladen voor BE-context met fr-BE vs nl-BE).
- **Liveness/readiness gescheiden** — industry-standard Kubernetes-pattern; ook bruikbaar zonder K8s op Coolify.
- **Snapshot-tekst in `consent_records`** — geen FK naar policies-tabel om GDPR-bewijs hard te garanderen.

</specifics>

<deferred>
## Deferred Ideas

- **Magic-link login** — Better Auth ondersteunt het, maar v1 = e-mail+wachtwoord only. Magic-link kan in v1.1 als gebruikersfeedback wijst op login-frictie.
- **2FA / TOTP** — uit scope voor v1; voor TD-account aanbevolen vanaf v1.1, voor andere rollen optioneel.
- **OAuth (Google/Microsoft)** — niet relevant voor v1 (interne federatie-tool); toevoegen in v2 als integratie met VTTL/KBTTB-systemen wordt overwogen.
- **Gedetailleerde admin audit-log UI** — `audit_log` wordt geschreven in Fase 1 maar de UI om hem te bekijken komt in Fase 7 of v1.1 als TD-tool.
- **Rate-limit per role** (bv. TD krijgt 500 req/min ipv. 100) — v1 = uniform; differentiëren als productie-metriek aanleiding geeft.
- **Live-reload van locale-strings** — handig in dev, maar v1 vereist een redeploy om vertalingen te wijzigen. CMS-driven translations is een v2-optie.
- **Consent-banner voor cookies** — niet relevant: het platform gebruikt alleen first-party functionele cookies (sessie); geen third-party tracking. Consent-records dekken data-verwerking, niet cookies.

</deferred>

---

*Phase: 01-Fundament*
*Context gathered: 2026-05-01*
