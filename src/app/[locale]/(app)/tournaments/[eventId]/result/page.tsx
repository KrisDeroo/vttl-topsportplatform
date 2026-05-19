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
  searchParams: Promise<{
    mode?: string | undefined;
    playerId?: string | undefined;
  }>;
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

  // CR-03 (Plan 04-12 Task 2): player caller is always own subject; non-player
  // callers MUST supply ?playerId in the URL. No fallback to an arbitrary
  // other player's row — that fallback was the silent-overwrite bug.
  const requestedPlayerId = sp.playerId;
  const resolvedPlayerId: string | null = isPlayer
    ? callerId
    : (requestedPlayerId ?? null);

  // CR-03 (Plan 04-12 Task 2): non-player caller without ?playerId — render a
  // Pick-Player selector listing the tournament's participants. Task 1
  // extended `tournament.get` with `participants: Array<{userId, userName}>`,
  // which backs the picker even when no `tournament_results` rows exist yet
  // (the first-result-of-tournament case — WARNING-3 Path A resolution).
  if (!resolvedPlayerId) {
    const participantsList = (tournament.participants ?? []) as Array<{
      userId: string;
      userName: string | null;
    }>;
    // Union: registered participants from `tournament.get` PLUS any orphan
    // result rows whose participant_event row was removed after entry.
    // Defensive — unlikely in practice but keeps the picker honest.
    const pickerOptions = [
      ...participantsList,
      ...(existing?.results ?? [])
        .filter(
          (r) =>
            !participantsList.some((p) => p.userId === r.playerUserId),
        )
        .map((r) => ({
          userId: r.playerUserId,
          userName: null as string | null,
        })),
    ];

    return (
      <main className="mx-auto max-w-screen-xl px-4 py-6 md:px-6 space-y-4">
        <header className="mb-2">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('pickPlayer')}</p>
        </header>
        <ul className="space-y-2 rounded-md border p-3">
          {pickerOptions.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              {t('noParticipants')}
            </li>
          ) : (
            pickerOptions.map((p) => (
              <li key={p.userId}>
                <a
                  className="text-sm underline-offset-2 hover:underline"
                  href={`/${locale}/tournaments/${eventId}/result?playerId=${p.userId}`}
                >
                  {p.userName ?? p.userId}
                </a>
              </li>
            ))
          )}
        </ul>
      </main>
    );
  }

  // Narrowed: from here on, targetPlayerId is a non-null string.
  const targetPlayerId: string = resolvedPlayerId;

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
