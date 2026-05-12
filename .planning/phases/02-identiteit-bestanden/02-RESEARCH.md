# Phase 2: Identiteit & Bestanden — Research

**Researched:** 2026-05-06
**Domain:** Profile schema (players + trainers) + Supabase Storage upload pipeline + magic-bytes/MIME/malware validation + age-category temporal history + RLS scope expansion + i18n forms (Zod-keys) + drietalig lookup labels.
**Confidence:** HIGH on every Phase-1-carry-forward and verified-version finding; MEDIUM on a handful of integration patterns flagged below; one ASSUMED claim (Belgian age-category birth-year ranges).

## Summary

Phase 2 sits cleanly on top of the Phase-1 fundament — every primitive it needs (Better Auth + Drizzle + RLS GUC binding + tRPC procedure presets + BullMQ on ioredis + Upstash cache abstraction + audit middleware + 3 message catalogs + lookup tables with `canonical_name`) already exists in `src/`. The phase is **not greenfield**: it is "extend the schema, add three tRPC routers, wire one new BullMQ queue (`malware-scan`), introduce `@supabase/supabase-js` server-side for signed URL generation, and ship five route surfaces with read-only/edit/create variants per role." [VERIFIED: codebase grep — Phase 1 plans 01–18 all marked complete; all 18 SUMMARY.md present; `package.json` already has `file-type@^22`, `bullmq@^5.76`, `@hookform/resolvers@^5`, `react-hook-form@^7`, `drizzle-orm@^0.45`].

Two **new** dependencies must be added: `@supabase/supabase-js@^2.105` (for `createSignedUrl` + server-side Storage SDK) and `clamscan@^2.4` (Node client wrapping clamd over TCP). Everything else is configuration and Drizzle migrations. [VERIFIED: `npm view @supabase/supabase-js version` → 2.105.3, `npm view clamscan version` → 2.4.0, both 2026-05].

Three architectural risks that must be made explicit so plans don't paper over them:

1. **`players_visible_to()` already has a working trainer/academy_manager UNION-arm** (read `drizzle/0002_rls_functions_and_policies.sql` lines 109–116) — Phase 2 does NOT need to add that arm. The function returns `users.id`, but Phase 2 wants `players` rows scoped on `players.user_id = users.id`. Plans must extend RLS to `players` table by **calling the existing function from new policies**, not re-implement the join. [VERIFIED: read `drizzle/0002_rls_functions_and_policies.sql` lines 86–129].
2. **D-35 says "no new junction table — `academy_memberships` IS the junction"** — but the seed flow assumes `role='trainer'` rows can be inserted via `admin.user.linkAcademy` (already implemented in `src/server/trpc/routers/admin.ts` lines 372–402). Phase 2 just consumes this. [VERIFIED: read `src/server/trpc/routers/admin.ts` lines 372–402].
3. **`uploaded_files` is the FIRST file table in this codebase**. There is no precedent in Phase 1 except `medical_documents` (which lives in the medical-isolated schema and is empty — no app code reads it yet). Phase 2 must establish the pattern that Phases 4 (evaluation attachments) and 5 (medical scans, message attachments) will reuse. Get the column shape, the bucket-prefix convention, the signed-URL TTL pattern, and the audit-trail of file replacement right now. [VERIFIED: read `drizzle/0001_medical_isolated.sql` — `medical_documents` exists with `storage_key` text but no Phase-1 code references it].

**Primary recommendation:** Build the upload pipeline as a single 4-step transaction-aware path — Zod input validation → `file-type` magic-bytes check on `Buffer` → `uploaded_files` row INSERT with `scan_status='pending'` + UUID `storage_key` → server-side `supabase.storage.from('profiles').upload()` (service-role client, bypasses storage RLS) → enqueue BullMQ `malware-scan` job. Profile-photo display reads `uploaded_files.scan_status` and only resolves a signed URL via `file.getSignedUrl` when status is `'clean'`. The `player.create`/`trainer.create` mutations do NOT do any file work themselves — they accept `profile_photo_file_id?: uuid` (already-uploaded), keeping the upload concern in `file.upload`. This composition is what shadcn `<PhotoUpload>` needs from the API contract (UI-SPEC §Photo Upload Widget steps 5–7).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**A. File-validation pijplijn architectuur (RISK-FILE-SCOPE + RISK-MALWARE)**

- **D-21 (sync vs async scan):** **Async malware scan via BullMQ.** Upload-mutatie valideert size + magic-bytes synchroon, schrijft `uploaded_files` rij met `scan_status='pending'`, plaatst BullMQ-job (`malware-scan` queue), en retourneert `fileId + scanStatus`. Profielfoto's tonen pas op de UI nadat `scan_status='clean'`; `pending` toont placeholder, `infected` toont waarschuwing en blokkeert vervangen door dezelfde gebruiker (audit-log entry geschreven). Sync zou ClamAV's response-tijd (~1–3s op kleine files) op de upload-request leggen — onacceptabel voor UX en faalt onder load.
- **D-22 (scan provider):** **ClamAV daemon als Coolify-sidecar service**, communicerend via `clamd` TCP (poort 3310) op localhost van de worker container. **Niet VirusTotal** — VT verstuurt file-hashes (en bij eerste-zien upload de file zelf) naar de cloud → GDPR-data-residency-risico voor profielfoto's (persoonsgegevens). ClamAV is open-source, fully self-hosted op Hetzner-infra, signature-update-cron via Coolify scheduled job.
- **D-23 (fail-fast plek):** **`file.upload` tRPC mutatie valideert vóór Supabase Storage upload.** Volgorde: (1) Zod input shape, (2) size limit (2 MB profile photos, configurable per endpoint), (3) magic-bytes via `file-type` package — als magic !== claimed MIME → reject 400 BAD_REQUEST. Pas dan upload naar Supabase Storage met UUID filename. Bandbreedte sparen + storage clean houden.
- **D-24 (signed URL TTL):** **1 uur** voor profielfoto's (FILE-01 ROADMAP). RBAC-check vóór elke URL-generatie in `file.getSignedUrl` — kan niet leunen op TTL alleen (RISK-FILE-SCOPE). Cliënt cached signed URLs niet langer dan 50 min (5 min veiligheidsmarge); vraagt nieuwe URL aan bij near-expiry of bij avatar-cycling. Geen "permanent" URL's, ook niet voor publieke surfaces.
- **D-25 (storage path conventie):** Pad-template `profiles/{user_id}/{uuid}.{ext}` (UUID = niet-voorspelbare filename per FILE-04, niet de original filename). `medical/` bucket bestaat al uit Phase 1; Phase 2 schrijft daar nog niet. `profiles/` bucket policies: TD + scope-trainer + eigen-eigenaar; nooit publiek (FILE-03).

**B. Speler-/trainerprofiel schema-ontwerp (PLAYER-01..07, TRAINER-01..03)**

- **D-26 (table layout):** **`players` en `trainers` als aparte tabellen, beide via 1:0..1 FK naar `users`.** `players.user_id uuid REFERENCES users(id) ON DELETE CASCADE UNIQUE` + idem voor trainers. Reden: domeinattributen (statuut, leeftijdscategorie, club, diploma, pedagogische kwalificatie) horen niet op de generieke `users` tabel; `users` blijft auth-only (email, role, locale, is_minor). Een persoon kan in theorie zowel speler als trainer zijn (sparring-partner-overlap, oudere speler die assistent wordt) — twee rijen in twee tabellen, één `users` rij. Dit is consistent met het Phase 1 patroon (`academy_memberships`, `parent_child_links` zijn ook satelliet-tabellen rond `users`).
- **D-27 (address):** **Flat kolommen** op `players` en `trainers`: `street`, `street_number`, `postal_code`, `city`, `province`, `country` (allemaal `text NOT NULL` behalve `street_number`). Geen normalisatie naar een `addresses` tabel — adressen zijn 1:1 met de persoon, niet gedeeld, geen zoekvereiste op adresniveau. Eenvoudiger Zod-validatie en form-rendering.
- **D-28 (emergency contact):** **Inline kolommen** op `players` (`emergency_contact_name text`, `emergency_contact_phone text`, `emergency_contact_relation text`). PLAYER-06 vereist één contact voor minderjarigen — geen N:N nodig. **Schema-constraint:** CHECK constraint `(NOT is_minor) OR (emergency_contact_name IS NOT NULL AND emergency_contact_phone IS NOT NULL)` afgedwongen op database-niveau (defense in depth bovenop Zod).
- **D-29 (profielfoto opslag):** **Kolom `profile_photo_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL`** op zowel `players` als `trainers`. Niet een aparte `profile_photos` tabel — alleen huidige foto wordt getoond (PLAYER-05 ROADMAP); replace = oude `uploaded_files` rij krijgt `superseded_at`. Audit-trail van foto-wisselingen via `audit_log` (writeAudit op file replace).
- **D-30 (uploaded_files tabel):** Nieuwe tabel `uploaded_files (id uuid PK, owner_user_id uuid FK users, bucket text, storage_key text UNIQUE, original_filename text, mime_type text, size_bytes bigint, scan_status text CHECK IN ('pending','clean','infected'), scan_completed_at timestamptz, superseded_at timestamptz, uploaded_at timestamptz NOT NULL DEFAULT now())`. Geen `deleted_at` (soft-delete via `superseded_at`). `storage_key` bevat het volledige bucket-pad voor signed URL generation.

**C. Leeftijdscategorie-historiek (DOM-CAT-01)**

- **D-31 (initiële categorie bij player.create):** Bij `player.create`: helper `deriveAgeCategory(dateOfBirth, asOfDate)` in `src/lib/players.ts` berekent huidige leeftijdscategorie (lookup uit `age_categories` tabel) op basis van leeftijd op `asOfDate` (default = today). Retourneert `(age_category_code, category_year)`. tRPC mutation schrijft inaugurele `age_category_history` rij **én** zet `players.age_category` + `category_year` op de afgeleide waarden — beide expliciet opgeslagen (PLAYER-04). Geen STORED generated column — leeftijdscategorie kan handmatig overruled worden door TD (bv. talent-promotie).
- **D-32 (categorie-wijziging mutation):** **`player.setAgeCategory(playerId, newCategoryCode, categoryYear, effectiveFrom)`** — alleen TD (`tdProcedure`). Logica: open de huidige `age_category_history` rij waar `effective_to IS NULL`, zet `effective_to = effectiveFrom - 1 day`. Insert nieuwe rij met `(player_id, age_category_code, category_year, effective_from, effective_to=NULL)`. Update `players.age_category` + `category_year` om huidige snapshot te reflecteren. Alles in één Drizzle transaction. Audit-log entry geschreven.
- **D-33 (history query helper):** **`getAgeCategoryAt(playerId, date) → { code, year } | null`** in `src/lib/players.ts`. Reads `age_category_history WHERE player_id = ? AND effective_from <= date AND (effective_to IS NULL OR effective_to >= date)`. Phase 4 toernooi-validatie importeert deze helper en gebruikt `tournament.start_date` als `date`. Index op `(player_id, effective_from DESC, effective_to)` voor query-performance.
- **D-34 (history table primary key):** **`bigserial id` als surrogaat-PK** + UNIQUE constraint op `(player_id, effective_from)` (natuurlijke key). Audit-log entries en eventuele toekomstige correctie-RPC's verwijzen naar de stabiele `id`. CHECK-constraint `effective_to IS NULL OR effective_to >= effective_from` afdwingen.

**D. Trainer-scope afdwinging (USER-04 + TRAINER-03 + RLS)**

- **D-35 (scope source):** **Hergebruik van `academy_memberships`** uit Phase 1. RLS op `players` lookt via `players_visible_to(current_user_id(), current_user_role())` SECURITY DEFINER (al gedefinieerd in `0002_rls_functions_and_policies.sql`). De functie heeft een UNION-clausule per rol — Phase 2 voegt het `trainer` UNION-arm toe waar dit nog niet ingevuld is, of bevestigt dat het Phase-1 placeholder daadwerkelijk werkt. Geen aparte `trainer_academy_links` ALS `academy_memberships` (composite PK `user_id + academy_code + role`) al de N:N-koppeling kan dragen — wat het kan: zet `role='trainer'` per academie-koppeling. **GEEN nieuwe junction-tabel — `academy_memberships` IS de junction.** ROADMAP §Schema noemt `trainer_academy_links` als suggestieve naam; Phase 2 mapt dat op het bestaande `academy_memberships`.
- **D-36 (cross-academy scope leak):** **404 NOT_FOUND** in plaats van 403 FORBIDDEN voor `player.get(playerId)` als RLS de rij filtert. Voorkomt enumeration (een trainer kan niet vaststellen of een spelernaam in een andere academie bestaat door het verschil tussen 404 en 403 te observeren). Implementatie: `player.get` returned `null` → tRPC throwed `NOT_FOUND`. RLS doet dit gratis — query returns 0 rows.
- **D-37 (player edit-rechten matrix):**
  - **TD:** alle velden van alle spelers (`tdProcedure`).
  - **Academy manager:** alle velden van spelers in eigen academie (gefilterd via RLS + tRPC route check).
  - **Trainer:** **read-only** voor profielvelden — kan niets editen. PLAYER-07 zegt "TD en academy_manager kunnen view+edit; player kan eigen non-sensitive editen". Trainers zijn niet genoemd als editor; dus expliciet uitgesloten.
  - **Player (self):** `player.updateSelf` accepteert alleen `{ street, street_number, postal_code, city, province, country, phone, email, emergency_contact_name?, emergency_contact_phone?, emergency_contact_relation? }`. Zod schema rejected elk ander veld. **NIET** wijzigbaar door speler: `status_code`, `academy_id`, `age_category`, `category_year`, `dob`, `gender`, `school`, `first_name`, `last_name`, `club` (laatste 4 zijn TD/academy_manager-only).
  - **Parent of minor:** kan kind-profiel zien (USER-04, GDPR-02) — zelfde non-sensitive velden als de speler zelf zou kunnen editen, plus `emergency_contact_*` (parent vult dit in voor minderjarige bij registratie). Implementatie: `player.updateOnBehalfOf(playerId)` route met `parent_child_links` check.
