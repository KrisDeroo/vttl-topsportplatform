'use client';

/**
 * <RankingLineChart> — recharts time-series chart (D-87 + UI4-D15).
 *
 * Y-axis INVERTED (<YAxis reversed>) — rank 1 sits at top per UI4-D15.
 * Tick formatter prepends '#' (e.g. '#127') to reinforce ranking semantics.
 * Axis label "Ranking (lager = beter)" is the redundant signifier for the
 * inversion (accessibility — color/visual is never the sole carrier).
 *
 * Empty state per UI-SPEC §Two Ranking Widgets §Empty state. Loading
 * skeleton: `<Skeleton class="h-80 w-full" />`.
 *
 * Reference: 04-UI-SPEC.md §Two Ranking Widgets §International ranking line
 *            chart, 04-CONTEXT.md D-87 + D-88 + D-90.
 */
import { LineChart as LineChartIcon, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/trpc-client';
import { cn } from '@/lib/utils';

export interface RankingLineChartProps {
  playerUserId: string;
  rankingTypeCode: string;
  from?: Date | undefined;
  to?: Date | undefined;
  onAddEntry?: () => void;
}

interface ChartDatum {
  ts: number;
  value: number;
  recordedAt: string;
  source: string;
}

function CustomTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload?: ChartDatum }>;
}) {
  const t = useTranslations('ranking.chart.tooltip.source');
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const d = props.payload[0]?.payload;
  if (!d) return null;
  const dateStr = new Date(d.recordedAt).toLocaleDateString('nl-BE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  let srcLabel: string;
  try {
    srcLabel = t(d.source === 'federation_official' ? 'federationOfficial' : 'manual');
  } catch {
    srcLabel = d.source;
  }
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow">
      <div className="font-medium tabular-nums">{dateStr}</div>
      <div className="tabular-nums">#{d.value}</div>
      <div className="text-xs text-muted-foreground">{srcLabel}</div>
    </div>
  );
}

export function RankingLineChart({
  playerUserId,
  rankingTypeCode,
  from,
  to,
  onAddEntry,
}: RankingLineChartProps) {
  const t = useTranslations('ranking');
  const tChart = useTranslations('ranking.chart');
  const tEmpty = useTranslations('ranking.empty');

  const query = trpc.ranking.getHistory.useQuery({
    playerUserId,
    rankingTypeCode,
    from,
    to,
  });

  if (query.isPending) {
    return <Skeleton className="h-80 w-full" />;
  }

  const entries: ChartDatum[] = (query.data?.entries ?? [])
    .filter((e) => e.valueNumeric !== null && e.valueNumeric !== undefined)
    .map((e) => ({
      ts: new Date(e.recordedAt).getTime(),
      value: Number(e.valueNumeric),
      recordedAt:
        typeof e.recordedAt === 'object' && e.recordedAt !== null && 'toISOString' in e.recordedAt
          ? (e.recordedAt as Date).toISOString()
          : String(e.recordedAt),
      source: e.source,
    }))
    .sort((a, b) => a.ts - b.ts);

  if (entries.length === 0) {
    return (
      <div className={cn('flex flex-col items-center gap-2 py-12 text-center')}>
        <LineChartIcon className="size-8 text-muted-foreground" aria-hidden />
        <h3 className="text-lg font-semibold">{tEmpty('heading')}</h3>
        <p className="text-sm text-muted-foreground">{tEmpty('body')}</p>
        {onAddEntry && (
          <Button variant="default" onClick={onAddEntry}>
            <Plus className="mr-1 size-4" />
            {tEmpty('cta')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{tChart('yAxisLabel')}</div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={entries} margin={{ top: 16, right: 16, bottom: 16, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(ts) =>
              new Date(ts).toLocaleDateString('nl-BE', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
              })
            }
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            reversed
            tickFormatter={(v) => `#${v}`}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 12 }}
            allowDataOverflow={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 4, fill: 'var(--primary)' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <span className="sr-only" aria-live="polite">
        {t('chart.yAxisLabel')}, {entries.length} entries
      </span>
    </div>
  );
}
