# Phase 2: Identiteit & Bestanden - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Mode:** Smart-discuss (autonomous, per long-run mandate; recommendations auto-accepted)

<domain>
## Phase Boundary

Fase 2 levert volledige speler- en trainerprofielen met foto-upload en correct gescopede bestandstoegang, zodat het dagelijks beheer van de spelerslijst operationeel is. De fase voegt **`players`**, **`trainers`**, **`trainer_academy_links`**, **`age_category_history`** en **`uploaded_files`** toe aan het schema; bouwt de **upload-pijplijn** met magic-bytes-validatie, MIME-whitelist, ClamAV-malware-scan, en server-side getekende URL's; voorziet **tRPC-routers** `player.*`, `trainer.*`, `file.*`; en levert de eerste echte **UI-oppervlakken** (spelerslijst, spelerprofielformulier, trainerprofielformulier, foto-upload-widget) bovenop de Phase 1 chrome.

Geen domeindata buiten profielen (kalender = Fase 3, toernooien/rankings/evaluaties = Fase 4+, medische records = Fase 5). Geen self-service registratie — TD blijft de enige met `user.create` rechten (uit Phase 1); Phase 2 maakt de profielvelden voor de TD beheerbaar.

</domain>

<decisions>
## Implementation Decisions

### A. File-validation pijplijn architectuur (RISK-FILE-SCOPE + RISK-MALWARE)

- **D-21 (sync vs async scan):** **Async malware scan via BullMQ.** Upload-mutatie valideert size + magic-bytes synchroon, schrijft `uploaded_files` rij met `scan_status='pending'`, plaatst BullMQ-job (`malware-scan` queue), en retourneert `fileId + scanStatus`. Profielfoto's tonen pas op de UI nadat `scan_status='clean'`; `pending` toont placeholder, `infected` toont waarschuwing en blokkeert vervangen door dezelfde gebruiker (audit-log entry geschreven). Sync zou ClamAV's response-tijd (~1–3s op kleine files) op de upload-request leggen — onacceptabel voor UX en faalt onder load.
- **D-22 (scan provider):** **ClamAV daemon als Coolify-sidecar service**, communicerend via `clamd` TCP (poort 3310) op localhost van de worker container. **Niet VirusTotal** — VT verstuurt file-hashes (en bij eerste-zien upload de file zelf) naar de cloud → GDPR-data-residency-risico voor profielfoto's (persoonsgegevens). ClamAV is open-source, fully self-hosted op Hetzner-infra, signature-update-cron via Coolify scheduled job.
- **D-23 (fail-fast plek):** **`file.upload` tRPC mutatie valideert vóór Supabase Storage upload.** Volgorde: (1) Zod input shape, (2) size limit (2 MB profile photos, configurable per endpoint), (3) magic-bytes via `file-type` package — als magic !== claimed MIME → reject 400 BAD_REQUEST. Pas dan upload naar Supabase Storage met UUID filename. Bandbreedte sparen + storage clean houden.
- **D-24 (signed URL TTL):** **1 uur** voor profielfoto's (FILE-01 ROADMAP). RBAC-check vóór elke URL-generatie in `file.getSignedUrl` — kan niet leunen op TTL alleen (RISK-FILE-SCOPE). Cliënt cached signed URLs niet langer dan 50 min (5 min veiligheidsmarge); vraagt nieuwe URL aan bij near-expiry of bij avatar-cycling. Geen "permanent" URL's, ook niet voor publieke surfaces.
- **D-25 (storage path conventie):** Pad-template `profiles/{user_id}/{uuid}.{ext}` (UUID = niet-voorspelbare filename per FILE-04, niet de original filename). `medical/` bucket bestaat al uit Phase 1; Phase 2 schrijft daar nog niet. `profiles/` bucket policies: TD + scope-trainer + eigen-eigenaar; nooit publiek (FILE-03).

