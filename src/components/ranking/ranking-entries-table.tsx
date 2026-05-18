/**
 * <RankingEntriesTable> — audit/correction view for ranking entries.
 *
 * Server Component (no mutation). Reads `trpc.ranking.listEntries` via the
 * appRouter caller. Returns every visible row sorted DESC by recorded_at.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (RankingEntriesTable row).
 */
import { getTranslations } from 'next-intl/server';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

interface RankingEntriesTableProps {
  ctx: Ctx;
  playerUserId: string;
  rankingTypeCode?: string;
  locale: string;
}

export async function RankingEntriesTable({
  ctx,
  playerUserId,
  rankingTypeCode,
  locale,
}: RankingEntriesTableProps) {
  const tCol = await getTranslations('ranking.entries.column');
  const tEmpty = await getTranslations('ranking.entries');
  const tType = await getTranslations('lookup.rankingType');
  const tSource = await getTranslations('ranking.chart.tooltip.source');

  const caller = appRouter.createCaller(ctx);
  let rows: Awaited<ReturnType<typeof caller.ranking.listEntries>>['entries'] = [];
  try {
    const res = await caller.ranking.listEntries({
      playerUserId,
      ...(rankingTypeCode ? { rankingTypeCode } : {}),
    });
    rows = res.entries;
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {tEmpty('empty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tEmpty('empty').replace(/^/, '')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tCol('date')}</TableHead>
              <TableHead>{tCol('type')}</TableHead>
              <TableHead>{tCol('value')}</TableHead>
              <TableHead>{tCol('source')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const value =
                r.valueNumeric !== null
                  ? `#${r.valueNumeric}`
                  : (r.valueClassificationCode ?? '—');
              let typeLabel: string;
              try {
                typeLabel = tType(r.rankingTypeCode);
              } catch {
                typeLabel = r.rankingTypeCode;
              }
              return (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">
                    {new Date(r.recordedAt).toLocaleDateString(
                      locale === 'en' ? 'en-GB' : `${locale}-BE`,
                    )}
                  </TableCell>
                  <TableCell>{typeLabel}</TableCell>
                  <TableCell className="tabular-nums">{value}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {r.source === 'federation_official'
                        ? tSource('federationOfficial')
                        : tSource('manual')}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
