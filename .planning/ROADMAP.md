# Roadmap — VTTL Topsportplatform

*Aangemaakt: 2026-05-01 | Bron: PROJECT.md + REQUIREMENTS.md + research/SUMMARY.md*

---

## Overzicht

| Fase | Naam | UI? | Parallel? | Vereisten |
|------|------|-----|-----------|-----------|
| 1 | Fundament | Nee | Nee | AUTH-01..05, USER-01..05, GDPR-01..08 |
| 2 | Identiteit & Bestanden | Ja | Nee | PLAYER-01..07, TRAINER-01..03, FILE-01..05 |
| 3 | Kalender | Ja | Nee | CAL-01..08 |
| 4 | Kerndomein | Ja | Ja (intern) | TRAIN-01..06, TOURN-01..06, RANK-01..07 |
| 5 | Uitgebreid domein | Ja | Ja (intern) | SPAR-01..04, AMB-01..04, EVAL-01..06, MED-01..06, AGE-01..04 |
| 6 | Communicatie | Ja | Nee | MSG-01..05 |
| 7 | Synthese | Ja | Nee | VIEW-01..05, SEARCH-01..02 |
| 8 | Kwaliteit & Release | Nee | Ja (intern) | CAL-06 (ICS), productieklaar |

---

## Fase 1 — Fundament

### Doel
Het fundament is klaar wanneer een technisch directeur kan inloggen met een gescopede sessie, RLS alle data afschermt op databaseniveau, en het GDPR-schema klaar staat voor alle vervolgfasen.

### Vereisten
AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, USER-01, USER-02, USER-03, USER-04, USER-05, GDPR-01, GDPR-02, GDPR-03, GDPR-04, GDPR-07, GDPR-08

> GDPR-05 en GDPR-06 (portabiliteitsexport + wissing-UI) worden technisch ontworpen in deze fase maar als UI afgewerkt in Fase 7.

### Succescriteria
1. Een technisch directeur kan inloggen; na browserherstart is de sessie nog actief.
2. Een gebruiker met de rol 'trainer' krijgt een 403-respons bij directe API-aanroep naar data van een andere academie — ook zonder omzeiling via de UI.
3. Een directe PostgreSQL-query als niet-eigenaar op `medical_events` retourneert nul rijen — RLS blokkeert zonder uitzondering.
4. De `audit_log` bevat een leesregistratie bij elke toegang tot een medisch record, met actor, actie, tijdstip en IP.
5. Een testgebruiker jonger dan 16 jaar kan geen account voltooien zonder een gekoppeld ouderaccount met gegeven toestemming.

### Kerntaken
- Databasemigratiebestand 001: volledige schemadefinitie — `users`, `sessions`, `roles`, `academy_memberships`, `parent_child_links`, lookup-tabellen (status A/B/C, academies, tornooitypes, rankingtypes, trainingtypes, organisaties, uitkomstlevels), `consent_records`, `audit_log`
- Databasemigratiebestand 002: medisch-geïsoleerde tabelgroep — `medical_events`, `medical_documents` met eigen RLS-policies en auditeer-trigger
- PostgreSQL RLS inschakelen op alle tabellen; `players_visible_to(caller_id)` hulpfunctie schrijven
- CallerContext implementeren als tRPC-middleware: `{ userId, role, academyIds, linkedPlayerIds }` injecteerbaar in elke query
- Better Auth configureren: e-mail+wachtwoord login, sessiemanagement, wachtwoordreset via e-mail
- AUTH-04/AUTH-05: TD-paneel voor gebruikersbeheer (accounts aanmaken, activeren, deactiveren, rollen toewijzen)
- GDPR-toestemmingsmodel implementeren: gelaagde toestemming bij registratie (operationele data, medische verwerking, foto/video-gebruik) met versie + tijdstip
- Belgisch minderjarigen-toestemmingspad (< 16 jaar): ouderaccount verplicht vóór activering speleraccount
- `TIMESTAMPTZ` + UTC-conventie afdwingen via Drizzle-schema-interceptor of lint-regel
- Technische documentatie: erasurestrategie (anonimiseer vs. verwijder) vastleggen vóór eerste migratie

