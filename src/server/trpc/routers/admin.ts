/**
 * tRPC `admin.user.*` sub-router (Plan 15) — TD-only user-management
 * surface backing the admin UI at `/[locale]/(app)/admin/users`.
 *
 * Surface contract:
 *
 *   - `list`             — tdProcedure. Returns users (TD scope, RLS-aware).
 *   - `listParentLinks`  — tdProcedure. Returns parent_child_links rows for
 *                          a child user_id (consumed by the RBAC matrix
 *                          test in Plan 17).
 *   - `auditLog.recent`  — tdProcedure. Phase 1 returns []; full audit
 *                          viewer is Phase 7 (SECURITY DEFINER read fn).
 *   - `create`           — tdProcedure. INSERTs a new user row (active=false)
 *                          + writes audit_log via writeAudit.
 *   - `activate`         — tdProcedure. Calls `canActivate(userId)` (Plan
 *                          12 minor-gate); throws PRECONDITION_FAILED with
 *                          the canonical reason on failure.
 *   - `deactivate`       — tdProcedure. Sets `users.active=false` and
 *                          `deactivated_at=now()`, then `setRevoked` (D-09)
 *                          + writes audit_log.
 *   - `assignRole`       — tdProcedure. Updates `users.role`, then
 *                          `setRevoked('role_changed', 24h)` (D-09) + writes
 *                          audit_log with `oldValues.role` / `newValues.role`.
 *   - `linkParent`       — sensitiveProcedure (re-auth required, SEC-03).
 *                          INSERTs a parent_child_links row + writes audit.
 *   - `linkAcademy`      — tdProcedure. INSERTs an academy_memberships row
 *                          + writes audit. Per CONTEXT.md a user can hold
 *                          multiple academy memberships (composite PK on
 *                          user_id + academy_code + role).
 *
 * D-09 wiring (Plan 09 revocation):
 *   - `deactivate` — `reason` from input (operator-supplied free text);
 *     TTL = default 30d (matches JWT lifetime).
 *   - `assignRole` — reason 'role_changed', TTL 24h. The shorter window
 *     is intentional: a role change forces re-auth on the next request,
 *     after which the new JWT carries the new role and the user no
 *     longer needs the revocation entry.
 *
 * Audit attribution:
 *   Every state-changing mutation calls `writeAudit(ctx, ...)` which
 *   pulls actor_user_id from `ctx.scope.userId` and ip + user-agent +
 *   request-id from the surrounding tRPC context. The middleware writes
 *   through the RLS-bound transaction handle (Plan 11 withRlsContext) so
 *   the audit row sees the same snapshot as the mutation.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 1
 *            .planning/phases/01-fundament/01-RESEARCH.md
 *              §admin.user.* tRPC router (lines 2057–2129)
 *            src/server/trpc/middleware/freshSession.ts (tdProcedure / sensitiveProcedure)
 *            src/server/auth/activate.ts (canActivate)
 *            src/server/auth/revocation.ts (setRevoked)
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Role } from '@/server/auth/permissions';
import { canActivate } from '@/server/auth/activate';
import { setRevoked } from '@/server/auth/revocation';
import { db as rawDb, type DbClient } from '@/server/db/client';
import { users } from '@/server/db/schema/auth';
import {
  academyMemberships,
  parentChildLinks,
} from '@/server/db/schema/memberships';

import { writeAudit } from '../middleware/audit';
import { sensitiveProcedure, tdProcedure } from '../middleware/freshSession';
import { router } from '../trpc';

/** Mirrors `userRoleEnum` (src/server/db/schema/auth.ts) and the `Role`
 *  union — the explicit literal list is the input-validation gate at the
 *  tRPC boundary so a malformed role string fails before the DB INSERT. */
const RoleSchema = z.enum([
  'technical_director',
  'academy_manager',
  'trainer',
  'player',
  'parent',
  'sparring_partner',
  'medical_staff',
]);

const LocaleSchema = z.enum(['nl', 'en', 'fr']);