- **D-38 (trainer edit-rechten):** Trainer kan eigen profiel editen (zelfde patroon als speler — alleen niet-gevoelige velden via `trainer.updateSelf`); kan **geen** speler-data editen. TD kan alle trainerprofielen editen.

**E. UI structuur en gebruikerservaring**

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

**F. i18n in Phase 2 (I18N-06, I18N-08)**

- **D-44 (lookup-labels in catalogs):** Nieuwe lookup-codes (academies, leeftijdscategorieën, statuut, trainerdiploma's) krijgen labels in `messages/{nl,en,fr}.json` onder `lookup.academy.*`, `lookup.age_category.*`, `lookup.status.*`, `lookup.trainer_diploma.*`. DB blijft language-neutral codes (D-19 uit Phase 1). Helper `useLookupLabel(category, code)` (client) en `getLookupLabel(category, code, locale)` (server) hidet de mapping. Lookup-tabellen krijgen pre-seed migration (Phase 2 plan: `0006_lookup_data_seed.sql` of een runtime-seeder als `0006` te vroeg is).
  - **Naming reconciliation note (UI-SPEC line 271):** Phase 1 already ships `lookups.status.*` (plural) under `messages/nl.json` line 57. UI-SPEC asks the planner to pick one direction in Wave 1. **Recommended:** keep `lookups.*` (plural) as the existing Phase 1 root — it matches the `lookups/` directory in `src/server/db/schema/lookups.ts` and avoids editing migrated code. Phase 2's new categories slot under `lookups.academy`, `lookups.ageCategory`, `lookups.trainerDiploma`. Update CONTEXT.md D-44 accordingly when this is locked.
- **D-45 (eigennamen-conventie):** **Academienamen en clubnamen worden 1× canonical opgeslagen en niet vertaald.** Lookup-tabel `academies` heeft kolom `display_name text NOT NULL` (canoniek, bv. `"Topsportschool Wilrijk"`); fr-UI toont identiek `Topsportschool Wilrijk`. Geen `display_name_nl`/`display_name_en`/`display_name_fr` kolommen. Coachnamen idem — opgeslagen op `users.first_name + last_name` zonder per-locale variatie. Documenteer in `docs/i18n-conventions.md`.
  - **Verified in repo:** `src/server/db/schema/lookups.ts` already has `academy.canonicalName text NOT NULL` (line 36); D-45 is satisfied for `academy` — only the `messages/{nl,en,fr}.json` `lookups.academy.*` blocks need the canonical labels and a doc clarifying the rule applies for clubs (free-text `players.club`) and person names (`users.name` already canonical).
- **D-46 (zod messages = i18n keys):** Zod schemas in `src/server/trpc/schemas/*.ts` gebruiken **i18n-keys als message-strings** (`z.string().email({ message: 'errors.email.invalid' })`). Server-side: tRPC error formatter mapt het zod-issue naar `TRPCError` met code `BAD_REQUEST` en `message` = de key + path. Client-side: react-hook-form `formState.errors[field].message` is de key, gerendert via `useTranslations('errors')`. Catalogs `errors.*` zijn een platte map.

### Claude's Discretion

- Concrete migration-bestandnaam-volgorde (volgende beschikbaar = `0006_*`); Drizzle-kit auto-genereert bestandsnaam, executor mag de exacte slug kiezen.
- Of `uploaded_files` een aparte migratie wordt of samen met `players`/`trainers` in één migratie zit — keuze tijdens planning op basis van afhankelijkheden.
- Concrete tRPC-router-bestanden-organisatie binnen `src/server/trpc/routers/`: één bestand per domein (`player.ts`, `trainer.ts`, `file.ts`) of een `profile.ts` aggregator; planner kiest.
- ClamAV Coolify-sidecar Docker-image keuze (`clamav/clamav:stable` vs `mkodockx/docker-clamav`) en signature-update-frequentie (default 24u via cron) — executor mag tijdens implementatie kiezen, gedocumenteerd in `docs/file-upload-pipeline.md`.
- shadcn componenten die toegevoegd moeten worden (DataTable voor lijst, Select voor academie-dropdown, RadioGroup voor statuut, Checkbox voor pedagogische kwalificatie) — executor installeert per `npx shadcn@latest add` per nood.
- Exacte vorm van `file-type` magic-bytes-validatie wrapper (mogelijk een centrale helper `validateUploadMagicBytes(buffer, expectedMimes[])`) — planner/executor kiest.

### Deferred Ideas (OUT OF SCOPE)

- **Profielfoto-cropping/resizing client-side** — v1 accepteert wat ge-upload wordt (max 2MB). Image-processing (thumbnail generation, EXIF-strippen) eventueel in v1.1 als BullMQ-job na clean-scan.
- **Trainer-team mutaties (multiple trainers per academie)** — `academy_memberships` ondersteunt N:N nu al; UI om bulk-toe te wijzen verschuift naar v1.1 als TD-tool.
- **Avatar-componenten met fallback initialen** — eenvoudige `<Avatar>` shadcn component is genoeg; gepersonaliseerde fallbacks (kleur per academie) zijn v1.1.
- **File-versie-historiek (oude foto's blijven raadpleegbaar)** — `superseded_at` ondersteunt het al schema-niveau; UI om oude foto's te zien is uit Phase 2 scope (niet in succescriteria).
- **EXIF-data extraction (camera-model, geo-tag) voor metadata** — niet relevant voor profielfoto's; mogelijk relevant voor video in Phase 5+.
- **Drag-and-drop herordenen van speler-lijst** — sortering via DataTable column headers volstaat; v1.1 als TD het echt wil.
- **Bulk-upload van speler-CSV** — niet in scope; TD vult per speler in via UI.
- **Pasfoto detectie / face-validation** — niet relevant; profielfoto is een sociale feature, niet een ID-document.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAYER-01 | Player profile stores name, voornaam, foto, DOB, geslacht, school, adres + postcode/gemeente/provincie/land, telefoon, e-mail | D-26/27 schema; address flat columns; FK `profile_photo_file_id` |
| PLAYER-02 | Sport attributes: club (free text), statuut (A/B/C lookup), academie (lookup, 6), leeftijdscategorie (lookup), categoriejaar | Existing `status` + `academy` lookup tables already in DB; new `age_categories` lookup needed; `players.club text` (not FK — D-CONFIRMED) |
| PLAYER-03 | Club and academy distinct fields — schema-enforced | `players.club text` + `players.academy_code text REFERENCES academy(code)` ⇒ inherently distinct |
| PLAYER-04 | Age category + category year explicit columns (not derived live) | `players.age_category` + `players.category_year integer` — kept in sync via D-32 mutation |
| PLAYER-05 | Profile photo uploaded + displayed; private bucket; auth + role gated | Upload pipeline (D-21..25); signed URL via `file.getSignedUrl` (D-24) |
| PLAYER-06 | Emergency contact stored on player profile (required for minors) | D-28 inline columns + CHECK constraint `(NOT users.is_minor) OR emergency_contact_name IS NOT NULL ...` — see Architecture §Emergency contact constraint |
| PLAYER-07 | TD + academy_manager view+edit in scope; player edits own non-sensitive | D-37 matrix; RLS + tRPC route gating |
| TRAINER-01 | Trainer profile: name, voornaam, foto, DOB, geslacht, adres, postcode/gemeente/provincie/land, telefoon, e-mail | D-26/27 trainer table; same address pattern |
| TRAINER-02 | Trainer diploma (none/A/B/A-in-opleiding/B-in-opleiding) + pedagogische qual toggle | New `trainer_diploma` lookup table; `trainers.has_pedagogical_qualification boolean` |
| TRAINER-03 | Trainer linked to ≥1 academies; scope-driver | **Reuse `academy_memberships` (D-35).** Phase-1 `admin.user.linkAcademy` (lines 372–402 of `src/server/trpc/routers/admin.ts`) inserts rows with role='trainer' |
| FILE-01 | Server-side signed URLs only — never public | `file.getSignedUrl` tRPC; service-role Supabase client; D-24 1h TTL |
| FILE-02 | Medical documents in separate stricter bucket | `medical/` bucket already exists; Phase 2 doesn't write there |
| FILE-03 | Profile photos in separate bucket; role-gated | `profiles/` bucket; D-25 path `profiles/{user_id}/{uuid}.{ext}` |
| FILE-04 | UUID filenames | `crypto.randomUUID()` for `storage_key`; original filename retained in `uploaded_files.original_filename` audit-only |
| FILE-05 | (Phase-5 — out of scope) | Not addressed in Phase 2 |
| VALID-01 | Size limits: 5MB medical, 2MB photos | D-23 chain — Zod refine + manual check before upload |
| VALID-02 | Magic-bytes via `file-type` | `fileTypeFromBuffer()` ESM API — see Tech §file-type |
| VALID-03 | MIME whitelist per endpoint | Profile: `image/jpeg`, `image/png` only |
| VALID-04 | Malware scan via VirusTotal or ClamAV | **ClamAV** per D-22; clamscan v2 over TCP; async via BullMQ `malware-scan` queue |
| VALID-05 | `Content-Type` strict + `Content-Disposition: attachment` | Set when generating signed URL: `download` option in supabase-js or HTTP route handler proxy |
| VALID-06 | Server-side Zod validation | Already standard in Phase-1 tRPC; D-46 i18n key strings |
| DOM-CAT-01 | `age_category_history` table per player with `effective_from`/`effective_to` | New table; D-31..D-34 |
| DOM-CAT-02 | Tournament category validation uses player's category as of tournament start date | `getAgeCategoryAt(playerId, date)` helper in `src/lib/players.ts`; Phase 4 imports |
| I18N-06 | Proper nouns not translated | D-45; `academy.canonical_name` already in schema; documented in `docs/i18n-conventions.md` |
| I18N-08 | Zod messages emitted as i18n keys | D-46; client renders via `useTranslations('errors')` + small adapter `src/lib/forms/zod-i18n.ts` |
| USER-04 | Each role sees only data within scope | RLS on `players` + `trainers` calling `players_visible_to()`; trainer arm verified in Phase-1 RLS function |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Player/trainer profile schema | Database / Storage | Backend (Drizzle types) | ACID + RLS belong in Postgres; CHECK constraint for minor-emergency is DB-enforced |
| Profile photo upload | Backend (tRPC mutation) | CDN / Object Storage (Supabase Storage Frankfurt) | Multipart parsing + magic-bytes + Zod = backend; bytes live in object storage |
| Magic-bytes validation | Backend | — | Buffer-level inspection requires server; client-side `file.type` is spoofable (declared D-23) |
| Malware scan (ClamAV) | Backend Worker (BullMQ) | Sidecar service (clamd Docker) | Sidecar runs the daemon; Node worker process speaks TCP to it; async per D-21 |
| Signed URL generation | Backend (Frontend Server) | — | Service-role Supabase client must never reach the browser; URL minted per request |
| Age-category history queries | Database | Backend (helper) | Time-range query is best done in SQL with index; helper memoizes for tournament validation |
| Profile detail page (read) | Frontend Server (RSC) | Backend (tRPC server caller) | Server Component fetches via tRPC server caller for initialData; same pattern as Phase 1 `UserTable` |
| Profile form (edit/create) | Browser / Client | Backend (tRPC mutation) | RHF + zod resolver = client; mutation hits server-validated schema |
| Photo-upload widget | Browser / Client | Backend (`file.upload` + `file.getScanStatus` polling) | UI state machine (idle/uploading/pending/clean/infected) is client; truth is server |
| RBAC scope enforcement | Backend (tRPC middleware + RLS) | Database (RLS as backstop) | Defense in depth — `requireRole`/`tdProcedure` at the edge, RLS at the DB |
| i18n labels (zod errors, lookup labels) | Browser / Client | Frontend Server (RSC + `getTranslations`) | Both sides use `next-intl`; lookup labels resolved at render time |

## Standard Stack

### Core (already installed, reuse as-is)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `^15.3` | App Router + RSC + Server Actions | Phase-1 baseline [VERIFIED: `package.json`] |
| `react` / `react-dom` | `^19.0` | UI runtime | Phase-1 baseline [VERIFIED] |
| `drizzle-orm` | `^0.45.2` | Postgres ORM, raw SQL escape hatch via `sql\`...\`` | Phase-1 baseline; supports `check()` constraint helper [VERIFIED: `npm view drizzle-orm version` → 0.45.2 + Context7 docs `/drizzle-team/drizzle-orm-docs` show `check()` API] |
| `drizzle-kit` | `^0.31` | Migrations CLI | Phase-1 baseline [VERIFIED] |
| `@trpc/server` / `@trpc/client` / `@trpc/react-query` / `@trpc/next` | `^11` | End-to-end typed RPC | Phase-1 baseline [VERIFIED] |
| `zod` | `^4` | Server + client schema validation | Phase-1 baseline; `.parse()` errors carry `path` for D-46 i18n key resolution [VERIFIED] |
| `react-hook-form` | `^7` | Form state management | Phase-1 baseline [VERIFIED] |
| `@hookform/resolvers` | `^5.2.2` | Zod resolver for RHF | Phase-1 baseline [VERIFIED: `npm view @hookform/resolvers version` → 5.2.2] |
| `next-intl` | `^4.11` | i18n + RSC catalogs | Phase-1 baseline [VERIFIED] |
| `bullmq` | `^5.76` | Async job queue | Phase-1 baseline; Phase 2 adds `MALWARE_SCAN` queue [VERIFIED] |
| `ioredis` | `^5.10` | BullMQ TCP/TLS connection | Phase-1 baseline [VERIFIED] |
| `file-type` | `^22.0.1` | Magic-bytes detection | Phase-1 baseline (added by Plan 01-01); ESM-only — `fileTypeFromBuffer(buffer)` returns `{ ext, mime } \| undefined` [VERIFIED: `npm view file-type version` → 22.0.1, [CITED: github.com/sindresorhus/file-type readme]] |
| `nanoid` / `crypto.randomUUID()` | `^5` / built-in | UUID file paths (FILE-04) | Phase-1 has `nanoid`; prefer `crypto.randomUUID()` from Node 24 standard library for canonical UUID v4 [VERIFIED: `node --version` → v24.15.0] |
| shadcn/ui (style=new-york, neutral, lucide) | per registry | UI primitives | Phase-1 already initialized — `components.json` present at repo root [VERIFIED: `ls` shows `components.json`] |
| `lucide-react` | `latest` | Icon set | Phase-1 baseline [VERIFIED] |

### Supporting (NEW — must install in Phase 2)

| Library | Version | Purpose | When to Use | Source |
|---------|---------|---------|-------------|--------|
| `@supabase/supabase-js` | `^2.105.3` | Server-side Storage SDK: `createSignedUrl`, `upload`, service-role client | Required for D-24 signed URL flow + D-25 server-side upload to `profiles/` bucket | [VERIFIED: `npm view @supabase/supabase-js version` → 2.105.3] [CITED: supabase.com/docs/reference/javascript/storage-from-createsignedurl] |
| `clamscan` | `^2.4.0` | Node client for clamd over TCP | BullMQ `malware-scan` worker only — NEVER in request path | [VERIFIED: `npm view clamscan version` → 2.4.0] [CITED: github.com/kylefarris/clamscan readme — `scanStream()` API for in-memory buffers; remote TCP via `clamdscan.host`/`clamdscan.port`/`localFallback: false`] |
| `@tanstack/react-table` | (defer to Phase 7) | DataTable headless engine | **NOT required for Phase 2.** Phase-1's `UserTable` deliberately omits it (line 13 of `src/components/admin/user-table.tsx`); Phase 2's player/trainer lists will be < 100 rows per academy and follow the same simple HTML-table-with-shadcn-styling pattern. Phase 7 (Synthese) introduces it for global search results. | [CITED: shadcn DataTable docs — "documentation-only", reusable through `<Table>` primitive; small lists do not require it] |

### Alternatives Considered

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `clamscan@^2.4` | Raw `node:net` socket to clamd implementing INSTREAM protocol manually | clamscan v2 already wraps INSTREAM, handles connection retries, and surfaces `isInfected: boolean` + `viruses: string[]`; rolling our own protocol parser is hand-rolling for no gain. Source code is auditable (~1k LOC). |
| `@supabase/supabase-js` (server-side) | Direct AWS S3 SDK against Supabase Storage's S3-compatible endpoint | Supabase Storage S3 endpoint exists but signed URL semantics differ + Supabase-specific RLS on `storage.objects` table is best-served by `@supabase/supabase-js` which understands the bucket-RLS conventions. Lock-in is bounded — service-role key + `createSignedUrl` are documented patterns. |
| ClamAV daemon (D-22 LOCKED) | VirusTotal API | **Rejected by user (D-22 GDPR data residency)** — VT uploads files to cloud. |
| `uuid` package | `crypto.randomUUID()` | Built-in to Node 24; no extra dep. |
| `react-dropzone` (D-41 EXCLUDED) | self-built drag/drop | **Rejected by user (D-41) — keeps bundle small.** |
| Per-locale `display_name_nl`/`display_name_en`/`display_name_fr` | `display_name text` (canonical, non-translated) | **D-45 LOCKED — proper nouns not translated** (I18N-06). Already implemented in `lookups.ts` `academy.canonicalName`. |

**Installation (single command for Phase 2):**

```bash
pnpm add @supabase/supabase-js@^2 clamscan@^2
```

**No other production deps needed.** shadcn primitives are added via `pnpm dlx shadcn@latest add <component>` per UI-SPEC component inventory (input, label, form, textarea, radio-group, checkbox, calendar, popover, avatar, dialog, alert-dialog, card, badge, separator, skeleton, tabs, sonner, tooltip).

**Version verification (verified 2026-05-06):**

```bash
$ npm view file-type version          # 22.0.1
$ npm view @supabase/supabase-js version  # 2.105.3
$ npm view clamscan version           # 2.4.0
$ npm view drizzle-orm version        # 0.45.2
$ npm view @hookform/resolvers version  # 5.2.2
```

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser (Client Components)                                          │
│  ─ /players, /trainers (lists, RHF forms, PhotoUpload widget)        │
│  ─ FileReader → object URL preview (instant, client-only)            │
└────────────┬───────────────────────────────────────┬────────────────┘
             │ tRPC (typed, JSON+CSRF)              │ polling getScanStatus
             │                                      │
┌────────────▼──────────────────────────────────────▼────────────────┐
│ Frontend Server (Next.js Route Handlers + Server Components)        │
│  ─ Server Components: read via tRPC server caller, hydrate initial  │
│  ─ tRPC routers (NEW Phase 2):                                      │
│      player.{create,get,list,updateSelf,updateAsTd,                 │
│              updateOnBehalfOf,setAgeCategory}                       │
│      trainer.{create,get,list,updateSelf,updateAsTd}                │
│      file.{upload, getSignedUrl, getScanStatus, delete}             │
│  ─ Middleware chain (REUSED from Phase 1):                          │
│      requireAuth → withRlsContext → requireCurrentConsent           │
│      → tdProcedure | sensitiveProcedure | protectedProcedure        │
│  ─ writeAudit() on every state change (REUSED)                      │
│  ─ Service-role @supabase/supabase-js singleton (NEW Phase 2)       │
└────┬─────────────────────┬─────────────────────────────┬───────────┘
     │                     │                             │
     │ pg over RLS         │ supabase.storage.upload     │ BullMQ.add(MALWARE_SCAN)
     │ (app.user_id GUC)   │ (service-role bypasses RLS) │ (ioredis)
     │                     │                             │
┌────▼────────────┐   ┌────▼────────────┐   ┌───────────▼──────────┐
│ Postgres        │   │ Supabase Storage│   │ ioredis / Upstash    │
│ (Supabase Pro   │   │  ─ profiles/    │   │ (BullMQ broker)      │
│  Frankfurt)     │   │  ─ medical/     │   │                      │
│  ─ RLS on       │   │  bucket-RLS via │   └───────────┬──────────┘
│    players,     │   │  storage.objects│               │
│    trainers,    │   │  (Drizzle migr) │   Worker process (pnpm worker)
│    uploaded_    │   └─────────────────┘   ┌───────────▼──────────┐
│    files,       │                         │ BullMQ Worker         │
│    age_         │                         │  ─ MALWARE_SCAN job  │
│    category_    │                         │  ─ load file from    │
│    history      │                         │    Supabase Storage  │
│  ─ players_     │                         │  ─ clamscan          │
│    visible_to() │                         │    .scanStream(buf)  │
│    SECURITY     │                         │  ─ UPDATE            │
│    DEFINER      │                         │    uploaded_files    │
│  ─ audit_log    │                         │    SET scan_status   │
│    + writeAudit │                         │    = 'clean'/'infected'│
│                 │                         └───────────┬──────────┘
└─────────────────┘                                     │
                                                        │ TCP 3310
                                            ┌───────────▼──────────┐
                                            │ ClamAV daemon        │
                                            │ (Coolify sidecar     │
                                            │  Docker service,     │
                                            │  same Hetzner VPS)   │
                                            │  ─ freshclam cron    │
                                            │    daily             │
                                            └──────────────────────┘
```

**Trace (upload happy path):** Browser drops file → `file.upload` mutation → `withRlsContext` opens tx + binds GUCs → Zod validate (size, type) → read multipart Buffer → `fileTypeFromBuffer(buf)` magic-bytes check → INSERT `uploaded_files` row with `scan_status='pending'` → service-role `supabase.storage.from('profiles').upload(storageKey, buf)` → `writeAudit(ctx, {action:'file.upload'})` → enqueue `MALWARE_SCAN` job with `{fileId, storageKey}` → return `{fileId, scanStatus:'pending'}` → tx commits. Worker picks up job → downloads file from Storage → `clamscan.scanStream(buf)` → updates `uploaded_files.scan_status` + `scan_completed_at`. Client polls `file.getScanStatus({fileId})` until `clean | infected | timeout`.

### Recommended Project Structure (Phase 2 additions)

```
drizzle/
├── 0006_phase2_profiles_and_files.sql           ← NEW: players, trainers, uploaded_files, age_category_history, age_categories lookup, trainer_diploma lookup, CHECK constraints
├── 0006_phase2_profiles_and_files.rollback.md
├── 0007_phase2_rls_policies.sql                  ← NEW: RLS on players/trainers/uploaded_files/age_category_history calling players_visible_to(); RLS on storage.objects for profiles/ bucket
├── 0007_phase2_rls_policies.rollback.md
├── 0008_phase2_lookup_seed.sql                   ← NEW (or runtime seed): academy seed expansion, age_categories taxonomy, trainer_diploma codes
└── 0008_phase2_lookup_seed.rollback.md

src/server/db/schema/
├── players.ts          ← NEW: players pgTable + age_category_history pgTable
├── trainers.ts         ← NEW: trainers pgTable
├── files.ts            ← NEW: uploaded_files pgTable (scan_status enum)
└── lookups.ts          ← MODIFY: add ageCategory + trainerDiploma exports (already has academy/status/etc.)

src/server/db/rls/
├── functions.sql       ← MODIFY (Wave 1): if planner discovers trainer arm of players_visible_to() needs adjustment for players-table cardinality, add a new SECURITY DEFINER fn `players_table_visible_to(caller_id, role)` that returns players.id rather than users.id
└── policies.sql        ← MODIFY: append RLS for players, trainers, uploaded_files, age_category_history

src/server/trpc/schemas/                          ← NEW directory
├── player.ts           ← NEW: playerCreateInput, playerSelfUpdateInput, playerOnBehalfOfInput, playerSetAgeCategoryInput, addressFields shared, emergencyContactFields
├── trainer.ts          ← NEW: trainerCreateInput, trainerSelfUpdateInput
└── file.ts             ← NEW: fileUploadInput (mime, size hint), fileGetSignedUrlInput, fileGetScanStatusInput

src/server/trpc/routers/
├── _app.ts             ← MODIFY: register player, trainer, file routers
├── player.ts           ← NEW
├── trainer.ts          ← NEW
└── file.ts             ← NEW

src/server/storage/                               ← NEW directory
├── client.ts           ← NEW: service-role Supabase client singleton (NEVER imported in client bundle — use 'server-only' marker)
├── profile-photo.ts    ← NEW: uploadProfilePhoto(buf, userId, ext) → { fileId, storageKey }
├── signed-url.ts       ← NEW: createProfilePhotoSignedUrl(storageKey, ttlSeconds) — RBAC check is the caller's responsibility
└── magic-bytes.ts      ← NEW: validateUploadMagicBytes(buf, allowedMimes[]) using fileTypeFromBuffer

src/server/workers/jobs/
└── malware-scan.ts     ← NEW: processMalwareScan({fileId, storageKey}) — clamscan over TCP, UPDATE scan_status

src/server/workers/queues.ts                      ← MODIFY: add QUEUES.MALWARE_SCAN + new Queue export
src/server/workers/index.ts                       ← MODIFY: spawn malware-scan Worker alongside consent-version-bump

src/lib/players.ts                                ← NEW: deriveAgeCategory(dob, asOfDate), getAgeCategoryAt(playerId, date)
src/lib/forms/zod-i18n.ts                         ← NEW: tiny adapter for <FormMessage> to call useTranslations('errors')(zodKey)

src/components/players/                           ← NEW directory
├── player-list-table.tsx
├── player-create-form.tsx
├── player-edit-form.tsx
├── player-header.tsx
└── age-category-change-dialog.tsx

src/components/trainers/                          ← NEW directory
├── trainer-list-table.tsx
├── trainer-create-form.tsx
├── trainer-edit-form.tsx
└── trainer-header.tsx

src/components/file/
└── photo-upload.tsx                              ← NEW

src/components/lookup/
└── lookup-select.tsx                             ← NEW

src/components/common/
└── empty-state.tsx                               ← NEW

src/app/[locale]/(app)/players/
├── page.tsx                                      ← NEW (Server Component, list)
├── new/page.tsx                                  ← NEW (TD-only)
└── [id]/page.tsx                                 ← NEW (read or edit per role)

src/app/[locale]/(app)/trainers/
├── page.tsx                                      ← NEW
├── new/page.tsx                                  ← NEW
└── [id]/page.tsx                                 ← NEW

src/app/[locale]/(app)/me/
└── profile/page.tsx                              ← NEW (router → PlayerSelfForm | TrainerSelfForm)

messages/{nl,en,fr}.json                          ← MODIFY: add players.*, trainers.*, files.*, lookups.{academy,ageCategory,trainerDiploma}.*, errors.field.*

docs/
├── i18n-conventions.md                           ← NEW: D-45 proper-noun rule + lookup-label resolver pattern
├── file-upload-pipeline.md                       ← NEW: ClamAV sidecar setup, freshclam cron, magic-bytes/MIME whitelist registry
└── deployment.md                                 ← MODIFY: add ClamAV sidecar to Coolify config + SUPABASE_SERVICE_ROLE_KEY env

src/lib/env.ts                                    ← MODIFY: add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLAMAV_HOST, CLAMAV_PORT (server-only) + NEXT_PUBLIC_SUPABASE_URL (client; safe — anon key not stored)
```

### Pattern 1: Drizzle CHECK constraint (D-28 emergency contact)

**What:** Database-level enforcement of "minor → emergency contact required". Defense in depth above Zod.

**When to use:** Any business rule expressible as a row-level predicate.

**Example:**

```typescript
// src/server/db/schema/players.ts (sketch — planner refines)
import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid, integer, date, boolean } from 'drizzle-orm/pg-core';
import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import { academy, status } from './lookups';

export const players = pgTable(
  'players',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    gender: text('gender').notNull(), // 'male' | 'female' | 'x' (Zod-validated; or pgEnum)
    school: text('school'),
    street: text('street').notNull(),
    streetNumber: text('street_number'),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    province: text('province').notNull(),
    country: text('country').notNull().default('BE'),
    phone: text('phone'),
    email: text('email'),
    club: text('club'),
    statusCode: text('status_code')
      .notNull()
      .references(() => status.code, { onDelete: 'restrict' }),
    academyCode: text('academy_code')
      .notNull()
      .references(() => academy.code, { onDelete: 'restrict' }),
    ageCategory: text('age_category').notNull(), // FK to age_categories.code (added in same migration)
    categoryYear: integer('category_year').notNull(),
    isMinor: boolean('is_minor').notNull(), // mirrors users.is_minor at create-time; updated by Phase-1 helper on dob change
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    emergencyContactRelation: text('emergency_contact_relation'),
    profilePhotoFileId: uuid('profile_photo_file_id'), // FK in 0007 once uploaded_files exists in same migration; or use sql`...` reference
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
    updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    check(
      'players_minor_emergency_contact',
      sql`(NOT ${t.isMinor}) OR (${t.emergencyContactName} IS NOT NULL AND ${t.emergencyContactPhone} IS NOT NULL)`,
    ),
  ],
);
```

**Source:** [VERIFIED via Context7 — `/drizzle-team/drizzle-orm-docs` shows `check(name, sql\`...\`)` syntax in `(table) => [...]` array form for drizzle-orm v0.45+.]

