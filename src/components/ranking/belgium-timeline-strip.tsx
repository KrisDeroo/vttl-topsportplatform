'use client';

/**
 * <BelgiumTimelineStrip> — annual tier-band horizontal timeline (D-87 + UI4-D16).
 *
 * Pure CSS/Tailwind component — no chart library. Each year-cell:
 *   - year label above (text-sm font-medium text-muted-foreground)
 *   - tier-code label centered in a band cell whose background reads
 *     `bg-cls-tier-{tier}-bg` and foreground `text-cls-tier-{tier}-fg`.
 *     NC carries a mandatory 1px border per UI-SPEC §Color §NC outline.
 *
 * Click cell opens a Popover with date + value + source. Keyboard navigable.
 *
 * Reference: 04-UI-SPEC.md §Two Ranking Widgets §Belgium timeline strip,
 *            04-CONTEXT.md D-87 + UI4-D16.
 */
import { Award, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/trpc-client';
import { cn } from '@/lib/utils';

export interface BelgiumTimelineStripProps {
  playerUserId: string;
  /** Belgium ranking type code (always 'ranking_belgium' in Phase 4). */
  rankingTypeCode: string;
  onAddEntry?: () => void;
}

type Tier = 'a' | 'b' | 'c' | 'd' | 'e' | 'nc';

function deriveTier(code: string): Tier {
  if (!code) return 'nc';
  const c = code.toUpperCase();
  if (c === 'NC') return 'nc';
  const first = c[0]?.toLowerCase();
  if (first === 'a' || first === 'b' || first === 'c' || first === 'd' || first === 'e') {
    return first as Tier;
  }
  return 'nc';
}

const TIER_BG_CLASSES: Record<Tier, string> = {
  a: 'bg-cls-tier-a-bg text-cls-tier-a-fg',
  b: 'bg-cls-tier-b-bg text-cls-tier-b-fg',
  c: 'bg-cls-tier-c-bg text-cls-tier-c-fg',
  d: 'bg-cls-tier-d-bg text-cls-tier-d-fg',
  e: 'bg-cls-tier-e-bg text-cls-tier-e-fg',
  nc: 'bg-cls-tier-nc-bg text-cls-tier-nc-fg border border-cls-tier-nc-border',
};

interface BelgiumEntry {
  id: string;
  year: number;
  code: string;
  recordedAt: string;
  source: string;
  tier: Tier;
}

export function BelgiumTimelineStrip({
  playerUserId,
  rankingTypeCode,
  onAddEntry,
}: BelgiumTimelineStripProps) {
  const tEmpty = useTranslations('ranking.belgium.empty');

  const query = trpc.ranking.getHistory.useQuery({
    playerUserId,
    rankingTypeCode,
  });

  if (query.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  const entries: BelgiumEntry[] = (query.data?.entries ?? [])
    .filter((e) => Boolean(e.valueClassificationCode))
    .map((e) => {
      const code = e.valueClassificationCode!;
      const recordedAt =
        typeof e.recordedAt === 'object' && e.recordedAt !== null && 'toISOString' in e.recordedAt
          ? (e.recordedAt as Date).toISOString()
          : String(e.recordedAt);
      return {
        id: e.id,
        year: new Date(recordedAt).getFullYear(),
        code,
        recordedAt,
        source: e.source,
        tier: deriveTier(code),
      };
    })
    .sort((a, b) => a.year - b.year);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <Award className="size-8 text-muted-foreground" aria-hidden />
        <h3 className="text-lg font-semibold">{tEmpty('heading')}</h3>
        <p className="text-sm text-muted-foreground">{tEmpty('body')}</p>
        {onAddEntry && (
          <Button onClick={onAddEntry}>
            <Plus className="mr-1 size-4" />
            {tEmpty('cta')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full overflow-x-auto gap-px rounded-md border bg-border">
      {entries.map((entry) => (
        <div key={entry.id} className="flex flex-col flex-1 min-w-20">
          <div className="text-sm font-medium text-muted-foreground text-center py-1">
            {entry.year}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${entry.year}: ${entry.code}`}
                className={cn(
                  'h-12 flex items-center justify-center text-sm font-medium font-mono',
                  TIER_BG_CLASSES[entry.tier],
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                )}
              >
                {entry.code}
              </button>
            </PopoverTrigger>
            <PopoverContent>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Datum:</span>{' '}
                  {new Date(entry.recordedAt).toLocaleDateString('nl-BE')}
                </div>
                <div>
                  <span className="text-muted-foreground">Klassement:</span>{' '}
                  <span className="font-mono">{entry.code}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Bron:</span>{' '}
                  {entry.source === 'federation_official' ? 'Officieel' : 'Manueel'}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      ))}
    </div>
  );
}
