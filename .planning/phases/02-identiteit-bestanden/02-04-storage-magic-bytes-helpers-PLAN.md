---
phase: 02-identiteit-bestanden
plan_id: 02-04-storage-magic-bytes-helpers
plan: 04
type: execute
wave: 2
depends_on: [02-01-deps-and-env]
files_modified:
  - src/server/storage/client.ts
  - src/server/storage/magic-bytes.ts
  - src/server/storage/signed-url.ts
  - src/server/storage/profile-photo.ts
  - src/lib/players.ts
  - src/lib/forms/zod-i18n.ts
autonomous: true
requirements:
  - VALID-01
  - VALID-02
  - VALID-03
  - VALID-05
  - VALID-06
  - FILE-01
  - FILE-04
  - DOM-CAT-01
  - DOM-CAT-02
  - I18N-08

must_haves:
  truths:
    - "`src/server/storage/client.ts` exports a `storageClient` singleton bound to SUPABASE_SERVICE_ROLE_KEY, marked with `import 'server-only'` directive (D-22, Pitfall 4)"
    - "`src/server/storage/magic-bytes.ts` exports `validateUploadMagicBytes(buf, bucket)` using `fileTypeFromBuffer` (D-23, VALID-02)"
    - "`src/server/storage/signed-url.ts` exports `createProfilePhotoSignedUrl(storageKey, ttlSeconds = 3600)` (D-24, FILE-01)"
    - "`src/server/storage/profile-photo.ts` exports `uploadProfilePhoto(buf, userId, ext)` returning `{ storageKey, fileId }` (D-25, FILE-04)"
    - "`src/lib/players.ts` exports `deriveAgeCategory(dob, asOfDate?)` and `getAgeCategoryAt(playerId, date)` (D-31, D-33, DOM-CAT-02)"
    - "`src/lib/forms/zod-i18n.ts` exports an adapter that resolves zod-issue i18n keys via next-intl (D-46, I18N-08)"
    - "All storage modules have `import 'server-only'` as line 1 (prevents client-bundle inclusion)"
  artifacts:
    - path: "src/server/storage/client.ts"
      provides: "Supabase service-role client singleton (server-only)"
      contains: "server-only"
      min_lines: 15
    - path: "src/server/storage/magic-bytes.ts"
      provides: "MIME whitelist + magic-bytes validation"
      contains: "fileTypeFromBuffer"
      min_lines: 25
    - path: "src/server/storage/signed-url.ts"
      provides: "createSignedUrl wrapper with TTL + Content-Disposition"
      contains: "createSignedUrl"
      min_lines: 20
    - path: "src/server/storage/profile-photo.ts"
      provides: "uploadProfilePhoto helper writing profiles/{userId}/{uuid}.{ext}"
      contains: "profiles"
      min_lines: 20
    - path: "src/lib/players.ts"
      provides: "deriveAgeCategory + getAgeCategoryAt"
      contains: "deriveAgeCategory"
      min_lines: 40
    - path: "src/lib/forms/zod-i18n.ts"
      provides: "FormMessage i18n adapter"
      contains: "useTranslations"
      min_lines: 15
  key_links:
    - from: "src/server/storage/magic-bytes.ts"
      to: "file-type (npm)"
      via: "import { fileTypeFromBuffer }"
      pattern: "from 'file-type'"
    - from: "src/server/storage/client.ts"
      to: "@supabase/supabase-js"
      via: "createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)"
      pattern: "createClient\\("
    - from: "src/lib/players.ts (getAgeCategoryAt)"
      to: "src/server/db/schema/players.ts (ageCategoryHistory)"
      via: "Drizzle SELECT with index idx_age_history_lookup"
      pattern: "ageCategoryHistory"
---

<objective>
Ship the 6 server-side helper modules that every Phase 2 tRPC router will compose:

