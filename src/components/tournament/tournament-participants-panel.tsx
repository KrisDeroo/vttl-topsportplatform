'use client';

/**
 * <TournamentParticipantsPanel> — TD-only edit panel (D-79).
 *
 * Two columns desktop: registered list + "voeg deelnemer toe" combobox.
 * Non-TD callers see read-only list (no add/remove). Subscribing a player
 * INSERTs a calendar_event_participants row → triggers the 14d entry
 * window and nudge chain (Plan 04-07).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TournamentParticipantsPanel
 *            row), 04-CONTEXT.md D-79.
 */
import { Trash2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc-client';

export interface TournamentParticipant {
  userId: string;
  userName: string | null;
}

export interface TournamentParticipantsPanelProps {
  tournamentEventId: string;
  participants: TournamentParticipant[];
  canEdit: boolean; // true when caller is TD
  /** Locale for constructing per-participant result-route links. */
  locale: string;
}

function initials(name: string | null): string {
  if (!name) return '??';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function TournamentParticipantsPanel({
  tournamentEventId,
  participants: initialParticipants,
  canEdit,
  locale,
}: TournamentParticipantsPanelProps) {
  const t = useTranslations('tournament.participants');
  const utils = trpc.useUtils();
  const [participants, setParticipants] = React.useState(initialParticipants);
  const [newPlayerId, setNewPlayerId] = React.useState('');

  const addMutation = trpc.tournament.addParticipant.useMutation({
    onSuccess: (_res, vars) => {
      // Best-effort optimistic — server is source of truth.
      setParticipants((cur) => [
        ...cur,
        { userId: vars.playerUserId, userName: null },
      ]);
      setNewPlayerId('');
      void utils.tournament.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = trpc.tournament.removeParticipant.useMutation({
    onSuccess: (_res, vars) => {
      setParticipants((cur) =>
        cur.filter((p) => p.userId !== vars.playerUserId),
      );
      void utils.tournament.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('heading', { default: 'Deelnemers' } as never)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="space-y-2">
            {participants.map((p) => (
              <li key={p.userId} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback>{initials(p.userName)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{p.userName ?? p.userId}</span>
                </div>
                <div className="flex items-center gap-1">
                  {/*
                    CR-03 (Plan 04-12 Task 4): explicit `?playerId=` carries
                    the subject through to result/page.tsx. TD/trainer flow
                    enters or overwrites the result for THIS participant
                    (Task 2's targetPlayerId narrowing).
                  */}
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={`/${locale}/tournaments/${tournamentEventId}/result?playerId=${p.userId}`}
                    >
                      {t('enterResult')}
                    </a>
                  </Button>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        removeMutation.mutate({
                          tournamentEventId,
                          playerUserId: p.userId,
                        })
                      }
                      disabled={removeMutation.isPending}
                      aria-label={t('remove')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="flex gap-2 pt-2 border-t">
            <Input
              value={newPlayerId}
              onChange={(e) => setNewPlayerId(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="flex-1"
            />
            <Button
              type="button"
              onClick={() =>
                addMutation.mutate({
                  tournamentEventId,
                  playerUserId: newPlayerId.trim(),
                })
              }
              disabled={!newPlayerId.trim() || addMutation.isPending}
            >
              <UserPlus className="mr-1 size-4" />
              {t('add')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground pt-2 border-t">{t('tdReadOnlyHint')}</p>
        )}
      </CardContent>
    </Card>
  );
}
