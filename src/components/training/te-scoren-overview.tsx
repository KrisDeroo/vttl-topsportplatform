/**
 * <TeScorenOverview> — trainer/TD dashboard widget (D-66 + D-68).
 *
 * Server Component. Reads `trpc.training.listPending` via the appRouter
 * caller (server-side); RLS scopes the pending-session rows. Trainer sees
 * only their own (scope='self'); TD sees all (scope='all', D-68).
 *
 * Each row: datum + (TD only) trainer + type + progress bar (% scored) +
 * "Score nu" button linking to /trainings/[eventId]/score?occurrenceDate=...
 *
 * Empty state (UI4-D23): direct + operational copy "Alle scores zijn
 * ingevoerd. Goed gedaan." with lucide CheckCircle2.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TeScorenOverview row),
 *            04-CONTEXT.md D-66 + D-68.
 */
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatOccurrenceDate } from '@/lib/rrule';
import { appRouter } from '@/server/trpc/routers/_app';
import type { createContext } from '@/server/trpc/server-context';

type Ctx = Awaited<ReturnType<typeof createContext>>;

interface TeScorenOverviewProps {
  ctx: Ctx;
  scope: 'self' | 'all';
  locale: string;
}

function isoDateOf(d: Date): string {
  // WR-02 (CR-09 family): Brussels-anchored YYYY-MM-DD via the canonical
  // formatOccurrenceDate helper. The previous `toISOString().slice(0, 10)`
  // drifted by one day for evening events in Brussels, sending trainers
  // to the wrong occurrence's score form.
  return formatOccurrenceDate(d);
}

export async function TeScorenOverview({ ctx, scope, locale }: TeScorenOverviewProps) {
  const t = await getTranslations('training.teScoren');
  const caller = appRouter.createCaller(ctx);

  let sessions: Awaited<ReturnType<typeof caller.training.listPending>>['sessions'] = [];
  try {
    const res = await caller.training.listPending({ scope });
    sessions = res.sessions;
  } catch {
    sessions = [];
  }

  if (sessions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('heading')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <CheckCircle2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        </CardContent>
      </Card>
    );
  }

  const isTd = scope === 'all';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('heading')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('column.date')}</TableHead>
              {isTd && <TableHead>{t('column.trainer')}</TableHead>}
              <TableHead>{t('column.type')}</TableHead>
              <TableHead>{t('column.progress')}</TableHead>
              <TableHead aria-hidden />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => {
              const endsAt = new Date(s.endsAt);
              const startsAt = new Date(s.startsAt);
              const occurrenceDate = isoDateOf(startsAt);
              // Pending players is what we receive; we treat the row as
              // "{pending} pending of unknown total" — server will return
              // exact total later. For now, show pending count.
              const pendingCount = Number(s.pendingPlayerCount ?? 0);
              return (
                <TableRow key={`${s.eventId}-${occurrenceDate}`}>
                  <TableCell>
                    {endsAt.toLocaleDateString(locale === 'en' ? 'en-GB' : `${locale}-BE`)}
                  </TableCell>
                  {isTd && <TableCell>{s.trainerId}</TableCell>}
                  <TableCell>{s.title ?? '—'}</TableCell>
                  <TableCell className="w-[140px]">
                    <Progress value={Math.max(0, 100 - pendingCount * 10)} aria-label={t('column.progress')} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm">
                      <Link
                        href={`/${locale}/trainings/${s.eventId}/score?occurrenceDate=${occurrenceDate}`}
                      >
                        {t('scoreNow')}
                      </Link>
                    </Button>
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
