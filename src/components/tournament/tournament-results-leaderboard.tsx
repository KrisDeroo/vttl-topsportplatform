/**
 * <TournamentResultsLeaderboard> — academy-wide visibility (D-78).
 *
 * Server Component. Reads `trpc.tournament.listResults` via the appRouter
 * caller — RLS does the scoping (5-branch UNION from migration 0018, plus
 * D-78's academy-peer branch). Sort by outcome_level.sort_order ASC
 * (winnaar first).
 *
 * Empty state: lucide Award + i18n message; localized direct/operational
 * tone per UI4-D23.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TournamentResultsLeaderboard
 *            row), 04-CONTEXT.md D-78.
 */
import { Award } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { appRouter } from '@/server/trpc/routers/_app';
import type { createContext } from '@/server/trpc/server-context';

type Ctx = Awaited<ReturnType<typeof createContext>>;

interface TournamentResultsLeaderboardProps {
  ctx: Ctx;
  tournamentEventId: string;
}

export async function TournamentResultsLeaderboard({
  ctx,
  tournamentEventId,
}: TournamentResultsLeaderboardProps) {
  const t = await getTranslations('tournament.leaderboard');
  const tLookupOutcome = await getTranslations('lookup.outcomeLevel');
  const caller = appRouter.createCaller(ctx);

  type ResultRow = Awaited<
    ReturnType<typeof caller.tournament.listResults>
  >['results'][number];
  type MatchRow = Awaited<
    ReturnType<typeof caller.tournament.listResults>
  >['matches'][number];
  let results: ResultRow[] = [];
  let matchesByPlayer = new Map<string, MatchRow[]>();
  try {
    const res = await caller.tournament.listResults({ tournamentEventId });
    results = res.results;
    matchesByPlayer = new Map();
    for (const m of res.matches) {
      const list = matchesByPlayer.get(m.playerUserId) ?? [];
      list.push(m);
      matchesByPlayer.set(m.playerUserId, list);
    }
  } catch {
    results = [];
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('heading')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Award className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('column.player')}</TableHead>
                <TableHead>{t('column.outcome')}</TableHead>
                <TableHead>{t('column.matches')}</TableHead>
                <TableHead>{t('column.won')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, idx) => {
                const playerMatches = matchesByPlayer.get(r.playerUserId) ?? [];
                const total = playerMatches.length;
                const won = playerMatches.filter(
                  (m) => (m.setsWon ?? 0) > (m.setsLost ?? 0),
                ).length;
                let outcomeLabel: string = '—';
                try {
                  outcomeLabel = tLookupOutcome(r.outcomeLevelCode);
                } catch {
                  outcomeLabel = r.outcomeLevelCode ?? '—';
                }
                return (
                  <TableRow key={`${r.playerUserId}-${idx}`}>
                    <TableCell>{r.playerUserId}</TableCell>
                    <TableCell>{outcomeLabel}</TableCell>
                    <TableCell className="tabular-nums">{total}</TableCell>
                    <TableCell className="tabular-nums">{won}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
