# Phase 1: Fundament - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 01-fundament
**Areas discussed:** Locale-switcher UX, Consent-tekst versionering & juridische review-timing, CallerContext caching strategie, Rate limit + Redis backend, Async job queue, Health endpoints

---

## Pre-discussion: i18n scope clarification

Voorafgaand aan de gray-area-discussie kwam de gebruiker met de mededeling dat het platform drietalig (nl/en/fr) moet zijn — niet Dutch-only zoals PROJECT.md/REQUIREMENTS.md/CLAUDE.md aanvankelijk stelden. Dit is verwerkt in een aparte commit (`e4702cf docs: add three-language UI (nl/en/fr) and fix roadmap headers`) en in de drie-decision-block die de discussie startte:

| Vraag | Opties | Keuze |
|-------|--------|-------|
| Welke locales en default? | (1) nl/en/fr default nl ✓ • (2) auto-detect • (3) regionale varianten nl-BE/nl-NL etc. | nl/en/fr, default nl |
| Lookup-strategie? | (1) codes-in-DB + i18n-catalogs ✓ • (2) translation-tabel in DB • (3) NL-only labels | Hybride: codes + i18n |
| Phase 1 i18n-diepte? | (1) volledig (DB + email + consent) ✓ • (2) schema-only • (3) defer naar Fase 2 | Volledig in Fase 1 |

Deze drie keuzes voedden de Decisions G in CONTEXT.md.

In dezelfde voorbereidingsstap is ook de tooling-fix uitgevoerd: ROADMAP.md-headers van `## Fase N — Naam` naar `## Phase N: Naam` zodat `gsd-tools findPhaseInternal` de fasen herkent. Inhoud bleef Nederlands.

---

## A. Locale-switcher UX

| Optie | Beschrijving | Gekozen |
|-------|--------------|---------|
| Header rechts (Recommended) | Compacte dropdown rechts in top bar, zichtbaar op elke pagina incl. login. Mobile in hamburger-menu | ✓ |
| Footer rechts | Onderaan elke pagina; minder opvallend, niet boven fold op lange pagina's | |
| Alleen op login + in profielinstellingen | Geen permanente switcher; vooraf op login of in /instellingen | |
| Alleen via profielinstellingen | Anonieme bezoekers krijgen Accept-Language detectie; pas na login wisselbaar | |

**User's choice:** Header rechts.
**Notes:** Gebruiker specificeerde aanvullend: "Taalkiezer bovenaan rechts, met een icoon van een wereldbolletje". Vastgelegd als lucide `Globe`-icoon (geen vlaggen — vermijden van politieke iconografie in BE-context). Op viewport < 768px verhuist de switcher naar het hamburger-menu maar het icoon blijft als hint zichtbaar in de header.

---

## B. Consent-tekst versionering & juridische review-timing

| Optie | Beschrijving | Gekozen |
|-------|--------------|---------|
| NL-brontekst eerst gelockt, EN/FR parallel met implementatie (Recommended) | Stap 1: definitieve NL-tekst juridisch ondertekend vóór migratie 001. Stap 2: EN/FR parallel met implementatie; juridische verificatie EN/FR uiterlijk Fase 8 release-gate. `policy_version` bumps bij correcties; oude consents blijven juridisch geldig via snapshot. | ✓ |
| Alle 3 talen samen vóór implementatie | NL + EN + FR alle drie juridisch ondertekend vóór migratie 001. Veiligst maar vertraagt Fase 1-start met 2–4 weken. | |
| Alleen NL nu; EN/FR pas vóór locale-livegang | Fase 1 ondersteunt technisch 3 talen; EN/FR-consent pas Fase 8. EN/FR in dev/staging maar niet productie tot review klaar. | |

**User's choice:** Optie 1 (NL-brontekst eerst, EN/FR parallel).
**Notes:** Snapshot-strategie in `consent_records` (kolom `consent_text_snapshot`) is hiermee vast: GDPR-bewijs vereist dat de exacte getoonde tekst opvraagbaar blijft. Bij majeure tekstwijziging wordt re-consent gevraagd via banner; minor wijzigingen alleen versie-bump op nieuwe consents.

---

## C. CallerContext caching strategie

| Optie | Beschrijving | Gekozen |
|-------|--------------|---------|
| JWT-claim + 15 min staleness (Recommended) | academyIds + linkedPlayerIds in JWT-payload bij login; max 15 min staleness; expliciete invalidatie via revocation-lijst. Snel, schaalbaar. | ✓ |
| Redis-cache met 60s TTL | Per-request lookup in Redis; bij miss DB-fetch + write-through. Verser maar +1-3ms per request. | |
| DB-fetch per request | Geen cache; elke request 5-10ms DB-latency × honderden RLS-checks per pagina. Niet aanbevolen. | |
| Hybride: JWT voor role, DB-fetch voor scope-arrays | role in JWT (verandert zelden), academyIds/linkedPlayerIds DB-fetch (verandert via TD zonder login-cycle). Combineert verse scope met snelle role-check. | |

