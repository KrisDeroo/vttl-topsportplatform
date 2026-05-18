/**
 * <MyTournamentResultPendingWidget> — player dashboard widget.
 *
 * Server Component. Reads `trpc.tournament.listPendingForPlayer` via the
 * appRouter caller. Lists tournaments where the player is a participant,
 * ends_at is in the past 14 days, AND no tournament_results row exists.
 * Each row: tournament name + days-left countdown + "Voer resultaat in" CTA.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory
 *            (MyTournamentResultPendingWidget row), 04-CONTEXT.md D-72.
 */
import Link from 'next/link';
import { CheckCircle2, Trophy } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appRouter } from '@/server/trpc/routers/_app';
import type { createContext } from '@/server/trpc/server-context';

type Ctx = Awaited<ReturnType<typeof createContext>>;

interface MyTournamentResultPendingWidgetProps {
  ctx: Ctx;
  locale: string;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export async function MyTournamentResultPendingWidget({
  ctx,
  locale,
}: MyTournamentResultPendingWidgetProps) {
  const t = await getTranslations('tournament.pendingWidget');
  const caller = appRouter.createCaller(ctx);

  let items: Awaited<ReturnType<typeof caller.tournament.listPendingForPlayer>>['pending'] = [];
  try {
    const res = await caller.tournament.listPendingForPlayer({});
    items = res.pending;
  } catch {
    items = [];
  }

  if (items.length === 0) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('heading')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => {
          const endsAt = new Date(item.endsAt);
          const elapsed = Date.now() - endsAt.getTime();
          const daysLeft = Math.max(0, Math.ceil((FOURTEEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)));
          return (
            <div
              key={item.eventId}
              className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Trophy className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{item.naam ?? item.eventId}</span>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t('daysLeft', { n: daysLeft })}
                </p>
              </div>
              <Button asChild size="sm">
                <Link href={`/${locale}/tournaments/${item.eventId}/result`}>
                  {t('cta')}
                </Link>
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