### B. Speler-/trainerprofiel schema-ontwerp (PLAYER-01..07, TRAINER-01..03)

- **D-26 (table layout):** **`players` en `trainers` als aparte tabellen, beide via 1:0..1 FK naar `users`.** `players.user_id uuid REFERENCES users(id) ON DELETE CASCADE UNIQUE` + idem voor trainers. Reden: domeinattributen (statuut, leeftijdscategorie, club, diploma, pedagogische kwalificatie) horen niet op de generieke `users` tabel; `users` blijft auth-only (email, role, locale, is_minor). Een persoon kan in theorie zowel speler als trainer zijn (sparring-partner-overlap, oudere speler die assistent wordt) — twee rijen in twee tabellen, één `users` rij. Dit is consistent met het Phase 1 patroon (`academy_memberships`, `parent_child_links` zijn ook satelliet-tabellen rond `users`).
- **D-27 (address):** **Flat kolommen** op `players` en `trainers`: `street`, `street_number`, `postal_code`, `city`, `province`, `country` (allemaal `text NOT NULL` behalve `street_number`). Geen normalisatie naar een `addresses` tabel — adressen zijn 1:1 met de persoon, niet gedeeld, geen zoekvereiste op adresniveau. Eenvoudiger Zod-validatie en form-rendering.
- **D-28 (emergency contact):** **Inline kolommen** op `players` (`emergency_contact_name text`, `emergency_contact_phone text`, `emergency_contact_relation text`). PLAYER-06 vereist één contact voor minderjarigen — geen N:N nodig. **Schema-constraint:** CHECK constraint `(NOT is_minor) OR (emergency_contact_name IS NOT NULL AND emergency_contact_phone IS NOT NULL)` afgedwongen op database-niveau (defense in depth bovenop Zod).
- **D-29 (profielfoto opslag):** **Kolom `profile_photo_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL`** op zowel `players` als `trainers`. Niet een aparte `profile_photos` tabel — alleen huidige foto wordt getoond (PLAYER-05 ROADMAP); replace = oude `uploaded_files` rij krijgt `superseded_at`. Audit-trail van foto-wisselingen via `audit_log` (writeAudit op file replace).
- **D-30 (uploaded_files tabel):** Nieuwe tabel `uploaded_files (id uuid PK, owner_user_id uuid FK users, bucket text, storage_key text UNIQUE, original_filename text, mime_type text, size_bytes bigint, scan_status text CHECK IN ('pending','clean','infected'), scan_completed_at timestamptz, superseded_at timestamptz, uploaded_at timestamptz NOT NULL DEFAULT now())`. Geen `deleted_at` (soft-delete via `superseded_at`). `storage_key` bevat het volledige bucket-pad voor signed URL generation.

### C. Leeftijdscategorie-historiek (DOM-CAT-01)

- **D-31 (initiële categorie bij player.create):** Bij `player.create`: helper `deriveAgeCategory(dateOfBirth, asOfDate)` in `src/lib/players.ts` berekent huidige leeftijdscategorie (lookup uit `age_categories` tabel) op basis van leeftijd op `asOfDate` (default = today). Retourneert `(age_category_code, category_year)`. tRPC mutation schrijft inaugurele `age_category_history` rij **én** zet `players.age_category` + `category_year` op de afgeleide waarden — beide expliciet opgeslagen (PLAYER-04). Geen STORED generated column — leeftijdscategorie kan handmatig overruled worden door TD (bv. talent-promotie).
- **D-32 (categorie-wijziging mutation):** **`player.setAgeCategory(playerId, newCategoryCode, categoryYear, effectiveFrom)`** — alleen TD (`tdProcedure`). Logica: open de huidige `age_category_history` rij waar `effective_to IS NULL`, zet `effective_to = effectiveFrom - 1 day`. Insert nieuwe rij met `(player_id, age_category_code, category_year, effective_from, effective_to=NULL)`. Update `players.age_category` + `category_year` om huidige snapshot te reflecteren. Alles in één Drizzle transaction. Audit-log entry geschreven.
- **D-33 (history query helper):** **`getAgeCategoryAt(playerId, date) → { code, year } | null`** in `src/lib/players.ts`. Reads `age_category_history WHERE player_id = ? AND effective_from <= date AND (effective_to IS NULL OR effective_to >= date)`. Phase 4 toernooi-validatie importeert deze helper en gebruikt `tournament.start_date` als `date`. Index op `(player_id, effective_from DESC, effective_to)` voor query-performance.
- **D-34 (history table primary key):** **`bigserial id` als surrogaat-PK** + UNIQUE constraint op `(player_id, effective_from)` (natuurlijke key). Audit-log entries en eventuele toekomstige correctie-RPC's verwijzen naar de stabiele `id`. CHECK-constraint `effective_to IS NULL OR effective_to >= effective_from` afdwingen.