> **Note:** `players.isMinor` is denormalized from `users.is_minor` (Phase 1 column added in `drizzle/0003_users_is_minor.sql`). Keeping it on `players` lets the CHECK constraint be local (no JOIN required at constraint evaluation). The Phase 1 application helper `isMinorAt(dob, now)` should be invoked from `player.create` / `player.updateAsTd` mutations to keep this column in sync. ESLint rule `forbid-bare-timestamp` from Phase 1 still applies — only use `tstz()`.

### Pattern 2: Composite index for time-range queries (D-33)

**What:** B-tree index on `(player_id, effective_from DESC, effective_to)` so `getAgeCategoryAt(playerId, date)` is index-only.

**Example:**

```typescript
// src/server/db/schema/players.ts (continued)
import { index } from 'drizzle-orm/pg-core';

export const ageCategoryHistory = pgTable(
  'age_category_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.userId, { onDelete: 'cascade' }),
    ageCategoryCode: text('age_category_code').notNull(),
    categoryYear: integer('category_year').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    setBy: uuid('set_by').references(() => users.id),
    setAt: tstz('set_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    unique('uniq_player_effective_from').on(t.playerId, t.effectiveFrom),
    check(
      'age_history_effective_to_after_from',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    index('idx_age_history_lookup').on(
      t.playerId,
      t.effectiveFrom.desc(),
      t.effectiveTo,
    ),
  ],
);
```

