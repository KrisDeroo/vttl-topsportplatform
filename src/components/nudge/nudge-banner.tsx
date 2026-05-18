'use client';

/**
 * <NudgeBanner> — single non-dismissible banner row (UI4-D08).
 *
 * Background color escalates by max-days-since-deadline:
 *   - yellow (days 0-6) — `--state-needs-action-*`
 *   - orange (days 7-9) — `--state-nudge-warning-*`
 *   - red    (days 10-12) — `--state-nudge-critical-*`
 *
 * Pulse animation 1Hz on critical level; `motion-safe:` guard disables under
 * `prefers-reduced-motion: reduce` (UI-SPEC §Accessibility Contract).
 *
 * Color is paired with the AlertTriangle icon and the text body containing
 * the count + daysLeft number — three signifiers; color alone never
 * carries meaning (T-04-52 mitigation).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (NudgeBanner row),
 *            04-CONTEXT.md D-67 channel 1 + UI4-D08.
 */
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { trpc } from '@/lib/trpc-client';
import { cn } from '@/lib/utils';

export interface NudgeBannerProps {
  kind: 'trainer_score' | 'player_result';
  href: string;
  scope?: 'self' | 'all';
}

function escalationLevel(maxDaysSinceEnd: number): 'yellow' | 'orange' | 'red' {
  if (maxDaysSinceEnd >= 10) return 'red';
  if (maxDaysSinceEnd >= 7) return 'orange';
  return 'yellow';
}

export function NudgeBanner({ kind, href, scope = 'self' }: NudgeBannerProps) {
  const tTrainer = useTranslations('nudge.trainerScore');
  const tPlayer = useTranslations('nudge.playerResult');
  const tCta = useTranslations('nudge.banner');

  // Live count — refetch every 30s per RESEARCH §Pitfall 7. Reads from the
  // same predicate the pg_cron job uses for inbox materialization (Plan 04-07).
  const trainerPending = trpc.training.listPending.useQuery(
    { scope },
    {
      enabled: kind === 'trainer_score',
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  );
  const playerPending = trpc.tournament.listPendingForPlayer.useQuery(
    {},
    {
      enabled: kind === 'player_result',
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  );

  if (kind === 'trainer_score') {
    const sessions = trainerPending.data?.sessions ?? [];
    if (sessions.length === 0) return null;
    const now = Date.now();
    const maxDaysSinceEnd = sessions.reduce((acc, s) => {
      const days = Math.floor(
        (now - new Date(s.endsAt).getTime()) / (24 * 60 * 60 * 1000),
      );
      return Math.max(acc, days);
    }, 0);
    const level = escalationLevel(maxDaysSinceEnd);
    const daysLeft = Math.max(0, 14 - maxDaysSinceEnd);
    let body: string;
    if (level === 'red') body = tTrainer('day10to12', { n: sessions.length, daysLeft });
    else if (level === 'orange') body = tTrainer('day7to9', { n: sessions.length });
    else body = tTrainer('day0to6', { n: sessions.length });
    return <BannerRow level={level} body={body} href={href} cta={tCta('viewLink')} />;
  }

  const pending = playerPending.data?.pending ?? [];
  if (pending.length === 0) return null;
  const now = Date.now();
  const maxDaysSinceEnd = pending.reduce((acc, p) => {
    const days = Math.floor(
      (now - new Date(p.endsAt).getTime()) / (24 * 60 * 60 * 1000),
    );
    return Math.max(acc, days);
  }, 0);
  const level = escalationLevel(maxDaysSinceEnd);
  const daysLeft = Math.max(0, 14 - maxDaysSinceEnd);
  let body: string;
  if (level === 'red') body = tPlayer('day10to12', { n: pending.length, daysLeft });
  else if (level === 'orange') body = tPlayer('day7to9', { n: pending.length });
  else body = tPlayer('day0to6', { n: pending.length });
  return <BannerRow level={level} body={body} href={href} cta={tCta('viewLink')} />;
}

interface BannerRowProps {
  level: 'yellow' | 'orange' | 'red';
  body: string;
  href: string;
  cta: string;
}

function BannerRow({ level, body, href, cta }: BannerRowProps) {
  const bgClass =
    level === 'red'
      ? 'bg-state-nudge-critical-bg text-state-nudge-critical-fg border-state-nudge-critical-border'
      : level === 'orange'
        ? 'bg-state-nudge-warning-bg text-state-nudge-warning-fg border-state-nudge-warning-border'
        : 'bg-state-needs-action-bg text-state-needs-action-fg border-state-needs-action-border';
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 border-b px-4 py-2',
        bgClass,
        level === 'red' && 'motion-safe:animate-pulse',
      )}
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <p className="flex-1 text-sm" dangerouslySetInnerHTML={{ __html: body }} />
      <Link
        href={href}
        className="text-sm font-medium underline-offset-2 hover:underline"
      >
        {cta}
      </Link>
    </div>
  );
}
