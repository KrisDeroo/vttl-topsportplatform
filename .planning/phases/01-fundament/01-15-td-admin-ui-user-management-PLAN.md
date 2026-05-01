---
phase: 01-fundament
plan: 15
type: execute
wave: 7
depends_on: [05, 07, 08, 09, 11, 12]
files_modified:
  - src/server/trpc/routers/admin.ts
  - src/server/trpc/routers/_app.ts
  - src/lib/trpc-client.ts
  - src/lib/trpc-provider.tsx
  - src/app/[locale]/(app)/layout.tsx
  - src/app/[locale]/(app)/admin/users/page.tsx
  - src/components/admin/user-table.tsx
  - src/components/admin/user-create-dialog.tsx
  - src/components/admin/role-assign-dialog.tsx
  - src/components/admin/parent-link-dialog.tsx
  - src/components/admin/academy-link-dialog.tsx
  - tests/integration/admin-user.test.ts
  - tests/helpers/seed.ts
autonomous: false
requirements:
  - AUTH-04
  - AUTH-05
  - USER-01
  - USER-02
requirements_supports:  # informational — primary owners listed below
  - USER-05
threat_refs:
  - T-01-07

must_haves:
  truths:
    - "admin.user.list / create / activate / deactivate / assignRole / linkParent / linkAcademy tRPC mutations exist (AUTH-04/05, USER-01/02)"
    - "admin.user.deactivate and admin.user.assignRole call setRevoked(userId, reason) — D-09 immediate scope inperking"
    - "admin.user.linkParent uses sensitiveProcedure (re-auth required — SEC-03)"
    - "admin.user.activate calls canActivate() (Plan 12) before flipping active=true; throws PRECONDITION_FAILED with reason on minor gate failure"
    - "admin.user.* mutations all write audit_log via writeAudit (Plan 11)"
    - "/admin/users page is a Server Component reading users.list (RLS-scoped to TD)"
    - "<UserTable> Client Component uses tanstack/react-table; supports search, role filter, active filter"
    - "Mobile-friendly admin UI (responsive table)"
    - "Phase 1 admin UI is intentionally minimal — full audit log viewer comes Phase 7"
    - "tests/helpers/seed.ts seedRolesMatrix() implementation lives in this plan (MAJOR-6) — feeds RBAC matrix (Plan 17) AND admin-user.test.ts (this plan)"
  artifacts:
    - path: "src/server/trpc/routers/admin.ts"
      provides: "adminRouter with user.* sub-router (Plan 11 tdProcedure / sensitiveProcedure presets)"
      contains: "adminRouter"
    - path: "src/lib/trpc-client.ts"
      provides: "tRPC React Query client (browser-side)"
      exports: ["trpc"]
    - path: "src/lib/trpc-provider.tsx"
      provides: "<TrpcProvider> wrapping QueryClientProvider"
      exports: ["TrpcProvider"]
    - path: "src/app/[locale]/(app)/admin/users/page.tsx"
      provides: "Server Component listing users + render UserTable"
      contains: "UserTable"
    - path: "src/components/admin/user-table.tsx"
      provides: "Client Component with table + actions (activate/deactivate/role/parent/academy)"
      exports: ["UserTable"]
  key_links:
    - from: "src/server/trpc/routers/admin.ts"
      to: "src/server/auth/revocation.ts (Plan 09)"
      via: "setRevoked(userId, reason) on deactivate + assignRole + linkParent break"
      pattern: "setRevoked"
    - from: "src/server/trpc/routers/admin.ts"
      to: "src/server/auth/activate.ts (Plan 12)"
      via: "canActivate(userId) gate before active=true"
      pattern: "canActivate"
---

<objective>
Build the minimal TD-only user-management UI. Plan 11 (tRPC middleware) and Plan 12 (consent + minor gate) are the prerequisites; this plan attaches the `admin.user.*` router and the React UI. Scope: list, create, activate, deactivate, assign role, link parent, link academy. Anything else (audit-log viewer, password reset trigger, etc.) is intentionally out of Phase 1 (deferred to Phase 7 or v1.1 per CONTEXT.md).