**Source:** [VERIFIED via Context7 — `/drizzle-team/drizzle-orm-docs` `latest-releases/drizzle-orm-v0310.mdx` shows `.on(table.column1.desc(), table.column2)` API (drizzle-orm v0.31+).]

### Pattern 3: tRPC router using existing procedure presets (D-37)

**Source:** Modeled on Phase 1 `src/server/trpc/routers/admin.ts` — `tdProcedure` + `writeAudit(ctx, ...)` + RLS-bound transaction handle via `(ctx.db as DbClient | undefined) ?? rawDb`. Use the same `.strict()` Zod input pattern; same eslint-disable cast pattern for INSERT values until Drizzle TS fixes the conditional default-now inference.

```typescript
// src/server/trpc/routers/player.ts (sketch — planner refines)
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { db as rawDb, type DbClient } from '@/server/db/client';
import { players, ageCategoryHistory } from '@/server/db/schema/players';
import { writeAudit } from '../middleware/audit';
import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
import { router } from '../trpc';
import {
  playerCreateInput,
  playerSelfUpdateInput,
  playerSetAgeCategoryInput,
} from '../schemas/player';
import { deriveAgeCategory } from '@/lib/players';

export const playerRouter = router({
  create: tdProcedure.input(playerCreateInput).mutation(async ({ ctx, input }) => {
    const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
    const { code: ageCategoryCode, year: categoryYear } = deriveAgeCategory(
      input.dateOfBirth,
      new Date(),
    );
    return dbHandle.transaction(async (tx) => {
      const [p] = await tx.insert(players).values({ /* ... */ ageCategoryCode, categoryYear }).returning();
      await tx.insert(ageCategoryHistory).values({
        playerId: p.userId,
        ageCategoryCode,
        categoryYear,
        effectiveFrom: input.dateOfBirth, // or now()
        setBy: ctx.scope!.userId,
      });
      await writeAudit(ctx, {
        action: 'player.create',
        resourceType: 'player',
        resourceId: p.userId,
        newValues: { /* redacted-by-pino-paths */ },
      });
      return p;
    });
  }),

  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
    // RLS filters out-of-scope rows → 0 rows → throw NOT_FOUND (D-36)
    const p = await dbHandle.query.players.findFirst({ where: eq(players.userId, input.id) });
    if (!p) throw new TRPCError({ code: 'NOT_FOUND' });
    return p;
  }),

  // updateSelf: protectedProcedure (anyone) — RLS + tRPC schema together gate field-level
  // updateAsTd: tdProcedure
  // updateOnBehalfOf: protectedProcedure + parent_child_links check inside the handler
  // setAgeCategory: tdProcedure
  // list: protectedProcedure (RLS does the scoping)
});
```

### Pattern 4: BullMQ queue addition (D-21 malware scan)

**Source:** Modeled on Phase 1 `src/server/workers/queues.ts` and `index.ts`. Append to existing `QUEUES` const, export new `Queue`, register new `Worker` in `index.ts`.

```typescript
// src/server/workers/queues.ts (modified)
export const QUEUES = {
  CONSENT_NOTIFY: 'consent-notify',
  MALWARE_SCAN: 'malware-scan',  // NEW
} as const;

export const malwareScanQueue = new Queue(QUEUES.MALWARE_SCAN, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'custom' },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});
```

```typescript
// src/server/workers/jobs/malware-scan.ts (NEW)
import NodeClam from 'clamscan';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { uploadedFiles } from '@/server/db/schema/files';
import { storageClient } from '@/server/storage/client';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

interface MalwareScanJob { fileId: string; storageKey: string; bucket: string; }

const clamscanPromise = new NodeClam().init({
  clamscan: { active: false },
  clamdscan: {
    socket: false,
    host: env.CLAMAV_HOST,
    port: Number(env.CLAMAV_PORT),
    timeout: 30_000,
    localFallback: false,
    active: true,
  },
});

export async function processMalwareScan({ fileId, storageKey, bucket }: MalwareScanJob): Promise<void> {
  const clamscan = await clamscanPromise;
  // Download from Supabase Storage (service-role)
  const { data, error } = await storageClient.storage.from(bucket).download(storageKey);
  if (error) {
    log.error({ fileId, err: error.message }, 'malware_scan.download_failed');
    throw error;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  const { isInfected, viruses } = await clamscan.scanStream(Readable.from(buf));
  await db
    .update(uploadedFiles)
    .set({
      scanStatus: isInfected ? 'infected' : 'clean',
      scanCompletedAt: new Date(),
    })
    .where(eq(uploadedFiles.id, fileId));
  log.info({ fileId, isInfected, viruses }, 'malware_scan.completed');
}
```

[CITED: github.com/kylefarris/clamscan readme — `scanStream()` API; `clamdscan` config block with `host`/`port`/`localFallback: false` for remote-only; resolves to `{isInfected: boolean, viruses: string[]}`.]

> **Concurrency note:** D-15 default `concurrency=5` is fine for malware scans (clamd is the bottleneck; 5 parallel scans against one clamd is well within its capacity for sub-2MB files). Worker concurrency lives in `src/server/workers/index.ts` per-Worker.

### Pattern 5: Service-role Supabase client (server-only)

```typescript
// src/server/storage/client.ts
import 'server-only';  // CRITICAL: ESLint + Next.js refuse to bundle this in client
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

export const storageClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```

[VERIFIED via WebFetch supabase.com docs — service-role key bypasses RLS, suitable for server-side Storage operations. Per supabase docs storage RLS section: "Service keys entirely bypass RLS policies."]

### Pattern 6: Storage bucket RLS (defense in depth, even though service-role bypasses)

Even though the service-role key bypasses RLS, we MUST write `storage.objects` policies in `0007_phase2_rls_policies.sql` because:
1. If the service-role key ever leaks or is misused, RLS still narrows damage.
2. If a future feature uses the anon key (e.g., browser-side direct upload — out of scope but possible v1.1), the policies would already exist.
3. Drift between intended access and actual access becomes visible during legal/security review (every access rule is in code).

```sql
-- 0007_phase2_rls_policies.sql (excerpt)
-- profiles bucket: own-folder reads + writes; TD reads/writes any
CREATE POLICY profiles_owner_read ON storage.objects FOR SELECT
  USING (
    bucket_id = 'profiles'
    AND (storage.foldername(name))[1] = current_user_id()::text
  );

CREATE POLICY profiles_owner_write ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'profiles'
    AND (storage.foldername(name))[1] = current_user_id()::text
  );

CREATE POLICY profiles_td_all ON storage.objects FOR ALL
  USING (
    bucket_id = 'profiles'
    AND current_user_role() = 'technical_director'
  )
  WITH CHECK (
    bucket_id = 'profiles'
    AND current_user_role() = 'technical_director'
  );

-- scope-trainer/parent read: defer to a SECURITY DEFINER fn that takes the storageKey,
-- decodes the user_id segment, and reuses players_visible_to() — wire in if/when
-- non-service-role access is implemented (deferred to Phase 5 if ever needed).
```

[CITED: supabase.com/docs/guides/storage/security/access-control — `storage.foldername(name)[1]` pattern for folder-as-userid; service-role key bypasses these policies for app-side operations.]

> **Naming reconciliation:** Phase 1 RLS uses `current_user_id()` (UUID-returning STABLE wrapper around `app.user_id` GUC). Storage RLS docs use `auth.jwt()->>'sub'` because Supabase's GoTrue auth pushes the JWT into a Postgres GUC by default. Since VTTL uses Better Auth (not Supabase Auth), `auth.jwt()` is empty. **The policy MUST use `current_user_id()` from Phase 1.** This requires that `withRlsContext` middleware also runs on whatever connection the storage policies see — NOT POSSIBLE for direct browser-to-Storage uploads, but the application path goes service-role-key → bypasses RLS → no problem. Wire the trainer/parent read policies only after a feasibility test on Phase 4 (deferred).

### Pattern 7: Photo upload widget client polling

**Source:** Modeled on existing `<UserTable>` (`src/components/admin/user-table.tsx`) — Client Component, `'use client'`, uses `trpc.X.Y.useQuery({initialData})` + `useMutation`.

Polling pattern: `trpc.file.getScanStatus.useQuery({ fileId }, { refetchInterval: 2000, enabled: status === 'pending' })`. Stop polling at 30s timeout (`enabled: pollCount < 15`). UI-SPEC §Photo Upload Widget §Interactions step 6 specifies the exact contract.

### Anti-Patterns to Avoid