### Afhankelijkheden
Geen — dit is de basis.

### Risico's
- **RISK-SCHEMA**: Elke fout in de RLS-policies of het medisch isolatieontwerp vereist latere migraties die geïmplementeerde features kunnen doorbreken. Het schema moet in één keer goed zijn.
- **RISK-CALLERCONTEXT**: Een onjuist gevulde CallerContext lekt data via later gebouwde routers. Valideer met integratietests per rol vóór Fase 2.
- **RISK-CONSENT**: Het toestemmingsmodel moet GDPR Art. 7 + 8 dekken; juridische review aanbevolen vóór productie.

### Parallelliseerbaar?
Nee — alle teams werken op hetzelfde kritieke pad: schema → RLS → auth → CallerContext.

### UI?
Beperkt — alleen de login-pagina, wachtwoordreset-flow, en het TD-gebruikersbeheer-paneel. Geen complexe UI.

---

## Fase 2 — Identiteit & Bestanden

### Doel
Het platform heeft volledige speler- en trainerprofielen met foto-upload en correct gescopede bestandstoegang, zodat het dagelijks beheer van de spelerslijst operationeel is.

### Vereisten
PLAYER-01, PLAYER-02, PLAYER-03, PLAYER-04, PLAYER-05, PLAYER-06, PLAYER-07, TRAINER-01, TRAINER-02, TRAINER-03, FILE-01, FILE-02, FILE-03, FILE-04, FILE-05

### Succescriteria
1. Een technisch directeur kan een volledig spelerprofiel aanmaken met foto; het profiel is direct zichtbaar in de spelerslijst.
2. Een trainer ziet alleen spelers van de academies waaraan hij/zij is toegewezen — niet de volledige lijst.
3. Een speler kan zijn eigen niet-gevoelige velden bewerken (adres, telefoon, e-mail) maar niet zijn status of academie.
4. Profielfoto's zijn alleen opvraagbaar via getekende URL's; een directe bucket-URL geeft een 403.
5. Noodcontactgegevens zijn aanwezig op het profiel van elke minderjarige speler — het systeem blokkeert opslaan als dit ontbreekt.

### Kerntaken
- Drizzle-schema voor `players` en `trainers` (alle velden uit PLAYER-01..04, TRAINER-01..02)
- Junction-tabel `trainer_academy_links` (N-op-N)
- tRPC-routers: `player.create`, `player.update`, `player.get`, `player.list`; `trainer.create`, `trainer.update`, `trainer.get`, `trainer.list`
- Cloudflare R2-opslagconfiguratie: twee buckets/prefixen — `profiles/` (toegankelijk voor geauthenticeerde gebruikers met rol) en `medical/` (striktere policies, Fase 5)
- Server-side getekende URL-generatie voor alle bestandsdownloads (FILE-01)
- Foto-uploadflow via server-side presigned POST → R2 → UUID-bestandsnaam (FILE-04)
- Spelersprofiel-UI: formulier met alle velden, foto-upload-widget, academie-dropdown (lookup), statusveld
- Trainerprofiel-UI: formulier, diploma-dropdown, pedagogische kwalificatie-toggle, academiekoppelingen
- Spelerslijst-UI: tabelweergave met scoping op basis van CallerContext
- Validatie: club ≠ academie schema-afdwinging (PLAYER-03); noodcontact verplicht voor minderjarigen (PLAYER-06)

### Afhankelijkheden
Fase 1 volledig afgerond — CallerContext, RLS, en auth zijn vereist.