### D. Trainer-scope afdwinging (USER-04 + TRAINER-03 + RLS)

- **D-35 (scope source):** **Hergebruik van `academy_memberships`** uit Phase 1. RLS op `players` lookt via `players_visible_to(current_user_id(), current_user_role())` SECURITY DEFINER (al gedefinieerd in `0002_rls_functions_and_policies.sql`). De functie heeft een UNION-clausule per rol — Phase 2 voegt het `trainer` UNION-arm toe waar dit nog niet ingevuld is, of bevestigt dat het Phase-1 placeholder daadwerkelijk werkt. Geen aparte `trainer_academy_links` ALS `academy_memberships` (composite PK `user_id + academy_code + role`) al de N:N-koppeling kan dragen — wat het kan: zet `role='trainer'` per academie-koppeling. **GEEN nieuwe junction-tabel — `academy_memberships` IS de junction.** ROADMAP §Schema noemt `trainer_academy_links` als suggestieve naam; Phase 2 mapt dat op het bestaande `academy_memberships`.
- **D-36 (cross-academy scope leak):** **404 NOT_FOUND** in plaats van 403 FORBIDDEN voor `player.get(playerId)` als RLS de rij filtert. Voorkomt enumeration (een trainer kan niet vaststellen of een spelernaam in een andere academie bestaat door het verschil tussen 404 en 403 te observeren). Implementatie: `player.get` returned `null` → tRPC throwed `NOT_FOUND`. RLS doet dit gratis — query returns 0 rows.
- **D-37 (player edit-rechten matrix):**
  - **TD:** alle velden van alle spelers (`tdProcedure`).
  - **Academy manager:** alle velden van spelers in eigen academie (gefilterd via RLS + tRPC route check).
  - **Trainer:** **read-only** voor profielvelden — kan niets editen. PLAYER-07 zegt "TD en academy_manager kunnen view+edit; player kan eigen non-sensitive editen". Trainers zijn niet genoemd als editor; dus expliciet uitgesloten.
  - **Player (self):** `player.updateSelf` accepteert alleen `{ street, street_number, postal_code, city, province, country, phone, email, emergency_contact_name?, emergency_contact_phone?, emergency_contact_relation? }`. Zod schema rejected elk ander veld. **NIET** wijzigbaar door speler: `status_code`, `academy_id`, `age_category`, `category_year`, `dob`, `gender`, `school`, `first_name`, `last_name`, `club` (laatste 4 zijn TD/academy_manager-only).
  - **Parent of minor:** kan kind-profiel zien (USER-04, GDPR-02) — zelfde non-sensitive velden als de speler zelf zou kunnen editen, plus `emergency_contact_*` (parent vult dit in voor minderjarige bij registratie). Implementatie: `player.updateOnBehalfOf(playerId)` route met `parent_child_links` check.
- **D-38 (trainer edit-rechten):** Trainer kan eigen profiel editen (zelfde patroon als speler — alleen niet-gevoelige velden via `trainer.updateSelf`); kan **geen** speler-data editen. TD kan alle trainerprofielen editen.

