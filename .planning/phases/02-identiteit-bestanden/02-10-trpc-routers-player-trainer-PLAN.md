---
phase: 02-identiteit-bestanden
plan_id: 02-10-trpc-routers-player-trainer
plan: 10
type: execute
wave: 4
depends_on: [02-07-trpc-schemas, 02-05-migration-0007-rls-policies, 02-04-storage-magic-bytes-helpers]
files_modified:
  - src/server/trpc/routers/player.ts
  - src/server/trpc/routers/trainer.ts
  - src/server/trpc/routers/_app.ts
autonomous: true
requirements:
  - PLAYER-01
  - PLAYER-02
  - PLAYER-03
  - PLAYER-04
  - PLAYER-05
  - PLAYER-06
  - PLAYER-07
  - TRAINER-01
  - TRAINER-02
  - TRAINER-03
  - DOM-CAT-01
  - DOM-CAT-02
  - USER-04

must_haves:
  truths:
    - "playerRouter exposes 7 procedures: create, get, list, updateSelf, updateAsTd, updateOnBehalfOf, setAgeCategory"
    - "trainerRouter exposes 5 procedures: create, get, list, updateSelf, updateAsTd"
    - "player.create runs in a Drizzle transaction: insert users row (if missing) → players row → age_category_history inaugural row (D-31)"
    - "player.create derives age_category via `deriveAgeCategory(dob)` (02-04)"
    - "player.create sets players.isMinor = `isMinorAt(dob, now)` (Phase 1 helper) — Pitfall 2 mitigation"
    - "player.setAgeCategory wraps the close-current + insert-new logic in a SERIALIZABLE transaction (Pitfall 6)"
    - "player.updateSelf accepts ONLY playerSelfUpdateInput fields (D-37 — schema-level whitelist)"
    - "player.updateOnBehalfOf checks parent_child_links row exists for ctx.scope.userId → playerId"
    - "player.get throws NOT_FOUND on RLS-filtered zero rows (D-36 enumeration prevention)"
    - "Both routers registered in _app.ts"
  artifacts:
    - path: "src/server/trpc/routers/player.ts"
      provides: "playerRouter with 7 procedures"
      contains: "setAgeCategory"
      min_lines: 200
    - path: "src/server/trpc/routers/trainer.ts"
      provides: "trainerRouter with 5 procedures"
      contains: "updateAsTd"
      min_lines: 100
    - path: "src/server/trpc/routers/_app.ts"
      provides: "appRouter extended with player + trainer"
      contains: "playerRouter"
  key_links:
    - from: "src/server/trpc/routers/player.ts (create)"
      to: "src/lib/players.ts (deriveAgeCategory)"
      via: "import + call to compute initial age_category"
      pattern: "deriveAgeCategory\\("
    - from: "src/server/trpc/routers/player.ts (create)"
      to: "src/lib/consent.ts (isMinorAt)"
      via: "Phase 1 helper for is_minor flag"
      pattern: "isMinorAt\\("
    - from: "src/server/trpc/routers/player.ts (setAgeCategory)"
      to: "src/server/db/schema/players.ts (ageCategoryHistory)"
      via: "transaction.update + transaction.insert + serializable isolation"
      pattern: "isolationLevel: 'serializable'"
---

<objective>
Ship the two domain routers for player and trainer profiles. These are the workhorses for every TD/academy-manager workflow and the only writeable path to the new tables.

**playerRouter** (7 procedures):
- `create` (TD only): inserts a player row + writes the inaugural `age_category_history` entry in a transaction.
- `get` (protected): returns `NOT_FOUND` for out-of-scope (D-36).
- `list` (protected): RLS does the scoping.
- `updateSelf` (protected): D-37 schema-level whitelist; player edits own non-sensitive fields.
- `updateAsTd` (TD only): full edit.
- `updateOnBehalfOf` (protected + parent_child_links check): parent of minor edits child's non-sensitive fields.
- `setAgeCategory` (TD only): closes current history row, inserts new — SERIALIZABLE transaction (Pitfall 6).

**trainerRouter** (5 procedures): `create`, `get`, `list`, `updateSelf`, `updateAsTd`.

Register both on `appRouter`.

