/**
 * /[locale]/(app)/tournaments/[eventId] — Phase 4 tournament detail.
 *
 * Server Component. Renders metadata card, TournamentParticipantsPanel
 * (TD-only edit), and TournamentResultsLeaderboard (academy-wide
 * visibility per D-78).
 *
 * Reference: 04-UI-SPEC.md §Page Surfaces (/tournaments/[eventId] row).
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TournamentParticipantsPanel } from '@/components/tournament/tournament-participants-panel';
import { TournamentResultsLeaderboard } from '@/components/tournament/tournament-results-leaderboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string; eventId: string }>;
}

export default async function TournamentDetailPage(props: PageProps) {
  const { locale, eventId } = await props.params;
  const t = await getTranslations({ locale, namespace: 'tournament.detail' });
  const ctx = await createContext();
  if (!ctx.scope) notFound();

  const caller = appRouter.createCaller(ctx);
  let tournament: Awaited<ReturnType<typeof caller.tournament.get>>;
  try {
    tournament = await caller.tournament.get({ tournamentEventId: eventId });
  } catch {
    notFound();
  }
  if (!tournament) notFound();

  const isTd = ctx.scope.role === 'technical_director';

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">
          {tournament.naam ?? t('title')}
        </h1>
        <div className="mt-1 text-sm text-muted-foreground">
          {tournament.city ?? ''} · {tournament.country ?? ''}
        </div>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            <span className="text-muted-foreground">Startdatum:</span>{' '}
            {new Date(tournament.startsAt).toLocaleDateString(
              locale === 'en' ? 'en-GB' : `${locale}-BE`,
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Einddatum:</span>{' '}
            {new Date(tournament.endsAt).toLocaleDateString(
              locale === 'en' ? 'en-GB' : `${locale}-BE`,
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Type:</span>{' '}
            {tournament.tournamentTypeCode ?? '—'}
          </div>
          <div>
            <span className="text-muted-foreground">Leeftijdscategorie:</span>{' '}
            {tournament.ageCategoryCode ?? '—'}
          </div>
          <div>
            <span className="text-muted-foreground">Deelnemers:</span>{' '}
            {tournament.participantCount}
          </div>
        </CardContent>
      </Card>
      <TournamentParticipantsPanel
        tournamentEventId={eventId}
        participants={tournament.participants ?? []}
        canEdit={isTd}
        locale={locale}
      />
      <TournamentResultsLeaderboard
        ctx={ctx}
        tournamentEventId={eventId}
        locale={locale}
      />
    </main>
  );
}