### Risico's
- **RISK-FILE-SCOPE**: Getekende URL-generatie heeft server-side rolvalidatie nodig bij elke URL-aanvraag. Toegangscontrole mag niet vertrouwen op URL-vervalingtijden alleen.
- **RISK-PHOTO-PII**: Profielfoto's zijn persoonsgegevens onder GDPR; apart opslaan in `profiles/`-prefix met eigen policy (FILE-03) is verplicht — niet samen met medische documenten.

### Parallelliseerbaar?
Nee — speler- en trainerprofielen zijn fundamenteel voor alle vervolgdomeinen.

### UI?
Ja — spelersprofiel-formulier, trainerprofiel-formulier, spelerslijst, foto-upload-interactie.

---

## Fase 3 — Kalender

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

## Fase 4 — Kerndomein

### Doel
De drie centrale sportdomeinen — trainingen, toernooien en rankings — zijn volledig operationeel, zodat een speler zijn dagelijkse training kan registreren, toernooiresultaten kan invoeren en de rangschikking-evolutie kan zien.

### Vereisten
TRAIN-01, TRAIN-02, TRAIN-03, TRAIN-04, TRAIN-05, TRAIN-06, TOURN-01, TOURN-02, TOURN-03, TOURN-04, TOURN-05, TOURN-06, RANK-01, RANK-02, RANK-03, RANK-04, RANK-05, RANK-06, RANK-07

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
- tRPC-routers: `tournament.create` (TD only), `tournament.list`, `result.enterFinalRanking` (eigen speler only), `result.enterMatchResult` (eigen speler only)
- API-gate: eigenaarschapsvalidatie via CallerContext op elk `result.*`-endpoint
- UI: toernooilijst, eindrangschikking-invoer, per-wedstrijd invoer (ronde, tegenstander, score, video-link)

**Rankingmodule (parallel uitvoerbaar):**
- Schema: `ranking_entries` (speler, type, datum, waarde) — pure tijdreeks, geen flat field op `players`
- Rankingtype-metadata: richting (lager = beter voor wereld/Europees; te bevestigen voor België — RISK-02)
- tRPC-routers: `ranking.addEntry`, `ranking.getHistory`, `ranking.getCurrentByType`
- UI: ranking-invoerformulier, lijndiagram per type (FullCalendar-stijl of recharts/chart.js)

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

## Fase 5 — Uitgebreid domein

### Doel
Alle ondersteunende sportdomeinen — sparringpartners, ambities, evaluaties, medische opvolging, vergaderingen, stages en evaluatiegesprekken — zijn operationeel, waarmee het dagelijkse sportbeheerpakket compleet is.

### Vereisten
SPAR-01, SPAR-02, SPAR-03, SPAR-04, AMB-01, AMB-02, AMB-03, AMB-04, EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, EVAL-06, MED-01, MED-02, MED-03, MED-04, MED-05, MED-06, AGE-01, AGE-02, AGE-03, AGE-04

### Succescriteria
1. Een TD kan een sparringpartner aanmaken en koppelen aan meerdere trainingssessies; een sparringpartner ziet na login alleen zijn/haar eigen kalenderevents.
2. Een TD stelt ambities in voor een speler per jaar per tornooitype; het systeem toont automatisch de vergelijking ambitie vs. werkelijk resultaat — inclusief "nog niet gespeeld" voor toernooien zonder resultaat.
3. Een trainer maakt een evaluatie aan met gescoorde evaluatiepunten; de labeltekst op elk punt is vastgelegd als snapshot op het moment van aanmaak — wijzigingen aan de configuratie van de TD raken bestaande evaluaties niet.
4. Een coach ziet alleen het rood/oranje/groen blessure-indicatielampje voor een speler; de volledige medische fiche is onzichtbaar zonder de bijbehorende rol.
5. Een stage is aangemaakt door de TD met deelnemende spelers en trainers; het event verschijnt correct op de kalender van alle deelnemers.

### Kerntaken