**User's choice:** Optie 1 (JWT-claim + 15 min staleness).
**Notes:** Staleness-trade-off geaccepteerd: scope-uitbreiding (extra academie, parent-link) ziet user na max 15 min of bij re-auth; scope-inperking (rol verlaagd, link verbroken) wordt direct via Redis-revocation-lijst afgedwongen — middleware checkt `revoked:{user_id}` per request (sub-ms lookup). Dit maakt Redis tot vereiste dependency, wat doorvoert naar D.

Integratietests per rol-resource-combinatie (35 minimum: 7 rollen × 5 resources) verplicht vóór Fase 2 mag starten — falen blokkeert merge.

---

## D. Rate limit + Redis backend

| Optie | Beschrijving | Gekozen |
|-------|--------------|---------|
| Upstash Redis (managed, EU) (Recommended) | Managed Redis EU; ~€10–20/mnd; @upstash/ratelimit-package; dient ook revocation, dashboard-cache, BullMQ-queue. | ✓ |
| Self-hosted Redis op Coolify | Redis-container naast app op Hetzner CX31; geen extra factuur, eigen onderhoud. | |
| In-memory token-bucket + Postgres revocation tabel | Geen Redis. Rate limit per replica in-memory; revocation als Postgres tabel. Goedkoopst maar Postgres extra read-load. | |

**User's choice:** Upstash Redis (managed, EU).
**Notes:** Vendor-lock-in beperkt door alle Redis-toegang achter `lib/cache.ts` te abstraheren — vervangen door Hetzner Redis container is een 1-bestand-wijziging. Geen Upstash-specifieke API's gebruiken zonder review. Connectie via `UPSTASH_REDIS_REST_URL` en `UPSTASH_REDIS_REST_TOKEN` als Coolify-secrets.

---

## E. Async job queue (follow-up question)

| Optie | Beschrijving | Gekozen |
|-------|--------------|---------|
| BullMQ op Upstash nu opzetten (Recommended) | Lichtgewicht setup in Fase 1 (worker-template + 1 voorbeeld-job); latere fasen voegen alleen jobs toe. | ✓ |
| Wachten tot Fase 5 | Eerste worker komt bij medical-audit-write; Fase 5 zet primitive op naast feature-werk. | |

**User's choice:** Nu opzetten in Fase 1.
**Notes:** Worker-process-template + one example job (consent-version-bump notification). Worker draait als apart Coolify-service (`web` + `worker`); zelfde codebase, andere entrypoint. Eerste productie-jobs in Fase 5 (medical-read-audit) en Fase 6 (group-message fan-out).

---

## F. Health endpoints (follow-up question)

| Optie | Beschrijving | Gekozen |
|-------|--------------|---------|
| Liveness + readiness gescheiden (Recommended) | `/api/health/live` (alleen process, voor UptimeRobot) + `/api/health/ready` (Postgres + Upstash, voor deploy-gate). | ✓ |
| Eén `/api/health` | Test alles bij elke ping; simpeler maar elke uptime-ping = DB-roundtrip. | |

**User's choice:** Gescheiden endpoints.
**Notes:** Industry-standard Kubernetes-pattern; bruikbaar zonder K8s op Coolify.

---

## Claude's Discretion

Tijdens implementatie/planning ingevuld door Claude (geen user-keuze gevraagd):

- Concrete naamgeving van migration-files, tRPC-router-organisatie, file-tree-structuur
- Exacte schema-namen voor lookup-tabellen (snake_case conventie)
- BullMQ-worker concurrency en retry-policy (sensible defaults: concurrency 5, retry 3× exp backoff)
- Sentry `beforeSend` PII-stripper-regels (geïnformeerd door pino-redact-config)
- Coolify-deployment configuratiedetails (gezondheidscheck-paden, secrets-mapping)

## Deferred Ideas

Genoemd of geïmpliceerd tijdens discussie, vastgelegd voor latere fasen:

- Magic-link login (Better Auth ondersteunt; v1 = e-mail+wachtwoord) — v1.1 op gebruikersfeedback
- 2FA/TOTP — TD-account aanbevolen vanaf v1.1
- OAuth (Google/Microsoft) — niet voor v1; v2 bij KBTTB-integratie
- Audit-log viewer UI — log wordt geschreven in Fase 1, UI in Fase 7 of v1.1
- Rate-limit per role (TD hoger dan player) — v1 uniform; differentiëren bij productie-metriek
- Live-reload van locale-strings (CMS-driven translations) — v2-optie
- Cookie-consent banner — niet nodig: alleen first-party functionele cookies; consent-records dekken data-verwerking, geen cookies
