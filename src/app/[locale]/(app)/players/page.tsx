/**
 * /[locale]/(app)/players — player list page (Plan 02-13 Task 4).
 *
 * Server Component. Mirrors Phase 1's admin/users pattern:
 *   1. Build per-request CallerContext via createContext() — populates
 *      session, scope, RLS GUCs (when wrapped by withRlsContext).
 *   2. tRPC server caller invokes `player.list` through the same
 *      middleware chain the HTTP adapter uses — RLS scopes the row set
 *      server-side; the client only ever receives rows it may see.
 *   3. The TD-only "Nieuwe speler" CTA renders conditionally; the server
 *      enforces the real RBAC for create (`player.create` is a
 *      tdProcedure), so this is cosmetic (T-02-13-CLIENT-ROLE-CHECK).
 *
 * BLOCKER-03: uses Phase 1 canonical caller pattern via
 * `createContext()` + `appRouter.createCaller(ctx)`. Does NOT import
 * from `@/lib/trpc-server` (that module does not exist).
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 4
 *            src/app/[locale]/(app)/admin/users/page.tsx
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PlayerListTable } from '@/components/players/player-list-table';
import { Button } from '@/components/ui/button';
import { db } from '@/server/db/client';
import { ageCategories, academy as academyTable } from '@/server/db/schema/lookups';
import { eq } from 'drizzle-orm';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function PlayersListPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations('players.list');

  const ctx = await createContext();
  if (!ctx.scope) {
    // Defensive — the (app) layout already redirects anonymous users; we
    // re-check so the createCaller path never runs without a scope.
    redirect(`/${locale}/login`);
  }

  // Player role users navigate to their own profile (UI-SPEC line 376 —
  // player role is redirected to /me/profile, no list view).
  if (ctx.scope.role === 'player') {
    redirect(`/${locale}/me/profile`);
  }

  const caller = appRouter.createCaller(ctx);
  // RLS-bound: the procedure runs inside withRlsContext (Phase 1) which
  // applies the per-request GUCs so the SELECT returns only rows visible
  // to the caller (TD/academy_manager/trainer/parent — all narrowed by
  // 02-05 RLS policies).
  const players = await caller.player.list({ limit: 50 });

  // Pre-fetch active age category codes for the change dialog. Reading
  // lookups via Drizzle here is fine — they are not RLS-scoped tables
  // (lookup data is public-readable per 02-05). Keeping the read in the
  // Server Component avoids an extra tRPC procedure for a small static
  // list. Plan also notes "use only active=true" (02-08 seed).
  const ageRows = await db.query.ageCategories.findMany({
    where: eq(ageCategories.active, true),
    orderBy: (r, { asc }) => [asc(r.sortOrder)],
  });
  const ageCategoryCodes = ageRows.map((r) => r.code);
  // Touch the academy table import to keep the dependency visible
  // (the page does not need the list itself, but the same import path
  // is reused by other pages in this task set).
  void academyTable;

  const isTd = ctx.scope.role === 'technical_director';

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {isTd ? (
          <Button asChild>
            <Link href={`/${locale}/players/new`}>{t('empty.ctaTd')}</Link>
          </Button>
        ) : null}
      </div>

      <PlayerListTable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialData={players as any}
        isTd={isTd}
        ageCategoryCodes={ageCategoryCodes}
        locale={locale}
      />
    </main>
  );
}