### E. UI structuur en gebruikerservaring

- **D-39 (routing):** Hergebruik Phase 1 routing-conventie. Nieuwe routes onder `src/app/[locale]/(app)/`:
  - `/players` — TD + academy_manager + trainer zien lijst (gefilterd door RLS)
  - `/players/[id]` — speler-profiel detail (read of edit afhankelijk van rol)
  - `/players/new` — TD-only formulier (nieuwe speler)
  - `/trainers`, `/trainers/[id]`, `/trainers/new` — idem voor trainers (TD-only edit + lijst per rol)
  - `/me/profile` — speler/trainer eigen profiel met enkel non-sensitive editable velden
- **D-40 (Server Components vs Client Components):** **Server Component** voor lijst-pagina's (initial render server-side, hydrated met tRPC `useQuery({initialData})` — zelfde patroon als Phase 1's `admin/users/page.tsx`). **Client Component** voor formulieren (react-hook-form + zod resolver, file-upload widget, optimistic updates). Foto-thumbnail in lijst vraagt signed URL aan via tRPC server-side (geen Bucket-URL leak naar client).
- **D-41 (foto-upload widget):** Zelfgebouwde React component (`src/components/file/photo-upload.tsx`): drag-drop zone + click-to-browse, instant preview client-side (FileReader → object URL), client-side size hint (alleen UX — server is autoritatief), upload via `file.upload` tRPC mutation, polled status (every 2s, max 30s) tot `scan_status` resolved. Geen externe library (geen `react-dropzone`) — gewoon HTML5 drag/drop events. Houdt bundel klein.
- **D-42 (formulier-validatie):** **react-hook-form + zod resolver** (al in Phase 1 `package.json`). Zod schemas voor `playerCreateInput`, `playerSelfUpdateInput`, `trainerCreateInput` etc. gedeeld tussen client (form-validation) en server (tRPC mutatie-input) via `src/server/trpc/schemas/`. Validatie-boodschappen via i18n-keys (I18N-08): zod gebruikt `z.string().min(1, { message: 'errors.field.required' })` waar message een i18n-key is, geresolvd in de UI via `useTranslations('errors')`.
- **D-43 (datepickers + locale):** **shadcn/ui Calendar + Popover combinatie** (lichte wrapper rond react-day-picker dat al in shadcn dependency staat). Locale via `date-fns/locale` per gebruiker (`nl-BE`, `en-GB`, `fr-BE`); placeholder-format en eerste-weekdag (maandag voor alle drie BE-locales) komen uit `src/lib/i18n-format.ts` van Phase 1.

### F. i18n in Phase 2 (I18N-06, I18N-08)

