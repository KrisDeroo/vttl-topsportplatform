/**
 * /[locale]/(app)/tournaments/[eventId]/result — atomic entry route (D-69 + D-80).
 *
 * Server Component shell wrapping the Client `<TournamentResultEntryForm>`.
 * Renders read-only view when:
 *   - ?mode=read OR
 *   - player caller AND 14d wall expired.
 *
 * Backfill badge / overwrite badge surfaces are derived server-side from
 * scope (Plan 04-04 D-73 + D-75 semantics):
 *   - role=technical_director AND existing result row → overwrite
 *   - role=trainer AND past 14d wall → backfill
 *
 * Reference: 04-UI-SPEC.md §Page Surfaces (/tournaments/[eventId]/result row).
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TournamentResultEntryForm } from '@/components/tournament/tournament-result-entry-form';
import { TournamentResultsReadView } from '@/components/tournament/tournament-results-read-view';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/server-context';

interface PageProps {
  params: Promise<{ locale: string; eventId: string }>;
  searchParams: Promise<{ mode?: string | undefined }>;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export default async function ResultPage(props: PageProps) {
  const { locale, eventId } = await props.params;
  const sp = await props.searchParams;
  const t = await getTranslations({ locale, namespace: 'tournament.result' });
  const ctx = await createContext();
  if (!ctx.scope) notFound();

  const callerId = ctx.scope.userId;
  const callerRole = ctx.scope.role;
  const isTd = callerRole === 'technical_director';
  const isTrainer = callerRole === 'trainer';
  const isPlayer = callerRole === 'player';

  const caller = appRouter.createCaller(ctx);
  let tournament: Awaited<ReturnType<typeof caller.tournament.get>>;
  try {
    tournament = await caller.tournament.get({ tournamentEventId: eventId });
  } catch {
    notFound();
  }
  if (!tournament) notFound();

  const endsAt = new Date(tournament.endsAt);
  const wallExpired = Date.now() - endsAt.getTime() > FOURTEEN_DAYS_MS;

  // Pre-load existing result + matches for the caller (if player) so the
  // form can render in overwrite/read mode.
  let existing: Awaited<ReturnType<typeof caller.tournament.listResults>> | null = null;
  try {
    existing = await caller.tournament.listResults({ tournamentEventId: eventId });
  } catch {
    existing = null;
  }

  const targetPlayerId = isPlayer ? callerId : (existing?.results[0]?.playerUserId ?? callerId);

  const playerResult = existing?.results.find((r) => r.playerUserId === targetPlayerId);
  const playerMatches =
    existing?.matches.filter((m) => m.playerUserId === targetPlayerId) ?? [];

  const initial = playerResult
    ? {
        outcome: playerResult.outcomeLevelCode,
        matches: playerMatches.map((m) => ({
          round: m.roundCode,
          opponent: m.opponentName,
          opponentRanking: m.opponentRanking ?? null,
          matchDate: new Date(m.matchDate as unknown as string),
          setsWon: m.setsWon,
          setsLost: m.setsLost,
          videoLink: m.videoLink ?? null,
        })),
      }
    : undefined;

  const mode = sp.mode;
  const readOnly =
    mode === 'read' || (isPlayer && wallExpired) || (!isTd && !isTrainer && !isPlayer);
  const isOverwrite = isTd && Boolean(playerResult);
  const isBackfill = isTrainer && wallExpired;

  if (mode === 'read' && playerResult) {
    return (
      <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6 space-y-4">
        <header className="mb-2">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
        </header>
        <TournamentResultsReadView
          tournamentEventId={eventId}
          playerUserId={targetPlayerId}
          outcome={playerResult.outcomeLevelCode}
          matches={playerMatches.map((m) => ({
            round: m.roundCode,
            opponent: m.opponentName,
            matchDate: String(m.matchDate),
            setsWon: m.setsWon,
            setsLost: m.setsLost,
            videoLink: m.videoLink ?? null,
          }))}
          canEdit={isTd || (isPlayer && !wallExpired)}
          locale={locale}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6 space-y-4">
      <header className="mb-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
      </header>
      <TournamentResultEntryForm
        tournamentEventId={eventId}
        playerUserId={targetPlayerId}
        ageCategoryCode={playerResult?.playerAgeCategoryCode ?? null}
        initial={initial}
        readOnly={readOnly}
        isOverwrite={isOverwrite}
        isBackfill={isBackfill}
        locale={locale}
      />
    </main>
  );
}
