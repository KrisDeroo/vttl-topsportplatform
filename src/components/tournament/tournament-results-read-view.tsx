/**
 * <TournamentResultsReadView> — read-only mirror of the entry form
 * (UI4-D21 read-mode + ?mode=read).
 *
 * Server Component. Re-uses the same data shape as the entry form
 * (`tournament.listResults` filtered to the player), renders fields as
 * read-only spans. "Bewerken" CTA visible when caller has edit permission.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TournamentResultsReadView row).
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { DerivedWonLostIndicator } from '@/components/tournament/derived-won-lost-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface ResultsReadViewProps {
  tournamentEventId: string;
  playerUserId: string;
  outcome: string;
  matches: Array<{
    round: string;
    opponent: string;
    matchDate: string;
    setsWon: number;
    setsLost: number;
    videoLink: string | null;
  }>;
  canEdit?: boolean;
  locale: string;
}

export async function TournamentResultsReadView({
  tournamentEventId,
  outcome,
  matches,
  canEdit,
  locale,
}: ResultsReadViewProps) {
  const t = await getTranslations('tournament.result');
  const tMatch = await getTranslations('tournament.matchResults');
  const tCommon = await getTranslations('common');
  const tLookupOutcome = await getTranslations('lookup.outcomeLevel');
  const tLookupRound = await getTranslations('lookup.tournamentRound');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('section.outcome')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm">
            <span className="text-muted-foreground">{t('field.outcome')}:</span>{' '}
            <span className="font-medium">
              {(() => {
                try {
                  return tLookupOutcome(outcome);
                } catch {
                  return outcome;
                }
              })()}
            </span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('section.matches')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tMatch('column.round')}</TableHead>
                <TableHead>{tMatch('column.opponent')}</TableHead>
                <TableHead>{tMatch('column.date')}</TableHead>
                <TableHead>{tMatch('column.setsWon')}</TableHead>
                <TableHead>{tMatch('column.setsLost')}</TableHead>
                <TableHead>{tMatch('column.result')}</TableHead>
                <TableHead>{tMatch('column.video')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((m, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    {(() => {
                      try {
                        return tLookupRound(m.round);
                      } catch {
                        return m.round;
                      }
                    })()}
                  </TableCell>
                  <TableCell>{m.opponent}</TableCell>
                  <TableCell className="tabular-nums">
                    {new Date(m.matchDate).toLocaleDateString(
                      locale === 'en' ? 'en-GB' : `${locale}-BE`,
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{m.setsWon}</TableCell>
                  <TableCell className="tabular-nums">{m.setsLost}</TableCell>
                  <TableCell>
                    <DerivedWonLostIndicator setsWon={m.setsWon} setsLost={m.setsLost} />
                  </TableCell>
                  <TableCell>
                    {m.videoLink ? (
                      <a
                        href={m.videoLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Link
                      </a>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {canEdit && (
        <div className="flex justify-end">
          <Button asChild>
            <Link href={`/${locale}/tournaments/${tournamentEventId}/result`}>
              {tCommon('edit')}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