- **D-44 (lookup-labels in catalogs):** Nieuwe lookup-codes (academies, leeftijdscategorieën, statuut, trainerdiploma's) krijgen labels in `messages/{nl,en,fr}.json` onder `lookup.academy.*`, `lookup.age_category.*`, `lookup.status.*`, `lookup.trainer_diploma.*`. DB blijft language-neutral codes (D-19 uit Phase 1). Helper `useLookupLabel(category, code)` (client) en `getLookupLabel(category, code, locale)` (server) hidet de mapping. Lookup-tabellen krijgen pre-seed migration (Phase 2 plan: `0006_lookup_data_seed.sql` of een runtime-seeder als `0006` te vroeg is).
- **D-45 (eigennamen-conventie):** **Academienamen en clubnamen worden 1× canonical opgeslagen en niet vertaald.** Lookup-tabel `academies` heeft kolom `display_name text NOT NULL` (canoniek, bv. `"Topsportschool Wilrijk"`); fr-UI toont identiek `Topsportschool Wilrijk`. Geen `display_name_nl`/`display_name_en`/`display_name_fr` kolommen. Coachnamen idem — opgeslagen op `users.first_name + last_name` zonder per-locale variatie. Documenteer in `docs/i18n-conventions.md`.
- **D-46 (zod messages = i18n keys):** Zod schemas in `src/server/trpc/schemas/*.ts` gebruiken **i18n-keys als message-strings** (`z.string().email({ message: 'errors.email.invalid' })`). Server-side: tRPC error formatter mapt het zod-issue naar `TRPCError` met code `BAD_REQUEST` en `message` = de key + path. Client-side: react-hook-form `formState.errors[field].message` is de key, gerendert via `useTranslations('errors')`. Catalogs `errors.*` zijn een platte map.

### Claude's Discretion
- Concrete migration-bestandnaam-volgorde (volgende beschikbaar = `0006_*`); Drizzle-kit auto-genereert bestandsnaam, executor mag de exacte slug kiezen.
- Of `uploaded_files` een aparte migratie wordt of samen met `players`/`trainers` in één migratie zit — keuze tijdens planning op basis van afhankelijkheden.
- Concrete tRPC-router-bestanden-organisatie binnen `src/server/trpc/routers/`: één bestand per domein (`player.ts`, `trainer.ts`, `file.ts`) of een `profile.ts` aggregator; planner kiest.
- ClamAV Coolify-sidecar Docker-image keuze (`clamav/clamav:stable` vs `mkodockx/docker-clamav`) en signature-update-frequentie (default 24u via cron) — executor mag tijdens implementatie kiezen, gedocumenteerd in `docs/file-upload-pipeline.md`.
- shadcn componenten die toegevoegd moeten worden (DataTable voor lijst, Select voor academie-dropdown, RadioGroup voor statuut, Checkbox voor pedagogische kwalificatie) — executor installeert per `npx shadcn@latest add` per nood.
- Exacte vorm van `file-type` magic-bytes-validatie wrapper (mogelijk een centrale helper `validateUploadMagicBytes(buffer, expectedMimes[])`) — planner/executor kiest.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Core value, constraints (incl. drietalig)
- `.planning/REQUIREMENTS.md` §PLAYER (PLAYER-01..07), §TRAINER (TRAINER-01..03), §FILE (FILE-01..05), §VALID (VALID-01..06), §USER (USER-04 scope), §I18N (I18N-06, I18N-08)
- `.planning/ROADMAP.md` Phase 2 — Doel, 5 succescriteria, Kerntaken (Schema, Bestandsopslag, File validation, tRPC-routers, Leeftijdscategorie-historiek, UI, Validatie-regels, i18n), Risico's (RISK-FILE-SCOPE, RISK-PHOTO-PII, RISK-MALWARE, RISK-CAT-HISTORY)
- `.planning/STATE.md`, `.planning/HANDOFF.md` — projectstatus en cross-phase constraints

### Phase 1 carry-forward (built infrastructure)
- `drizzle/0000_initial.sql` — base schema: `users`, `academy_memberships`, `parent_child_links`, lookups, audit
- `drizzle/0002_rls_functions_and_policies.sql` — RLS-fundament; Phase 2 voegt policies toe voor `players`, `trainers`, `uploaded_files`, `age_category_history`, en breidt `players_visible_to()` uit met de trainer UNION-arm waar dat nog niet ingevuld is
- `src/server/trpc/middleware/freshSession.ts` — `protectedProcedure`, `tdProcedure`, `sensitiveProcedure` presets; Phase 2 hangt `player.*`/`trainer.*`/`file.*` routers eraan op
- `src/lib/cache.ts` — D-14 abstractie; geen direct Upstash-import buiten dit bestand
- `src/server/workers/{connection,queues,index}.ts` — BullMQ template; Phase 2 voegt nieuwe queue `MALWARE_SCAN` en bijbehorende job toe
- `src/lib/log-redact-paths.ts` — pino + Sentry redact paths; Phase 2 voegt `*.emergencyContactPhone`, `*.phone` (al aanwezig) toe waar nieuwe veld-namen nodig zijn
- `src/server/trpc/middleware/audit.ts` — `writeAudit(ctx, entry)`; alle player/trainer/file mutaties moeten audit schrijven (GDPR-04)

### Stack-specifiek (Phase 2 nieuwe deps)
- Supabase Storage Server SDK — `https://supabase.com/docs/reference/javascript/storage` — server-side getekende URL's, bucket-RLS via SQL policies
- `file-type` npm package — `https://github.com/sindresorhus/file-type` — magic-bytes-detectie buffer-based
- ClamAV daemon (clamd) — `https://docs.clamav.net/manual/Usage/Scanning.html` — TCP socket protocol; Node client via `clamscan` package of raw socket
- BullMQ queue + worker — al in Phase 1 (`src/server/workers/`)
- shadcn/ui DataTable, Select, RadioGroup, Calendar, Popover, Form — `https://ui.shadcn.com/docs/components/`
- react-hook-form — `https://react-hook-form.com/get-started`
- next-intl `useTranslations` server + client — al in Phase 1

### GDPR & validation
- VALID-01..06 (REQUIREMENTS.md) — magic bytes, MIME whitelist, malware scan, headers, Zod, no-client-trust
- FILE-01..05 (REQUIREMENTS.md) — signed URLs, separate bucket per category, UUID filenames
- Belgian Patient Rights Act — niet relevant in Phase 2 (geen medical data); wel in Phase 5

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (gebouwd in Phase 1)
- **`src/server/db/schema/{auth,memberships,lookups,consent,audit}.ts`** — base schema patterns; Phase 2 schrijft `players.ts`, `trainers.ts`, `files.ts`, `age_category_history.ts` in dezelfde stijl (snake_case columns, `tstz()` helper voor timestamps, FK ON DELETE rules expliciet)
- **`src/server/trpc/middleware/{rls,freshSession,audit}.ts`** — alle tRPC routes erven RLS-context + audit; Phase 2 routes hangen aan `protectedProcedure`/`tdProcedure`
- **`src/server/auth/permissions.ts`** — Better Auth role permissions; Phase 2 voegt `players:read`, `players:write`, `trainers:read`, `trainers:write`, `files:upload`, `files:read` toe
- **`src/lib/consent.ts`** — sha256 + snapshot pattern voor file-upload-similar audit semantics (referentiepatroon)
- **`src/lib/i18n-format.ts`** — date-fns + Intl per locale; datepickers gebruiken het
- **`src/components/admin/user-table.tsx`** — DataTable pattern; player-table en trainer-table volgen dit (Server Component → tRPC initialData → useQuery refetch)
- **`src/components/i18n/locale-switcher.tsx`** — locale-bewust component pattern
- **`messages/{nl,en,fr}.json`** — 155 lijnen elk; Phase 2 voegt sleutels onder `players.*`, `trainers.*`, `files.*`, `lookup.*`, `errors.*`

### Established Patterns
- Drizzle migration discipline: nieuw bestand `drizzle/000N_*.sql` + companion `000N_*.rollback.md` met `**Risk:**`/`**Procedure:**`/`**Verification:**` sectie-markers (MIG-05, gehandhaafd door `tests/unit/migration-format.test.ts`)
- ESLint regels uit Phase 1 blijven van kracht: geen bare `timestamp({withTimezone:false})` (GDPR-08); geen `@upstash/redis` import buiten `src/lib/cache.ts` (D-14); geen direct `process.env` (alle env via `src/lib/env.ts`)
- tRPC route convention: één router per `src/server/trpc/routers/<domain>.ts`; geregistreerd in `_app.ts`
- Zod schemas leven in `src/server/trpc/schemas/<domain>.ts` en worden geïmporteerd door **zowel** server (tRPC input) **als** client (react-hook-form resolver)
- Server Component page.tsx patroon: hydreer initial data via tRPC caller, render shadcn DataTable; client refetcht na mutaties
- Audit-log: `writeAudit(ctx, { action, resource, resourceId, ...meta })` op elke create/update/delete; rls-bound transaction zorgt dat audit-row dezelfde snapshot heeft als de mutatie

### Integration Points
- **Supabase Storage**: bucket `profiles/` bestaat al (aangemaakt in Phase 1 setup); Phase 2 voegt RLS policies toe via Drizzle migration (`0007_storage_policies_profiles.sql`)
- **Coolify deploy**: ClamAV sidecar service moet aan `docker-compose.yml` (of Coolify-equivalent) toegevoegd worden; documenteer in `docs/deployment.md`
- **CI**: bestaande `.github/workflows/ci.yml` lint+typecheck+vitest+e2e blijft draaien; Phase 2 voegt RBAC-matrix-tests toe (uitbreiding van Phase 1's 7×5 D-11 matrix met `players` en `trainers` resource types → 7×7 = 49 tests)
- **`src/server/auth/auth.ts`**: `admin.user.create` (Phase 1) + Phase 2's `player.create` worden ge-coördineerd: TD maakt user account + player profile in één tRPC mutation `player.create` die intern beide tabellen vult in een transactie
- **i18n catalogs**: nieuwe sleutels in alle drie de bestanden in parallel; CI-gate (Phase 8) zal ontbrekende sleutels detecteren

</code_context>

<specifics>
## Specific Ideas

- **404 NOT_FOUND voor cross-scope queries** — niet 403 FORBIDDEN, om enumeration te voorkomen (D-36).
- **`uploaded_files` tabel als single source of truth voor alle uploads** — profielfoto's nu, evaluatie-attachments in Phase 4, medical documents in Phase 5 hangen er straks aan met scoped buckets.
- **`academy_memberships` IS de junction-tabel voor trainers** — niet een nieuwe `trainer_academy_links`. ROADMAP suggestie wordt gemapt op bestaande Phase 1 infra.
- **Initiële leeftijdscategorie afgeleid bij player.create maar expliciet opgeslagen** — afwijkt van naïeve "afleiden bij elke query" patroon; PLAYER-04 wil expliciet veld.
- **Async malware-scan via BullMQ in plaats van sync** — UX-eis + voorkomt dat upload-request hangt onder load.
- **ClamAV self-hosted, NIET VirusTotal** — GDPR data-residency.

</specifics>

<deferred>
## Deferred Ideas

- **Profielfoto-cropping/resizing client-side** — v1 accepteert wat ge-upload wordt (max 2MB). Image-processing (thumbnail generation, EXIF-strippen) eventueel in v1.1 als BullMQ-job na clean-scan.
- **Trainer-team mutaties (multiple trainers per academie)** — `academy_memberships` ondersteunt N:N nu al; UI om bulk-toe te wijzen verschuift naar v1.1 als TD-tool.
- **Avatar-componenten met fallback initialen** — eenvoudige `<Avatar>` shadcn component is genoeg; gepersonaliseerde fallbacks (kleur per academie) zijn v1.1.
- **File-versie-historiek (oude foto's blijven raadpleegbaar)** — `superseded_at` ondersteunt het al schema-niveau; UI om oude foto's te zien is uit Phase 2 scope (niet in succescriteria).
- **EXIF-data extraction (camera-model, geo-tag) voor metadata** — niet relevant voor profielfoto's; mogelijk relevant voor video in Phase 5+.
- **Drag-and-drop herordenen van speler-lijst** — sortering via DataTable column headers volstaat; v1.1 als TD het echt wil.
- **Bulk-upload van speler-CSV** — niet in scope; TD vult per speler in via UI.
- **Pasfoto detectie / face-validation** — niet relevant; profielfoto is een sociale feature, niet een ID-document.

</deferred>

---

*Phase: 02-Identiteit & Bestanden*
*Context gathered: 2026-05-06*
