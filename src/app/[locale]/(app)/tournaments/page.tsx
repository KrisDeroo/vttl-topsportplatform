/**
 * /[locale]/(app)/tournaments — Phase 4 tournament list route.
 *
 * Server Component. Lists tournaments visible to the caller via
 * `trpc.tournament.list` (RLS scopes the row set). TD-only "Nieuw
 * toernooi" affordance is rendered by the client component.
 *
 * Reference: 04-UI-SPEC.md §Page Surfaces (/tournaments row).
 */
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TournamentList } from '@/components/tournament/tournament-list';
import { Button } from '@/components/ui/button';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function TournamentsPage(props: PageProps) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'tournament.list' });
  const ctx = await createContext();
  if (!ctx.scope) redirect(`/${locale}/login`);

  const caller = appRouter.createCaller(ctx);
  let rows: Awaited<ReturnType<typeof caller.tournament.list>>['tournaments'] = [];
  try {
    const res = await caller.tournament.list({ limit: 10 });
    rows = res.tournaments;
  } catch {
    rows = [];
  }

  const isTd = ctx.scope.role === 'technical_director';

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {isTd && (
          <Button asChild>
            <Link href={`/${locale}/tournaments/new`}>
              <Plus className="mr-1 size-4" />
              {t('title')}
            </Link>
          </Button>
        )}
      </header>
      <TournamentList
        rows={rows.map((r) => ({
          eventId: r.eventId,
          naam: r.naam,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          city: r.city,
          country: r.country,
          ageCategoryCode: r.ageCategoryCode,
          tournamentTypeCode: r.tournamentTypeCode,
        }))}
        locale={locale}
      />
    </main>
  );
}