export const adminRouter = router({
  user: router({
    /**
     * Lists users newest-first. RLS-bound transaction is provided by
     * `tdProcedure` (protectedProcedure → withRlsContext); the handler
     * uses `ctx.db ?? rawDb` to honour the RLS GUCs.
     *
     * `search` is reserved for a future plan — Phase 1 ignores it.
     */
    list: tdProcedure
      .input(
        z.object({
          search: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      )
      .query(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        return dbHandle.query.users.findMany({
          limit: input.limit,
          orderBy: (u, { desc }) => desc(u.createdAt),
        });
      }),

    /**
     * Returns parent_child_links rows for a child user_id (CRIT-3 RBAC
     * matrix probe). TD-only — non-TD callers go through
     * `consent.listMyParentLinks` (Plan 12) for own-link visibility.
     */
    listParentLinks: tdProcedure
      .input(z.object({ userId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        return dbHandle.query.parentChildLinks.findMany({
          where: eq(parentChildLinks.childUserId, input.userId),
        });
      }),

    /**
     * Phase 1 audit-log read surface — returns [] under TD scope. The
     * `audit_log` table's RLS read policy is `USING (false)` (Plan 04),
     * so even TD-as-app_user gets zero rows from a direct SELECT. The
     * Phase 7 admin viewer wires a SECURITY DEFINER function to bypass
     * this; Phase 1 only ships the surface so the RBAC matrix test
     * (Plan 17) has a query path for the `audit_log` resource probe.
     */
    auditLog: router({
      recent: tdProcedure
        .input(
          z.object({
            limit: z.number().int().min(1).max(100).default(20),
          }),
        )
        .query(async () => {
          // Intentionally empty — see block-comment above.
          return [] as unknown[];
        }),
    }),

    /**
     * Creates a new user with `active=false` (AUTH-04: TD activates
     * later via `activate`). Writes an audit_log entry attributing the
     * action to the TD with the new user's id as `resource_id`.
     *
     * `dateOfBirth` is optional — TD/staff accounts often have no DOB
     * on file; the generated `is_minor` column on `users` returns NULL
     * for those rows so they pass the activation guard as adults.
     *
     * `.strict()` on the input shape rejects unknown fields so a
     * misspelled key (e.g. `localePreference`) fails loudly instead of
     * being silently dropped.
     */
    create: tdProcedure
      .input(
        z
          .object({
            email: z.string().email(),
            name: z.string().min(2),
            role: RoleSchema,
            preferredLocale: LocaleSchema.default('nl'),
            dateOfBirth: z.string().date().optional(),
          })
          .strict(),
      )
      .mutation(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        // `createdAt` / `updatedAt` are filled by `tstz(..., { defaultNow:
        // true })`, but Drizzle 0.45's strict TS inference flags them as
        // required regardless. Cast through `unknown` (same pattern as
        // src/server/trpc/middleware/audit.ts and src/lib/consent.ts) so the
        // DB defaults remain canonical and we don't reintroduce client-side
        // wall-clock drift here.
        const values = {
          email: input.email,
          name: input.name,
          role: input.role as Role,
          preferredLocale: input.preferredLocale,
          dateOfBirth: input.dateOfBirth ?? null,
          active: false,
        };
        const [u] = await dbHandle
          .insert(users)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .values(values as any)
          .returning();
        if (!u) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'user_insert_returned_no_row',
          });
        }
        await writeAudit(ctx, {
          action: 'user.create',
          resourceType: 'user',
          resourceId: u.id,
          newValues: { email: input.email, role: input.role },
        });
        return u;
      }),

    /**
     * Flips `users.active = true` after the Plan 12 minor-gate passes.
     * `canActivate` returns one of `not_found | parent_link_missing |
     * parent_consent_missing | consent_missing`; we surface the reason
     * as the `message` of a PRECONDITION_FAILED error so the UI can
     * translate it via i18n keys (`admin.users.errors.<reason>`).
     */
    activate: tdProcedure
      .input(z.object({ userId: z.string().uuid() }).strict())
      .mutation(async ({ ctx, input }) => {
        const result = await canActivate(input.userId);
        if (!result.ok) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: result.reason ?? 'unknown',
          });
        }
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        const [u] = await dbHandle
          .update(users)
          .set({ active: true })
          .where(eq(users.id, input.userId))
          .returning();
        await writeAudit(ctx, {
          action: 'user.activate',
          resourceType: 'user',
          resourceId: input.userId,
        });
        return u;
      }),

    /**
     * Sets `users.active=false` + `deactivated_at=now()`, then immediately
     * revokes the user's session (D-09). The next protected tRPC call
     * from that user fails with UNAUTHORIZED `session_revoked` and the
     * UI prompts a re-auth — but a deactivated account has nowhere to
     * re-auth to until the TD reactivates them.
     *
     * `reason.min(3)` ensures the operator typed a meaningful explanation
     * — the reason is stored on both the audit_log row and the Upstash
     * revocation entry for forensic clarity.
     */
    deactivate: tdProcedure
      .input(
        z
          .object({
            userId: z.string().uuid(),
            reason: z.string().min(3),
          })
          .strict(),
      )
      .mutation(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        await dbHandle
          .update(users)
          .set({ active: false, deactivatedAt: new Date(Date.now()) })
          .where(eq(users.id, input.userId));
        await setRevoked(input.userId, input.reason);
        await writeAudit(ctx, {
          action: 'user.deactivate',
          resourceType: 'user',
          resourceId: input.userId,
          newValues: { reason: input.reason },
        });
        return { ok: true };
      }),

    /**
     * Updates `users.role` and revokes the old session (D-09). The
     * 24-hour TTL is shorter than the default 30d — long enough to
     * force a re-auth on the next request while letting the entry
     * auto-expire afterwards. The new JWT issued post-re-auth carries
     * the new role; no further revocation entry needed.
     *
     * Audit row captures both `oldValues.role` and `newValues.role` so
     * the security review can spot demotions / promotions at a glance.
     */
    assignRole: tdProcedure
      .input(
        z
          .object({
            userId: z.string().uuid(),
            role: RoleSchema,
          })
          .strict(),
      )
      .mutation(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        const old = await dbHandle.query.users.findFirst({
          where: eq(users.id, input.userId),
        });
        const [u] = await dbHandle
          .update(users)
          .set({ role: input.role as Role })
          .where(eq(users.id, input.userId))
          .returning();
        await setRevoked(input.userId, 'role_changed', 60 * 60 * 24);
        await writeAudit(ctx, {
          action: 'user.role_change',
          resourceType: 'user',
          resourceId: input.userId,
          oldValues: { role: old?.role },
          newValues: { role: input.role },
        });
        return u;
      }),

    /**
     * Sensitive — re-auth required (SEC-03) because creating a
     * parent-child link is a scope-uitbreiding for the parent
     * (gains read-access to the minor's medical events via the
     * Plan 04 `medical.read_assigned` policy). Throwing
     * `re_auth_required` from `requireFreshSession` lets the UI route
     * the operator to /[locale]/(auth)/re-auth without losing the form
     * state.
     *
     * The DB-level UNIQUE constraint on `parent_child_links.child_user_id`
     * (Plan 02 memberships.ts) enforces Belgian Art. 8 "one consenting
     * parent per minor" — a second parent insert here fails at the
     * Postgres layer with a 23505 violation, which the TRPCError formatter
     * surfaces as a generic mutation error (the UI presents it as a
     * "child already linked" message via the i18n catalog).
     */
    linkParent: sensitiveProcedure
      .input(
        z
          .object({
            parentUserId: z.string().uuid(),
            childUserId: z.string().uuid(),
            consentGivenAt: z.string().datetime(),
          })
          .strict(),
      )
      .mutation(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        const linkValues = {
          parentUserId: input.parentUserId,
          childUserId: input.childUserId,
          consentGivenAt: new Date(input.consentGivenAt),
          linkedBy: ctx.scope!.userId,
        };
        await dbHandle
          .insert(parentChildLinks)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .values(linkValues as any);
        await writeAudit(ctx, {
          action: 'user.link_parent',
          resourceType: 'parent_child_link',
          resourceId: `${input.parentUserId}:${input.childUserId}`,
          newValues: input,
        });
        return { ok: true };
      }),

    /**
     * Adds an academy_membership row. Defaults `role` to 'trainer' but
     * accepts 'academy_manager' for academy-level admin grants. The
     * composite PK (user_id + academy_code + role) lets a single user
     * hold multiple roles at the same academy without colliding.
     *
     * Per CONTEXT.md a user can have multiple academy memberships —
     * the FK to `academy.code` enforces the lookup discipline (no
     * free-text academy names).
     */
    linkAcademy: tdProcedure
      .input(
        z
          .object({
            trainerUserId: z.string().uuid(),
            academyCode: z.string(),
            role: z
              .enum(['trainer', 'academy_manager'])
              .default('trainer'),
          })
          .strict(),
      )
      .mutation(async ({ ctx, input }) => {
        const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
        const membershipValues = {
          userId: input.trainerUserId,
          academyCode: input.academyCode,
          role: input.role,
          linkedBy: ctx.scope!.userId,
        };
        await dbHandle
          .insert(academyMemberships)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .values(membershipValues as any);
        await writeAudit(ctx, {
          action: 'user.link_academy',
          resourceType: 'academy_membership',
          resourceId: `${input.trainerUserId}:${input.academyCode}`,
          newValues: input,
        });
        return { ok: true };
      }),
  }),
});
