/**
 * <MinimalSystemInbox> — Phase 4 thin inbox list (UI4-D09).
 *
 * Server Component. Reads from `trpc.inbox.listAll` via the appRouter caller
 * (RLS restricts to caller's rows). Chronological list, newest first. Per row:
 *   - lucide icon (Bell / Trophy / Dumbbell by kind)
 *   - body (i18n key with payload substitution)
 *   - relative date
 *   - subtle background tint when unread
 *   - <MarkAsReadButton> per row (Client component) calling
 *     `trpc.inbox.markRead`
 *
 * Phase 6 replaces this with the full Inbox UI; this is the thin v1 shim.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (MinimalSystemInbox row),
 *            04-CONTEXT.md D-67 + D-72 + UI4-D09.
 */
import { Bell, Dumbbell, Inbox, Trophy } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { MarkInboxRowReadButton } from '@/components/inbox/mark-inbox-row-read-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appRouter } from '@/server/trpc/routers/_app';
import type { createContext } from '@/server/trpc/server-context';
import { cn } from '@/lib/utils';

type Ctx = Awaited<ReturnType<typeof createContext>>;

interface MinimalSystemInboxProps {
  ctx: Ctx;
  locale: string;
}

function iconForKind(kind: string) {
  if (kind.includes('trainer') || kind.includes('training')) return Dumbbell;
  if (kind.includes('player') || kind.includes('tournament')) return Trophy;
  return Bell;
}

function bodyKeyForKind(kind: string): string {
  if (kind.includes('trainer') || kind.includes('training')) return 'nudge.inbox.trainerScoreBody';
  return 'nudge.inbox.playerResultBody';
}

export async function MinimalSystemInbox({ ctx, locale }: MinimalSystemInboxProps) {
  const t = await getTranslations('dashboard.inbox');
  const tNudgeInbox = await getTranslations('nudge.inbox');
  const caller = appRouter.createCaller(ctx);

  let rows: Awaited<ReturnType<typeof caller.inbox.listAll>>['entries'] = [];
  try {
    const res = await caller.inbox.listAll({ limit: 20 });
    rows = res.entries;
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('heading')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <Inbox className="size-8 text-muted-foreground" aria-hidden />
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
      <CardContent className="space-y-2">
        {rows.map((r) => {
          const Icon = iconForKind(r.kind);
          const unread = !r.readAt;
          // Body params via payload (count + maxDaysSinceEnd are present per
          // Plan 04-07 pg_cron function body).
          const payload = (r.payload ?? {}) as Record<string, unknown>;
          const count = Number(payload.pendingCount ?? payload.count ?? 0);
          let body: string;
          try {
            const bodyKey = bodyKeyForKind(r.kind);
            // useTranslations doesn't accept dynamic key paths, but the
            // namespace pattern works: nudge.inbox has trainerScoreBody +
            // playerResultBody as direct keys.
            if (bodyKey.endsWith('trainerScoreBody')) {
              body = tNudgeInbox('trainerScoreBody', { n: count });
            } else {
              body = tNudgeInbox('playerResultBody', { n: count });
            }
          } catch {
            body = '';
          }
          return (
            <div
              key={r.id}
              className={cn(
                'flex items-start gap-3 rounded-md border p-3',
                unread && 'bg-muted/40',
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="text-sm">{body}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {new Date(r.createdAt).toLocaleString(
                    locale === 'en' ? 'en-GB' : `${locale}-BE`,
                  )}
                </p>
              </div>
              {unread && <MarkInboxRowReadButton id={r.id} />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
