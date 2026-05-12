---
phase: 02-identiteit-bestanden
plan_id: 02-07-trpc-schemas
plan: 07
type: execute
wave: 2
depends_on: [02-02-drizzle-schema-files]
files_modified:
  - src/server/trpc/schemas/player.ts
  - src/server/trpc/schemas/trainer.ts
  - src/server/trpc/schemas/file.ts
autonomous: true
requirements:
  - VALID-06
  - I18N-08
  - PLAYER-07
  - TRAINER-01

must_haves:
  truths:
    - "Every Zod schema uses .strict() (VALID-06 — rejects unknown keys)"
    - "Every error `message` is an i18n-key string starting with `errors.` (D-46, I18N-08)"
    - "playerCreateInput requires all PLAYER-01..02 fields; playerSelfUpdateInput accepts ONLY the D-37 non-sensitive whitelist"
    - "trainerCreateInput requires TRAINER-01..02; trainerSelfUpdateInput accepts ONLY non-sensitive fields per D-38"
    - "fileUploadInput accepts base64 content with size hint + Zod-validated MIME claim (server-authoritative magic-bytes overrides)"
    - "Schemas are importable from both server (tRPC input) and client (RHF resolver) — no Node-only deps"
  artifacts:
    - path: "src/server/trpc/schemas/player.ts"
      provides: "playerCreateInput, playerSelfUpdateInput, playerOnBehalfOfInput, playerSetAgeCategoryInput, playerUpdateAsTdInput"
      contains: "playerCreateInput"
      min_lines: 80
    - path: "src/server/trpc/schemas/trainer.ts"
      provides: "trainerCreateInput, trainerSelfUpdateInput, trainerUpdateAsTdInput"
      contains: "trainerCreateInput"
      min_lines: 50
    - path: "src/server/trpc/schemas/file.ts"
      provides: "fileUploadInput, fileGetSignedUrlInput, fileGetScanStatusInput"
      contains: "fileUploadInput"
      min_lines: 30
  key_links:
    - from: "src/server/trpc/schemas/player.ts"
      to: "src/server/db/schema/players.ts"
      via: "Zod schemas mirror Drizzle column constraints"
      pattern: "first_name|firstName"
    - from: "src/server/trpc/schemas/player.ts"
      to: "src/lib/forms/zod-i18n.ts (consumer)"
      via: "Error messages are i18n keys resolved by FormMessage"
      pattern: "errors\\."
---

<objective>
Lock the Zod input schemas for every Phase 2 tRPC mutation. These schemas are imported by **both** sides:

- **Server**: `src/server/trpc/routers/{player,trainer,file}.ts` (created in 02-09) for procedure input validation.
- **Client**: react-hook-form `zodResolver` calls in `<PlayerCreateForm>` etc. (created in 02-11/12) so the same validation runs before the request leaves the browser.

Every error message is an **i18n key** string per D-46 — never a literal user-facing label. The client's `useZodErrorMessage` adapter (02-04) resolves keys to text via `useTranslations('errors')`.

Field-level RBAC enforcement (D-37: player can update only non-sensitive fields) lives in the schema, not in the router — the `playerSelfUpdateInput` schema literally does not include `statusCode`/`academyCode`/`ageCategoryCode`/`dateOfBirth`/`gender`/`firstName`/`lastName`/`school`/`club`. `.strict()` makes Zod reject any extra fields the client tries to submit.

Output: 3 schema files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@.planning/phases/02-identiteit-bestanden/02-02-drizzle-schema-files-PLAN.md
@src/server/db/schema/players.ts
@src/server/db/schema/trainers.ts
@src/server/db/schema/files.ts
@CLAUDE.md

<interfaces>
<!-- Zod conventions used across the repo (Phase 1 examples) -->