**Sparringpartners (parallel uitvoerbaar):**
- Schema: `sparring_partners`-tabel (naam, foto, telefoon, e-mail); junction `session_sparring_partners` al aangemaakt in Fase 4
- tRPC-routers: `sparringPartner.create` (TD only), `sparringPartner.update`, `sparringPartner.list`
- SPAR-04: CallerContext-check in `calendar.list` voor sparringpartnerrol — alleen eigen sessies
- UI: sparringpartner-register (lijst + formulier), koppeling aan sessies

**Ambities (parallel uitvoerbaar):**
- Schema: `ambitions` (speler, jaar, tornooitype, minimum-uitkomstniveau)
- tRPC-router: `ambition.set`, `ambition.compareWithResults` — LEFT JOIN op `tournament_results`
- AMB-03: "nog niet gespeeld"-geval expliciet behandeld in query (LEFT JOIN retourneert NULL → vertaald naar tekst in serviclaag)
- UI: ambities-formulier per jaar per tornooitype, vergelijkingstabel (ambitie vs. resultaat)

**Evaluaties (parallel uitvoerbaar):**
- Schema: `evaluations`, `evaluation_scores` (FK naar `evaluation_points` + snapshot-labelveld), `evaluation_points` (configureerbaar, soft-delete)
- tRPC-routers: `evaluation.create`, `evaluation.list`, `evaluationPoint.configure` (TD only)
- EVAL-03: snapshot-logica — bij aanmaken evaluatie, kopieer huidige label naar `evaluation_scores.label_snapshot`
- Bijlage-upload: via R2, getekende URL, toegankelijk voor trainer + TD + betrokken speler (FILE-05)
- UI: evaluatieformulier, configuratiescherm evaluatiepunten (TD), spelersevaluatielijst

**Medische opvolging (parallel uitvoerbaar):**
- Schema: `medical_events` (al ontworpen in Fase 1, nu gevuld); `medical_documents` (bijlagen, aparte bucket-prefix)
- tRPC-routers: `medical.create`, `medical.update`, `medical.list` — alleen eigen of TD-scope
- MED-04: `medical.getInjuryStatus`-endpoint retourneert uitsluitend traffic-light enum (groen/oranje/rood); nooit medische vrije tekst
- GDPR-04: audit-log trigger al aanwezig uit Fase 1; valideer dat elke `medical.list`-aanroep schrijft
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

## Fase 6 — Communicatie

### Doel
Intern berichtenverkeer is operationeel — trainers en de TD kunnen spelers en groepen bereiken; spelers ontvangen in-app-meldingen en optionele e-mailmeldingen.

### Vereisten
MSG-01, MSG-02, MSG-03, MSG-04, MSG-05

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
- In-app-melding via Soketi (self-hosted): push event bij nieuw bericht naar geabonneerde gebruiker
- E-mailmelding: optioneel per gebruiker, via transactionele e-maildienst (EU-gebaseerd) — gebruikersvoorkeur opgeslagen
- Bijlage-upload: R2 + getekende URL, aparte prefix `messages/`
- UI: inbox, verzonden berichten, berichtopsteller met ontvangerselectie (individueel + groep), reply/forward, bijlage-upload, ongelezen-badge in navigatie

### Afhankelijkheden
Fase 1 (gebruikers en rollen), Fase 2 (speler-/trainersprofielen voor ontvangerselectie), Fase 5 (groepsdefinities volledig gevuld).

### Risico's
- **RISK-GROUP-SEND**: Groepsverzending naar grote groepen (bijv. alle spelers + alle trainers) kan honderden rijen genereren. Job queue is verplicht; synchrone verzending is geen optie.
- **RISK-REALTIME**: Soketi vereist een aparte service-implementatie op Coolify. Test de WebSocket-verbinding vroeg — fallback naar polling als Soketi niet stabiel is.

### Parallelliseerbaar?
Nee — berichtenverkeer vereist de volledige gebruikers-, profiel- en groepsinfrastructuur.

### UI?
Ja — de volledige berichteninterface is een substantieel UI-onderdeel.

