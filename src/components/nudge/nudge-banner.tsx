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
 * CR-08 fix (Phase 4 gap closure 04-15): bold copy now renders via next-intl
 * t.rich with a `<b>` chunk → `<strong>` JSX. No raw-HTML innerHTML sink.
 *
 * WR-10 fix (Phase 4 gap closure 04-15): daysLeft uses Math.ceil on the raw
 * ms delta. Day 14 (when wall is strict-greater) still shows "nog 1 dag";
 * day 15 shows 0 (and writes are already blocked by the server-side wall).
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

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

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

const boldChunk = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

export function NudgeBanner({ kind, href, scope = 'self' }: NudgeBannerProps) {
  const tTrainer = useTranslations('nudge.trainerScore');
  const tPlayer = useTranslations('nudge.playerResult');
  const tCta = useTranslations('nudge.banner');

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
    const maxMsSinceEnd = sessions.reduce((acc, s) => {
      return Math.max(acc, now - new Date(s.endsAt).getTime());
    }, 0);
    const msLeft = FOURTEEN_DAYS_MS - maxMsSinceEnd;
    const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    const level = escalationLevel(maxDaysSinceEnd);

    const bodyNode =
      level === 'red'
        ? tTrainer.rich('day10to12', { n: sessions.length, daysLeft, b: boldChunk })
        : level === 'orange'
          ? tTrainer.rich('day7to9', { n: sessions.length, b: boldChunk })
          : tTrainer.rich('day0to6', { n: sessions.length, b: boldChunk });

    return <BannerRow level={level} bodyNode={bodyNode} href={href} cta={tCta('viewLink')} />;
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
  const maxMsSinceEnd = pending.reduce((acc, p) => {
    return Math.max(acc, now - new Date(p.endsAt).getTime());
  }, 0);
  const msLeft = FOURTEEN_DAYS_MS - maxMsSinceEnd;
  const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
  const level = escalationLevel(maxDaysSinceEnd);

  const bodyNode =
    level === 'red'
      ? tPlayer.rich('day10to12', { n: pending.length, daysLeft, b: boldChunk })
      : level === 'orange'
        ? tPlayer.rich('day7to9', { n: pending.length, b: boldChunk })
        : tPlayer.rich('day0to6', { n: pending.length, b: boldChunk });

  return <BannerRow level={level} bodyNode={bodyNode} href={href} cta={tCta('viewLink')} />;
}

interface BannerRowProps {
  level: 'yellow' | 'orange' | 'red';
  bodyNode: React.ReactNode;
  href: string;
  cta: string;
}

function BannerRow({ level, bodyNode, href, cta }: BannerRowProps) {
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
      <p className="flex-1 text-sm">{bodyNode}</p>
      <Link
        href={href}
        className="text-sm font-medium underline-offset-2 hover:underline"
      >
        {cta}
      </Link>
    </div>
  );
}