1. `src/server/storage/client.ts` — service-role Supabase client singleton (server-only).
2. `src/server/storage/magic-bytes.ts` — `validateUploadMagicBytes(buf, bucket)` with the MIME whitelist registry.
3. `src/server/storage/signed-url.ts` — `createProfilePhotoSignedUrl(storageKey, ttlSeconds)` with `Content-Disposition: attachment` per VALID-05.
4. `src/server/storage/profile-photo.ts` — `uploadProfilePhoto(buf, userId, ext)` that builds the canonical `profiles/{userId}/{uuid}.{ext}` storage key.
5. `src/lib/players.ts` — `deriveAgeCategory(dob, asOfDate?)` + `getAgeCategoryAt(playerId, date)` (DOM-CAT-01/02 helpers).
6. `src/lib/forms/zod-i18n.ts` — react-hook-form `<FormMessage>` adapter that maps zod issue keys to localised text via `useTranslations('errors')` (D-46).

These are the building blocks; the tRPC routers in 02-09 compose them. Keeping them in their own plan lets unit tests (02-15) run against the helpers without spinning up the router stack.

Purpose: small audit surface for the security-critical primitives (magic-bytes, signed-URL, service-role client).

Output: 6 new files. No router wiring. No UI.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@.planning/phases/02-identiteit-bestanden/02-01-deps-and-env-PLAN.md
@.planning/phases/02-identiteit-bestanden/02-02-drizzle-schema-files-PLAN.md
@src/lib/env.ts
@src/lib/i18n-format.ts
@CLAUDE.md

<interfaces>
<!-- The two new deps installed in 02-01: -->

```typescript
// @supabase/supabase-js v2.105 — createClient signature
import { createClient } from '@supabase/supabase-js';
const sb = createClient(url: string, key: string, options?: { auth: { persistSession: false, autoRefreshToken: false } });
sb.storage.from(bucket).upload(path: string, buf: Buffer | Blob, { contentType, upsert }): Promise<{data, error}>;
sb.storage.from(bucket).createSignedUrl(path: string, expiresIn: number, options?: { download?: string | boolean }): Promise<{data: { signedUrl: string } | null, error}>;
sb.storage.from(bucket).download(path: string): Promise<{data: Blob, error}>;
sb.storage.from(bucket).remove(paths: string[]): Promise<{data, error}>;
```

```typescript
// file-type@^22 — ESM-only
import { fileTypeFromBuffer } from 'file-type';
const detected: { ext: string; mime: string } | undefined = await fileTypeFromBuffer(buf);
```

```typescript
// Phase 1 src/lib/env.ts (extended in 02-01)
export const env = {
  SUPABASE_URL: string,
  SUPABASE_SERVICE_ROLE_KEY: string,
  CLAMAV_HOST: string,
  CLAMAV_PORT: number,
  // ... rest unchanged ...
};
```

```typescript
// Phase 1 src/server/db/client.ts (existing — Drizzle handle)
export const db: DbClient; // typed against full schema barrel
export type DbClient = typeof db;
```

