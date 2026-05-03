/**
 * /[locale]/(app)/admin/users — TD-only user-management page (Plan 15 Task 2).
 *
 * Server Component:
 *   - Re-validates the session via Better Auth (the parent layout already
 *     redirected anonymous users; we re-check role here so a non-TD
 *     authenticated user can't reach this URL).
 *   - Reads the initial user list THROUGH the tRPC `admin.user.list`
 *     procedure (CR-07 fix, 2026-05-01) so the same middleware chain that
 *     guards the client (requireAuth + withRlsContext +
 *     requireCurrentConsent + requireRole(technical_director)) also gates
 *     the server-rendered initial data. Direct `db.query.users.findMany`
 *     would have bypassed RLS on read, leaving sensitive columns (DOB,
 *     deactivatedAt) exposed if a non-TD ever reached this Server
 *     Component via a routing bug or a Better Auth role-claim quirk.
 *   - Hands the list off to <UserTable> as `initialData` so the React
 *     Query cache hydrates without a client-side round-trip.
 *
 * Role gating: the redirect target is `/[locale]/login` for both
 * "no session" and "wrong role" — we deliberately do NOT differentiate
 * between the two cases at this layer (no enumeration of which paths
 * exist for which roles). The login page can prompt re-auth; if the
 * user is already authenticated they land on the role's home page after
 * login.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            .planning/phases/01-fundament/01-RESEARCH.md
 *              §`/admin/users/page.tsx` (lines 2132–2156)
 */
import { redirect } from 'next/navigation';

import { getTranslations } from 'next-intl/server';

import { UserTable } from '@/components/admin/user-table';
import { createContext } from '@/server/trpc/server-context';
import { appRouter } from '@/server/trpc/routers/_app';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminUsersPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations('admin.users');

  // Build the same per-request context the HTTP tRPC adapter uses; this
  // populates session, scope, RLS GUCs, request-id, ip, etc. so the
  // server-side caller honours every middleware (requireAuth,
  // withRlsContext, requireCurrentConsent, requireRole).
  const ctx = await createContext();

  // Anonymous or non-TD callers go to login. Doing the role check first
  // avoids the cost of building the caller for a request that will
  // immediately be denied by `requireRole('technical_director')`.
  if (!ctx.scope || ctx.scope.role !== 'technical_director') {
    redirect(`/${locale}/login`);
  }

  // tRPC server-side caller — invokes the procedure WITH the full
  // middleware chain. RLS is enforced inside `tdProcedure`'s
  // `withRlsContext`, so this is the canonical guarded read path; any
  // future tightening of the policy automatically applies here too.
  const caller = appRouter.createCaller(ctx);
  const list = await caller.admin.user.list({ limit: 100 });

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <UserTable initialData={list} />
    </main>
  );
}
