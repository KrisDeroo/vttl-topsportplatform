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
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 3 §Pitfall 6
 */
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';

import { isMinorAt } from '@/lib/consent';
import { deriveAgeCategory } from '@/lib/players';
import { db as rawDb, type DbClient } from '@/server/db/client';
import {
  academyMemberships,
  parentChildLinks,
} from '@/server/db/schema/memberships';
import { ageCategoryHistory, players } from '@/server/db/schema/players';

import { writeAudit } from '../middleware/audit';
import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
import {
  playerCreateInput,
  playerGetInput,
  playerListInput,
  playerOnBehalfOfInput,
  playerSelfUpdateInput,
  playerSetAgeCategoryInput,
  playerUpdateAsTdInput,
} from '../schemas/player';
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

      // BLOCKER-07 fix: effective_from = TODAY (creation date), NOT DOB.
      // Setting effective_from to DOB would falsely claim the player has
      // been in this age_category since birth, breaking the DOM-CAT-02
      // invariant that getAgeCategoryAt(tournament_date) returns the
      // category in effect at tournament time. Phase 5 may backfill
      // earlier history rows if a historical claim becomes necessary.
      const todayIso = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const dobIso = input.dateOfBirth.toISOString().slice(0, 10);

      // `isMinor` from isMinorAt(...) can be null only when dateOfBirth
      // is null/undefined/invalid — playerCreateInput requires a valid
      // dateOfBirth (Zod z.coerce.date().max(now)), so a null here would
      // be a contract violation. Default to false for type-safety but
      // assert above via Zod.
      const isMinorFlag = isMinor === null ? false : isMinor;

      const playerValues = {
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
        isMinor: isMinorFlag,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactRelation: input.emergencyContactRelation,
      };

      let created;
      try {
        created = await dbHandle.transaction(async (tx) => {
          const [row] = await tx
            .insert(players)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values(playerValues as any)
            .returning();
          if (!row) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'player_insert_returned_no_row',
            });
          }

          // WARNING-02 fix: register academy_memberships so the player is
          // visible to trainers/academy_managers via `players_visible_to()`.
          // ON CONFLICT DO NOTHING keeps this idempotent against retries.
          await tx
            .insert(academyMemberships)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values({
              userId: input.userId,
              academyCode: input.academyCode,
              role: 'player',
              linkedBy: ctx.scope!.userId,
            } as any)
            .onConflictDoNothing();

          // BLOCKER-07 fix: effective_from = TODAY (creation date), NOT DOB.
          // Phase 4 tournament-time queries via getAgeCategoryAt(playerId,
          // tournament_date) will return NULL for dates before player
          // creation, which is the correct semantics — there is no
          // historical category record before the player existed in the
          // platform.
          await tx
            .insert(ageCategoryHistory)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values({
              playerId: input.userId,
              ageCategoryCode,
              categoryYear,
              effectiveFrom: todayIso,
              setBy: ctx.scope!.userId,
            } as any);

          return row;
        });
      } catch (err: unknown) {
        // Gap-closure (verifier verdict 2026-05-13): map the Postgres
        // CHECK-constraint violation `players_minor_emergency_contact`
        // (SQLSTATE 23514) to a clean BAD_REQUEST. Without this catch,
        // the TD sees a generic 500 when emergency contact is missing
        // for a minor — breaks Phase 2 succescriterium #5 (PLAYER-06).
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23514' && e.constraint === 'players_minor_emergency_contact') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'errors.field.emergencyContactRequiredForMinor',
          });
        }
        throw err;
      }

      await writeAudit(ctx, {
        action: 'player.create',
        resourceType: 'player',
        resourceId: created.userId,
        newValues: {
          statusCode: created.statusCode,
          academyCode: created.academyCode,
          ageCategoryCode,
          categoryYear,
          isMinor: isMinorFlag,
          // PII columns (firstName, lastName, address, phone, email,
          // emergencyContact_*) intentionally OMITTED from audit per
          // log-redact-paths convention.
        },
      });

      return created;
    }),

  /**
   * Read a single player. RLS scopes the row set — if the caller cannot
   * see the row, the query returns 0 rows. We surface NOT_FOUND so
   * callers cannot distinguish "row does not exist" from "row exists
   * but you cannot see it" (D-36 enumeration prevention).
   */
  get: protectedProcedure
    .input(playerGetInput)
    .query(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      const row = await dbHandle.query.players.findFirst({
        where: eq(players.userId, input.playerId),
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  /**
   * List players in caller scope. RLS does scope-filtering for free —
   * `findMany` returns only rows current_user_id+role can see per the
   * 02-05 policies.
   */
  list: protectedProcedure
    .input(playerListInput)
    .query(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      const conds = [];
      if (input.academyCode) conds.push(eq(players.academyCode, input.academyCode));
      if (input.statusCode) conds.push(eq(players.statusCode, input.statusCode));

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
      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'player_update_returned_no_row',
        });
      }

      // WARNING-13 fix: capture the SET of changed field NAMES (not
      // values) for GDPR-04 accountability. Field names are not PII;
      // capturing only `updatedAt` was forensically useless. The Phase 1
      // log-redact-paths convention strips field VALUES from audit
      // rows — `changedFields` is allowed because it carries no PII.
      const candidateFields = [
        'street',
        'streetNumber',
        'postalCode',
        'city',
        'province',
        'country',
        'phone',
        'email',
        'emergencyContactName',
        'emergencyContactPhone',
        'emergencyContactRelation',
        'profilePhotoFileId',
      ] as const;
      const existingRecord = existing as unknown as Record<string, unknown>;
      const updatedRecord = updated as unknown as Record<string, unknown>;
      const changedFields = candidateFields.filter(
        (f) => existingRecord[f] !== updatedRecord[f],
      );

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

  /**
   * Parent of minor edits child's non-sensitive fields. The
   * parent_child_links row must exist (Belgian Art. 8 — Plan 02
   * memberships.ts UNIQUE child_user_id). RLS's UPDATE policy is the
   * second layer; the explicit 404 here makes the failure mode clearer
   * for the UI.
   */
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
          profilePhotoFileId: input.profilePhotoFileId,
          updatedAt: new Date(),
        })
        .where(eq(players.userId, input.playerId))
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'player_update_returned_no_row',
        });
      }

      await writeAudit(ctx, {
        action: 'player.updateOnBehalfOf',
        resourceType: 'player',
        resourceId: input.playerId,
        newValues: { onBehalfOfChild: input.playerId },
      });
      return updated;
    }),

  /**
   * TD full edit. Recomputes `isMinor` from the (possibly updated) DOB —
   * if the TD adjusts the birth date, the minor flag must stay coherent.
   * Age-category transitions are NOT handled here; use `setAgeCategory`
   * for that (it owns the history-row bookkeeping).
   */
  updateAsTd: tdProcedure
    .input(playerUpdateAsTdInput)
    .mutation(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      const existing = await dbHandle.query.players.findFirst({
        where: eq(players.userId, input.playerId),
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      const recomputedIsMinor = isMinorAt(input.dateOfBirth, new Date());
      const newIsMinor = recomputedIsMinor === null ? false : recomputedIsMinor;

      let updated;
      try {
        const rows = await dbHandle
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
        updated = rows[0];
      } catch (err: unknown) {
        // Same gap-closure as player.create: an UPDATE that flips
        // is_minor=true without emergency contact would otherwise raise
        // a generic 500. Map SQLSTATE 23514 on this constraint to a
        // BAD_REQUEST with the locale-aware i18n key.
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23514' && e.constraint === 'players_minor_emergency_contact') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'errors.field.emergencyContactRequiredForMinor',
          });
        }
        throw err;
      }
      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'player_update_returned_no_row',
        });
      }

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
          statusCode: updated.statusCode,
          academyCode: updated.academyCode,
          isMinor: newIsMinor,
        },
      });
      return updated;
    }),

  /**
   * D-32 — TD changes a player's age category effective from a given
   * date. SERIALIZABLE isolation prevents the Pitfall 6 race (two TDs
   * both inserting "current" rows for the same player).
   *
   * Transaction shape:
   *   1. Close the current open row (effective_to IS NULL) by setting
   *      effective_to = effectiveFrom - 1 day.
   *   2. Insert the new "current" row with the supplied effective_from
   *      and effective_to = NULL.
   *   3. Mirror the new code+year onto the players row (denormalised
   *      snapshot per D-32).
   */
  setAgeCategory: tdProcedure
    .input(playerSetAgeCategoryInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.scope) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

      const updated = await dbHandle.transaction(
        async (tx) => {
          const effectiveFromIso = input.effectiveFrom
            .toISOString()
            .slice(0, 10);
          // effective_to of the previous row = effectiveFrom - 1 day,
          // so the [from, to] ranges are disjoint and continuous.
          const effectiveToForOld = new Date(input.effectiveFrom);
          effectiveToForOld.setUTCDate(effectiveToForOld.getUTCDate() - 1);
          const effectiveToOldIso = effectiveToForOld
            .toISOString()
            .slice(0, 10);

          await tx
            .update(ageCategoryHistory)
            .set({ effectiveTo: effectiveToOldIso })
            .where(
              and(
                eq(ageCategoryHistory.playerId, input.playerId),
                isNull(ageCategoryHistory.effectiveTo),
              ),
            );

          const [newRow] = await tx
            .insert(ageCategoryHistory)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values({
              playerId: input.playerId,
              ageCategoryCode: input.ageCategoryCode,
              categoryYear: input.categoryYear,
              effectiveFrom: effectiveFromIso,
              setBy: ctx.scope!.userId,
            } as any)
            .returning();
          if (!newRow) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'age_history_insert_returned_no_row',
            });
          }

          // Mirror the snapshot onto players (D-32 — players carries
          // the current code+year for fast read paths).
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
        resourceId: String(updated.id),
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