```typescript
// src/server/db/schema/players.ts (locked in 02-02)
export const ageCategoryHistory = pgTable('age_category_history', {
  id: bigserial,
  playerId: uuid,
  ageCategoryCode: text (FK age_categories.code),
  categoryYear: integer,
  effectiveFrom: date,
  effectiveTo: date | null,
  setBy: uuid | null,
  setAt: tstz,
});
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create the 4 storage helpers (client, magic-bytes, signed-url, profile-photo)</name>
  <read_first>
    - src/lib/env.ts (env shape after 02-01)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 5 (service-role client) §Pattern 6 (RLS for storage objects) §Magic-bytes validation helper code example
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-22, D-23, D-24, D-25
  </read_first>
  <files>
    src/server/storage/client.ts
    src/server/storage/magic-bytes.ts
    src/server/storage/signed-url.ts
    src/server/storage/profile-photo.ts
  </files>
  <action>
    Create the 4 files. Every file MUST start with `import 'server-only';` on line 1 (Next.js + ESLint refuse to bundle into client) — this is enforced by Pitfall 4 mitigation.

    **File 1 — `src/server/storage/client.ts`:**

    ```typescript
    import 'server-only';

    /**
     * Service-role Supabase Storage client singleton (D-22, FILE-01).
     *
     * The service-role key BYPASSES Supabase Storage RLS — this is intentional
     * because all upload/download/signed-URL flows happen on the server, gated
     * by Phase 2 tRPC procedures (which do their OWN RBAC via withRlsContext +
     * `protectedProcedure`/`tdProcedure`). Direct browser-to-Storage is OUT OF
     * SCOPE for v1.
     *
     * Security guards:
     *  - `import 'server-only'` makes Next.js refuse to bundle this into a
     *    Client Component. A developer trying to `import { storageClient }`
     *    from a `'use client'` file gets a build-time error.
     *  - ESLint restricted-imports rule on `@/server/storage/*` (added in 02-13)
     *    enforces the same invariant at lint time.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 5
     */
    import { createClient, type SupabaseClient } from '@supabase/supabase-js';
    import { env } from '@/lib/env';

    export const storageClient: SupabaseClient = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    ```

    **File 2 — `src/server/storage/magic-bytes.ts`:**

    ```typescript
    import 'server-only';

    /**
     * Magic-bytes validation (VALID-02, D-23).
     *
     * Trusts the file's BYTES, never the user-agent's claim about MIME type
     * (which is trivially spoofable). The MIME_BY_BUCKET registry is the
     * single source of truth for "what files are accepted where".
     *
     * Returns TRPCError-friendly i18n-keyed errors per D-46.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-23
     *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Magic-bytes validation helper
     */
    import { TRPCError } from '@trpc/server';
    import { fileTypeFromBuffer } from 'file-type';

    export const MIME_BY_BUCKET = {
      profiles: ['image/jpeg', 'image/png'] as const,
      // Phase 4 adds 'evaluations': ['application/pdf', 'image/jpeg', 'image/png'].
      // Phase 5 adds 'medical': ['application/pdf', 'image/jpeg', 'image/png'].
    } as const satisfies Record<string, readonly string[]>;

    export type UploadBucket = keyof typeof MIME_BY_BUCKET;

    export async function validateUploadMagicBytes(
      buf: Buffer,
      bucket: UploadBucket,
    ): Promise<{ ext: string; mime: string }> {
      const detected = await fileTypeFromBuffer(buf);
      if (!detected) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.file.unknownType',
        });
      }
      const allowed: readonly string[] = MIME_BY_BUCKET[bucket];
      if (!allowed.includes(detected.mime)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'errors.file.disallowedType',
        });
      }
      return detected;
    }
    ```

    **File 3 — `src/server/storage/signed-url.ts`:**

    ```typescript
    import 'server-only';

    /**
     * Server-side signed URL generation (FILE-01, D-24, VALID-05).
     *
     * Every signed URL caller MUST do its own RBAC check BEFORE calling this
     * helper (D-24 + RISK-FILE-SCOPE) — TTL alone is not a substitute. The
     * helper is intentionally dumb: given a storage_key + TTL, mint a URL.
     *
     * `download: storageKey-derived-filename` forces `Content-Disposition:
     * attachment` (VALID-05) so the browser cannot interpret an unexpected
     * file type as inline HTML/script.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-24
     */
    import { TRPCError } from '@trpc/server';
    import { storageClient } from './client';

    export const PROFILE_PHOTO_TTL_SECONDS = 60 * 60; // 1h per D-24

    export async function createProfilePhotoSignedUrl(
      storageKey: string,
      ttlSeconds: number = PROFILE_PHOTO_TTL_SECONDS,
    ): Promise<{ url: string; expiresAt: Date }> {
      // Derive the filename suggestion from the storage key (last path segment).
      // Storage policy: storage_key is `profiles/{userId}/{uuid}.{ext}`.
      const filename = storageKey.split('/').pop() ?? 'photo.bin';
      const { data, error } = await storageClient.storage
        .from('profiles')
        .createSignedUrl(storageKey, ttlSeconds, { download: filename });

      if (error || !data) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'errors.file.signedUrlFailed',
        });
      }
      return {
        url: data.signedUrl,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      };
    }
    ```

    **File 4 — `src/server/storage/profile-photo.ts`:**

    ```typescript
    import 'server-only';

    /**
     * Profile photo upload helper (D-25, FILE-04).
     *
     * Generates a UUID storage key, never the original filename — predictable
     * keys leak user-supplied content and can collide. The bucket path template
     * `profiles/{userId}/{uuid}.{ext}` co-locates a user's files under their
     * own folder so Phase 5+ can write per-folder RLS policies (Pattern 6).
     *
     * The caller (file.upload tRPC mutation in 02-09) inserts the
     * `uploaded_files` row BEFORE calling this helper; this function only
     * handles the bytes-to-storage write.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-25
     */
    import { TRPCError } from '@trpc/server';
    import { storageClient } from './client';

    export interface UploadProfilePhotoResult {
      storageKey: string;
    }

    export async function uploadProfilePhoto(
      buf: Buffer,
      userId: string,
      ext: string,
      mime: string,
    ): Promise<UploadProfilePhotoResult> {
      const fileId = crypto.randomUUID();
      const storageKey = `${userId}/${fileId}.${ext}`;

      const { error } = await storageClient.storage
        .from('profiles')
        .upload(storageKey, buf, {
          contentType: mime,
          upsert: false,  // explicit: never overwrite — UUID makes collisions impossible
        });

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'errors.file.uploadFailed',
        });
      }
      return { storageKey };
    }
    ```

    Note: `fileId` here is local-scope used to mint the storage key. The DB row uses its own `crypto.randomUUID()` minted by the tRPC mutation (02-09); the two MUST match. To enforce this, 02-09 will pass `fileId` to this helper as a parameter, but for now we keep this function self-contained and the router will compose properly.

    **HOWEVER — to support the cleaner orchestration in 02-09, change the signature:**

    ```typescript
    export async function uploadProfilePhoto(
      buf: Buffer,
      userId: string,
      fileId: string,  // caller-provided — must match uploaded_files.id
      ext: string,
      mime: string,
    ): Promise<UploadProfilePhotoResult> {
      const storageKey = `${userId}/${fileId}.${ext}`;
      // ... rest unchanged
    }
    ```

    Use THIS signature. The caller in 02-09 mints the UUID once and passes it to both the DB INSERT and this upload call so storage_key and uploaded_files.id are linked.

    Note `from('profiles')` not `from('profiles/')` — the bucket name is `profiles` (no trailing slash). Storage path inside the bucket is `{userId}/{fileId}.{ext}`. The `storage_key` column in `uploaded_files` stores ONLY the path-within-bucket (`{userId}/{fileId}.{ext}`) — the bucket name lives in `uploaded_files.bucket`. This avoids storage_key ambiguity when Phase 4 adds the evaluations bucket.
  </action>
  <verify>
    <automated>for f in src/server/storage/client.ts src/server/storage/magic-bytes.ts src/server/storage/signed-url.ts src/server/storage/profile-photo.ts; do test -f "$f" && head -1 "$f" | grep -q "^import 'server-only';" || { echo "$f missing or no server-only directive"; exit 1; }; done && grep -q "fileTypeFromBuffer" src/server/storage/magic-bytes.ts && grep -q "MIME_BY_BUCKET" src/server/storage/magic-bytes.ts && grep -q "createSignedUrl" src/server/storage/signed-url.ts && grep -q "PROFILE_PHOTO_TTL_SECONDS = 60 \* 60" src/server/storage/signed-url.ts && grep -q "crypto.randomUUID\|fileId" src/server/storage/profile-photo.ts && grep -q "upsert: false" src/server/storage/profile-photo.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*storage/")</automated>
  </verify>
  <acceptance_criteria>
    - All 4 files exist with `import 'server-only';` as line 1
    - `MIME_BY_BUCKET.profiles` is `['image/jpeg', 'image/png']` (exact list — VALID-03)
    - `validateUploadMagicBytes` throws `TRPCError` with `code: 'BAD_REQUEST'` and `message` set to an i18n key (D-46)
    - `PROFILE_PHOTO_TTL_SECONDS` exported and equals `60 * 60`
    - `createProfilePhotoSignedUrl` passes `download: filename` to enforce attachment disposition (VALID-05)
    - `uploadProfilePhoto` accepts caller-provided `fileId` (so DB row and storage key UUID stay linked)
    - `upsert: false` on the upload call (never overwrite an existing key)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>The 4 storage primitives are unit-testable and importable by Wave 3 routers.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Create src/lib/players.ts with deriveAgeCategory + getAgeCategoryAt</name>
  <read_first>
    - src/server/db/schema/players.ts (ageCategoryHistory shape, locked in 02-02)
    - src/server/db/schema/lookups.ts (ageCategories shape — bornAfterOrEqual/bornBeforeOrEqual int columns)
    - src/server/db/client.ts (Drizzle db handle)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-31, D-33
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 2 (composite index strategy for getAgeCategoryAt)
  </read_first>
  <files>
    src/lib/players.ts
  </files>
  <action>
    ```typescript
    /**
     * Player domain helpers — age-category derivation and historical lookup.
     *
     * `deriveAgeCategory(dob, asOfDate)`:
     *   Computes which age category code matches a player's birth year on
     *   `asOfDate` (default `new Date()`). Logic:
     *     1. Read all rows from `age_categories` WHERE active = true.
     *     2. Compute the player's calendar birth year.
     *     3. Pick the row whose [bornAfterOrEqual, bornBeforeOrEqual] range
     *        contains the birth year (NULL endpoints = open-ended).
     *     4. If no row matches, return code 'age_unknown' (seeded in 02-08).
     *
     *   The `categoryYear` returned is the YEAR component of `asOfDate` —
     *   convention chosen to match how toernooi-validatie (Phase 4) treats
     *   "category for season N" as "category as of season N's start year".
     *
     * `getAgeCategoryAt(playerId, date)`:
     *   Reads from `age_category_history` the row whose
     *   `effective_from <= date AND (effective_to IS NULL OR effective_to >= date)`.
     *   Returns `null` if no row covers the date (e.g., before player was created).
     *
     * Both helpers run in normal app code under the RLS-bound db client; RLS
     * filters age_category_history to rows the caller can see (player owner +
     * TD + scope-trainer per 02-05 policies).
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-31, D-33
     *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 2
     */
    import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
    import { db, type DbClient } from '@/server/db/client';
    import { ageCategoryHistory } from '@/server/db/schema/players';
    import { ageCategories } from '@/server/db/schema/lookups';

    export interface AgeCategoryResult {
      code: string;
      year: number;
    }

    /**
     * Compute age-category for a given DOB as of an evaluation date.
     * Returns 'age_unknown' if seeded boundaries don't cover the birth year
     * (RESEARCH §Open Questions point 4 — until TD confirms ranges).
     */
    export async function deriveAgeCategory(
      dob: Date,
      asOfDate: Date = new Date(),
      dbHandle: DbClient = db,
    ): Promise<AgeCategoryResult> {
      const birthYear = dob.getUTCFullYear();
      const categoryYear = asOfDate.getUTCFullYear();

      // BLOCKER-05 fix: explicit ASC ordering on sort_order makes the lookup
      // deterministic. age_unknown is seeded with sort_order=99 (plan 02-08),
      // so it is evaluated LAST — strictly more-specific categories win,
      // age_unknown is the documented fallback only when no row matches.
      // Without ORDER BY, Postgres returns rows in arbitrary order and the
      // first-match loop could return age_unknown even when a real category
      // fits.
      const rows = await dbHandle.query.ageCategories.findMany({
        where: eq(ageCategories.active, true),
        orderBy: (t, { asc }) => [asc(t.sortOrder)],
      });

      for (const row of rows) {
        const lowerOk = row.bornAfterOrEqual === null || birthYear >= row.bornAfterOrEqual;
        const upperOk = row.bornBeforeOrEqual === null || birthYear <= row.bornBeforeOrEqual;
        if (lowerOk && upperOk) {
          return { code: row.code, year: categoryYear };
        }
      }
      return { code: 'age_unknown', year: categoryYear };
    }

    /**
     * Look up the age category that was in effect for a player on a given date.
     * Phase 4 toernooi-validatie will call this with `tournament.start_date`.
     * Returns null if no history row covers the date.
     */
    export async function getAgeCategoryAt(
      playerId: string,
      date: Date,
      dbHandle: DbClient = db,
    ): Promise<AgeCategoryResult | null> {
      // BLOCKER-06 fix: pass YYYY-MM-DD string directly — Drizzle 0.40 binds
      // string operands for `date` columns natively (driver coerces). The
      // earlier `as unknown as string` double-cast was a TS-strict workaround
      // smell that nudges executors toward `any`. effective_from / effective_to
      // are PostgreSQL DATE columns; YYYY-MM-DD is the canonical wire format.
      const dateIso = date.toISOString().slice(0, 10); // YYYY-MM-DD

      const row = await dbHandle.query.ageCategoryHistory.findFirst({
        where: and(
          eq(ageCategoryHistory.playerId, playerId),
          lte(ageCategoryHistory.effectiveFrom, dateIso),
          or(
            isNull(ageCategoryHistory.effectiveTo),
            gte(ageCategoryHistory.effectiveTo, dateIso),
          ),
        ),
        orderBy: (t, { desc }) => [desc(t.effectiveFrom)],
      });

      if (!row) return null;
      return { code: row.ageCategoryCode, year: row.categoryYear };
    }
    ```

    Do NOT cache the lookup in memory at module load — seed migration runs after import; reading from `db.query.ageCategories.findMany` on each call (with the existing `idx_age_categories_active_pk` index from PG defaults) is sub-millisecond and avoids stale-cache pitfalls in dev.

    Do NOT compute "current age" — only birth-year-vs-boundary. Belgian table tennis category boundaries are calendar-year boundaries, not birthday boundaries (per RESEARCH §A2).
  </action>
  <verify>
    <automated>test -f src/lib/players.ts && grep -q "export async function deriveAgeCategory" src/lib/players.ts && grep -q "export async function getAgeCategoryAt" src/lib/players.ts && grep -q "age_unknown" src/lib/players.ts && grep -q "ageCategoryHistory" src/lib/players.ts && grep -q "from '@/server/db/schema/players'" src/lib/players.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*lib/players\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - Both helpers exported with the signatures shown
    - `deriveAgeCategory` returns `'age_unknown'` when no boundary row matches
    - `getAgeCategoryAt` uses the composite index path (`(player_id, effective_from desc, effective_to)`) — verified by reading the query shape (Drizzle's `findFirst` with `where` + `orderBy desc` matches the index)
    - Both helpers accept an optional `dbHandle` so tests can pass an RLS-bound test transaction
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Phase 4 toernooi-validatie can import `getAgeCategoryAt` once Phase 2 is merged.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Create src/lib/forms/zod-i18n.ts adapter for FormMessage</name>
  <read_first>
    - src/lib/i18n-format.ts (Phase 1 i18n helpers — locale resolution + Intl wrappers)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-46
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 3 (Zod schema with i18n-key error messages)
  </read_first>
  <files>
    src/lib/forms/zod-i18n.ts
  </files>
  <action>
    ```typescript
    /**
     * Zod-error → i18n-key resolution adapter (D-46, I18N-08).
     *
     * Convention: every Zod schema in `src/server/trpc/schemas/*.ts` emits
     * its `message` as an i18n key (e.g., `'errors.field.required'`). On the
     * client side, react-hook-form's `formState.errors[field].message` is
     * that key. The shadcn `<FormMessage>` component renders `message` as-is,
     * which would show the literal key. This adapter wraps the resolution.
     *
     * Usage in a Client Component:
     *
     *   import { useZodErrorMessage } from '@/lib/forms/zod-i18n';
     *
     *   function MyForm() {
     *     const resolve = useZodErrorMessage();
     *     return (
     *       <FormMessage>
     *         {resolve(form.formState.errors.firstName?.message)}
     *       </FormMessage>
     *     );
     *   }
     *
     * Or, more idiomatically, plug it directly into the shadcn `<FormMessage>`
     * by composing a wrapper — see Plan 02-12 PhotoUpload widget for the
     * canonical usage.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-46
     */
    'use client';

    import { useTranslations } from 'next-intl';

    /**
     * Returns a function that resolves an i18n-key string (or undefined) to a
     * localised label. Pass-through for already-resolved strings is NOT
     * supported — Zod schemas should always emit keys.
     *
     * Missing keys produce `MISSING_KEY:errors.<...>` in dev (D-20 fail-loud
     * fallback from Phase 1); the Phase 8 CI gate (I18N-10) prevents shipping.
     */
    export function useZodErrorMessage(): (
      key: string | undefined,
    ) => string | undefined {
      const t = useTranslations('errors');
      return (key) => {
        if (!key) return undefined;
        // Trim the 'errors.' prefix if present (Zod schemas emit full path).
        const trimmed = key.startsWith('errors.') ? key.slice('errors.'.length) : key;
        // next-intl returns the key literally when missing in dev (fail-loud);
        // production catalog completeness is enforced in Phase 8.
        return t(trimmed);
      };
    }
    ```

    Do NOT add server-side equivalent here — server-side tRPC error formatter handles its own key→message resolution at the route layer (covered in 02-09).
    Do NOT add path-rewrites for nested-object Zod schemas in this plan — Phase 2 forms are flat (no nested `address.street`); if Phase 5 needs nested resolution, extend in that phase.
  </action>
  <verify>
    <automated>test -f src/lib/forms/zod-i18n.ts && grep -q "'use client'" src/lib/forms/zod-i18n.ts && grep -q "useTranslations" src/lib/forms/zod-i18n.ts && grep -q "export function useZodErrorMessage" src/lib/forms/zod-i18n.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*zod-i18n\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - File starts with `'use client';`
    - Exports `useZodErrorMessage` that returns a `(key) => string | undefined` callable
    - Handles `undefined` input (when the field has no error)
    - Strips `errors.` prefix so callers can pass full path or short key
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Forms in 02-11/12 can resolve Zod errors to localised text in one line.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Service-role key ↔ client bundle | Catastrophic if leaked (Pitfall 4); `'server-only'` directive + future ESLint rule (02-13) provide two layers |
| Buffer claim (file.type) ↔ actual bytes | Magic-bytes module is the single trust gate for what was uploaded |
| Storage path components | UUID filenames prevent enumeration; per-user folder enables future per-folder RLS |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04-SR-KEY-LEAK | Information Disclosure / Elevation of Privilege | `storageClient` singleton bundled into client | mitigate | `import 'server-only'` directive on all 4 storage modules; ESLint restricted-imports rule added in 02-13; CI tsc check ensures the directive is not removed |
| T-02-04-MIME-SPOOF | Tampering | Attacker uploads a PDF claiming `image/jpeg` MIME | mitigate | `validateUploadMagicBytes` rejects when `fileTypeFromBuffer(buf).mime` does not match the bucket whitelist; tests/unit/magic-bytes.test.ts (Plan 02-15) covers PDF-renamed-as-JPG case |
| T-02-04-PREDICTABLE-KEY | Information Disclosure (IDOR via predictable filenames) | If storage_key contained original filename or sequential id | mitigate | `crypto.randomUUID()` in `uploadProfilePhoto` per FILE-04; storage_key is unguessable |
| T-02-04-SIGNED-URL-WITHOUT-RBAC | Information Disclosure | Caller mints signed URL without checking the row's RBAC scope | mitigate | Helper is documented as "caller checks RBAC FIRST" — Plan 02-09 `file.getSignedUrl` does the check by reading `uploaded_files` through RLS (zero rows → NOT_FOUND); D-24 explicit |
| T-02-04-INLINE-EXECUTION | Tampering / Malicious Code | Browser interprets an unexpected upload as inline HTML | mitigate | `createSignedUrl({ download: filename })` forces `Content-Disposition: attachment` (VALID-05) |
| T-02-04-AGE-UNKNOWN-FALLBACK | Repudiation | `deriveAgeCategory` silently returns 'age_unknown' instead of raising — could mask seed-data misconfiguration | accept | Explicit fallback documented; seed migration (02-08) inserts an `age_unknown` lookup row so FK from `players.age_category` never fails; alerted via existing pino logging when 'age_unknown' is selected during player.create. |
</threat_model>

<verification>
- All 4 storage files start with `import 'server-only';` (line 1)
- `grep -rn "'server-only'" src/server/storage/` returns ≥ 4
- `npx tsc --noEmit` exits 0 across all 6 new files
- `pnpm exec eslint src/server/storage/ src/lib/players.ts src/lib/forms/zod-i18n.ts` exits 0
</verification>

<success_criteria>
- 4 storage helpers (client, magic-bytes, signed-url, profile-photo) compiled and audit-ready
- 2 lib helpers (players, zod-i18n) compiled
- Service-role key never imported into a Client Component (server-only directive)
- MIME whitelist registry centralised in one file
- TTL constant exported (no magic numbers scattered across callers)
- Storage key format `{userId}/{uuid}.{ext}` consistent
- `deriveAgeCategory` falls back to 'age_unknown' when boundaries are unconfirmed (RESEARCH A2 mitigation)
- `getAgeCategoryAt` uses the composite index path for sub-ms query
- Zod-i18n adapter handles `undefined` cleanly
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-04-SUMMARY.md` listing all 6 new files, their exported names, and the i18n keys that the magic-bytes/signed-url modules will throw.
</output>
