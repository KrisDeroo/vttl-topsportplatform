/**
 * trainer.* tRPC router (Phase 2 — TRAINER-01..03, USER-04).
 *
 * Procedures:
 *   - create     — tdProcedure. Insert trainer row.
 *   - get        — protectedProcedure. NOT_FOUND on out-of-scope.
 *   - list       — protectedProcedure. RLS scoping.
 *   - updateSelf — protectedProcedure. D-38 whitelist (no diplomaCode,
 *                  no hasPedagogicalQualification).
 *   - updateAsTd — tdProcedure. Full edit.
 *
 * TRAINER-03 (academy linkage): handled via Phase 1 `admin.user.linkAcademy`
 * + the academy_memberships table. No new junction. RLS on `trainers`
 * uses `academy_memberships` to scope trainer→trainer visibility.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §B + §D
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { db as rawDb, type DbClient } from '@/server/db/client';
import { trainers } from '@/server/db/schema/trainers';

import { writeAudit } from '../middleware/audit';
import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
import {
  trainerCreateInput,
  trainerGetInput,
  trainerListInput,
  trainerSelfUpdateInput,
  trainerUpdateAsTdInput,
} from '../schemas/trainer';
import { router } from '../trpc';

export const trainerRouter = router({
  create: tdProcedure
    .input(trainerCreateInput)
    .mutation(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

      const [row] = await dbHandle
        .insert(trainers)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        } as any)
        .returning();
      if (!row) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'trainer_insert_returned_no_row',
        });
      }

      await writeAudit(ctx, {
        action: 'trainer.create',
        resourceType: 'trainer',
        resourceId: row.userId,
        newValues: {
          diplomaCode: row.diplomaCode,
          hasPedagogicalQualification: row.hasPedagogicalQualification,
          // PII (firstName/lastName/address/phone/email) intentionally
          // omitted per log-redact-paths convention.
        },
      });
      return row;
    }),

  /**
   * Read a single trainer. RLS scopes the row set; NOT_FOUND is the
   * canonical response for both "row absent" and "row exists but
   * caller cannot see it" (D-36 enumeration prevention).
   */
  get: protectedProcedure
    .input(trainerGetInput)
    .query(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      const row = await dbHandle.query.trainers.findFirst({
        where: eq(trainers.userId, input.trainerId),
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  /**
   * List trainers in caller scope. The academyCode filter intentionally
   * does NOT join through academy_memberships here — RLS scopes visible
   * trainers via the membership table already, so an additional join
   * would be redundant for Phase 2 list UI. `diplomaCode` is a direct
   * column filter.
   */
  list: protectedProcedure
    .input(trainerListInput)
    .query(async ({ ctx, input }) => {
      const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
      const conds = [];
      if (input.diplomaCode) conds.push(eq(trainers.diplomaCode, input.diplomaCode));

      const rows = await dbHandle.query.trainers.findMany({
        where: conds.length > 0 ? and(...conds) : undefined,
        limit: input.limit,
        orderBy: (t, { asc }) => [asc(t.lastName), asc(t.firstName)],
      });
      return rows;
    }),

  /**
   * D-38 self-update — `diplomaCode` and `hasPedagogicalQualification`
   * are TD-only and intentionally OMITTED from `trainerSelfUpdateInput`
   * (Zod `.strict()` rejects them as unknown keys before the router
   * sees them).
   */
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
      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'trainer_update_returned_no_row',
        });
      }

      await writeAudit(ctx, {
        action: 'trainer.updateSelf',
        resourceType: 'trainer',
        resourceId: ctx.scope.userId,
        // Pre/post `updatedAt` is forensically thin but captures the
        // "this row was touched" event with the GDPR-04 actor attribution.
        // A future change set could mirror the players-router
        // `changedFields` pattern; trainer self-update has a smaller
        // candidate set so the value is lower.
        oldValues: { updatedAt: existing.updatedAt },
        newValues: { updatedAt: updated.updatedAt },
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
      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'trainer_update_returned_no_row',
        });
      }

      await writeAudit(ctx, {
        action: 'trainer.updateAsTd',
        resourceType: 'trainer',
        resourceId: input.trainerId,
        oldValues: {
          diplomaCode: existing.diplomaCode,
          hasPedagogicalQualification: existing.hasPedagogicalQualification,
        },
        newValues: {
          diplomaCode: updated.diplomaCode,
          hasPedagogicalQualification: updated.hasPedagogicalQualification,
        },
      });
      return updated;
    }),
});