---

## Fase 7 — Synthese

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

## Fase 8 — Kwaliteit & Release

### Doel
Het platform is productierijp: ICS-export werkt, prestatietests zijn geslaagd, de GDPR DPIA is uitgevoerd, de beveiligingsaudit is afgerond, en de applicatie draait stabiel op Coolify/Hetzner.

### Vereisten
CAL-06 (ICS-export), plus niet-functionele vereisten: prestaties, beveiliging, GDPR DPIA, productie-deployment.

> Alle v1 functionele vereisten zijn afgedekt in Fasen 1–7. Fase 8 is de kwaliteitspoort naar productie.

### Succescriteria
1. ICS-export per gebruiker genereert een geldig `.ics`-bestand dat correct importeert in Outlook, Google Calendar en Apple Calendar.
2. Een loadtest simuleert 50 gelijktijdige gebruikers; P95-responstijd voor de kalenderweergave < 800ms; dashboardquery < 2s.
3. De GDPR DPIA is gedocumenteerd en ondertekend; verwerkingsactiviteiten, gegevenscategorieën, bewaartermijnen en rechtsgrondslagen zijn volledig ingevuld.
4. De beveiligingsaudit (OWASP Top 10 beoordeling) heeft geen openstaande High of Critical bevindingen.
5. De productieomgeving op Hetzner/Coolify draait met automatische HTTPS, databaseback-ups elke 6 uur, en een gedocumenteerd rollback-procedure.

### Kerntaken
- CAL-06: ICS/iCal-exportendpoint per gebruiker — genereer `.ics` op basis van `calendar_events` binnen de CallerContext-scope
- Valideer ICS-output in Outlook 365, Google Calendar, Apple Calendar
- Loadtest met k6 of Locust: kalenderweergave, spelersprofiel, dashboard-query — P95-drempelwaarden documenteren
- Database query-analyse: EXPLAIN ANALYZE op kritieke queries (kalender, dashboard, zoeken); indices toevoegen/aanpassen
- GDPR DPIA: documenteer gegevensverwerkingsactiviteiten, gegevenscategorieën, bewaartermijnen, rechtsgrondslagen, betrokken verwerkers (Cloudflare, Hetzner), betrokkenenrechten
- Beveiligingsaudit: OWASP Top 10 beoordeling — focus op injectie, broken access control, security misconfiguration, cryptographic failures
- Productie-Coolify-configuratie: SSL/TLS (Let's Encrypt), PostgreSQL met dagelijkse back-ups naar offsite opslag, omgevingsvariabelen via Coolify Secrets, health checks
- Monitoring: applicatie-foutlogging (Sentry of gelijkwaardig), database-prestatiestatistieken, uptime-monitoring
- DPA-verificatie: bevestig dat Data Processing Agreements zijn afgesloten met Cloudflare (R2) en Hetzner
- Definitieve UX-revisie: taalconsistentie (Dutch-only), foutberichten in het Nederlands, formuliervalidatieteksten
- Documenteer RISK-01 (scan-uploads) en RISK-02 (Belgium Ranking-richting) als opgeloste of uitgestelde v2-items

### Afhankelijkheden
Alle Fasen 1–7 volledig en productioneel stabiel.

### Risico's
- **RISK-DPIA-DELAY**: De DPIA vereist juridische input en kan niet volledig intern worden uitgevoerd. Plan externe DPO-review minimaal 2 weken voor de geplande livegang.
- **RISK-ICS-COMPAT**: ICS-formaat heeft subtiele compatibiliteitsproblemen tussen kalenderclients. Test vroeg in de fase; gebruik een gevalideerde ICS-bibliotheek.
- **RISK-PERF-SURPRISE**: Prestatieknelpunten verschijnen vaak pas bij realistisch testdatavolume. Vul de database met representatief volume (bijv. 100 spelers × 3 jaar data) vóór de loadtest.

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