Output: 2 router files + 1 `_app.ts` update.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@.planning/phases/02-identiteit-bestanden/02-07-trpc-schemas-PLAN.md
@.planning/phases/02-identiteit-bestanden/02-04-storage-magic-bytes-helpers-PLAN.md
@src/server/trpc/routers/admin.ts
@src/server/trpc/middleware/freshSession.ts
@src/lib/consent.ts
@CLAUDE.md

<interfaces>
<!-- Composables -->

```typescript
// Phase 1: isMinor helper (src/lib/consent.ts)
export function isMinorAt(birthDate: Date, now: Date): boolean;

// Phase 2: age-category helpers (02-04, src/lib/players.ts)
export async function deriveAgeCategory(dob: Date, asOfDate?: Date, db?: DbClient): Promise<{code: string, year: number}>;
export async function getAgeCategoryAt(playerId: string, date: Date, db?: DbClient): Promise<{code, year} | null>;

// Phase 1: parent_child_links shape (src/server/db/schema/memberships.ts)
parentChildLinks: { parentUserId, childUserId, consentGivenAt, ... }
// UNIQUE(childUserId) → at most one parent per minor (Belgian Art. 8)

// Phase 1: writeAudit (src/server/trpc/middleware/audit.ts)
writeAudit(ctx, { action, resourceType, resourceId, newValues?, oldValues? }): Promise<void>

// Phase 1: procedure presets (src/server/trpc/middleware/freshSession.ts)
protectedProcedure, tdProcedure, sensitiveProcedure

// Phase 2: schemas (02-07)
playerCreateInput, playerSelfUpdateInput, playerOnBehalfOfInput, playerUpdateAsTdInput,
playerSetAgeCategoryInput, playerGetInput, playerListInput,
trainerCreateInput, trainerSelfUpdateInput, trainerUpdateAsTdInput, trainerGetInput, trainerListInput
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create src/server/trpc/routers/player.ts (7 procedures)</name>
  <read_first>
    - src/server/trpc/routers/admin.ts (full file — pattern for tdProcedure, ctx.db handle, writeAudit, RLS-bound transaction)
    - src/server/trpc/schemas/player.ts (02-07 — input schemas)
    - src/server/db/schema/players.ts (02-02 — players + ageCategoryHistory)
    - src/server/db/schema/memberships.ts (parent_child_links — for updateOnBehalfOf check)
    - src/lib/consent.ts (Phase 1 — isMinorAt helper)
    - src/lib/players.ts (02-04 — deriveAgeCategory helper)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-31, D-32, D-36, D-37
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 3 §Pitfall 6 (concurrent age-category transitions — SERIALIZABLE)
  </read_first>
  <files>
    src/server/trpc/routers/player.ts
  </files>
  <action>
    ```typescript
    /**
     * player.* tRPC router (Phase 2 — PLAYER-01..07, USER-04, DOM-CAT-01).
     *
     * Procedures:
     *   - create               — tdProcedure. Insert player + inaugural
     *                            age_category_history row in a tx.
     *   - get                  — protectedProcedure. NOT_FOUND on out-of-scope
     *                            (D-36 enumeration prevention).
     *   - list                 — protectedProcedure. RLS does the scoping.
     *   - updateSelf           — protectedProcedure. D-37 whitelist via the
     *                            schema (playerSelfUpdateInput).
     *   - updateOnBehalfOf     — protectedProcedure + parent_child_links check.
     *   - updateAsTd           — tdProcedure. Full edit.
     *   - setAgeCategory       — tdProcedure. SERIALIZABLE tx — Pitfall 6.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §B + §C + §D
     */
    import { TRPCError } from '@trpc/server';
    import { and, eq, isNull } from 'drizzle-orm';

    import { isMinorAt } from '@/lib/consent';
    import { deriveAgeCategory } from '@/lib/players';
    import { db as rawDb, type DbClient } from '@/server/db/client';
    import { ageCategoryHistory, players } from '@/server/db/schema/players';
    import { academyMemberships } from '@/server/db/schema/memberships';
    import { parentChildLinks } from '@/server/db/schema/memberships';
    import {
      playerCreateInput,
      playerGetInput,
      playerListInput,
      playerOnBehalfOfInput,
      playerSelfUpdateInput,
      playerSetAgeCategoryInput,
      playerUpdateAsTdInput,
    } from '../schemas/player';
    import { writeAudit } from '../middleware/audit';
    import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
    import { router } from '../trpc';

    export const playerRouter = router({
      /**
       * Create a player profile. The user row must already exist
       * (admin.user.create — Phase 1).
       *
       * Transaction shape:
       *   1. Compute derivable values (is_minor, age_category).
       *   2. INSERT players row.
       *   3. INSERT academy_memberships(user_id, academy_code, role='player')
       *      so the player is reachable through Phase 1's
       *      `players_visible_to()` SECURITY DEFINER function used by trainer
       *      and academy_manager RLS policies (WARNING-02 fix). Idempotent
       *      via ON CONFLICT DO NOTHING since (user_id, academy_code, role)
       *      is the composite PK.
       *   4. INSERT inaugural age_category_history row with
       *      effective_from = TODAY (player creation date, NOT date-of-birth
       *      — BLOCKER-07 fix). DOB would falsely claim the player has been
       *      in their current age_category since birth, breaking the
       *      DOM-CAT-02 invariant for tournament-time category lookups.
       *      effective_to = NULL.
       *   5. writeAudit.
       */
      create: tdProcedure
        .input(playerCreateInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

          const now = new Date();
          const isMinor = isMinorAt(input.dateOfBirth, now);
          const { code: ageCategoryCode, year: categoryYear } =
            await deriveAgeCategory(input.dateOfBirth, now, dbHandle);

          const todayIso = now.toISOString().slice(0, 10); // YYYY-MM-DD — player creation date
          const dobIso = input.dateOfBirth.toISOString().slice(0, 10);

          const created = await dbHandle.transaction(async (tx) => {
            const [row] = await tx
              .insert(players)
              .values({
                userId: input.userId,
                firstName: input.firstName,
                lastName: input.lastName,
                dateOfBirth: dobIso,
                gender: input.gender,
                school: input.school,
                street: input.street,
                streetNumber: input.streetNumber,
                postalCode: input.postalCode,
                city: input.city,
                province: input.province,
                country: input.country,
                phone: input.phone,
                email: input.email,
                club: input.club,
                statusCode: input.statusCode,
                academyCode: input.academyCode,
                ageCategoryCode,
                categoryYear,
                isMinor,
                emergencyContactName: input.emergencyContactName,
                emergencyContactPhone: input.emergencyContactPhone,
                emergencyContactRelation: input.emergencyContactRelation,
              })
              .returning();

            // WARNING-02 fix: register academy_memberships so the player is
            // visible to trainers/academy_managers via `players_visible_to()`.
            // ON CONFLICT DO NOTHING keeps this idempotent against retries.
            await tx
              .insert(academyMemberships)
              .values({
                userId: input.userId,
                academyCode: input.academyCode,
                role: 'player',
                linkedBy: ctx.scope!.userId,
              })
              .onConflictDoNothing();

            // BLOCKER-07 fix: effective_from = TODAY (creation date), not DOB.
            // Phase 4 tournament-time queries via getAgeCategoryAt(playerId,
            // tournament_date) will return NULL for dates before player
            // creation, which is the correct semantics — there is no
            // historical category record before the player existed in the
            // platform. Phase 5 may backfill earlier history if needed.
            await tx.insert(ageCategoryHistory).values({
              playerId: input.userId,
              ageCategoryCode,
              categoryYear,
              effectiveFrom: todayIso,
              setBy: ctx.scope!.userId,
            });

            return row!;
          });

          await writeAudit(ctx, {
            action: 'player.create',
            resourceType: 'player',
            resourceId: created.userId,
            newValues: {
              statusCode: created.statusCode,
              academyCode: created.academyCode,
              ageCategoryCode,
              categoryYear,
              isMinor,
              // PII columns (firstName, lastName, address, phone, email,
              // emergencyContact_*) intentionally OMITTED from audit per
              // log-redact-paths convention.
            },
          });

          return created;
        }),

      get: protectedProcedure.input(playerGetInput).query(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        // RLS filters → 0 rows for out-of-scope.
        const row = await dbHandle.query.players.findFirst({
          where: eq(players.userId, input.playerId),
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }),

      list: protectedProcedure.input(playerListInput).query(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        const conds = [];
        if (input.academyCode) conds.push(eq(players.academyCode, input.academyCode));
        if (input.statusCode) conds.push(eq(players.statusCode, input.statusCode));

        // RLS does scope-filtering for free — `findMany` returns only rows
        // current_user_id+role can see per 02-05 policies.
        const rows = await dbHandle.query.players.findMany({
          where: conds.length > 0 ? and(...conds) : undefined,
          limit: input.limit,
          orderBy: (t, { asc }) => [asc(t.lastName), asc(t.firstName)],
        });
        return rows;
      }),

      /**
       * D-37 self-update — schema whitelist enforced by Zod `.strict()`.
       * playerSelfUpdateInput is structurally narrower than the create/update
       * schemas so `statusCode`/`academyCode`/`firstName`/etc cannot be set.
       */
      updateSelf: protectedProcedure
        .input(playerSelfUpdateInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
          if (ctx.scope.role !== 'player') {
            // RLS would also block, but a clean 403 helps debugging.
            throw new TRPCError({ code: 'FORBIDDEN', message: 'role_not_allowed' });
          }
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

          const existing = await dbHandle.query.players.findFirst({
            where: eq(players.userId, ctx.scope.userId),
          });
          if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

          const [updated] = await dbHandle
            .update(players)
            .set({
              street: input.street,
              streetNumber: input.streetNumber,
              postalCode: input.postalCode,
              city: input.city,
              province: input.province,
              country: input.country,
              phone: input.phone,
              email: input.email,
              emergencyContactName: input.emergencyContactName,
              emergencyContactPhone: input.emergencyContactPhone,
              emergencyContactRelation: input.emergencyContactRelation,
              profilePhotoFileId: input.profilePhotoFileId,
              updatedAt: new Date(),
            })
            .where(eq(players.userId, ctx.scope.userId))
            .returning();

          // WARNING-13 fix: capture the SET of changed field NAMES (not
          // values) for GDPR-04 accountability. Field names are not PII;
          // capturing only `updatedAt` was forensically useless. The Phase 1
          // log-redact-paths convention strips field VALUES from audit
          // rows — `changedFields` is allowed because it carries no PII.
          const candidateFields = [
            'street', 'streetNumber', 'postalCode', 'city', 'province',
            'country', 'phone', 'email',
            'emergencyContactName', 'emergencyContactPhone',
            'emergencyContactRelation', 'profilePhotoFileId',
          ] as const;
          const changedFields = candidateFields.filter((f) => {
            const a = (existing as Record<string, unknown>)[f];
            const b = (updated as unknown as Record<string, unknown>)[f];
            return a !== b;
          });

          await writeAudit(ctx, {
            action: 'player.updateSelf',
            resourceType: 'player',
            resourceId: ctx.scope.userId,
            // Field-name set is non-PII; satisfies GDPR-04 accountability
            // (an operator can answer "which fields did the player change?").
            newValues: { changedFields },
          });

          return updated;
        }),

      updateOnBehalfOf: protectedProcedure
        .input(playerOnBehalfOfInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
          if (ctx.scope.role !== 'parent') {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'role_not_allowed' });
          }
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

          // Verify parent_child_links exists.
          const link = await dbHandle.query.parentChildLinks.findFirst({
            where: and(
              eq(parentChildLinks.parentUserId, ctx.scope.userId),
              eq(parentChildLinks.childUserId, input.playerId),
            ),
          });
          if (!link) throw new TRPCError({ code: 'NOT_FOUND' });

          const [updated] = await dbHandle
            .update(players)
            .set({
              street: input.street,
              streetNumber: input.streetNumber,
              postalCode: input.postalCode,
              city: input.city,
              province: input.province,
              country: input.country,
              phone: input.phone,
              email: input.email,
              emergencyContactName: input.emergencyContactName,
              emergencyContactPhone: input.emergencyContactPhone,
              emergencyContactRelation: input.emergencyContactRelation,
              updatedAt: new Date(),
            })
            .where(eq(players.userId, input.playerId))
            .returning();

          await writeAudit(ctx, {
            action: 'player.updateOnBehalfOf',
            resourceType: 'player',
            resourceId: input.playerId,
            newValues: { onBehalfOfChild: input.playerId },
          });
          return updated;
        }),

      updateAsTd: tdProcedure
        .input(playerUpdateAsTdInput)
        .mutation(async ({ ctx, input }) => {
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
          const existing = await dbHandle.query.players.findFirst({
            where: eq(players.userId, input.playerId),
          });
          if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

          const newIsMinor = isMinorAt(input.dateOfBirth, new Date());

          const [updated] = await dbHandle
            .update(players)
            .set({
              firstName: input.firstName,
              lastName: input.lastName,
              dateOfBirth: input.dateOfBirth.toISOString().slice(0, 10),
              gender: input.gender,
              school: input.school,
              street: input.street,
              streetNumber: input.streetNumber,
              postalCode: input.postalCode,
              city: input.city,
              province: input.province,
              country: input.country,
              phone: input.phone,
              email: input.email,
              club: input.club,
              statusCode: input.statusCode,
              academyCode: input.academyCode,
              isMinor: newIsMinor,
              profilePhotoFileId: input.profilePhotoFileId,
              emergencyContactName: input.emergencyContactName,
              emergencyContactPhone: input.emergencyContactPhone,
              emergencyContactRelation: input.emergencyContactRelation,
              updatedAt: new Date(),
            })
            .where(eq(players.userId, input.playerId))
            .returning();

          await writeAudit(ctx, {
            action: 'player.updateAsTd',
            resourceType: 'player',
            resourceId: input.playerId,
            oldValues: {
              statusCode: existing.statusCode,
              academyCode: existing.academyCode,
              isMinor: existing.isMinor,
            },
            newValues: {
              statusCode: updated!.statusCode,
              academyCode: updated!.academyCode,
              isMinor: newIsMinor,
            },
          });
          return updated;
        }),

      /**
       * D-32 — TD changes a player's age category effective from a given date.
       * SERIALIZABLE isolation prevents the Pitfall 6 race (two TDs both
       * inserting "current" rows for the same player).
       */
      setAgeCategory: tdProcedure
        .input(playerSetAgeCategoryInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

          const updated = await dbHandle.transaction(
            async (tx) => {
              // Close current row (effective_to IS NULL).
              const effectiveFromIso = input.effectiveFrom.toISOString().slice(0, 10);
              const effectiveToForOld = new Date(input.effectiveFrom);
              effectiveToForOld.setUTCDate(effectiveToForOld.getUTCDate() - 1);
              const effectiveToOldIso = effectiveToForOld.toISOString().slice(0, 10);

              await tx
                .update(ageCategoryHistory)
                .set({ effectiveTo: effectiveToOldIso })
                .where(
                  and(
                    eq(ageCategoryHistory.playerId, input.playerId),
                    isNull(ageCategoryHistory.effectiveTo),
                  ),
                );

              // Insert new "current" row.
              const [newRow] = await tx
                .insert(ageCategoryHistory)
                .values({
                  playerId: input.playerId,
                  ageCategoryCode: input.ageCategoryCode,
                  categoryYear: input.categoryYear,
                  effectiveFrom: effectiveFromIso,
                  setBy: ctx.scope!.userId,
                })
                .returning();

              // Mirror the snapshot onto players (D-32 — players carries current).
              await tx
                .update(players)
                .set({
                  ageCategoryCode: input.ageCategoryCode,
                  categoryYear: input.categoryYear,
                  updatedAt: new Date(),
                })
                .where(eq(players.userId, input.playerId));

              return newRow;
            },
            { isolationLevel: 'serializable' },
          );

          await writeAudit(ctx, {
            action: 'player.setAgeCategory',
            resourceType: 'age_category_history',
            resourceId: String(updated!.id),
            newValues: {
              playerId: input.playerId,
              ageCategoryCode: input.ageCategoryCode,
              categoryYear: input.categoryYear,
              effectiveFrom: input.effectiveFrom.toISOString().slice(0, 10),
            },
          });
          return updated;
        }),
    });
    ```

    Do NOT call `deriveAgeCategory` in `updateAsTd` — that mutation accepts the TD's explicit values (which may overrule the derived default). Use `setAgeCategory` for category changes; `updateAsTd` does not change category.

    Do NOT skip the parent-child link check in `updateOnBehalfOf` — RLS catches it but the explicit 404 is clearer for the UI.
  </action>
  <verify>
    <automated>test -f src/server/trpc/routers/player.ts && grep -q "export const playerRouter = router" src/server/trpc/routers/player.ts && grep -c "tdProcedure\b" src/server/trpc/routers/player.ts | grep -qE "^[3-9]" && grep -q "deriveAgeCategory" src/server/trpc/routers/player.ts && grep -q "isMinorAt" src/server/trpc/routers/player.ts && grep -q "isolationLevel: 'serializable'" src/server/trpc/routers/player.ts && grep -q "code: 'NOT_FOUND'" src/server/trpc/routers/player.ts && grep -q "writeAudit" src/server/trpc/routers/player.ts && grep -q "parentChildLinks" src/server/trpc/routers/player.ts && grep -q "ageCategoryHistory" src/server/trpc/routers/player.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*routers/player\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - 7 procedures exported on `playerRouter`
    - `create` uses `tdProcedure`, in a transaction, calls `deriveAgeCategory` + `isMinorAt`
    - `setAgeCategory` wraps in `{ isolationLevel: 'serializable' }`
    - `updateSelf` checks `ctx.scope.role === 'player'`
    - `updateOnBehalfOf` queries `parent_child_links` before updating
    - `get` throws NOT_FOUND on RLS filtered queries
    - Every state-changing procedure calls `writeAudit`
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Player domain mutations live.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Create src/server/trpc/routers/trainer.ts (5 procedures)</name>
  <read_first>
    - src/server/trpc/routers/player.ts (Task 1 — same pattern, simpler)
    - src/server/trpc/schemas/trainer.ts (02-07)
    - src/server/db/schema/trainers.ts (02-02)
  </read_first>
  <files>
    src/server/trpc/routers/trainer.ts
  </files>
  <action>
    ```typescript
    /**
     * trainer.* tRPC router (Phase 2 — TRAINER-01..03, USER-04).
     *
     * Procedures:
     *   - create     — tdProcedure. Insert trainer row.
     *   - get        — protectedProcedure. NOT_FOUND on out-of-scope.
     *   - list       — protectedProcedure. RLS scoping.
     *   - updateSelf — protectedProcedure. D-38 whitelist.
     *   - updateAsTd — tdProcedure. Full edit.
     *
     * TRAINER-03 (academy linkage): handled via Phase 1 `admin.user.linkAcademy`
     * + the academy_memberships table. No new junction. RLS on `trainers`
     * uses `academy_memberships` to scope trainer→trainer visibility.
     */
    import { TRPCError } from '@trpc/server';
    import { and, eq } from 'drizzle-orm';

    import { db as rawDb, type DbClient } from '@/server/db/client';
    import { trainers } from '@/server/db/schema/trainers';
    import {
      trainerCreateInput,
      trainerGetInput,
      trainerListInput,
      trainerSelfUpdateInput,
      trainerUpdateAsTdInput,
    } from '../schemas/trainer';
    import { writeAudit } from '../middleware/audit';
    import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
    import { router } from '../trpc';

    export const trainerRouter = router({
      create: tdProcedure
        .input(trainerCreateInput)
        .mutation(async ({ ctx, input }) => {
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

          const [row] = await dbHandle
            .insert(trainers)
            .values({
              userId: input.userId,
              firstName: input.firstName,
              lastName: input.lastName,
              dateOfBirth: input.dateOfBirth.toISOString().slice(0, 10),
              gender: input.gender,
              street: input.street,
              streetNumber: input.streetNumber,
              postalCode: input.postalCode,
              city: input.city,
              province: input.province,
              country: input.country,
              phone: input.phone,
              email: input.email,
              diplomaCode: input.diplomaCode,
              hasPedagogicalQualification: input.hasPedagogicalQualification,
            })
            .returning();

          await writeAudit(ctx, {
            action: 'trainer.create',
            resourceType: 'trainer',
            resourceId: row!.userId,
            newValues: {
              diplomaCode: row!.diplomaCode,
              hasPedagogicalQualification: row!.hasPedagogicalQualification,
            },
          });
          return row;
        }),

      get: protectedProcedure.input(trainerGetInput).query(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        const row = await dbHandle.query.trainers.findFirst({
          where: eq(trainers.userId, input.trainerId),
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }),

      list: protectedProcedure.input(trainerListInput).query(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        const conds = [];
        if (input.diplomaCode) conds.push(eq(trainers.diplomaCode, input.diplomaCode));
        // academyCode filter intentionally not implemented here — RLS scopes
        // visible trainers via academy_memberships; explicit filter by
        // academyCode would require a JOIN we don't need in Phase 2 list UI.

        const rows = await dbHandle.query.trainers.findMany({
          where: conds.length > 0 ? and(...conds) : undefined,
          limit: input.limit,
          orderBy: (t, { asc }) => [asc(t.lastName), asc(t.firstName)],
        });
        return rows;
      }),

      updateSelf: protectedProcedure
        .input(trainerSelfUpdateInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
          if (ctx.scope.role !== 'trainer') {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'role_not_allowed' });
          }
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

          const existing = await dbHandle.query.trainers.findFirst({
            where: eq(trainers.userId, ctx.scope.userId),
          });
          if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

          const [updated] = await dbHandle
            .update(trainers)
            .set({
              street: input.street,
              streetNumber: input.streetNumber,
              postalCode: input.postalCode,
              city: input.city,
              province: input.province,
              country: input.country,
              phone: input.phone,
              email: input.email,
              profilePhotoFileId: input.profilePhotoFileId,
              updatedAt: new Date(),
            })
            .where(eq(trainers.userId, ctx.scope.userId))
            .returning();

          await writeAudit(ctx, {
            action: 'trainer.updateSelf',
            resourceType: 'trainer',
            resourceId: ctx.scope.userId,
            oldValues: { updatedAt: existing.updatedAt },
            newValues: { updatedAt: updated!.updatedAt },
          });
          return updated;
        }),

      updateAsTd: tdProcedure
        .input(trainerUpdateAsTdInput)
        .mutation(async ({ ctx, input }) => {
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
          const existing = await dbHandle.query.trainers.findFirst({
            where: eq(trainers.userId, input.trainerId),
          });
          if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

          const [updated] = await dbHandle
            .update(trainers)
            .set({
              firstName: input.firstName,
              lastName: input.lastName,
              dateOfBirth: input.dateOfBirth.toISOString().slice(0, 10),
              gender: input.gender,
              street: input.street,
              streetNumber: input.streetNumber,
              postalCode: input.postalCode,
              city: input.city,
              province: input.province,
              country: input.country,
              phone: input.phone,
              email: input.email,
              diplomaCode: input.diplomaCode,
              hasPedagogicalQualification: input.hasPedagogicalQualification,
              profilePhotoFileId: input.profilePhotoFileId,
              updatedAt: new Date(),
            })
            .where(eq(trainers.userId, input.trainerId))
            .returning();

          await writeAudit(ctx, {
            action: 'trainer.updateAsTd',
            resourceType: 'trainer',
            resourceId: input.trainerId,
            oldValues: {
              diplomaCode: existing.diplomaCode,
              hasPedagogicalQualification: existing.hasPedagogicalQualification,
            },
            newValues: {
              diplomaCode: updated!.diplomaCode,
              hasPedagogicalQualification: updated!.hasPedagogicalQualification,
            },
          });
          return updated;
        }),
    });
    ```
  </action>
  <verify>
    <automated>test -f src/server/trpc/routers/trainer.ts && grep -q "export const trainerRouter = router" src/server/trpc/routers/trainer.ts && grep -c "tdProcedure\b" src/server/trpc/routers/trainer.ts | grep -qE "^[2-9]" && grep -q "trainerSelfUpdateInput" src/server/trpc/routers/trainer.ts && grep -q "code: 'NOT_FOUND'" src/server/trpc/routers/trainer.ts && grep -q "writeAudit" src/server/trpc/routers/trainer.ts && ! grep -q "diplomaCode" src/server/trpc/routers/trainer.ts | sed -n '/updateSelf:/,/^      \},$/p' | grep -q "diplomaCode" && npx tsc --noEmit 2>&1 | (! grep -i "error.*routers/trainer\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - 5 procedures: create, get, list, updateSelf, updateAsTd
    - `updateSelf` does NOT mutate `diplomaCode` or `hasPedagogicalQualification` (D-38)
    - Every state-changing procedure calls `writeAudit`
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Trainer domain mutations live.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Register both routers in src/server/trpc/routers/_app.ts</name>
  <read_first>
    - src/server/trpc/routers/_app.ts (current state after 02-09 added `file:`)
  </read_first>
  <files>
    src/server/trpc/routers/_app.ts
  </files>
  <action>
    Add imports + attach to `appRouter`:

    ```typescript
    import { playerRouter } from './player';
    import { trainerRouter } from './trainer';

    export const appRouter = router({
      ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
      consent: consentRouter,
      admin: adminRouter,
      file: fileRouter,
      player: playerRouter,    // NEW (Phase 2)
      trainer: trainerRouter,  // NEW (Phase 2)
    });
    ```

    Update JSDoc — append:

    ```
     *   - player.*         — Phase 2 (create / get / list / updateSelf / updateOnBehalfOf / updateAsTd / setAgeCategory)
     *   - trainer.*        — Phase 2 (create / get / list / updateSelf / updateAsTd)
    ```
  </action>
  <verify>
    <automated>grep -q "import { playerRouter }" src/server/trpc/routers/_app.ts && grep -q "import { trainerRouter }" src/server/trpc/routers/_app.ts && grep -q "player: playerRouter" src/server/trpc/routers/_app.ts && grep -q "trainer: trainerRouter" src/server/trpc/routers/_app.ts && grep -q "file: fileRouter" src/server/trpc/routers/_app.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*routers/_app\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - All 3 Phase 2 routers (file, player, trainer) attached to appRouter
    - Phase 1 routers (consent, admin) still attached
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>tRPC client now sees `trpc.player.*`, `trpc.trainer.*`, `trpc.file.*`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Player self-update ↔ field-level RBAC | Schema-level whitelist + role-check + RLS UPDATE policy = three layers |
| `setAgeCategory` ↔ concurrency | Two simultaneous TDs could create dueling "current" rows without SERIALIZABLE |
| `updateOnBehalfOf` ↔ parent_child_links | Parent of A cannot update player B |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-10-SELF-UPDATE-PRIVESC | Elevation of Privilege | Player submits `statusCode` via updateSelf | mitigate | Zod schema is structurally narrower (no statusCode field); `.strict()` rejects unknown keys; integration test in 02-15 covers (`playerSelfUpdateInput rejects extras`) |
| T-02-10-AGE-RACE | Tampering | Two TDs call setAgeCategory simultaneously → two open `effective_to IS NULL` rows | mitigate | `isolationLevel: 'serializable'` on the transaction; Pitfall 6 documented; integration test in 02-15 fires two parallel calls and asserts single open row remains |
| T-02-10-PARENT-WRONG-CHILD | Information Disclosure | Parent of A updates player B's profile | mitigate | Explicit `parent_child_links` query in updateOnBehalfOf before UPDATE; RLS UPDATE policy is the second layer |
| T-02-10-MINOR-DRIFT | Repudiation | DOB updated by TD; `is_minor` flag not recomputed | mitigate | `updateAsTd` recomputes `isMinorAt(dob, now)`; CHECK constraint at DB enforces emergency-contact consistency |
| T-02-10-AUDIT-PII-LEAK | Information Disclosure | writeAudit logs include `firstName`/`lastName`/`phone` | mitigate | PII fields intentionally omitted from `newValues` objects in every audit call; redacted by pino log-redact-paths regardless |
| T-02-10-MISSING-FRESH-SESSION | Elevation of Privilege | `updateAsTd` does not require recent re-auth | accept | Phase 1 SEC-03 only applies to medical writes / parent-child link / data export / erasure. TD identity edits are out of scope; if post-launch we tighten this, swap `tdProcedure` → `tdProcedure.use(requireFreshSession)`. |
</threat_model>

<verification>
- 12 total tRPC procedures across player + trainer routers
- Drizzle SERIALIZABLE transaction declared exactly once (in setAgeCategory)
- writeAudit called in every mutation (4 in playerRouter, 3 in trainerRouter)
- `npx tsc --noEmit` exits 0
- Client-side `trpc.player.list.useQuery()` typed
</verification>

<success_criteria>
- 7 player procedures + 5 trainer procedures live
- All schema-level RBAC whitelists honored
- D-32 + Pitfall 6 mitigation present
- D-36 enumeration prevention applied uniformly
- Phase 1 admin router and Phase 2 file router unchanged
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-10-SUMMARY.md` listing every procedure, its preset, its audit-action string, and the explicit RBAC check (if any) inside the handler.
</output>