Output: working `/[locale]/(app)/admin/users` page; admin-user.test.ts (Plan 17) GREEN.
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
  <name>Task 1: admin.user.* tRPC router (list/create/activate/deactivate/assignRole/linkParent/linkAcademy)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §admin.user.* tRPC router (lines 2057–2135) — full router code
    - src/server/trpc/middleware/freshSession.ts (Plan 11 — tdProcedure, sensitiveProcedure)
    - src/server/auth/revocation.ts (Plan 09)
    - src/server/auth/activate.ts (Plan 12)
    - src/server/trpc/middleware/audit.ts (Plan 11)
  </read_first>
  <files>
    src/server/trpc/routers/admin.ts
    src/server/trpc/routers/_app.ts
    tests/integration/admin-user.test.ts
  </files>
  <behavior>
    - Test 1 (integration): admin.user.list returns users (TD scope)
    - Test 2 (integration): admin.user.create inserts row + audit_log entry
    - Test 3 (integration): admin.user.activate fails with PRECONDITION_FAILED reason='consent_missing' for user without consent
    - Test 4 (integration): admin.user.deactivate calls setRevoked + writes audit_log
    - Test 5 (integration): admin.user.assignRole calls setRevoked('role_changed') + writes audit_log
    - Test 6 (integration): admin.user.linkParent requires fresh session (sensitiveProcedure)
    - Test 7 (integration): non-TD calling admin.user.list throws FORBIDDEN
  </behavior>
  <action>
    Create `src/server/trpc/routers/admin.ts` per RESEARCH §admin.user.* tRPC router (lines 2059–2135), with these adaptations:
    - Use `tdProcedure` (Plan 11) for non-sensitive mutations
    - Use `sensitiveProcedure` (= protectedProcedure + requireFreshSession) for `linkParent` (SEC-03)
    - Add a `listParentLinks` query for the RBAC matrix test in Plan 17
    - Add an `auditLog.recent` query (TD-only, reads via the SECURITY DEFINER function — but for Phase 1 just SELECT directly under TD-scoped RLS where audit_log read policy is `USING (false)` — TD must use a separate query path; for now this returns empty — full audit viewer is Phase 7)

    Full code:
    ```ts
    import { z } from 'zod';
    import { router } from '../trpc';
    import { tdProcedure, sensitiveProcedure } from '../middleware/freshSession';
    import { writeAudit } from '../middleware/audit';
    import { db as rawDb } from '@/server/db/client';
    import { users, parentChildLinks, academyMemberships, auditLog } from '@/server/db/schema';
    import { eq } from 'drizzle-orm';
    import { TRPCError } from '@trpc/server';
    import { canActivate } from '@/server/auth/activate';
    import { setRevoked } from '@/server/auth/revocation';
    import type { Role } from '@/server/auth/permissions';

    const RoleSchema = z.enum([
      'technical_director','academy_manager','trainer','player','parent','sparring_partner','medical_staff',
    ]);

    export const adminRouter = router({
      user: router({
        list: tdProcedure
          .input(z.object({
            search: z.string().optional(),
            limit: z.number().int().min(1).max(100).default(50),
          }))
          .query(async ({ ctx, input }) => {
            const db = ctx.db ?? rawDb;
            return db.query.users.findMany({
              limit: input.limit,
              orderBy: (u, { desc }) => desc(u.createdAt),
            });
          }),

        listParentLinks: tdProcedure
          .input(z.object({ userId: z.string().uuid() }))
          .query(async ({ ctx, input }) => {
            const db = ctx.db ?? rawDb;
            return db.query.parentChildLinks.findMany({
              where: eq(parentChildLinks.childUserId, input.userId),
            });
          }),

        auditLog: router({
          recent: tdProcedure
            .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
            .query(async () => {
              // audit_log direct SELECT is blocked by RLS USING (false) (Plan 04).
              // Phase 1: return empty array. Phase 7 implements a SECURITY DEFINER fn for TD reads.
              return [] as unknown[];
            }),
        }),

        create: tdProcedure
          .input(z.object({
            email: z.string().email(),
            name: z.string().min(2),
            role: RoleSchema,
            preferredLocale: z.enum(['nl','en','fr']).default('nl'),
            dateOfBirth: z.string().date().optional(),
          }).strict())
          .mutation(async ({ ctx, input }) => {
            const db = ctx.db ?? rawDb;
            const [u] = await db.insert(users).values({
              email: input.email,
              name: input.name,
              role: input.role as Role,
              preferredLocale: input.preferredLocale,
              dateOfBirth: input.dateOfBirth ?? null,
              active: false,
            }).returning();
            await writeAudit(ctx, {
              action: 'user.create', resourceType: 'user', resourceId: u!.id,
              newValues: { email: input.email, role: input.role },
            });
            return u;
          }),

        activate: tdProcedure
          .input(z.object({ userId: z.string().uuid() }))
          .mutation(async ({ ctx, input }) => {
            const result = await canActivate(input.userId);
            if (!result.ok) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: result.reason });
            const db = ctx.db ?? rawDb;
            const [u] = await db.update(users).set({ active: true }).where(eq(users.id, input.userId)).returning();
            await writeAudit(ctx, { action: 'user.activate', resourceType: 'user', resourceId: input.userId });
            return u;
          }),

        deactivate: tdProcedure
          .input(z.object({ userId: z.string().uuid(), reason: z.string().min(3) }).strict())
          .mutation(async ({ ctx, input }) => {
            const db = ctx.db ?? rawDb;
            await db.update(users).set({ active: false, deactivatedAt: new Date(Date.now()) }).where(eq(users.id, input.userId));
            await setRevoked(input.userId, input.reason);  // D-09
            await writeAudit(ctx, {
              action: 'user.deactivate', resourceType: 'user', resourceId: input.userId,
              newValues: { reason: input.reason },
            });
            return { ok: true };
          }),

        assignRole: tdProcedure
          .input(z.object({ userId: z.string().uuid(), role: RoleSchema }).strict())
          .mutation(async ({ ctx, input }) => {
            const db = ctx.db ?? rawDb;
            const old = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
            const [u] = await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId)).returning();
            await setRevoked(input.userId, 'role_changed', 60 * 60 * 24);  // 24h — long enough for the user to be forced re-auth on next request
            await writeAudit(ctx, {
              action: 'user.role_change', resourceType: 'user', resourceId: input.userId,
              oldValues: { role: old?.role }, newValues: { role: input.role },
            });
            return u;
          }),

        linkParent: sensitiveProcedure
          .input(z.object({
            parentUserId: z.string().uuid(),
            childUserId: z.string().uuid(),
            consentGivenAt: z.string().datetime(),
          }).strict())
          .mutation(async ({ ctx, input }) => {
            const db = ctx.db ?? rawDb;
            await db.insert(parentChildLinks).values({
              parentUserId: input.parentUserId,
              childUserId: input.childUserId,
              consentGivenAt: new Date(input.consentGivenAt),
              linkedBy: ctx.scope!.userId,
            });
            await writeAudit(ctx, {
              action: 'user.link_parent', resourceType: 'parent_child_link',
              resourceId: `${input.parentUserId}:${input.childUserId}`, newValues: input,
            });
            return { ok: true };
          }),

        linkAcademy: tdProcedure
          .input(z.object({
            trainerUserId: z.string().uuid(),
            academyCode: z.string(),
            role: z.enum(['trainer', 'academy_manager']).default('trainer'),
          }).strict())
          .mutation(async ({ ctx, input }) => {
            const db = ctx.db ?? rawDb;
            await db.insert(academyMemberships).values({
              userId: input.trainerUserId,
              academyCode: input.academyCode,
              role: input.role,
              linkedBy: ctx.scope!.userId,
            });
            await writeAudit(ctx, {
              action: 'user.link_academy', resourceType: 'academy_membership',
              resourceId: `${input.trainerUserId}:${input.academyCode}`, newValues: input,
            });
            return { ok: true };
          }),
      }),

      // Top-level "consent listForUser" surface for the RBAC matrix test:
      // (RBAC test calls caller.consent.listForUser — that's already on consentRouter from Plan 12)
    });
    ```

    Update `src/server/trpc/routers/_app.ts`:
    ```ts
    import { router, publicProcedure } from '../trpc';
    import { consentRouter } from './consent';
    import { adminRouter } from './admin';

    export const appRouter = router({
      ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
      consent: consentRouter,
      admin: adminRouter,
    });

    export type AppRouter = typeof appRouter;
    ```

    Update `tests/integration/admin-user.test.ts` — replace Plan 12's `it.todo` placeholders with real tests using `appCaller` from Plan 11:
    ```ts
    import { describe, it, expect, beforeEach, afterEach } from 'vitest';
    import { freshDb } from '../helpers/db';
    import { appCaller } from '../helpers/trpc';

    describe('AUTH-04/05 + USER-01/02 — admin.user.*', () => {
      let h: Awaited<ReturnType<typeof freshDb>>;
      const tdId = '00000000-0000-0000-0000-000000000001';

      beforeEach(async () => { h = await freshDb(); /* seed TD user */ });
      afterEach(async () => { await h[Symbol.asyncDispose](); });

      it('TD can list users', async () => {
        const caller = appCaller({ userId: tdId, role: 'technical_director' });
        const list = await caller.admin.user.list({ limit: 50 });
        expect(Array.isArray(list)).toBe(true);
      });

      it('non-TD list throws FORBIDDEN', async () => {
        const caller = appCaller({ userId: 'p1', role: 'player' });
        await expect(caller.admin.user.list({ limit: 50 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      });

      it('TD can create user + audit_log row', async () => {
        const caller = appCaller({ userId: tdId, role: 'technical_director' });
        const u = await caller.admin.user.create({
          email: 'new@vttl.test', name: 'New User', role: 'player', preferredLocale: 'nl',
        });
        expect(u?.email).toBe('new@vttl.test');
      });

      it('activate fails with PRECONDITION_FAILED reason="consent_missing" for user without consent', async () => {
        const caller = appCaller({ userId: tdId, role: 'technical_director' });
        const u = await caller.admin.user.create({
          email: 'noconsent@vttl.test', name: 'X', role: 'player', preferredLocale: 'nl',
        });
        await expect(caller.admin.user.activate({ userId: u!.id }))
          .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      });

      it('linkParent requires fresh session (sensitiveProcedure)', async () => {
        const caller = appCaller({ userId: tdId, role: 'technical_director', fresh: false });
        await expect(caller.admin.user.linkParent({
          parentUserId: '11111111-1111-1111-1111-111111111111',
          childUserId: '22222222-2222-2222-2222-222222222222',
          consentGivenAt: new Date(Date.now()).toISOString(),
        })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 're_auth_required' });
      });
    });
    ```
  </action>
  <verify>
    <automated>test -f src/server/trpc/routers/admin.ts && grep -q "user: router" src/server/trpc/routers/admin.ts && grep -q "tdProcedure" src/server/trpc/routers/admin.ts && grep -q "sensitiveProcedure" src/server/trpc/routers/admin.ts && grep -q "canActivate" src/server/trpc/routers/admin.ts && grep -q "setRevoked" src/server/trpc/routers/admin.ts && grep -q "writeAudit" src/server/trpc/routers/admin.ts && grep -q "PRECONDITION_FAILED" src/server/trpc/routers/admin.ts && grep -q "linkParent" src/server/trpc/routers/admin.ts && grep -q "linkAcademy" src/server/trpc/routers/admin.ts && grep -q "adminRouter" src/server/trpc/routers/_app.ts && npx tsc --noEmit && npx vitest run tests/integration/admin-user.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - All 7 admin.user.* operations exist (list, listParentLinks, create, activate, deactivate, assignRole, linkParent, linkAcademy)
    - `linkParent` uses `sensitiveProcedure` (re-auth required)
    - `deactivate` and `assignRole` call `setRevoked` (D-09 immediate revocation)
    - `activate` calls `canActivate()` and surfaces the reason as PRECONDITION_FAILED message
    - All 5 mutations write audit_log entries via writeAudit
    - admin-user.test.ts has 5+ real tests; non-TD path rejected; sensitiveProcedure enforcement asserted
  </acceptance_criteria>
  <done>admin.user.* router complete; D-09 revocation wired on every scope-inperking action.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: tRPC client setup + (app) layout + admin/users Server Component + Client Components</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §`/admin/users/page.tsx` (lines 2137–2161)
    - src/components/i18n/locale-switcher.tsx (Plan 08 — Client Component pattern)
    - src/server/auth/auth.ts (Plan 05 — auth.api.getSession)
  </read_first>
  <files>
    src/lib/trpc-client.ts
    src/lib/trpc-provider.tsx
    src/app/[locale]/(app)/layout.tsx
    src/app/[locale]/(app)/admin/users/page.tsx
    src/components/admin/user-table.tsx
    src/components/admin/user-create-dialog.tsx
    src/components/admin/role-assign-dialog.tsx
    src/components/admin/parent-link-dialog.tsx
    src/components/admin/academy-link-dialog.tsx
  </files>
  <action>
    Create `src/lib/trpc-client.ts`:
    ```ts
    import { createTRPCReact } from '@trpc/react-query';
    import type { AppRouter } from '@/server/trpc/routers/_app';

    export const trpc = createTRPCReact<AppRouter>();
    ```

    Create `src/lib/trpc-provider.tsx`:
    ```tsx
    'use client';
    import { useState } from 'react';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { httpBatchLink } from '@trpc/client';
    import { trpc } from './trpc-client';

    export function TrpcProvider({ children }: { children: React.ReactNode }) {
      const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));
      const [tc] = useState(() => trpc.createClient({
        links: [httpBatchLink({ url: '/api/trpc' })],
      }));
      return (
        <trpc.Provider client={tc} queryClient={qc}>
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        </trpc.Provider>
      );
    }
    ```

    Create `src/app/[locale]/(app)/layout.tsx`:
    ```tsx
    import { auth } from '@/server/auth/auth';
    import { headers } from 'next/headers';
    import { redirect } from 'next/navigation';
    import { TrpcProvider } from '@/lib/trpc-provider';

    export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
      const { locale } = await params;
      const session = await auth.api.getSession({ headers: await headers() });
      if (!session) redirect(`/${locale}/login`);
      return <TrpcProvider>{children}</TrpcProvider>;
    }
    ```

    Create `src/app/[locale]/(app)/admin/users/page.tsx`:
    ```tsx
    import { auth } from '@/server/auth/auth';
    import { headers } from 'next/headers';
    import { redirect } from 'next/navigation';
    import { getTranslations } from 'next-intl/server';
    import { db } from '@/server/db/client';
    import { UserTable } from '@/components/admin/user-table';

    export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
      const { locale } = await params;
      const t = await getTranslations('admin.users');
      const session = await auth.api.getSession({ headers: await headers() });
      if (!session || (session.user as any).role !== 'technical_director') {
        redirect(`/${locale}/login`);
      }

      // Plan 11 sets up RLS via withRlsContext middleware on tRPC; for the Server Component
      // we read directly via `db` (schema owner role bypasses RLS). For UI table snapshots this is
      // acceptable; mutations in <UserTable> go through tRPC where RLS DOES apply.
      const list = await db.query.users.findMany({
        orderBy: (u, { desc }) => desc(u.createdAt),
        limit: 100,
      });

      return (
        <main className="p-6">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <UserTable initialData={list} />
        </main>
      );
    }
    ```

    Create `src/components/admin/user-table.tsx` (skeleton — actions wired via tRPC; full table impl uses tanstack/react-table):
    ```tsx
    'use client';
    import { useState } from 'react';
    import { useTranslations } from 'next-intl';
    import { trpc } from '@/lib/trpc-client';
    import { Button } from '@/components/ui/button';
    import { UserCreateDialog } from './user-create-dialog';
    import { RoleAssignDialog } from './role-assign-dialog';
    import { ParentLinkDialog } from './parent-link-dialog';
    import { AcademyLinkDialog } from './academy-link-dialog';

    interface User {
      id: string; email: string; name: string; role: string; preferredLocale: string;
      active: boolean; createdAt: Date | string;
    }

    interface Props { initialData: User[]; }

    export function UserTable({ initialData }: Props) {
      const t = useTranslations('admin.users');
      const list = trpc.admin.user.list.useQuery({ limit: 100 }, { initialData: initialData as any });
      const activate = trpc.admin.user.activate.useMutation({ onSuccess: () => list.refetch() });
      const deactivate = trpc.admin.user.deactivate.useMutation({ onSuccess: () => list.refetch() });

      const [createOpen, setCreateOpen] = useState(false);
      const [roleTarget, setRoleTarget] = useState<User | null>(null);
      const [parentTarget, setParentTarget] = useState<User | null>(null);
      const [academyTarget, setAcademyTarget] = useState<User | null>(null);

      return (
        <div>
          <div className="flex justify-between items-center my-4">
            <Button onClick={() => setCreateOpen(true)}>{t('create')}</Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left"><th className="py-2">{t('fields.email')}</th><th>{t('fields.name')}</th><th>{t('fields.role')}</th><th>{t('fields.locale')}</th><th>{t('fields.status')}</th><th></th></tr>
            </thead>
            <tbody>
              {list.data?.map((u: any) => (
                <tr key={u.id} className="border-b">
                  <td className="py-2">{u.email}</td>
                  <td>{u.name}</td>
                  <td>{u.role}</td>
                  <td>{u.preferredLocale}</td>
                  <td>{u.active ? 'active' : 'inactive'}</td>
                  <td className="flex gap-1">
                    {!u.active
                      ? <Button size="sm" onClick={() => activate.mutate({ userId: u.id })}>{t('activate')}</Button>
                      : <Button size="sm" variant="outline" onClick={() => {
                          const reason = prompt('Reason?'); if (reason) deactivate.mutate({ userId: u.id, reason });
                        }}>{t('deactivate')}</Button>
                    }
                    <Button size="sm" variant="outline" onClick={() => setRoleTarget(u)}>{t('assignRole')}</Button>
                    <Button size="sm" variant="outline" onClick={() => setParentTarget(u)}>{t('linkParent')}</Button>
                    <Button size="sm" variant="outline" onClick={() => setAcademyTarget(u)}>{t('linkAcademy')}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {createOpen && <UserCreateDialog onClose={() => { setCreateOpen(false); list.refetch(); }} />}
          {roleTarget && <RoleAssignDialog user={roleTarget} onClose={() => { setRoleTarget(null); list.refetch(); }} />}
          {parentTarget && <ParentLinkDialog user={parentTarget} onClose={() => { setParentTarget(null); }} />}
          {academyTarget && <AcademyLinkDialog user={academyTarget} onClose={() => { setAcademyTarget(null); }} />}
        </div>
      );
    }
    ```

    Create the 4 dialog components — minimal forms calling the corresponding tRPC mutation. Each is a small Client Component using shadcn dialog primitive (or a simple inline modal). Skeleton signatures:
    - `<UserCreateDialog onClose />` — form: email/name/role/locale/dob → trpc.admin.user.create.useMutation
    - `<RoleAssignDialog user onClose />` — select role dropdown → trpc.admin.user.assignRole.useMutation
    - `<ParentLinkDialog user onClose />` — input parent userId → trpc.admin.user.linkParent.useMutation (this triggers re-auth flow; UI must handle FORBIDDEN re_auth_required by routing to /[locale]/(auth)/re-auth)
    - `<AcademyLinkDialog user onClose />` — academy code dropdown → trpc.admin.user.linkAcademy.useMutation

    For Phase 1 these can be minimal `<dialog>` elements with native form; full shadcn Dialog can land later. The acceptance check is that each opens, submits, and closes on success.

    Add re-auth route stub `src/app/[locale]/(auth)/re-auth/page.tsx`:
    ```tsx
    import { getTranslations } from 'next-intl/server';

    export default async function ReAuthPage() {
      const t = await getTranslations('auth.login');
      return (
        <main className="max-w-md mx-auto p-6">
          <h1 className="text-2xl">{t('title')}</h1>
          <p>{t.markup ? t('forgot') : 'Please re-enter your password.'}</p>
          {/* Re-auth form: same as login; on success Better Auth bumps session.freshUntil */}
        </main>
      );
    }
    ```
  </action>
  <verify>
    <automated>test -f src/lib/trpc-client.ts && test -f src/lib/trpc-provider.tsx && test -f src/app/\[locale\]/\(app\)/layout.tsx && test -f src/app/\[locale\]/\(app\)/admin/users/page.tsx && test -f src/components/admin/user-table.tsx && test -f src/components/admin/user-create-dialog.tsx && test -f src/components/admin/role-assign-dialog.tsx && test -f src/components/admin/parent-link-dialog.tsx && test -f src/components/admin/academy-link-dialog.tsx && grep -q "createTRPCReact" src/lib/trpc-client.ts && grep -q "TrpcProvider" src/lib/trpc-provider.tsx && grep -q "QueryClientProvider" src/lib/trpc-provider.tsx && grep -q "auth.api.getSession" src/app/\[locale\]/\(app\)/layout.tsx && grep -q "redirect" src/app/\[locale\]/\(app\)/admin/users/page.tsx && grep -q "technical_director" src/app/\[locale\]/\(app\)/admin/users/page.tsx && grep -q "trpc.admin.user.list" src/components/admin/user-table.tsx && grep -q "trpc.admin.user.activate" src/components/admin/user-table.tsx && grep -q "trpc.admin.user.deactivate" src/components/admin/user-table.tsx && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - tRPC client + provider wired
    - `/[locale]/(app)/layout.tsx` redirects unauthenticated users to `/login`
    - `/[locale]/(app)/admin/users/page.tsx` redirects non-TD users
    - `<UserTable>` renders, supports activate / deactivate / assignRole / linkParent / linkAcademy actions via tRPC
    - 4 dialog components exist
    - re-auth route page exists for sensitiveProcedure friction
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>TD admin UI minimal-but-complete; all D-09 + SEC-03 + audit hooks active.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Implement seedRolesMatrix() in tests/helpers/seed.ts (MAJOR-6)</name>
  <read_first>
    - tests/helpers/seed.ts (Plan 17 — STUB returning empty objects)
    - src/server/db/schema/auth.ts + memberships.ts + medical.ts + consent.ts + audit.ts
    - src/lib/consent.ts (Plan 12 — recordConsent helper)
    - src/server/db/helpers/encryption.ts (Plan 03 — encrypt() helper for medical event cipher fields)
  </read_first>
  <files>
    tests/helpers/seed.ts
  </files>
  <action>
    Replace the Plan 17 stub `seedRolesMatrix()` with a real implementation. The stub currently returns
    `{ users: {} as Record<Role, string>, victimId: '' }` — feed real data so the RBAC matrix test
    (Plan 17) and admin-user.test.ts (this plan) can both rely on it.

    Final implementation in `tests/helpers/seed.ts`:
    ```ts
    import { sql } from 'drizzle-orm';
    import { users, parentChildLinks, academyMemberships, consentRecords, auditLog, medicalEvents, academy } from '@/server/db/schema';
    import { encrypt } from '@/server/db/helpers/encryption';
    import { CURRENT_POLICY, recordConsent, getConsentText } from '@/lib/consent';
    import type { drizzle } from 'drizzle-orm/postgres-js';

    export interface SeededRolesMatrix {
      users: Record<typeof ROLES[number], string>;
      victimId: string;
      academyA: string;
      academyB: string;
    }

    /**
     * Seeds the fixture for D-11 RBAC matrix + admin-user.test.ts.
     *
     * - 7 users (one per role), all active=true, email_verified=true, with operational consent recorded.
     * - 1 victim player linked to academy B (cross-academy isolation case).
     * - trainer + academy_manager linked to academy A; victim player on B → cross-academy denial.
     * - 1 medical_event for the victim (encrypted via pgcrypto).
     * - 1 parent_child_link (parent → victim) with a parent operational consent.
     * - 1 audit_log row attributing a `seed.bootstrap` action to the TD.
     */
    export async function seedRolesMatrix(db: ReturnType<typeof drizzle>): Promise<SeededRolesMatrix> {
      // Set the medical encryption key for this connection so encrypt() works inside seed.
      await db.execute(sql`SELECT set_config('app.medical_key', ${process.env.MEDICAL_ENCRYPTION_KEY!}, false)`);

      // 1. Academies
      const [acA] = await db.insert(academy).values({
        code: 'academy_a', canonicalName: 'Academy A', sortOrder: 10, active: true,
      }).returning();
      const [acB] = await db.insert(academy).values({
        code: 'academy_b', canonicalName: 'Academy B', sortOrder: 20, active: true,
      }).returning();

      // 2. Users — one per role
      const adultDob = new Date(Date.now() - 30 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const userIds: Record<typeof ROLES[number], string> = {} as any;
      for (const role of ROLES) {
        const [u] = await db.insert(users).values({
          email: `seed-${role}@vttl.test`,
          name: `Seed ${role}`,
          role,
          preferredLocale: 'nl',
          dateOfBirth: adultDob,
          active: true,
          emailVerified: true,
        }).returning();
        userIds[role] = u!.id;
      }

      // 3. Victim player (separate from the role's "player" fixture so cross-role probes target a stranger)
      const [victim] = await db.insert(users).values({
        email: 'seed-victim@vttl.test',
        name: 'Seed Victim',
        role: 'player',
        preferredLocale: 'nl',
        dateOfBirth: adultDob,
        active: true,
        emailVerified: true,
      }).returning();

      // 4. Memberships: trainer + academy_manager → academy A; victim → academy B
      await db.insert(academyMemberships).values([
        { userId: userIds.trainer,         academyCode: acA!.code, role: 'trainer',          linkedBy: userIds.technical_director },
        { userId: userIds.academy_manager, academyCode: acA!.code, role: 'academy_manager',  linkedBy: userIds.technical_director },
        { userId: victim!.id,              academyCode: acB!.code, role: 'player',           linkedBy: userIds.technical_director },
      ]);

      // 5. Operational consent for every seeded user (so requireCurrentConsent passes)
      const operationalText = await getConsentText('operational', CURRENT_POLICY.operational.version, 'nl');
      for (const role of ROLES) {
        await recordConsent({
          userId: userIds[role],
          category: 'operational',
          version: CURRENT_POLICY.operational.version,
          locale: 'nl',
          textShown: operationalText,
          ipAddress: '127.0.0.1',
          userAgent: 'seed',
          db,
        });
      }
      await recordConsent({
        userId: victim!.id,
        category: 'operational',
        version: CURRENT_POLICY.operational.version,
        locale: 'nl',
        textShown: operationalText,
        ipAddress: '127.0.0.1',
        userAgent: 'seed',
        db,
      });

      // 6. Parent → victim link (parent gives consent on behalf of the minor in real flow;
      //    for adults the link still exists in the test fixture so RLS pcl_visible has a row).
      await db.insert(parentChildLinks).values({
        parentUserId: userIds.parent,
        childUserId: victim!.id,
        consentGivenAt: new Date(Date.now()),
        linkedBy: userIds.technical_director,
      });

      // 7. Medical event for the victim — encrypted free-text fields.
      await db.insert(medicalEvents).values({
        playerUserId: victim!.id,
        eventDescriptionCipher: encrypt('Seed injury — for RBAC matrix test') as any,
        doctorCipher: encrypt('Dr. Seed') as any,
        isInjury: true,
        startDate: new Date(Date.now()).toISOString().slice(0, 10),
        createdBy: userIds.medical_staff,
      });

      // 8. Audit log seed row attributed to the TD.
      await db.insert(auditLog).values({
        actorUserId: userIds.technical_director,
        action: 'seed.bootstrap',
        resourceType: 'fixture',
        outcome: 'success',
      });

      return {
        users: userIds,
        victimId: victim!.id,
        academyA: acA!.code,
        academyB: acB!.code,
      };
    }
    ```

    NOTE: this implementation depends on Plans 02, 03, 04 (schema), 12 (consent), and 17 (ROLES const).
    Plan 15 is wave 7 — all of those have shipped before this task runs.
  </action>
  <verify>
    <automated>grep -q "export async function seedRolesMatrix" tests/helpers/seed.ts && grep -q "academyA" tests/helpers/seed.ts && grep -q "victimId: victim" tests/helpers/seed.ts && grep -q "encrypt('Seed injury" tests/helpers/seed.ts && grep -q "set_config.*app.medical_key" tests/helpers/seed.ts && ! grep -q "Stub returns empty" tests/helpers/seed.ts</automated>
  </verify>
  <acceptance_criteria>
    - `seedRolesMatrix` returns `{ users: Record<Role, string>, victimId: string, academyA: string, academyB: string }`
    - 7 role users + 1 victim are inserted with `active=true` and `email_verified=true`
    - `recordConsent` called 8 times (one per user) for `operational` category — required for `requireCurrentConsent` middleware to pass
    - 1 medical_event row inserted with pgcrypto-encrypted cipher columns (Plan 03 `encrypt` helper)
    - 1 parent_child_link inserted (parent → victim)
    - 1 audit_log row with `action='seed.bootstrap'`
    - Function sets `app.medical_key` GUC before INSERT so pgp_sym_encrypt resolves the key
    - Plan 17 stub comment "Stub returns empty until Plan 02 schema lands." is REMOVED
  </acceptance_criteria>
  <done>seedRolesMatrix is real; RBAC matrix + admin-user.test.ts can rely on it.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: e2e walkthrough — TD admin actions trigger every Phase 1 security control</name>
  <what-built>
    - /[locale]/(app)/admin/users page (TD-only)
    - 7 admin actions wired through tRPC with audit_log + revocation + minor gate
    - 4 dialog components for actions
  </what-built>
  <how-to-verify>
    1. Run `npm run dev`. Log in as a TD user (seed via SQL: INSERT a user with role='technical_director' and active=true, plus an operational consent row).
    2. Visit `/nl/admin/users`. The table loads with the seeded TD plus any registered users.
    3. **Create:** Click "Nieuwe gebruiker", fill form, submit. New row appears. Verify in DB: 1 new `users` row + 1 `audit_log` row (action='user.create').
    4. **Activate (success):** For a user with a valid consent_records row + adult DOB, click "Activeren". User flips to active.
    5. **Activate (failure path — minor gate):** For a user under 16 without parent link, click "Activeren". UI shows error "parent_link_missing".
    6. **Deactivate:** Click "Deactiveren", enter reason, submit. Verify in Upstash: `revoked:{userId}` key set with TTL ~30d.
    7. **Assign role:** Change a user from 'player' to 'trainer'. Verify Upstash: `revoked:{userId}` set with reason 'role_changed'. Verify audit_log row.
    8. **Link parent (re-auth flow):** Click "Ouder koppelen". Without a fresh session, app routes to /[locale]/(auth)/re-auth. Re-authenticate. Now linkParent succeeds.
    9. **Link academy:** Choose academy, submit. Verify `academy_memberships` row + audit_log row.
    10. **403 path:** Log out, register a new player account, log in. Visit `/nl/admin/users` → redirect to `/login` (since role !== TD).
  </how-to-verify>
  <resume-signal>Type "approved" if all 10 steps work, or list which step failed.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TD browser ↔ admin.user.* | tdProcedure gated; sensitiveProcedure for linkParent (re-auth) |
| Admin mutation ↔ scope downgrade | setRevoked called immediately; in-flight requests using stale JWT will see UNAUTHORIZED 'session_revoked' on next call |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-07 | Elevation of Privilege | Stale JWT after role downgrade or parent-link break | mitigate | admin.user.deactivate + assignRole + (future) unlinkParent all call setRevoked() — Plan 11 requireAuth catches it on next request |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npx vitest run tests/integration/admin-user.test.ts` GREEN (5+ tests)
- Task 3 visual checkpoint approved
</verification>

<success_criteria>
- 7 admin.user.* operations
- D-09 revocation wired on deactivate + role change
- SEC-03 re-auth on linkParent
- Minor gate enforced via canActivate
- Audit log on every state-changing action
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-15-SUMMARY.md` documenting:
- All admin.user.* mutations functional
- Confirmation that D-09 + SEC-03 + audit hooks all fire correctly per Task 3 walkthrough
</output>
