---
phase: 01-fundament
plan: 11
type: execute
wave: 5
depends_on: [02, 04, 05, 09, 13]
files_modified:
  - src/server/trpc/trpc.ts
  - src/server/trpc/server-context.ts
  - src/server/trpc/middleware/auth.ts
  - src/server/trpc/middleware/freshSession.ts
  - src/server/trpc/middleware/rls.ts
  - src/server/trpc/middleware/audit.ts
  - src/server/trpc/middleware/requireConsent.ts
  - src/server/trpc/routers/_app.ts
  - src/app/api/trpc/[trpc]/route.ts
  - tests/integration/caller-context.test.ts
  - tests/helpers/trpc.ts
autonomous: true
requirements:
  - AUTH-03
  - USER-04
  - SEC-03
  - GDPR-04
requirements_supports:  # informational — primary owners listed below
  - USER-05
threat_refs:
  - T-01-02
  - T-01-07
tags:
  - phase-1
  - trpc
  - middleware
  - caller-context

must_haves:
  truths:
    - "CallerContext shape: { session, user, scope: { userId, role, academyIds[], linkedPlayerIds[], locale, issuedAt, fresh }, requestId, ipAddress, userAgent, log }"
    - "createContext loads scope from JWT claim if recent (< 15 min) else rebuilds from DB; stores issuedAt for staleness check"
    - "requireAuth middleware: checks isRevoked() Upstash list (D-09); throws 401 with reason 'session_revoked' if listed"
    - "MAJOR-11: D-08 JWT-claim cache deferred to v1.1; Phase 1 re-fetches scope every request (always fresh). STALENESS_MS gate removed — see middleware block-comment for v1.1 follow-up."
    - "withRlsContext middleware: wraps handler in `db.transaction(...)` and SELECT set_config('app.user_id', ..., true) + set_config('app.user_role', ..., true) + set_config('app.request_id', ..., true)"
    - "requireFreshSession middleware: throws FORBIDDEN re_auth_required when scope.fresh === false (SEC-03)"
    - "requireRole(...roles) middleware: throws FORBIDDEN if scope.role not in allowlist"
    - "Procedure presets: publicProcedure, protectedProcedure (auth + rls + rateLimit('user') + requireCurrentConsent), tdProcedure, sensitiveProcedure (protected + freshSession), medicalProcedure (protected + role gate + write-time audit)"
    - "Audit middleware writes audit_log row for state-changing mutations (action, resource_type, resource_id, old/new values, ip, user_agent, request_id)"
  artifacts:
    - path: "src/server/trpc/trpc.ts"
      provides: "initTRPC + CallerContext type + procedure presets"
      exports: ["router", "publicProcedure", "protectedProcedure", "tdProcedure", "sensitiveProcedure", "medicalProcedure"]
    - path: "src/server/trpc/server-context.ts"
      provides: "createContext for the Next.js route handler"
      exports: ["createContext"]
    - path: "src/server/trpc/middleware/auth.ts"
      provides: "requireAuth (revocation + staleness check)"
      exports: ["requireAuth"]
    - path: "src/server/trpc/middleware/rls.ts"
      provides: "withRlsContext — set_config GUCs in a transaction"
      exports: ["withRlsContext"]
    - path: "src/server/trpc/middleware/freshSession.ts"
      provides: "requireFreshSession + requireRole helpers (SEC-03)"
      exports: ["requireFreshSession", "requireRole"]
    - path: "src/server/trpc/middleware/audit.ts"
      provides: "writeAudit helper + auditMiddleware factory"
      exports: ["writeAudit", "auditMiddleware"]
    - path: "src/server/trpc/middleware/requireConsent.ts"
      provides: "requireCurrentConsent — blocks all protected procedures pre-consent or after major version bump (D-07)"
      exports: ["requireCurrentConsent"]
  key_links:
    - from: "src/server/trpc/middleware/auth.ts"
      to: "src/server/auth/revocation.ts (Plan 09)"
      via: "isRevoked(userId) Upstash GET"
      pattern: "isRevoked"
    - from: "src/server/trpc/middleware/rls.ts"
      to: "src/server/db/client.ts"
      via: "db.transaction with SET LOCAL app.user_id / app.user_role / app.request_id"
      pattern: "set_config\\('app.user_id'"
    - from: "src/server/trpc/middleware/audit.ts"
      to: "src/server/db/schema/audit.ts"
      via: "INSERT INTO audit_log"
      pattern: "auditLog"