- **Trusting `file.type` from the browser** — it is the user-agent's claim, not authoritative. Magic-bytes via `fileTypeFromBuffer()` is the only valid signal (D-23). [CITED: VALID-02]
- **Synchronous ClamAV scan in request path** — would hold the tRPC mutation open for 1–3s per upload, hit timeouts under load, and serialize on clamd's connection pool. **Async via BullMQ** is locked (D-21).
- **Public bucket URLs** — even for "harmless" profile photos, a public URL is permanently scrapable. Always signed-URL with TTL (D-24, FILE-01).
- **Storing the original filename as the storage key** — predictable + reveals user-supplied content; could also collide. UUID-only path per FILE-04 (D-25).
- **Using `current_user_id()` in client-direct-to-Storage uploads** — Supabase's `auth.jwt()` is what storage RLS evaluates against; we use Better Auth + service-role key + server-side upload, which is fine, but DO NOT add a "direct browser upload" path without first wiring a Phase-2.x JWT-passthrough.
- **Re-implementing `players_visible_to()`** — Phase 1 already has the trainer arm working (`drizzle/0002_rls_functions_and_policies.sql` lines 109–116). New RLS policies on `players` should call the existing function, not duplicate the join.
- **Writing audit_log directly via `db.insert(auditLog)`** — always use `writeAudit(ctx, ...)` so actor + IP + UA + request_id are bound consistently. [CITED: `src/server/trpc/middleware/audit.ts`]
- **Bare `timestamp(...)`** — Phase 1 ESLint rule blocks it; always `tstz(name, opts)` from `src/server/db/helpers/timestamps.ts`.
- **Creating a `trainer_academy_links` table** — D-35 LOCKED: reuse `academy_memberships`. ROADMAP §Schema names it suggestively, not prescriptively.
- **Using `display_name_nl/en/fr` columns on lookups** — D-45 + I18N-06: proper nouns rendered identically across locales.
- **Touching `medical/` bucket from Phase 2 code** — out of scope per phase boundary.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Magic-bytes detection | Manual byte-prefix matching against PNG/JPEG sigs | `fileTypeFromBuffer(buf)` from `file-type@^22` | Covers 200+ formats, edge cases (TIFF disguised as JPEG, polyglot files), maintained by Sindre Sorhus, ESM-only [CITED: github.com/sindresorhus/file-type] |
| ClamAV TCP protocol parsing | Raw `node:net` socket implementing INSTREAM | `clamscan@^2` `scanStream()` | Connection retries, INSTREAM framing, `isInfected/viruses` shape stable since v1.x [CITED: github.com/kylefarris/clamscan] |
| Signed URL HMAC + token | Roll-your-own JWT-signed URL | `supabase.storage.from(bucket).createSignedUrl(path, ttl)` | Supabase signs with the storage JWT secret; no leaked-key risk; TTL parameter directly maps to D-24 [CITED: supabase.com/docs/reference/javascript/storage-from-createsignedurl] |
| UUID v4 generation | `Math.random()`-based hex strings | `crypto.randomUUID()` (Node 24 built-in) | Unbiased; standard; FIPS-compliant variant exists [VERIFIED: Node 24 `crypto.randomUUID()`] |
| BullMQ job retry/backoff | Manual setInterval loops | BullMQ default `attempts:3 + custom backoff` from `src/server/workers/index.ts` | Already configured; reuse [CITED: `src/server/workers/index.ts` lines 38–42] |
| Form state machine | hand-rolled `useState` | `react-hook-form@^7` + `@hookform/resolvers/zod` | Phase 1 baseline; type-inference works through zod schema [CITED: `package.json`] |
| Date formatting per locale | `Intl.DateTimeFormat()` direct | `formatDate(date, locale)` from `src/lib/i18n-format.ts` | Phase 1 single source of truth; UI-SPEC mandates it |
| Lookup label resolution | Hard-coded label maps | `useLookupLabel(category, code)` (client) + `getLookupLabel(category, code, locale)` (server) — see `<LookupSelect>` | D-44; one helper for all 4 lookup categories |

**Key insight:** Every "convenient" custom solution in this domain has a security-or-correctness failure mode (e.g., partial magic-bytes table, signed URL HMAC bug, race in scan status). The libraries above are auditable in <2k LOC each and battle-tested.

## Runtime State Inventory