```typescript
// Phase 1 patterns from src/server/trpc/routers/admin.ts:
const RoleSchema = z.enum(['technical_director', 'academy_manager', 'trainer', 'player', 'parent', 'sparring_partner', 'medical_staff']);
const LocaleSchema = z.enum(['nl', 'en', 'fr']);

// admin.user.create input shape (Phase 1):
z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: RoleSchema,
  preferredLocale: LocaleSchema.optional(),
  dateOfBirth: z.string().date().optional(),
}).strict()
```

```typescript
// Drizzle column ↔ Zod mapping (Phase 2):
// text NOT NULL → z.string().min(1, { message: 'errors.field.required' })
// text          → z.string().optional()
// date NOT NULL → z.coerce.date()  (RHF date input emits ISO string; coerce handles it)
// integer NOT NULL → z.coerce.number().int()
// boolean NOT NULL → z.boolean()
// FK text       → z.string() (server validates the actual code exists)
// uuid          → z.string().uuid()
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create src/server/trpc/schemas/player.ts</name>
  <read_first>
    - src/server/db/schema/players.ts (locked in 02-02 — column list)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-37 (self-update field whitelist)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Zod schema with i18n-key error messages
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Copywriting Contract (error key list)
  </read_first>
  <files>
    src/server/trpc/schemas/player.ts
  </files>
  <action>
    ```typescript
    /**
     * Zod input schemas for player.* tRPC mutations (Plan 02-09).
     *
     * All schemas use `.strict()` (VALID-06): client cannot smuggle extra
     * fields. All error messages are i18n keys (D-46 + I18N-08); client
     * resolves via `useZodErrorMessage` from `src/lib/forms/zod-i18n.ts`.
     *
     * Field-level RBAC matrix (D-37):
     *   playerCreateInput     — TD only; full PLAYER-01..02 field set.
     *   playerUpdateAsTdInput — TD/academy_manager; same fields as create.
     *   playerSelfUpdateInput — player editing self; whitelist of non-sensitive
     *                           fields (address, phone, email, emergencyContact_*).
     *   playerOnBehalfOfInput — parent of minor; same whitelist as self-update
     *                           (parent_child_links check is in the tRPC handler).
     *   playerSetAgeCategoryInput — TD only; D-32 mutation input.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-37
     */
    import { z } from 'zod';

    // ─── Shared field groups ────────────────────────────────────────────────

    /** Belgian postal code: exactly 4 digits (e.g., "2000" for Antwerp). */
    const belgianPostalCode = z.string().regex(/^[0-9]{4}$/, {
      message: 'errors.field.belgianPostalCode',
    });

    /** ISO-3166-1 alpha-2 country code; default BE. */
    const countryCode = z.string().length(2, { message: 'errors.field.country' });

    /** Address subset (D-27 — flat columns). Both create and update include these. */
    const addressFields = {
      street: z.string().min(1, { message: 'errors.field.required' }),
      streetNumber: z.string().optional(),
      postalCode: belgianPostalCode,
      city: z.string().min(1, { message: 'errors.field.required' }),
      province: z.string().min(1, { message: 'errors.field.required' }),
      country: countryCode.default('BE'),
    };

    /** Emergency contact subset (D-28). Optional in schema; CHECK constraint
     *  enforces presence when player.is_minor is true. */
    const emergencyContactFields = {
      emergencyContactName: z.string().min(1).optional(),
      emergencyContactPhone: z.string().min(1).optional(),
      emergencyContactRelation: z.string().min(1).optional(),
    };

    /** Contact subset shared between self-update and create. */
    const contactFields = {
      phone: z.string().min(1).optional(),
      email: z.string().email({ message: 'errors.field.email' }).optional(),
    };

    // ─── Schemas ────────────────────────────────────────────────────────────

    /** player.create — TD only. PLAYER-01..04. */
    export const playerCreateInput = z
      .object({
        userId: z.string().uuid(),  // existing user row (admin.user.create runs first)
        firstName: z.string().min(1, { message: 'errors.field.required' }),
        lastName: z.string().min(1, { message: 'errors.field.required' }),
        dateOfBirth: z.coerce.date().max(new Date(), { message: 'errors.field.dateInPast' }),
        gender: z.enum(['male', 'female', 'x']),
        school: z.string().optional(),
        ...addressFields,
        ...contactFields,
        club: z.string().optional(),
        statusCode: z.string().min(1, { message: 'errors.field.required' }),
        academyCode: z.string().min(1, { message: 'errors.field.required' }),
        // Initial age_category + categoryYear come from deriveAgeCategory at the
        // router layer — not accepted from client (PLAYER-04 expects explicit
        // server-derived values). If TD wants to override, use setAgeCategory.
        ...emergencyContactFields,
      })
      .strict();

    /** player.updateAsTd — TD / academy_manager (RLS narrows). Same shape as create
     *  minus `userId` (the row id) which becomes a separate path param. */
    export const playerUpdateAsTdInput = z
      .object({
        playerId: z.string().uuid(),
        firstName: z.string().min(1, { message: 'errors.field.required' }),
        lastName: z.string().min(1, { message: 'errors.field.required' }),
        dateOfBirth: z.coerce.date().max(new Date(), { message: 'errors.field.dateInPast' }),
        gender: z.enum(['male', 'female', 'x']),
        school: z.string().optional(),
        ...addressFields,
        ...contactFields,
        club: z.string().optional(),
        statusCode: z.string().min(1, { message: 'errors.field.required' }),
        academyCode: z.string().min(1, { message: 'errors.field.required' }),
        profilePhotoFileId: z.string().uuid().nullable().optional(),
        ...emergencyContactFields,
      })
      .strict();

    /** player.updateSelf — D-37 whitelist. Fields NOT in this schema are NOT
     *  accepted; `.strict()` rejects unknown keys. */
    export const playerSelfUpdateInput = z
      .object({
        ...addressFields,
        ...contactFields,
        ...emergencyContactFields,
        profilePhotoFileId: z.string().uuid().nullable().optional(),
      })
      .strict();

    /** player.updateOnBehalfOf — parent of minor; same whitelist as self-update
     *  + the target player id. tRPC handler verifies parent_child_links. */
    export const playerOnBehalfOfInput = z
      .object({
        playerId: z.string().uuid(),
        ...addressFields,
        ...contactFields,
        ...emergencyContactFields,
      })
      .strict();

    /** player.setAgeCategory — TD only (D-32). */
    export const playerSetAgeCategoryInput = z
      .object({
        playerId: z.string().uuid(),
        ageCategoryCode: z.string().min(1, { message: 'errors.field.required' }),
        categoryYear: z.coerce.number().int().min(1900).max(2100),
        effectiveFrom: z.coerce.date(),
      })
      .strict();

    /** player.list — pagination + optional filters. */
    export const playerListInput = z
      .object({
        academyCode: z.string().optional(),
        statusCode: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict();

    /** player.get — read by id. */
    export const playerGetInput = z
      .object({
        playerId: z.string().uuid(),
      })
      .strict();

    export type PlayerCreateInput = z.infer<typeof playerCreateInput>;
    export type PlayerUpdateAsTdInput = z.infer<typeof playerUpdateAsTdInput>;
    export type PlayerSelfUpdateInput = z.infer<typeof playerSelfUpdateInput>;
    export type PlayerOnBehalfOfInput = z.infer<typeof playerOnBehalfOfInput>;
    export type PlayerSetAgeCategoryInput = z.infer<typeof playerSetAgeCategoryInput>;
    ```

    Do NOT include `firstName`, `lastName`, `dateOfBirth`, `gender`, `school`, `club`, `statusCode`, `academyCode`, `ageCategoryCode`, `categoryYear`, `isMinor` in `playerSelfUpdateInput` — those are TD-managed (D-37).
    Do NOT include `playerId` in `playerSelfUpdateInput` — the player IS the target; the handler uses `ctx.scope.userId`.
    Do NOT add server-only imports (no Drizzle, no Buffer-only APIs) — these schemas must compile in the client bundle.
  </action>
  <verify>
    <automated>test -f src/server/trpc/schemas/player.ts && grep -q "export const playerCreateInput" src/server/trpc/schemas/player.ts && grep -q "export const playerSelfUpdateInput" src/server/trpc/schemas/player.ts && grep -q "export const playerOnBehalfOfInput" src/server/trpc/schemas/player.ts && grep -q "export const playerSetAgeCategoryInput" src/server/trpc/schemas/player.ts && grep -q "\.strict()" src/server/trpc/schemas/player.ts && grep -c "message: 'errors\." src/server/trpc/schemas/player.ts | grep -qE "^[5-9]|^[0-9]{2,}" && ! grep -E "statusCode|academyCode|ageCategoryCode" src/server/trpc/schemas/player.ts | grep -v "^export\|TdInput\|CreateInput\|SetAgeCategoryInput\|playerListInput" | grep -q "playerSelfUpdateInput" && npx tsc --noEmit 2>&1 | (! grep -i "error.*schemas/player\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - All 6 schemas exported with `.strict()` chained
    - `playerSelfUpdateInput` does NOT have `statusCode`/`academyCode`/`ageCategoryCode`/`firstName`/`lastName`/`dateOfBirth`/`gender`/`school`/`club` keys (D-37 compliance)
    - All `message:` strings start with `errors.`
    - `belgianPostalCode` regex matches exactly 4 digits
    - All `z.infer<...>` types exported
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Player schemas usable from both server tRPC procedures and client RHF resolvers.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Create src/server/trpc/schemas/trainer.ts</name>
  <read_first>
    - src/server/trpc/schemas/player.ts (Task 1 — reuse the addressFields/contactFields pattern)
    - src/server/db/schema/trainers.ts (locked in 02-02)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-38
  </read_first>
  <files>
    src/server/trpc/schemas/trainer.ts
  </files>
  <action>
    ```typescript
    /**
     * Zod input schemas for trainer.* tRPC mutations (Plan 02-09).
     *
     * RBAC matrix (D-38):
     *   trainerCreateInput     — TD only.
     *   trainerUpdateAsTdInput — TD only.
     *   trainerSelfUpdateInput — trainer editing self; non-sensitive whitelist
     *                            (address, phone, email).
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-38
     */
    import { z } from 'zod';

    const belgianPostalCode = z.string().regex(/^[0-9]{4}$/, {
      message: 'errors.field.belgianPostalCode',
    });

    const addressFields = {
      street: z.string().min(1, { message: 'errors.field.required' }),
      streetNumber: z.string().optional(),
      postalCode: belgianPostalCode,
      city: z.string().min(1, { message: 'errors.field.required' }),
      province: z.string().min(1, { message: 'errors.field.required' }),
      country: z.string().length(2).default('BE'),
    };

    const contactFields = {
      phone: z.string().min(1).optional(),
      email: z.string().email({ message: 'errors.field.email' }).optional(),
    };

    export const trainerCreateInput = z
      .object({
        userId: z.string().uuid(),
        firstName: z.string().min(1, { message: 'errors.field.required' }),
        lastName: z.string().min(1, { message: 'errors.field.required' }),
        dateOfBirth: z.coerce.date().max(new Date(), { message: 'errors.field.dateInPast' }),
        gender: z.enum(['male', 'female', 'x']),
        ...addressFields,
        ...contactFields,
        diplomaCode: z.string().min(1, { message: 'errors.field.required' }),
        hasPedagogicalQualification: z.boolean().default(false),
      })
      .strict();

    export const trainerUpdateAsTdInput = z
      .object({
        trainerId: z.string().uuid(),
        firstName: z.string().min(1, { message: 'errors.field.required' }),
        lastName: z.string().min(1, { message: 'errors.field.required' }),
        dateOfBirth: z.coerce.date().max(new Date(), { message: 'errors.field.dateInPast' }),
        gender: z.enum(['male', 'female', 'x']),
        ...addressFields,
        ...contactFields,
        diplomaCode: z.string().min(1, { message: 'errors.field.required' }),
        hasPedagogicalQualification: z.boolean(),
        profilePhotoFileId: z.string().uuid().nullable().optional(),
      })
      .strict();

    /** trainer.updateSelf — D-38 whitelist. */
    export const trainerSelfUpdateInput = z
      .object({
        ...addressFields,
        ...contactFields,
        profilePhotoFileId: z.string().uuid().nullable().optional(),
      })
      .strict();

    export const trainerListInput = z
      .object({
        academyCode: z.string().optional(),
        diplomaCode: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict();

    export const trainerGetInput = z
      .object({
        trainerId: z.string().uuid(),
      })
      .strict();

    export type TrainerCreateInput = z.infer<typeof trainerCreateInput>;
    export type TrainerUpdateAsTdInput = z.infer<typeof trainerUpdateAsTdInput>;
    export type TrainerSelfUpdateInput = z.infer<typeof trainerSelfUpdateInput>;
    ```

    Do NOT include `diplomaCode` or `hasPedagogicalQualification` in `trainerSelfUpdateInput` (D-38 — trainer-self cannot upgrade own diploma).
  </action>
  <verify>
    <automated>test -f src/server/trpc/schemas/trainer.ts && grep -q "export const trainerCreateInput" src/server/trpc/schemas/trainer.ts && grep -q "export const trainerSelfUpdateInput" src/server/trpc/schemas/trainer.ts && grep -q "\.strict()" src/server/trpc/schemas/trainer.ts && grep -q "diplomaCode" src/server/trpc/schemas/trainer.ts && grep -q "hasPedagogicalQualification" src/server/trpc/schemas/trainer.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*schemas/trainer\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - All 5 schemas exported with `.strict()`
    - `trainerSelfUpdateInput` does NOT have `diplomaCode` or `hasPedagogicalQualification` keys
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Trainer schemas locked.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Create src/server/trpc/schemas/file.ts</name>
  <read_first>
    - src/server/db/schema/files.ts (uploaded_files shape)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-23, D-25
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §file.upload tRPC mutation skeleton §Open Questions point 2 (base64-in-JSON transport)
  </read_first>
  <files>
    src/server/trpc/schemas/file.ts
  </files>
  <action>
    ```typescript
    /**
     * Zod input schemas for file.* tRPC mutations (Plan 02-09).
     *
     * Transport: base64-in-JSON for v1 (RESEARCH §Open Questions point 2).
     * 2 MB file → ~2.66 MB request body — within bodyParser sizeLimit '5mb'
     * documented in 02-16. Phase 5 medical PDFs (5 MB → ~6.66 MB) will revisit.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-23, D-25
     */
    import { z } from 'zod';

    /**
     * file.upload — server runs Zod validation → size check → magic-bytes →
     * Supabase Storage upload → DB row insert → BullMQ enqueue.
     */
    export const fileUploadInput = z
      .object({
        bucket: z.literal('profiles'),  // Phase 2 only; Phase 4/5 extends
        // Server is authoritative on MIME via fileTypeFromBuffer. The client
        // claim is captured here for audit-only ("user said it was X").
        claimedMimeType: z
          .string()
          .min(1, { message: 'errors.field.required' })
          .max(120, { message: 'errors.file.disallowedType' }),
        originalFilename: z
          .string()
          .min(1, { message: 'errors.field.required' })
          .max(255, { message: 'errors.file.filenameTooLong' }),
        // base64-encoded bytes; server decodes via Buffer.from(...,'base64').
        // Length cap enforced server-side after decode (2 MB raw → ~2.66 MB b64).
        contentBase64: z
          .string()
          .min(1, { message: 'errors.field.required' })
          .max(3 * 1024 * 1024, { message: 'errors.file.tooLarge' }),  // ~2.25 MB raw
      })
      .strict();

    /**
     * file.getSignedUrl — caller must already have visibility on the
     * uploaded_files row (RLS enforces); handler returns 404 if not.
     */
    export const fileGetSignedUrlInput = z
      .object({
        fileId: z.string().uuid(),
      })
      .strict();

    /**
     * file.getScanStatus — used for polling by the PhotoUpload widget (02-12).
     */
    export const fileGetScanStatusInput = z
      .object({
        fileId: z.string().uuid(),
      })
      .strict();

    /**
     * file.delete — TD only (handler enforces). Marks superseded_at = now()
     * AND optionally removes the storage object if soft-delete flag is set.
     */
    export const fileDeleteInput = z
      .object({
        fileId: z.string().uuid(),
        removeStorage: z.boolean().default(false),
      })
      .strict();

    export type FileUploadInput = z.infer<typeof fileUploadInput>;
    export type FileGetSignedUrlInput = z.infer<typeof fileGetSignedUrlInput>;
    export type FileGetScanStatusInput = z.infer<typeof fileGetScanStatusInput>;
    export type FileDeleteInput = z.infer<typeof fileDeleteInput>;
    ```

    Do NOT accept the file size as a separate field — derive it from `Buffer.from(contentBase64, 'base64').length` server-side; the schema max-length cap on `contentBase64` is the first gate.
    Do NOT accept `mimeType` from client as authoritative — `claimedMimeType` is audit-only; the magic-bytes module is authoritative.
  </action>
  <verify>
    <automated>test -f src/server/trpc/schemas/file.ts && grep -q "export const fileUploadInput" src/server/trpc/schemas/file.ts && grep -q "export const fileGetSignedUrlInput" src/server/trpc/schemas/file.ts && grep -q "export const fileGetScanStatusInput" src/server/trpc/schemas/file.ts && grep -q "z.literal('profiles')" src/server/trpc/schemas/file.ts && grep -q "claimedMimeType" src/server/trpc/schemas/file.ts && grep -q "\.strict()" src/server/trpc/schemas/file.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*schemas/file\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - All 4 schemas with `.strict()`
    - Bucket fixed to `z.literal('profiles')` for Phase 2 (Phase 5+ widens)
    - `contentBase64` capped at ~3 MB (b64-inflated 2 MB)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>File schemas locked.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Client form ↔ tRPC mutation | Zod schemas are the shared contract; `.strict()` blocks field smuggling |
| Field-level RBAC | Schema-level field whitelist (D-37/D-38) is the first gate; RLS UPDATE policies are the second |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-07-FIELD-SMUGGLING | Elevation of Privilege | Player submits `statusCode` via `playerSelfUpdateInput` | mitigate | `.strict()` rejects unknown keys with a Zod error; covered by `tests/unit/player-schemas.test.ts` in 02-15 |
| T-02-07-OVERSIZED-PAYLOAD | Denial of Service | Client sends 100MB base64 string | mitigate | Zod `max(3 * 1024 * 1024)` on `contentBase64` is the first cap; Next.js bodyParser `sizeLimit: '5mb'` (02-16) is the second |
| T-02-07-MIME-CLIENT-TRUST | Tampering | Client claims a bogus `claimedMimeType` | mitigate | Documented as audit-only; magic-bytes module (02-04) is the authoritative gate |
| T-02-07-DATE-IN-FUTURE | Tampering | Client submits DOB in 2099 | mitigate | `z.coerce.date().max(new Date())` rejects future dates with `errors.field.dateInPast` |
</threat_model>

<verification>
- `grep -c '\.strict()' src/server/trpc/schemas/` returns ≥ 12 (3 files × ~4 schemas each)
- No schema file imports server-only deps (no `drizzle-orm`, no `node:fs`)
- All error messages start with `errors.`
- `npx tsc --noEmit` exits 0
</verification>

<success_criteria>
- 3 schema files exporting validated tRPC inputs
- Field-level RBAC encoded in schemas (self-update is structurally narrower than create)
- All error messages i18n keys (D-46)
- Client + server can both import these schemas
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-07-SUMMARY.md` listing every exported schema name and its purpose.
</output>