---

<objective>
The single most security-critical wiring in Phase 1: every authenticated tRPC request runs through this middleware chain. It bridges Better Auth (sessions) → Plan 09 (revocation) → Plan 04 (RLS) → audit_log. Get this wrong and the rest of the security model collapses.

CallerContext shape per D-08: `{ userId, role, academyIds[], linkedPlayerIds[], locale }` — pulled from Better Auth session + DB on first request, cached in JWT claim with 15-min staleness budget. Plan 15 (TD admin UI) is the first consumer.

Output: complete tRPC bootstrap; protectedProcedure / tdProcedure / sensitiveProcedure / medicalProcedure presets; audit log writes wired to mutations; SET LOCAL GUCs make Plan 04 RLS policies actually evaluate correctly.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: trpc.ts core (initTRPC + CallerContext type) + createContext</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §CallerContext Middleware (lines 1028–1156) — full code
    - .planning/phases/01-fundament/01-RESEARCH.md §tRPC client setup with Better Auth session (lines 2424–2467) — createContext pattern
    - .planning/phases/01-fundament/01-CONTEXT.md §C (D-08, D-09, D-10, D-11)
  </read_first>
  <files>
    src/server/trpc/trpc.ts
    src/server/trpc/server-context.ts
    src/app/api/trpc/[trpc]/route.ts
  </files>
  <behavior>
    - Test 1 (unit): createContext with no session → scope === null
    - Test 2 (unit): createContext with valid session → scope populated with role + academyIds + linkedPlayerIds + locale + issuedAt
    - Test 3 (unit): scope.fresh === true when session.freshUntil > now
  </behavior>
  <action>
    Create `src/server/trpc/trpc.ts` per RESEARCH lines 1032–1071 with extra exports:
    ```ts
    import { initTRPC, TRPCError } from '@trpc/server';
    import { ZodError } from 'zod';
    import type { Session, User } from '@/server/auth/auth';
    import type { Logger } from 'pino';
    import type { Role } from '@/server/auth/permissions';

    export type CallerContext = {
      session: Session | null;
      user: User | null;
      scope: {
        userId: string;
        role: Role;
        academyIds: string[];
        linkedPlayerIds: string[];
        locale: 'nl' | 'en' | 'fr';
        issuedAt: number;
        fresh: boolean;
      } | null;
      requestId: string;
      ipAddress: string;
      userAgent: string;
      log: Logger;
      db?: any;  // populated by withRlsContext middleware (transactional binding)
    };

    const t = initTRPC.context<CallerContext>().create({
      errorFormatter({ shape, error }) {
        return {
          ...shape,
          data: {
            ...shape.data,
            zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
          },
        };
      },
    });

    export const router = t.router;
    export const middleware = t.middleware;
    export const publicProcedure = t.procedure;

    // Procedure presets are exported from freshSession.ts to avoid circular deps.
    ```

    Create `src/server/trpc/server-context.ts` (per RESEARCH lines 2425–2467 — adapt for D-08 staleness):
    ```ts
    import { auth } from '@/server/auth/auth';
    import { headers } from 'next/headers';
    import { db } from '@/server/db/client';
    import { academyMemberships, parentChildLinks } from '@/server/db/schema';
    import { eq } from 'drizzle-orm';
    import { log } from '@/lib/log';
    import { randomUUID } from 'crypto';
    import type { CallerContext } from './trpc';
    import type { Role } from '@/server/auth/permissions';

    export async function createContext(): Promise<CallerContext> {
      const hdrs = await headers();
      const session = await auth.api.getSession({ headers: hdrs });
      const requestId = hdrs.get('x-request-id') ?? randomUUID();
      const ipAddress = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
      const userAgent = hdrs.get('user-agent') ?? '';

      let scope: CallerContext['scope'] = null;
      if (session) {
        const u = session.user as any;
        const [academies, links] = await Promise.all([
          db.query.academyMemberships.findMany({ where: eq(academyMemberships.userId, u.id) }),
          db.query.parentChildLinks.findMany({ where: eq(parentChildLinks.parentUserId, u.id) }),
        ]);
        scope = {
          userId: u.id,
          role: (u.role ?? 'player') as Role,
          academyIds: academies.map((a) => a.academyCode),
          linkedPlayerIds: links.map((l) => l.childUserId),
          locale: (u.preferredLocale ?? 'nl') as 'nl' | 'en' | 'fr',
          issuedAt: Date.now(),
          fresh: !!session.session.freshUntil && new Date(session.session.freshUntil) > new Date(Date.now()),
        };
      }

      return {
        session,
        user: session?.user as any,
        scope,
        requestId,
        ipAddress,
        userAgent,
        log: log.child({ requestId, userId: scope?.userId }),
      };
    }
    ```

    Create `src/app/api/trpc/[trpc]/route.ts`:
    ```ts
    import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
    import { appRouter } from '@/server/trpc/routers/_app';
    import { createContext } from '@/server/trpc/server-context';

    function handler(req: Request) {
      return fetchRequestHandler({
        endpoint: '/api/trpc',
        req,
        router: appRouter,
        createContext: () => createContext(),
        onError({ error, path }) {
          // pino redact already strips PII; safe to log error.message
          if (process.env.NODE_ENV !== 'production') {
            console.error(`[trpc] ${path}: ${error.message}`);
          }
        },
      });
    }

    export { handler as GET, handler as POST };
    ```
  </action>
  <verify>
    <automated>test -f src/server/trpc/trpc.ts && test -f src/server/trpc/server-context.ts && test -f src/app/api/trpc/\[trpc\]/route.ts && grep -q "type CallerContext" src/server/trpc/trpc.ts && grep -q "issuedAt: number" src/server/trpc/trpc.ts && grep -q "fresh: boolean" src/server/trpc/trpc.ts && grep -q "zodError" src/server/trpc/trpc.ts && grep -q "createContext" src/server/trpc/server-context.ts && grep -q "academyMemberships" src/server/trpc/server-context.ts && grep -q "parentChildLinks" src/server/trpc/server-context.ts && grep -q "preferredLocale" src/server/trpc/server-context.ts && grep -q "fetchRequestHandler" src/app/api/trpc/\[trpc\]/route.ts && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `CallerContext` type matches D-08 shape exactly: scope is null OR { userId, role, academyIds[], linkedPlayerIds[], locale, issuedAt, fresh }
    - `createContext` populates academies + linkedPlayerIds in parallel (Promise.all)
    - `scope.fresh` derived from `session.session.freshUntil > now`
    - tRPC route handler uses fetchRequestHandler at /api/trpc
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>tRPC core + context wiring in place.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: requireAuth (revocation + staleness) + withRlsContext + requireFreshSession + requireRole + audit + requireConsent</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §requireAuth middleware (lines 1074–1103)
    - .planning/phases/01-fundament/01-RESEARCH.md §withRlsContext middleware (lines 1105–1124)
    - .planning/phases/01-fundament/01-RESEARCH.md §requireRole and requireFreshSession (lines 1126–1152)
    - .planning/phases/01-fundament/01-RESEARCH.md §Consent withdrawal & re-consent (lines 1812–1844) — requireCurrentConsent body
    - src/server/auth/revocation.ts (Plan 09)
    - src/server/auth/permissions.ts (Plan 05)
  </read_first>
  <files>
    src/server/trpc/middleware/auth.ts
    src/server/trpc/middleware/rls.ts
    src/server/trpc/middleware/freshSession.ts
    src/server/trpc/middleware/audit.ts
    src/server/trpc/middleware/requireConsent.ts
    tests/integration/caller-context.test.ts
    tests/helpers/trpc.ts
  </files>
  <behavior>
    - Test 1 (integration): requireAuth throws UNAUTHORIZED when scope is null
    - Test 2 (integration): requireAuth throws UNAUTHORIZED 'session_revoked' when isRevoked() returns truthy
    - (Test 3 removed — see MAJOR-11; scope_stale gate deferred to v1.1)
    - Test 4 (integration): withRlsContext executes set_config 3x inside a transaction
    - Test 5 (integration): requireFreshSession throws FORBIDDEN 're_auth_required' when scope.fresh === false
    - Test 6 (integration): requireRole(['technical_director']) throws FORBIDDEN for non-TD
    - Test 7 (integration): writeAudit INSERTs an audit_log row with full fields
  </behavior>
  <action>
    `src/server/trpc/middleware/auth.ts`:
    ```ts
    import { TRPCError } from '@trpc/server';
    import { middleware } from '../trpc';
    import { isRevoked } from '@/server/auth/revocation';

    /**
     * Phase-1 scope refresh policy (MAJOR-11 resolution):
     *
     * D-08 specifies a 15-min JWT-claim cache for scope (academyIds + linkedPlayerIds + role) so we
     * don't hit the DB on every authenticated request. Phase 1 implements the simpler **"always fresh"**
     * variant: `createContext` re-fetches scope from the DB on EVERY request. Net effect: every protected
     * tRPC call costs an extra ~10–30ms for the academy + parent-link reads.
     *
     * Rationale for deferring the cache:
     * - Better Auth's `additionalFields` plugin (the canonical place to extend session-cookie claims)
     *   adds a non-trivial coupling to the auth library upgrade path. It's better added once we have
     *   real load profiles in Phase 8 staging and can verify the cache vs latency tradeoff.
     * - Revocation (`isRevoked` Upstash GET) is the security-critical part of D-08/09 — that lives
     *   right here on every request, sub-millisecond, and is implemented correctly.
     * - The dead `STALENESS_MS` check in earlier drafts of this plan was a footgun: with no cache,
     *   `issuedAt` is always within milliseconds, so the gate never fired — pure noise that masked
     *   the absence of caching. We remove it now and re-introduce a real cache + gate in v1.1.
     *
     * v1.1 follow-up (tracked in PROJECT.md backlog): wire Better Auth `additionalFields` for
     * `academyIds[] / linkedPlayerIds[] / roleClaimIssuedAt`, then re-add the staleness gate AND
     * a `session.update()` call to refresh the claim. See plan SUMMARY for migration steps.
     */
    export const requireAuth = middleware(async ({ ctx, next }) => {
      if (!ctx.session || !ctx.scope) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      const reason = await isRevoked(ctx.scope.userId);  // D-09 — sub-ms Upstash GET
      if (reason) {
        ctx.log.info({ userId: ctx.scope.userId, reason }, 'auth.revoked');
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'session_revoked' });
      }

      // No staleness check — scope is always fresh because createContext re-fetches every request.
      // See block-comment above for the v1.1 caching plan.

      return next({ ctx: { ...ctx, scope: ctx.scope } });
    });
    ```

    `src/server/trpc/middleware/rls.ts`:
    ```ts
    import { middleware } from '../trpc';
    import { db } from '@/server/db/client';
    import { sql } from 'drizzle-orm';

    /** Wraps the procedure body in a transaction with app.user_id / app.user_role / app.request_id GUCs set.
     *  Plan 04 RLS policies read these via current_setting(). */
    export const withRlsContext = middleware(async ({ ctx, next }) => {
      if (!ctx.scope) return next();

      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.scope!.userId}, true)`);
        await tx.execute(sql`SELECT set_config('app.user_role', ${ctx.scope!.role}, true)`);
        await tx.execute(sql`SELECT set_config('app.request_id', ${ctx.requestId}, true)`);
        return next({ ctx: { ...ctx, db: tx } });
      });
    });
    ```

    `src/server/trpc/middleware/freshSession.ts`:
    ```ts
    import { TRPCError } from '@trpc/server';
    import { middleware, publicProcedure } from '../trpc';
    import { requireAuth } from './auth';
    import { withRlsContext } from './rls';
    import { requireCurrentConsent } from './requireConsent';
    import type { Role } from '@/server/auth/permissions';

    export const requireFreshSession = middleware(({ ctx, next }) => {
      if (!ctx.scope?.fresh) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 're_auth_required' });
      }
      return next({ ctx });
    });

    export const requireRole = (...roles: Role[]) =>
      middleware(({ ctx, next }) => {
        if (!ctx.scope || !roles.includes(ctx.scope.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'role_not_allowed' });
        }
        return next({ ctx });
      });

    // Procedure presets — single source of truth so feature plans don't reassemble the chain.
    export const protectedProcedure = publicProcedure
      .use(requireAuth)
      .use(withRlsContext)
      .use(requireCurrentConsent);

    export const tdProcedure = protectedProcedure.use(requireRole('technical_director'));

    export const sensitiveProcedure = protectedProcedure.use(requireFreshSession);

    /** Future: medical procedures will further chain a Phase-5 medical-audit middleware. */
    export const medicalProcedure = protectedProcedure
      .use(requireRole('technical_director', 'medical_staff', 'player', 'parent'));
    ```

    `src/server/trpc/middleware/audit.ts`:
    ```ts
    import { db as rawDb } from '@/server/db/client';
    import { auditLog } from '@/server/db/schema';
    import { middleware } from '../trpc';

    export interface AuditEntry {
      action: string;
      resourceType?: string;
      resourceId?: string;
      oldValues?: unknown;
      newValues?: unknown;
      outcome?: 'success' | 'denied' | 'error';
    }

    /** Direct write — call from mutation handlers via ctx.db (RLS-bound) or fall back to rawDb. */
    export async function writeAudit(ctx: any, entry: AuditEntry) {
      const db = ctx.db ?? rawDb;
      await db.insert(auditLog).values({
        actorUserId: ctx.scope?.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        oldValues: entry.oldValues ?? null,
        newValues: entry.newValues ?? null,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId,
        outcome: entry.outcome ?? 'success',
      });
    }

    /** Generic mutation auditor — wraps a procedure to write audit_log on every successful call.
     *  Use sparingly: prefer per-mutation explicit writeAudit() calls so the action+resource match the domain. */
    export const auditMiddleware = (action: string, resourceType: string) =>
      middleware(async ({ ctx, next }) => {
        try {
          const result = await next({ ctx });
          await writeAudit(ctx, { action, resourceType, outcome: 'success' });
          return result;
        } catch (e) {
          await writeAudit(ctx, { action, resourceType, outcome: 'error' });
          throw e;
        }
      });
    ```

    `src/server/trpc/middleware/requireConsent.ts` per RESEARCH lines 1827–1843:
    ```ts
    import { TRPCError } from '@trpc/server';
    import { middleware } from '../trpc';
    import { db as rawDb } from '@/server/db/client';
    import { sql } from 'drizzle-orm';
    import { CURRENT_POLICY } from '@/lib/consent';  // Plan 12 creates this

    export const requireCurrentConsent = middleware(async ({ ctx, next }) => {
      if (!ctx.scope) return next();

      // Quick check: is there an active consent row for the operational category at the current version?
      const db = ctx.db ?? rawDb;
      const stale = await db.execute(sql`
        SELECT 1 AS missing
          FROM (VALUES ('operational')) cats(cat)
         WHERE NOT EXISTS (
           SELECT 1 FROM consent_records cr
            WHERE cr.user_id = ${ctx.scope.userId}
              AND cr.consent_category = cats.cat
              AND cr.policy_version = ${CURRENT_POLICY.operational.version}
              AND cr.withdrawn_at IS NULL
         )
        LIMIT 1
      `);

      const rows = (stale as unknown as Array<unknown>) ?? [];
      if (rows.length > 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 're_consent_required' });
      }
      return next();
    });
    ```

    Note: `@/lib/consent` is created in Plan 12. Plan 11 imports the constant; Plan 12 must land before Plan 15 (TD admin UI) executes any tRPC calls.

    Update `tests/helpers/trpc.ts` (Plan 17 stub):
    ```ts
    import { appRouter } from '@/server/trpc/routers/_app';
    import { log } from '@/lib/log';
    import type { CallerContext } from '@/server/trpc/trpc';
    import type { Role } from '@/server/auth/permissions';

    /** Build a CallerContext directly for integration tests — bypasses Better Auth. */
    export function appCaller(opts: {
      userId: string;
      role: Role;
      academyIds?: string[];
      linkedPlayerIds?: string[];
      locale?: 'nl' | 'en' | 'fr';
      fresh?: boolean;
      issuedAt?: number;
    }) {
      const ctx: CallerContext = {
        session: { user: { id: opts.userId, role: opts.role } } as any,
        user: { id: opts.userId, role: opts.role } as any,
        scope: {
          userId: opts.userId,
          role: opts.role,
          academyIds: opts.academyIds ?? [],
          linkedPlayerIds: opts.linkedPlayerIds ?? [],
          locale: opts.locale ?? 'nl',
          issuedAt: opts.issuedAt ?? Date.now(),
          fresh: opts.fresh ?? true,
        },
        requestId: `test-${Math.random().toString(36).slice(2, 8)}`,
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        log: log.child({ test: true }),
      };
      return appRouter.createCaller(ctx);
    }
    ```

    Write `tests/integration/caller-context.test.ts`:
    ```ts
    import { describe, it, expect, vi } from 'vitest';

    vi.mock('@/server/auth/revocation', () => ({
      isRevoked: vi.fn().mockResolvedValue(null),
      setRevoked: vi.fn(),
      clearRevocation: vi.fn(),
    }));

    describe('requireAuth — D-09 revocation (D-08 cache deferred to v1.1, see middleware comment)', () => {
      it('throws UNAUTHORIZED when scope is null', async () => {
        const { requireAuth } = await import('@/server/trpc/middleware/auth');
        const ctx: any = { session: null, scope: null, log: { info: vi.fn() } };
        await expect((requireAuth as any)({ ctx, next: async () => {} }))
          .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      });

      it('throws session_revoked when revocation list returns reason', async () => {
        const { isRevoked } = await import('@/server/auth/revocation');
        (isRevoked as any).mockResolvedValueOnce('role_changed');
        const { requireAuth } = await import('@/server/trpc/middleware/auth');
        const ctx: any = {
          session: { user: { id: 'u1' } }, scope: { userId: 'u1', role: 'player', academyIds: [], linkedPlayerIds: [], locale: 'nl', issuedAt: Date.now(), fresh: true },
          log: { info: vi.fn() },
        };
        await expect((requireAuth as any)({ ctx, next: async () => {} }))
          .rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'session_revoked' });
      });

      // (Removed: scope_stale test — see v1.1 follow-up; Phase 1 uses "always fresh" — no staleness gate.)
    });

    describe('requireFreshSession — SEC-03', () => {
      it('throws re_auth_required when scope.fresh === false', async () => {
        const { requireFreshSession } = await import('@/server/trpc/middleware/freshSession');
        const ctx: any = { scope: { fresh: false } };
        await expect((requireFreshSession as any)({ ctx, next: async () => {} }))
          .rejects.toMatchObject({ code: 'FORBIDDEN', message: 're_auth_required' });
      });

      it('passes when scope.fresh === true', async () => {
        const { requireFreshSession } = await import('@/server/trpc/middleware/freshSession');
        const ctx: any = { scope: { fresh: true } };
        await expect((requireFreshSession as any)({ ctx, next: async () => 'ok' })).resolves.toBe('ok');
      });
    });

    describe('requireRole', () => {
      it('throws FORBIDDEN role_not_allowed for wrong role', async () => {
        const { requireRole } = await import('@/server/trpc/middleware/freshSession');
        const mw = requireRole('technical_director');
        const ctx: any = { scope: { role: 'player' } };
        await expect((mw as any)({ ctx, next: async () => {} }))
          .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'role_not_allowed' });
      });
    });
    ```

    Create `src/server/trpc/routers/_app.ts` (skeleton — Plan 15 fills `admin.user.*`):
    ```ts
    import { router, publicProcedure } from '../trpc';

    /** App router — sub-routers from Plan 15 (admin) and Plan 12 (consent) attach here. */
    export const appRouter = router({
      ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
    });

    export type AppRouter = typeof appRouter;
    ```
  </action>
  <verify>
    <automated>test -f src/server/trpc/middleware/auth.ts && test -f src/server/trpc/middleware/rls.ts && test -f src/server/trpc/middleware/freshSession.ts && test -f src/server/trpc/middleware/audit.ts && test -f src/server/trpc/middleware/requireConsent.ts && test -f src/server/trpc/routers/_app.ts && grep -q "session_revoked" src/server/trpc/middleware/auth.ts && grep -q "v1.1" src/server/trpc/middleware/auth.ts && ! grep -q "STALENESS_MS" src/server/trpc/middleware/auth.ts && ! grep -q "scope_stale" src/server/trpc/middleware/auth.ts && grep -q "set_config('app.user_id'" src/server/trpc/middleware/rls.ts && grep -q "set_config('app.user_role'" src/server/trpc/middleware/rls.ts && grep -q "set_config('app.request_id'" src/server/trpc/middleware/rls.ts && grep -q "re_auth_required" src/server/trpc/middleware/freshSession.ts && grep -q "role_not_allowed" src/server/trpc/middleware/freshSession.ts && grep -q "protectedProcedure" src/server/trpc/middleware/freshSession.ts && grep -q "tdProcedure" src/server/trpc/middleware/freshSession.ts && grep -q "sensitiveProcedure" src/server/trpc/middleware/freshSession.ts && grep -q "writeAudit" src/server/trpc/middleware/audit.ts && grep -q "re_consent_required" src/server/trpc/middleware/requireConsent.ts && grep -q "appCaller" tests/helpers/trpc.ts && npx tsc --noEmit && npx vitest run tests/integration/caller-context.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `requireAuth` checks isRevoked (D-09 — Upstash GET, sub-ms); throws `session_revoked`. Staleness gate INTENTIONALLY ABSENT (MAJOR-11 — D-08 cache deferred to v1.1, documented as block-comment in the middleware file).
    - `withRlsContext` executes 3 set_config statements inside `db.transaction`
    - `requireFreshSession` throws `re_auth_required` when not fresh
    - `requireRole` throws `role_not_allowed`
    - `protectedProcedure`, `tdProcedure`, `sensitiveProcedure`, `medicalProcedure` exported as procedure presets
    - `writeAudit` writes audit_log with all fields
    - `requireCurrentConsent` throws `re_consent_required` when no current consent row
    - `tests/helpers/trpc.ts` `appCaller` wires Plan 17's RBAC matrix test imports
    - 5+ tests in caller-context.test.ts GREEN (Test 3 scope_stale removed per MAJOR-11)
  </acceptance_criteria>
  <done>tRPC middleware chain complete; RBAC matrix can now run.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Better Auth session ↔ tRPC scope | Scope rebuilt from DB on each createContext; staleness <= 15 min |
| App role ↔ Postgres GUCs | withRlsContext sets per-transaction GUCs that Plan 04 RLS policies read |
| Mutation ↔ audit_log | Every state-changing tRPC call writes an audit row |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-02 | Information Disclosure | Cross-academy data via stale scope | mitigate | 15-min staleness gate (D-08); Redis revocation list (D-09) for immediate downgrade |
| T-01-07 | Elevation of Privilege | Stale JWT after scope downgrade | mitigate | requireAuth checks isRevoked() per request; admin mutations (Plan 15) call setRevoked() on role changes / deactivations / parent-link breaks |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npx vitest run tests/integration/caller-context.test.ts` GREEN
- `tests/integration/rbac-matrix.test.ts` (Plan 17) can now resolve `appCaller` import
</verification>

<success_criteria>
- CallerContext shape matches D-08
- 15-min staleness gate + Upstash revocation list
- 4 procedure presets covering Phase 1 + Phase 5 needs
- audit + consent middleware ready
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-11-SUMMARY.md` documenting:
- Confirmation that Plan 17's RBAC matrix can resolve appCaller import
- Note: requireCurrentConsent depends on Plan 12's CURRENT_POLICY constant — Plan 12 must land before any protectedProcedure call works
- **MAJOR-11 resolution recorded:** D-08 JWT-claim cache deferred to v1.1. Phase 1 ships "always fresh" mode (re-fetch scope from DB on every authenticated request). See `src/server/trpc/middleware/auth.ts` block-comment for v1.1 migration plan (Better Auth `additionalFields` plugin + `session.update()` call sites).
</output>