> Phase 2 introduces NEW persistent state (it does not rename or migrate existing state). The categories below confirm there is no prior state from Phase 1 that needs adjustment.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 1 left `players`/`trainers`/`uploaded_files` un-created. Phase 1 also seeded only `academy` lookup with two rows (`academy_antwerpen`, `topsportschool`); the additional 4 academies (PLAYER-02 ROADMAP says 6 total) need seed rows in Phase 2. | Add seed rows in `0008_phase2_lookup_seed.sql`. The TD must confirm the canonical names of the remaining 4 academies. |
| Live service config | None — no n8n / Datadog / Tailscale workflows reference VTTL profile data. ClamAV is being added fresh as a Coolify sidecar; no migration needed. | Document Coolify sidecar config in `docs/deployment.md` (Claude's Discretion D-22). |
| OS-registered state | None — no Windows/launchd/cron tasks exist for VTTL outside Coolify. `pg_cron` jobs are not added in Phase 2. | None. |
| Secrets/env vars | NEW required env vars (server-only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLAMAV_HOST` (default `clamav`), `CLAMAV_PORT` (default `3310`). NEW optional client env: `NEXT_PUBLIC_SUPABASE_URL` only if a future plan needs it (currently NOT needed — server-only path). | Add to `src/lib/env.ts` `server` block; update `.env.example`; provision in Coolify Secrets. |
| Build artifacts / installed packages | New deps: `@supabase/supabase-js`, `clamscan`. shadcn primitives: 18 components from official registry (no Wave-0 stale packages). | `pnpm add @supabase/supabase-js@^2 clamscan@^2`; `pnpm dlx shadcn@latest add input label form textarea radio-group checkbox calendar popover avatar dialog alert-dialog card badge separator skeleton tabs sonner tooltip` |

## Common Pitfalls

### Pitfall 1: `players_visible_to()` returns `users.id`, not `players.user_id`

**What goes wrong:** Naïve RLS like `CREATE POLICY ... USING (user_id IN (SELECT player_user_id FROM players_visible_to(...)))` works ONLY if `players.user_id` is the PK FK to `users.id` (which it is per D-26 — `players.user_id PRIMARY KEY REFERENCES users.id`). If the planner introduces a separate `players.id uuid PK` and uses `players.user_id` as a non-unique ref, the join fails on the `IN` clause. **Verify in plan-checker that `players.user_id` is the PK.**

**Why it happens:** Standard "every entity has its own surrogate id" instinct. D-26 deliberately collapses player.id to user.id (1:0..1 FK) because a player IS a user with extra fields.

**How to avoid:** Schema review checks `players.user_id` is `primaryKey().references(() => users.id, { onDelete: 'cascade' })`. Apply same to `trainers`.

**Warning signs:** Two columns `players.id` AND `players.user_id`; or `players.user_id` not unique.

### Pitfall 2: `players.is_minor` drift from `users.is_minor`

**What goes wrong:** D-28 CHECK constraint references `players.is_minor`. If `users.is_minor` is updated (e.g., on DOB correction) but `players.is_minor` is not, the constraint silently allows a now-minor player to lack emergency contact (or vice versa).

**Why it happens:** Two columns mirroring the same logical fact; updates aren't atomic.

**How to avoid:** Either (a) compute `is_minor` from a single source via a generated column tied to `dateOfBirth` in `players` (Postgres allows STORED generated columns IF the expression is IMMUTABLE — comparing `dateOfBirth` to a literal cutoff is fine, but referencing `CURRENT_DATE` is NOT — see Phase-1 CR-01 fix in `src/server/db/schema/auth.ts` lines 60–72), OR (b) recompute `players.is_minor` in `player.create` / `player.updateAsTd` mutations using the Phase-1 helper `isMinorAt(dob, now)`. **Recommended: (b)**, matching Phase 1's pattern.

**Warning signs:** Missing call to `isMinorAt()` in `player.update` mutations; CHECK constraint passes today but breaks on DOB updates.

### Pitfall 3: ClamAV signature staleness

**What goes wrong:** clamd ships with empty signature DB; without `freshclam` the daemon detects nothing. New install runs `freshclam` once, but signatures age out within a week.

**Why it happens:** clamav-clamd Docker images sometimes pre-run freshclam on first boot but not on schedule.

**How to avoid:** Coolify scheduled job (or container `CMD` running freshclam every 24h, then `clamd`) per D-22. Document in `docs/file-upload-pipeline.md`. **Tip:** `clamav/clamav:stable` Docker image already bundles a `freshclam` cron — confirm at deploy.

**Warning signs:** EICAR test buffer (`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`) returns `isInfected: false` after a week of operation.

### Pitfall 4: Service-role key bundled into client

**What goes wrong:** A developer imports `src/server/storage/client.ts` from a Client Component → Next.js bundles the service-role key into the JS sent to browsers → catastrophic credential leak.

**Why it happens:** `@supabase/supabase-js` works in both runtimes; nothing structurally prevents this.

**How to avoid:** First line of `src/server/storage/client.ts` must be `import 'server-only';`. Add ESLint rule `restricted-imports` blocking `@/server/storage/*` from `src/components/**` and `src/app/**/page.tsx` Client Components. Pattern-mapper should flag any new client import of storage modules.

**Warning signs:** `'use client'` file imports from `@/server/storage/`.

### Pitfall 5: Upload buffer size on Vercel/Coolify request limits

**What goes wrong:** Default Next.js Route Handler body parser caps at 1MB by default in Edge runtime, 4MB in Node runtime. A 2MB profile photo can fail under non-default config.

**Why it happens:** Defaults change between Next.js versions; Coolify may add nginx body-size limits.

**How to avoid:** Configure tRPC route handler `bodyParser: { sizeLimit: '5mb' }` in the route handler's `route.ts` for `/api/trpc/*`. Document the chosen size in `docs/file-upload-pipeline.md`. Coolify's reverse proxy (Caddy by default) uses 10MB by default — fine.

**Warning signs:** "Request entity too large" error on a 1.8MB file in production.

### Pitfall 6: Concurrent age-category transitions

**What goes wrong:** Two TDs simultaneously call `player.setAgeCategory` for the same player. Both read `effective_to IS NULL` → both insert new "current" rows → unique constraint `(player_id, effective_from)` saves us only if they pick the same `effective_from` date. Otherwise we end up with two open ranges.

**Why it happens:** The "close current row, insert new row" pattern is a TOCTOU race.

**How to avoid:** Wrap the entire D-32 mutation in `SELECT ... FOR UPDATE` on the current open row, OR use serializable isolation level for this transaction. Drizzle: `db.transaction(async (tx) => { ... }, { isolationLevel: 'serializable' })`. Document in `docs/age-category-history.md`.

**Warning signs:** Integration test that fires two `setAgeCategory` calls in parallel and observes 2 rows with `effective_to IS NULL` for the same player.

### Pitfall 7: i18n key lookup at server-render-time fails before catalog loads

**What goes wrong:** If `useTranslations('errors')` is called server-side before next-intl's locale provider has hydrated the catalog (e.g., during early static generation), the key string is rendered literally. UI shows `errors.field.required` instead of `Dit veld is verplicht`.

**Why it happens:** `next-intl` requires the locale param to be set in the route segment. Phase 1 already ships `[locale]` segment, so this is rare — but custom server actions can bypass it.

**How to avoid:** All Phase 2 forms are inside `[locale]/(app)/...` segment, so the provider is always present. For Server Actions, use `getTranslations(locale)` async helper from `next-intl/server`. Verify with the dev fail-loud fallback (D-20).

**Warning signs:** Literal i18n keys appearing in UI; CI smoke test "homepage in nl shows 'Inloggen' not 'auth.login.title'".

### Pitfall 8: TTL caching of signed URLs in browser

**What goes wrong:** Browser caches the signed URL response (HTTP 200 body) and re-uses it past the 1h TTL → 403 from Supabase.

**Why it happens:** TanStack Query default `staleTime: 0`, but if a developer sets `staleTime: Infinity` on a `getSignedUrl` query for "performance", the URL gets reused.

**How to avoid:** D-24 mandates client refreshes at 50min mark. Implement as `useQuery({queryKey:[fileId], queryFn:..., staleTime: 50*60*1000})` and rely on TanStack's auto-refetch on stale. Document.

**Warning signs:** "Profile photo broken after one hour" reports.

## Code Examples

### Magic-bytes validation helper

```typescript
// src/server/storage/magic-bytes.ts
import 'server-only';
import { fileTypeFromBuffer } from 'file-type';
import { TRPCError } from '@trpc/server';

const MIME_BY_BUCKET: Record<string, readonly string[]> = {
  profiles: ['image/jpeg', 'image/png'] as const,
  // medical: ['application/pdf', 'image/jpeg', 'image/png'] — Phase 5
};

export async function validateUploadMagicBytes(
  buf: Buffer,
  bucket: keyof typeof MIME_BY_BUCKET,
): Promise<{ ext: string; mime: string }> {
  const detected = await fileTypeFromBuffer(buf);
  if (!detected) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.file.unknownType',
    });
  }
  const allowed = MIME_BY_BUCKET[bucket];
  if (!allowed.includes(detected.mime)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.file.disallowedType',
    });
  }
  return detected;
}
```

[CITED: github.com/sindresorhus/file-type — `fileTypeFromBuffer(buffer)` returns `Promise<{ext, mime} | undefined>` in v22.]

### file.upload tRPC mutation skeleton

```typescript
// src/server/trpc/routers/file.ts (sketch — planner refines exact zod shape)
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db as rawDb, type DbClient } from '@/server/db/client';
import { uploadedFiles } from '@/server/db/schema/files';
import { storageClient } from '@/server/storage/client';
import { validateUploadMagicBytes } from '@/server/storage/magic-bytes';
import { malwareScanQueue } from '@/server/workers/queues';
import { writeAudit } from '../middleware/audit';
import { protectedProcedure } from '../middleware/freshSession';
import { router } from '../trpc';

const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;

export const fileRouter = router({
  upload: protectedProcedure
    .input(
      z.object({
        bucket: z.literal('profiles'), // Phase 2 only profiles; Phase 5 extends
        // base64-encoded multipart body — alternative: separate Route Handler
        // for true multipart; planner picks the transport
        contentBase64: z.string().min(1),
        originalFilename: z.string().min(1).max(255),
      }).strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const buf = Buffer.from(input.contentBase64, 'base64');
      if (buf.length > MAX_PROFILE_PHOTO_BYTES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'errors.file.tooLarge' });
      }
      const { ext, mime } = await validateUploadMagicBytes(buf, input.bucket);

      const fileId = crypto.randomUUID();
      const storageKey = `${ctx.scope!.userId}/${fileId}.${ext}`;

      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      // INSERT row first, then upload — if upload fails we have an orphan row
      // (CRON cleanup task). Reverse would orphan the storage object on RLS denial.
      const [row] = await dbHandle.insert(uploadedFiles).values({
        id: fileId,
        ownerUserId: ctx.scope!.userId,
        bucket: input.bucket,
        storageKey,
        originalFilename: input.originalFilename,
        mimeType: mime,
        sizeBytes: buf.length,
        scanStatus: 'pending',
      } as any).returning();

      const { error } = await storageClient.storage
        .from(input.bucket)
        .upload(storageKey, buf, { contentType: mime, upsert: false });
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      }

      await malwareScanQueue.add('scan', { fileId, storageKey, bucket: input.bucket });

      await writeAudit(ctx, {
        action: 'file.upload',
        resourceType: 'uploaded_file',
        resourceId: fileId,
        newValues: { bucket: input.bucket, mimeType: mime, sizeBytes: buf.length },
      });

      return { fileId, scanStatus: 'pending' as const };
    }),

  getSignedUrl: protectedProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      // RLS narrows uploaded_files to those caller can see (file-row RLS = same as
      // owning entity's RLS — see RLS Patterns below). 0 rows → NOT_FOUND.
      const file = await dbHandle.query.uploadedFiles.findFirst({
        where: eq(uploadedFiles.id, input.fileId),
      });
      if (!file) throw new TRPCError({ code: 'NOT_FOUND' });
      if (file.scanStatus !== 'clean') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'errors.file.scanNotClean' });
      }
      const { data, error } = await storageClient.storage
        .from(file.bucket)
        .createSignedUrl(file.storageKey, 60 * 60); // 1h per D-24
      if (error || !data) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'errors.file.signedUrlFailed' });
      }
      return { url: data.signedUrl, expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
    }),

  getScanStatus: protectedProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      const file = await dbHandle.query.uploadedFiles.findFirst({
        where: eq(uploadedFiles.id, input.fileId),
        columns: { scanStatus: true, scanCompletedAt: true },
      });
      if (!file) throw new TRPCError({ code: 'NOT_FOUND' });
      return file;
    }),
});
```

[CITED: supabase.com/docs/reference/javascript/storage-from-createsignedurl — `createSignedUrl(path, expiresIn)`; `upload(path, buf, {contentType, upsert})`.]

### Zod schema with i18n-key error messages (D-46)

```typescript
// src/server/trpc/schemas/player.ts
import { z } from 'zod';

const addressFields = z.object({
  street: z.string().min(1, { message: 'errors.field.required' }),
  streetNumber: z.string().optional(),
  postalCode: z.string().regex(/^[0-9]{4}$/, { message: 'errors.field.belgianPostalCode' }),
  city: z.string().min(1, { message: 'errors.field.required' }),
  province: z.string().min(1, { message: 'errors.field.required' }),
  country: z.string().min(2).max(2).default('BE'),
});

const emergencyContactFields = z.object({
  emergencyContactName: z.string().min(1).optional(),
  emergencyContactPhone: z.string().min(1).optional(),
  emergencyContactRelation: z.string().min(1).optional(),
});

export const playerCreateInput = z
  .object({
    userId: z.string().uuid(), // user must exist (admin.user.create runs first)
    firstName: z.string().min(1, { message: 'errors.field.required' }),
    lastName: z.string().min(1, { message: 'errors.field.required' }),
    dateOfBirth: z.coerce.date().max(new Date(), { message: 'errors.field.dateInPast' }),
    gender: z.enum(['male', 'female', 'x']),
    school: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email({ message: 'errors.field.email' }).optional(),
    club: z.string().optional(),
    statusCode: z.string(),                 // FK to status.code
    academyCode: z.string(),                // FK to academy.code
  })
  .extend(addressFields.shape)
  .extend(emergencyContactFields.shape)
  .strict();
```

[CITED: amannn/next-intl docs — zod validation error key i18n form pattern: messages emitted as keys, resolved via `getTranslations`/`useTranslations`.]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trust `file.type` from browser | Magic-bytes via `file-type` Buffer detection | VALID-02 standard 2024+ | Required to mitigate file-extension-spoofing attacks |
| Public bucket URLs for "non-sensitive" files | Signed URLs only, even for profile photos | FILE-01 standard for GDPR-touching personal data | Profile photos ARE personal data; treat as such |
| Sync malware scan in request | Async scan via queue + polling | Modern UX expectation; clamd cold-start ~1s | Avoids request-timeout failures under load |
| `display_name_nl/en/fr` columns | Canonical proper-noun column + i18n catalog | I18N-06 design lesson from European multilingual products | Works for academies/clubs/persons; doesn't work for descriptive labels (those need translations) |
| `react-dropzone` | Self-built HTML5 drag/drop on `<input type="file">` | Bundle-size-conscious 2025 trend | One less dep; full control of state machine |
| Hand-rolled CHECK constraint sql files | Drizzle `check()` helper in pgTable | Drizzle 0.30+ added the `check()` helper | Schema + constraint co-located in TS |

**Deprecated/outdated:**
- `clamscan@^1.x` — older; prefer v2 with explicit `localFallback: false` for remote-only TCP setup.
- `react-dropzone` — works but adds 7KB; D-41 explicitly excludes.
- Public Supabase Storage buckets for "convenience" — never appropriate for personal data under GDPR.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 6 academies in PLAYER-02 are: Topsportschool, Academy Antwerpen, plus 4 yet-unconfirmed names. The TD must supply the canonical list. | Lookup seeding strategy | Wrong canonical names → `academy.canonical_name` shows mis-spelled / wrong-cased academy names in UI for all locales (since not translated). Easy to fix later via UPDATE on `academy` rows but creates churn. |
| A2 | The Belgian table tennis youth age categories are: **Preminiemen, Miniemen, Cadetten, Junioren, Senioren, Veteranen** (with seniors and veterans inferred — only youth is published on vttl.be 2025 page). Birth-year ranges per category for season N are **NOT** in this research; TD must supply (or we follow KBTTB Sportreglementen PDF that we have not parsed). [ASSUMED] | Lookup seeding (age_categories) | Wrong birth-year ranges → `deriveAgeCategory(dob, asOfDate)` returns wrong category at player.create → tournament validation in Phase 4 silently lets ineligible players register. **MUST confirm with TD before plan execution starts.** |
| A3 | Trainer diploma categories are: **none, A, B, A-in-opleiding, B-in-opleiding** (5 codes per TRAINER-02 ROADMAP). [ASSUMED — taken verbatim from REQUIREMENTS.md] | Lookup seeding (trainer_diploma) | Lower risk (admin field, not gating); planner can add via UPDATE if codes change. |
| A4 | ClamAV signature DB freshness via `freshclam` cron (every 24h) is sufficient for v1 risk surface (small, internal, profile photos only). [ASSUMED — based on industry default] | Pitfall §ClamAV signature staleness | If a fresh-zero-day picture-formatted exploit appears, signatures could be ≤24h stale. For profile photos this is acceptable; reconsider for medical PDFs in Phase 5. |
| A5 | Coolify CX31 has enough RAM for an additional ClamAV daemon (~700MB resident). [ASSUMED — based on Hetzner CX31 = 8GB RAM, app+postgres+redis already use ~2GB per Phase 1 sizing] | Deployment | If ClamAV OOMs, fallback to a separate small VM (CX11 = €4/mo) — not a v1 blocker. |
| A6 | Supabase Storage bucket `profiles/` was created in Phase 1 setup (per CONTEXT.md `code_context` "bucket `profiles/` bestaat al"). **Not verified by reading any migration file** — there is no `0000–0005` file with `INSERT INTO storage.buckets`. [ASSUMED] | Integration Points | If the bucket does not exist, the Phase 2 first upload fails with `Bucket not found`. Easy fix: add `INSERT INTO storage.buckets (id, name, public) VALUES ('profiles', 'profiles', false) ON CONFLICT DO NOTHING;` to `0007_phase2_rls_policies.sql`. **Recommended: do this anyway as defense-in-depth.** |

**If this table is empty:** N/A — research has 6 assumed claims; A2 is the highest-risk and demands TD confirmation before execution.

## Lookup-Tabel Data Seeding Strategy

Phase 2 introduces 2 new lookup tables (`age_categories`, `trainer_diploma`) and expands one existing (`academy`). All three follow the Phase 1 pattern: `code text PRIMARY KEY`, `sort_order integer NOT NULL`, `active boolean NOT NULL DEFAULT true`. Codes are language-neutral; labels go in `messages/{nl,en,fr}.json` `lookups.<table>.<code>`.

### Existing: `academy` (D-19, already in `lookups.ts`)

Currently seeded in `tests/integration/trainer-academy.test.ts` (line 35) with 2 codes: `academy_antwerpen`, `topsportschool`. **PLAYER-02 says 6 academies.** Phase 2 adds 4 more — **TD must supply canonical names**.

**Proposed seed (placeholders — TD to confirm):**

| code | canonical_name | sort_order | i18n-keys | Confidence |
|------|----------------|------------|-----------|------------|
| `topsportschool` | Topsportschool | 1 | (already in nl.json line 64) | HIGH (seeded) |
| `academy_antwerpen` | Academy Antwerpen | 2 | (already in nl.json line 65) | HIGH (seeded) |
| `academy_brussel` | (TD confirms) | 3 | new | [ASSUMED A1] |
| `academy_oost_vlaanderen` | (TD confirms) | 4 | new | [ASSUMED A1] |
| `academy_west_vlaanderen` | (TD confirms) | 5 | new | [ASSUMED A1] |
| `academy_limburg` | (TD confirms) | 6 | new | [ASSUMED A1] |

> Per D-45 the canonical name is rendered identically in nl/en/fr. The `messages/{nl,en,fr}.json` `lookups.academy.<code>` value duplicates the canonical name verbatim in all three catalogs — the i18n indirection exists for consistency with other lookup tables, not for translation.

### NEW: `age_categories`

**Proposed schema:**

```typescript
export const ageCategories = pgTable('age_categories', {
  code: text('code').primaryKey(), // 'age_pre_minor' | 'age_minor' | 'age_cadet' | 'age_junior' | 'age_senior' | 'age_veteran'
  sortOrder: integer('sort_order').notNull(),
  // Birth-year boundary helpers — exclusive upper, inclusive lower —
  // applied as `birthYear >= bornAfterOrEqual AND birthYear <= bornBeforeOrEqual`
  bornAfterOrEqual: integer('born_after_or_equal'), // null = no lower bound (e.g., veteran)
  bornBeforeOrEqual: integer('born_before_or_equal'), // null = no upper bound (e.g., senior)
  active: boolean('active').notNull().default(true),
});
```

**Proposed seed (TD MUST confirm birth-year boundaries — these are placeholders mapping to the Flemish Youth Championship 2025 page data we found):**

| code | sort_order | bornAfterOrEqual | bornBeforeOrEqual | nl label | Confidence |
|------|------------|------------------|-------------------|----------|------------|
| `age_pre_minor` | 1 | 2014 | 2016 | Preminiemen | [ASSUMED A2 — vttl.be 2025 page mentions 2015–2016 in pre-minor sub-divisions; treat ranges as illustrative until TD confirms] |
| `age_minor` | 2 | 2012 | 2014 | Miniemen | [ASSUMED A2] |
| `age_cadet` | 3 | 2010 | 2012 | Cadetten | [ASSUMED A2] |
| `age_junior` | 4 | 2007 | 2010 | Junioren | [ASSUMED A2] |
| `age_senior` | 5 | 1962 | 2007 | Senioren | [ASSUMED A2 — boundary with veteran TBD] |
| `age_veteran` | 6 | NULL | 1961 | Veteranen | [ASSUMED A2] |

> **PLANNER ACTION:** Surface this table to the TD in the discuss-phase wave or in plan-bouncer feedback. Mark as a **D-CONFIRMATION** request before executing the seed migration. Until confirmed, the planner SHOULD NOT lock these boundary values; insert with `bornAfterOrEqual=NULL, bornBeforeOrEqual=NULL` and overwrite once TD confirms.

### NEW: `trainer_diploma`

**Proposed seed (per TRAINER-02 verbatim, low risk):**

| code | sort_order | nl label | en label | fr label |
|------|------------|----------|----------|----------|
| `diploma_none` | 1 | Geen | None | Aucun |
| `diploma_a` | 2 | Diploma A | Diploma A | Diplôme A |
| `diploma_b` | 3 | Diploma B | Diploma B | Diplôme B |
| `diploma_a_in_training` | 4 | Diploma A in opleiding | Diploma A in training | Diplôme A en formation |
| `diploma_b_in_training` | 5 | Diploma B in opleiding | Diploma B in training | Diplôme B en formation |

### NEW: `status` (already exists, but `status_a`/`b`/`c` codes need labels per UI-SPEC line 134)

`status` table is in `src/server/db/schema/lookups.ts` line 29; `messages/nl.json` line 58–62 already has `lookups.status.status_a/b/c`. **Already done in Phase 1.** Phase 2 only consumes.

### Seed migration vs runtime seed

Two patterns:

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| `0008_phase2_lookup_seed.sql` migration with `INSERT ... ON CONFLICT DO NOTHING` | Versioned, replayable, applied automatically on every deploy | Hard to keep in sync if TD edits in dev; rollback awkward | **Recommended** — lookups are reference data, not user data |
| Runtime `pnpm seed` script | Easier to edit | Not in migration history; staging vs prod can drift | Useful for fixtures/dev only |

**Decision (planner discretion per D-44):** ship `0008_phase2_lookup_seed.sql` with `ON CONFLICT (code) DO NOTHING` so re-running is safe; document in `docs/lookup-seeding.md`.

## Files to Create / Modify (for gsd-pattern-mapper)

### Create (NEW files)

```
drizzle/0006_phase2_profiles_and_files.sql
drizzle/0006_phase2_profiles_and_files.rollback.md
drizzle/0007_phase2_rls_policies.sql
drizzle/0007_phase2_rls_policies.rollback.md
drizzle/0008_phase2_lookup_seed.sql
drizzle/0008_phase2_lookup_seed.rollback.md

src/server/db/schema/players.ts          ← players, age_category_history pgTable defs
src/server/db/schema/trainers.ts         ← trainers pgTable
src/server/db/schema/files.ts            ← uploaded_files pgTable
src/server/trpc/schemas/player.ts        ← Zod input schemas (D-46 i18n keys)
src/server/trpc/schemas/trainer.ts
src/server/trpc/schemas/file.ts
src/server/trpc/routers/player.ts        ← create/get/list/updateSelf/updateAsTd/updateOnBehalfOf/setAgeCategory
src/server/trpc/routers/trainer.ts       ← create/get/list/updateSelf/updateAsTd
src/server/trpc/routers/file.ts          ← upload/getSignedUrl/getScanStatus/delete
src/server/storage/client.ts             ← service-role Supabase client (server-only)
src/server/storage/profile-photo.ts      ← uploadProfilePhoto helper
src/server/storage/signed-url.ts         ← createProfilePhotoSignedUrl
src/server/storage/magic-bytes.ts        ← validateUploadMagicBytes
src/server/workers/jobs/malware-scan.ts  ← processMalwareScan job

src/lib/players.ts                       ← deriveAgeCategory, getAgeCategoryAt
src/lib/forms/zod-i18n.ts                ← <FormMessage> i18n adapter

src/components/players/player-list-table.tsx
src/components/players/player-create-form.tsx
src/components/players/player-edit-form.tsx
src/components/players/player-header.tsx
src/components/players/age-category-change-dialog.tsx
src/components/trainers/trainer-list-table.tsx
src/components/trainers/trainer-create-form.tsx
src/components/trainers/trainer-edit-form.tsx
src/components/trainers/trainer-header.tsx
src/components/file/photo-upload.tsx
src/components/lookup/lookup-select.tsx
src/components/common/empty-state.tsx

src/app/[locale]/(app)/players/page.tsx
src/app/[locale]/(app)/players/new/page.tsx
src/app/[locale]/(app)/players/[id]/page.tsx
src/app/[locale]/(app)/trainers/page.tsx
src/app/[locale]/(app)/trainers/new/page.tsx
src/app/[locale]/(app)/trainers/[id]/page.tsx
src/app/[locale]/(app)/me/profile/page.tsx

docs/i18n-conventions.md                 ← D-45 proper-noun rule
docs/file-upload-pipeline.md             ← ClamAV sidecar config + freshclam cron + magic-bytes registry
docs/lookup-seeding.md                   ← seed migration discipline

tests/unit/players-derive-age-category.test.ts
tests/unit/magic-bytes.test.ts
tests/integration/player-router.test.ts  ← RBAC matrix expansion: 7 roles × player resource
tests/integration/trainer-router.test.ts
tests/integration/file-upload.test.ts
tests/integration/age-category-history.test.ts
tests/rls/players-direct-query.test.ts   ← RLS backstop: direct DB query as wrong-academy trainer returns 0 rows
tests/e2e/photo-upload.spec.ts           ← Playwright: visual states pending → clean
```

### Modify (existing files)

```
package.json                              ← add @supabase/supabase-js, clamscan
src/lib/env.ts                            ← add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLAMAV_HOST, CLAMAV_PORT
.env.example                              ← document the 4 new env vars
src/lib/log-redact-paths.ts               ← add *.emergencyContactPhone (phone already covered, but emergency_contact_phone is snake_case in DB; verify pino redact handles snake_case)
src/server/db/schema/lookups.ts           ← add ageCategories, trainerDiploma exports
src/server/db/schema/index.ts             ← re-export new schemas
src/server/db/rls/functions.sql           ← OPTIONAL: add players_table_visible_to() if RLS shape needs it
src/server/db/rls/policies.sql            ← add policies for players, trainers, uploaded_files, age_category_history, storage.objects (profiles bucket)
src/server/trpc/routers/_app.ts           ← register playerRouter, trainerRouter, fileRouter
src/server/workers/queues.ts              ← add MALWARE_SCAN queue
src/server/workers/index.ts               ← add malware-scan Worker
src/components/admin/user-table.tsx       ← (optional) link "Open profile" → /players/[id] for player rows; not blocking
messages/nl.json                          ← add players.*, trainers.*, files.*, lookups.{ageCategory, trainerDiploma}.*, errors.field.*
messages/en.json                          ← same keys, en values per UI-SPEC Copywriting Contract
messages/fr.json                          ← same keys, fr values per UI-SPEC Copywriting Contract
docs/deployment.md                        ← add ClamAV sidecar config + Supabase env vars
coolify.json                              ← add clamav service definition
.github/workflows/ci.yml                  ← extend RBAC matrix tests to include player + trainer resources (7×7 = 49)
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^3` (unit + integration) + `@playwright/test@^1.59` (e2e) — both Phase-1 baseline |
| Config file | `vitest.config.ts`, `playwright.config.ts` (both at repo root) [VERIFIED] |
| Quick run command | `pnpm test -- <pattern>` (e.g., `pnpm test players-derive-age-category`) |
| Full suite command | `pnpm test && pnpm test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAYER-01 | All required address/identity fields persist on `players` | unit (schema) | `pnpm test players-schema` | ❌ Wave 0 |
| PLAYER-04 | `age_category` + `category_year` columns set explicitly at create | integration | `pnpm test player-router -t "create stores age category"` | ❌ Wave 0 |
| PLAYER-05 | Profile photo via signed URL only; bucket URL returns 403 | e2e + integration | `pnpm test:e2e photo-upload.spec.ts` + `pnpm test file-upload -t "no public bucket"` | ❌ Wave 0 |
| PLAYER-06 | Emergency contact CHECK constraint blocks minor without contact | integration (DB-level) | `pnpm test player-router -t "minor without emergency contact rejected"` | ❌ Wave 0 |
| PLAYER-07 | Player can edit own non-sensitive; cannot edit status/academy | integration (RBAC) | `pnpm test player-router -t "self-update rejects status field"` | ❌ Wave 0 |
| TRAINER-03 | Trainer scope via `academy_memberships` filters player.list | integration | `pnpm test player-router -t "trainer sees only own-academy players"` | ❌ Wave 0 |
| FILE-01 | Signed URL TTL = 1h (D-24); `file.getSignedUrl` returns 404 for non-clean | integration | `pnpm test file-upload -t "signed url issued only when clean"` | ❌ Wave 0 |
| FILE-04 | Storage key uses UUID; original filename in `original_filename` only | integration | `pnpm test file-upload -t "storage key is UUID"` | ❌ Wave 0 |
| VALID-01 | 2MB limit enforced server-side (client check is non-authoritative) | integration | `pnpm test file-upload -t "exceeds 2MB rejected"` | ❌ Wave 0 |
| VALID-02 | Magic-bytes mismatch rejected (e.g., .jpg renamed PDF) | unit | `pnpm test magic-bytes -t "rejects mismatched mime"` | ❌ Wave 0 |
| VALID-03 | MIME whitelist enforced (e.g., GIF rejected for profile bucket) | integration | `pnpm test file-upload -t "rejects gif"` | ❌ Wave 0 |
| VALID-04 | EICAR test buffer routed through scan → `infected` status | integration | `pnpm test malware-scan -t "EICAR detected"` | ❌ Wave 0 |
| VALID-05 | Signed URL serves `Content-Disposition: attachment` | integration | `pnpm test file-upload -t "content-disposition attachment"` | ❌ Wave 0 |
| VALID-06 | Zod rejects unknown fields via `.strict()` | unit | `pnpm test player-schemas -t "strict rejects extras"` | ❌ Wave 0 |
| DOM-CAT-01 | `age_category_history` row inserted at create + on setAgeCategory | integration | `pnpm test age-category-history -t "history row per change"` | ❌ Wave 0 |
| DOM-CAT-02 | `getAgeCategoryAt(playerId, date)` returns category at that date | unit | `pnpm test players-derive-age-category` | ❌ Wave 0 |
| USER-04 | Trainer direct-DB query as `app_user` returns 0 rows for other-academy | rls | `pnpm test players-direct-query -t "wrong academy returns 0 rows"` | ❌ Wave 0 |
| I18N-08 | Zod errors emit i18n-key strings, not English literals | unit | `pnpm test player-schemas -t "zod messages are i18n keys"` | ❌ Wave 0 |
| RBAC matrix expansion | 7 roles × {player, trainer, uploaded_file, age_category_history} = 28 new probes | integration | `pnpm test rbac-matrix -t "phase 2"` | ❌ Wave 0 |

### Sampling Rate (Nyquist)

- **Per task commit:** `pnpm test -- <touched-file-pattern>` — typically a single integration or unit test in <10s.
- **Per wave merge:** `pnpm test && pnpm test:e2e` — full suite (Phase 1 baseline ~3min unit + ~2min e2e against testcontainers).
- **Phase gate:** Full suite green; RLS direct-query suite green; RBAC matrix 7×{users, players, trainers, uploaded_files, audit_log, parent_child_links, academy_memberships} = 7×7 = 49 cells all asserting expected outcome (200/403/404).

### Wave 0 Gaps

- [ ] `tests/unit/players-derive-age-category.test.ts` — unit covers DOM-CAT-02 lookup math + boundary cases
- [ ] `tests/unit/magic-bytes.test.ts` — covers VALID-02
- [ ] `tests/unit/player-schemas.test.ts` — Zod i18n-keys + strict rejection (I18N-08, VALID-06)
- [ ] `tests/integration/player-router.test.ts` — covers PLAYER-01..07 + USER-04 trainer scope
- [ ] `tests/integration/trainer-router.test.ts` — covers TRAINER-01..03
- [ ] `tests/integration/file-upload.test.ts` — covers FILE-01..04 + VALID-01/03/05
- [ ] `tests/integration/age-category-history.test.ts` — covers DOM-CAT-01 + concurrency-pitfall test
- [ ] `tests/integration/malware-scan.test.ts` — covers VALID-04 (requires testcontainer ClamAV image; alternatively mock the queue and assert enqueue + reuse Phase-1 BullMQ test pattern from `tests/unit/worker-template.test.ts`)
- [ ] `tests/rls/players-direct-query.test.ts` — direct `app_user` connection, set GUCs to wrong-academy trainer, expect 0 rows
- [ ] `tests/e2e/photo-upload.spec.ts` — visual state machine: drop file → spinner → pending Badge → clean (or infected with EICAR fixture)
- [ ] Extend `tests/integration/rbac-matrix.test.ts` (Phase 1) — add `players`, `trainers`, `uploaded_files`, `age_category_history` resource probes for 7 roles

*Framework already installed; these are missing TEST FILES, not framework gaps. Wave 0 in Phase 2 = scaffolding the RED tests, then Wave 1+ implement them GREEN.*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (transitively) | Better Auth (Phase 1); Phase 2 mutations all require `protectedProcedure` (auth gate). |
| V3 Session Management | yes | Phase-1 cookies (httpOnly, Secure, SameSite=Lax); D-09 revocation; D-37 player.update enforces server-side scope, never trusts client claims. |
| V4 Access Control | yes | RLS on `players`, `trainers`, `uploaded_files`, `age_category_history`; tRPC role checks (`tdProcedure`); `players_visible_to()` SECURITY DEFINER reused. **D-36 404-not-403** prevents enumeration. |
| V5 Input Validation | yes | Zod `.strict()` on every mutation; magic-bytes validation; size limits; D-46 i18n-key error messages. |
| V6 Cryptography | yes (signed URLs) | Supabase Storage signed URLs use HMAC-SHA256 (Supabase-managed key); we never store the signing key in app code; service-role key in env only. |
| V7 Error Handling | partial | tRPC error formatter (Phase 1); D-46 maps Zod issues to i18n keys. Verify error messages do not leak DB-internal details. |
| V8 Data Protection | yes | Profile photos = personal data per GDPR Art. 4(1); private bucket; signed URL TTL; audit_log on `file.upload` + `file.replace`. |
| V9 Communication | yes | HTTPS via Coolify + Let's Encrypt (Phase 1); Supabase TLS; ClamAV TCP — see threat below. |
| V10 Malicious Code | yes | ClamAV scan via D-22; `Content-Disposition: attachment` (VALID-05) prevents browser execution of unknown types. |
| V12 File and Resources | yes | UUID filenames (FILE-04); private bucket; size limit (VALID-01); MIME whitelist (VALID-03). |
| V13 API and Web Service | yes | tRPC + CSRF (Phase 1); `requireAuth`/`tdProcedure`; rate limit reused (SEC-08 file upload 10/min/user — already on `protectedProcedure`). |

### Known Threat Patterns for {Next.js + tRPC + Supabase Storage + Postgres + ClamAV}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| File-extension spoofing (PDF disguised as JPG) | Tampering | Magic-bytes via `fileTypeFromBuffer` (VALID-02). |
| Polyglot file (HTML+JPEG dual-format) | Tampering / Information Disclosure | `Content-Disposition: attachment` (VALID-05) — browser will not execute. |
| Stored XSS via `original_filename` echoed in UI | Tampering | Render filename as text only via React (auto-escapes); never `dangerouslySetInnerHTML`. |
| Cross-academy enumeration | Information Disclosure | 404-not-403 (D-36); RLS returns 0 rows; same UI copy for "no players in scope" vs "no players exist". |
| Service-role key leak (bundle into client) | Elevation of Privilege | `import 'server-only'` directive; ESLint restricted-imports rule on `@/server/storage/*` from client paths (Pitfall 4). |
| Direct browser-to-Supabase upload bypassing server validation | Bypass | Only server-side upload pattern; no client browser code calls `supabase.storage.upload()`. |
| Stale signed URL replayed by attacker | Information Disclosure | 1h TTL (D-24); audit_log records every URL issuance for forensic. |
| ClamAV TCP unauthenticated | Information Disclosure / Tampering | Coolify private network only; clamd MUST NOT bind to public interface. Document `TCPAddr 127.0.0.1` or container-network-only in `docs/file-upload-pipeline.md`. [CITED: docs.clamav.net "clamd does not currently protect or authenticate traffic coming over the TCP socket"] |
| ClamAV signature staleness | Repudiation / Tampering | freshclam cron (Pitfall 3); document update cadence. |
| Race in age-category transitions | Tampering | Serializable transaction (Pitfall 6). |
| Audit-log tampering on file ops | Repudiation | Phase-1 `app_user` REVOKE UPDATE/DELETE on `audit_log`; `writeAudit` writes through that connection — append-only. |
| File-upload DoS (large or many uploads) | Denial of Service | SEC-08 rate limit (10/min, 100/day) reused; size limit (2MB); BullMQ concurrency=5 prevents scan worker overrun. |
| Orphan storage objects (DB INSERT succeeds, scan never runs) | Resource exhaustion | CRON cleanup task (deferred to Phase 8 OPS-09 routine? Or add `pg_cron` job in Phase 2 docs as TODO; not v1 blocker). |

## Open Questions

1. **Should Phase 2 add a `players_table_visible_to()` SECURITY DEFINER fn that returns `players.user_id` rather than `users.id`, to avoid double-indirection in RLS policies?**
   - What we know: Phase 1's `players_visible_to()` returns `users.id`. Direct usage in `players` RLS works because `players.user_id IS users.id` (same UUID).
   - What's unclear: Whether the planner should add a thin wrapper for clarity vs. accept the indirection.
   - Recommendation: Use the existing function as-is; it works; adding a wrapper is cosmetic. Note in the plan.

2. **Where exactly does the multipart upload land in the tRPC stack — base64-in-JSON or true `multipart/form-data` Route Handler?**
   - What we know: Phase 1 has tRPC over JSON; no precedent for binary uploads.
   - What's unclear: tRPC v11 supports FormData natively (per upstream docs), but the team's existing pattern is JSON. Base64-in-JSON inflates payload by 33% but keeps the transport homogeneous.
   - Recommendation (planner discretion): For 2MB profile photos, base64-in-JSON gives a 2.66MB request — within `bodyParser.sizeLimit: '5mb'`. **Recommend base64 in v1**; revisit if Phase 5 medical PDFs (5MB → 6.66MB) push limits. Document in `docs/file-upload-pipeline.md`.

3. **Should the `uploaded_files` row exist BEFORE the storage upload, or AFTER?**
   - What we know: Pre-INSERT means orphan DB row on storage failure; post-INSERT means orphan storage object on DB failure.
   - Recommendation: **Pre-INSERT** (DB row first, then upload). Orphan DB rows are easier to find (`scan_status='pending' AND uploaded_at < now() - 5min`) and cleanable; orphan storage objects require listing the bucket and joining against the DB — slower. Document the cleanup task as a TODO for Phase 8 OPS routine.

4. **TD must confirm before plan execution: (a) the 4 missing academy canonical names; (b) the birth-year boundaries for each age category code.**
   - Recommendation: Surface in discuss-phase or treat as a PHASE-START blocker with a fallback (insert with NULL boundaries; `deriveAgeCategory` returns null until a TD-only admin tool confirms — UI shows "Categorie nog niet bepaald" until set). [ASSUMED A1, A2]

5. **Should `players.club` be a free-text or a lookup?**
   - What we know: PLAYER-02 says "club (vrij tekst)" — explicitly free text. Search is on canonical names, but VTTL has hundreds of clubs across BE.
   - Recommendation: Free text with `text NOT NULL DEFAULT ''` on `players.club`; search via Phase 7 `pg_trgm` (deferred). Phase 2 ships free text — done.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Postgres (Supabase) | All phases | ✓ (Phase 1 setup) | Supabase Pro Frankfurt | — |
| Supabase Storage `profiles/` bucket | FILE-03 | ⚠ Assumed (A6) | — | Add `INSERT INTO storage.buckets` to `0007_phase2_rls_policies.sql` defensively |
| Upstash Redis (REST) | rate limit, revocation | ✓ (Phase 1) | — | — |
| ioredis-compatible Redis (TCP/TLS) | BullMQ | ✓ (Phase 1 `REDIS_URL`) | Upstash TCP endpoint | — |
| Node ≥ 24 | `crypto.randomUUID`, modern globals | ✓ | v24.15.0 | — |
| ClamAV daemon (TCP 3310) | VALID-04 | ✗ NOT YET | — | **Blocks Phase 2 production launch.** Coolify sidecar must be provisioned. Dev: skip-mark scan tests OR run testcontainers `clamav/clamav:stable`. |
| Docker (for testcontainers) | RLS direct-query test, ClamAV test | ✗ NOT on this dev machine | — | CI has Docker; dev may need to install (not blocking — Phase 1 already uses testcontainers per `package.json` `@testcontainers/postgresql`). |
| ffmpeg | Phase 5+ video — out of scope | ✗ | — | Not needed Phase 2. |
| `freshclam` | ClamAV signature updates | implicit in clamav Docker image | bundled | Coolify scheduled job per D-22 documented. |

**Missing dependencies blocking execution:**
- ClamAV daemon — must be provisioned in Coolify before VALID-04 acceptance test passes; dev workflow can mock the BullMQ job (unit-level `worker-template.test.ts` pattern from Phase 1).

**Missing dependencies with fallback:**
- Supabase `profiles/` bucket — defensive `CREATE BUCKET IF NOT EXISTS` in migration.
- Local Docker — dev can run `pnpm test --filter !rls` to skip integration tests requiring testcontainers; CI runs the full suite.

## Project Constraints (from CLAUDE.md)

These directives are extracted from `./CLAUDE.md` and apply with the same authority as locked CONTEXT.md decisions:

1. **Multilingual UI nl/en/fr — all user-facing strings via i18n catalog**, codes in DB. Backend logs and source code English.
2. **GDPR-strict** — medical separation, consent tracking, technical role enforcement at API + DB layer.
3. **Calendar week view** mandatory for v1 — Phase 3, not Phase 2; do not introduce calendar UI here.
4. **Lookups centrally managed, not free-text** — `academy`, `status`, `age_categories`, `trainer_diploma`. Player's `club` is the documented exception (free text per PLAYER-02).
5. **Authorization is a hard constraint** — RLS + tRPC role checks; never UI-only.
6. **Stack: Next.js 15.x App Router + tRPC 11 + Drizzle 0.40+ (we're on 0.45) + Postgres 16 + Better Auth + Supabase Pro Frankfurt + Coolify Hetzner.** Do NOT introduce alternatives.
7. **Forbidden:** Firebase, Supabase as primary auth, Auth0/Clerk for primary auth, Prisma, MongoDB, Vercel as primary host, public Pusher, Mux/Wistia, react-big-calendar, react-i18next, Moment.js, jQuery, Google Fonts CDN load, react-dropzone (D-41 alignment), `display_name_nl/en/fr` columns (D-45 alignment).
8. **GSD workflow** — file edits only via GSD command path; pattern-mapper enforced.
9. **No CLAUDE.md "developer profile" yet** — keep general best-practice posture.

## Sources

### Primary (HIGH confidence)

- Codebase grep + reads (2026-05-06):
  - `package.json` — installed deps + versions
  - `drizzle/0002_rls_functions_and_policies.sql` — `players_visible_to()` SECURITY DEFINER (lines 86–129); RLS policy patterns (lines 195–496); trainer/academy_manager arm verified at lines 109–116.
  - `src/server/trpc/routers/admin.ts` — `tdProcedure` + `writeAudit` + `linkAcademy` pattern (lines 372–402).
  - `src/server/trpc/middleware/freshSession.ts` — procedure presets `protectedProcedure | tdProcedure | sensitiveProcedure | medicalProcedure`.
  - `src/server/trpc/middleware/audit.ts` — `writeAudit(ctx, entry)` API.
  - `src/server/trpc/middleware/rls.ts` — `withRlsContext` GUC binding pattern.
  - `src/server/db/schema/{auth,memberships,lookups}.ts` — column conventions, `tstz` helper, `pgEnum`, `unique`, FK with `onDelete`.
  - `src/server/workers/{queues,index,connection}.ts` — BullMQ template + Worker spawn + ioredis.
  - `src/components/admin/user-table.tsx` — Server-Component-feeds-initialData → Client `useQuery` pattern.
  - `src/lib/log-redact-paths.ts` — pino redact paths convention.
  - `messages/{nl,en,fr}.json` — existing catalog shape (read nl.json full).
- Context7 docs `/drizzle-team/drizzle-orm-docs` — `check()` constraint helper, composite index `.on(col.desc(), col.nullsLast())` API for v0.31+.
- Context7 docs `/amannn/next-intl` — Zod validation error key pattern; Server Component + Client form composition.
- WebFetch supabase.com/docs `createSignedUrl(path, expiresIn)` API + `service-role key bypasses RLS`.
- WebFetch github.com/sindresorhus/file-type — `fileTypeFromBuffer(buffer)` ESM-only API, JPEG/PNG support.
- WebFetch github.com/kylefarris/clamscan — `scanStream()` API for in-memory; remote-only TCP via `clamdscan.host/port/localFallback:false`; return `{isInfected, viruses}`.
- WebFetch ui.shadcn.com/docs/components/data-table — DataTable is documentation-only; small lists fine with `<Table>` primitive.
- `npm view <pkg> version` — verified versions of `@supabase/supabase-js@2.105.3`, `clamscan@2.4.0`, `file-type@22.0.1`, `drizzle-orm@0.45.2`, `@hookform/resolvers@5.2.2`.

### Secondary (MEDIUM confidence)

- WebSearch + vttl.be 2025 youth championship page — Belgian table tennis age category names (Preminiemen, Miniemen, Cadetten, Junioren) verified; senior/veteran categories inferred (not on this page) and birth-year boundaries placeholder per [ASSUMED A2].
- docs.clamav.net manual — TCP socket commands (PING, INSTREAM, etc.) listed; default port 3310 is widely-known industry default but page returned 403 on detail. clamscan v2 uses 3310 by default in its config.

### Tertiary (LOW confidence)

- ClamAV signature update best practices — 24h cadence is industry-default, no single canonical source. [ASSUMED A4]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every version verified via `npm view` and Context7; no LOW-confidence library claims.
- Architecture: HIGH — Phase 1 patterns verified by reading the actual files; the few new pieces (Supabase Storage server-side flow, ClamAV worker) verified against upstream docs.
- File pipeline: HIGH on the API contract; MEDIUM on the storage-bucket-RLS interaction with Better Auth's non-Supabase JWT (planner should accept that the Phase-2 path is service-role-only and any browser-direct upload is deferred).
- Pitfalls: HIGH on Pitfalls 1–6 (verified against codebase or library docs); MEDIUM on Pitfall 7 (next-intl edge case, not directly tested) and Pitfall 8 (TanStack Query default behavior, well-known).
- Lookup seeding (academies, age categories): MEDIUM/LOW — boundary values [ASSUMED A1, A2]; canonical names for 4 of 6 academies unknown.
- Security domain: HIGH — ASVS map verified against current Phase 1 controls; new threats (file uploads, signed URLs) covered by standard patterns.

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (stable: Phase 1 baseline locked, no upstream major-version churn expected in 30 days; verify ClamAV image tag at deploy if past this date).

## RESEARCH COMPLETE
