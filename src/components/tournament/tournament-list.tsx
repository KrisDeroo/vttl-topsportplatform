'use client';

/**
 * <TournamentList> — browsable history table.
 *
 * shadcn `<Table>` on desktop; card-stack on mobile. Filter bar lives in
 * a sibling `<TournamentFilterBar>` (URL-state filters). Columns vary
 * slightly by RBAC — TD sees aantal deelnemers; player sees "Mijn
 * resultaat" status; trainer + academy_manager see the academy roster.
 *
 * Phase 4 minimum-viable shape: render rows from `tournament.list` data
 * fetched server-side. Pagination via cursor (10 per page default).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TournamentList row).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface TournamentRow {
  eventId: string;
  naam: string | null;
  startsAt: string;
  endsAt: string;
  city: string | null;
  country: string | null;
  ageCategoryCode: string | null;
  tournamentTypeCode: string | null;
}

interface TournamentListProps {
  rows: TournamentRow[];
  locale: string;
}

export function TournamentList({ rows, locale }: TournamentListProps) {
  const t = useTranslations('tournament.list');

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('column.name')}</TableHead>
              <TableHead>{t('column.startsAt')}</TableHead>
              <TableHead>{t('column.city')}</TableHead>
              <TableHead>{t('column.country')}</TableHead>
              <TableHead>{t('column.ageCategory')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.eventId}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    href={`/${locale}/tournaments/${r.eventId}`}
                  >
                    {r.naam ?? r.eventId}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  {new Date(r.startsAt).toLocaleDateString(
                    locale === 'en' ? 'en-GB' : `${locale}-BE`,
                  )}
                </TableCell>
                <TableCell>{r.city ?? '—'}</TableCell>
                <TableCell>{r.country ?? '—'}</TableCell>
                <TableCell>{r.ageCategoryCode ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* Mobile card stack */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <Card key={r.eventId}>
            <CardContent className="p-4">
              <Link
                href={`/${locale}/tournaments/${r.eventId}`}
                className="font-medium hover:underline"
              >
                {r.naam ?? r.eventId}
              </Link>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {new Date(r.startsAt).toLocaleDateString(
                  locale === 'en' ? 'en-GB' : `${locale}-BE`,
                )}{' '}
                · {r.city ?? '—'} · {r.country ?? '—'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {r.ageCategoryCode ?? '—'} · {r.tournamentTypeCode ?? '—'}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
