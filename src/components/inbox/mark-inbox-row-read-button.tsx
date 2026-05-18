'use client';

/**
 * <MarkInboxRowReadButton> — Client-side per-row dismissal CTA.
 *
 * Calls `trpc.inbox.markRead.useMutation()`. Idempotent — the router
 * short-circuits on already-read rows (Plan 04-07).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (MinimalSystemInbox row).
 */
import { CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc-client';

export interface MarkInboxRowReadButtonProps {
  id: string;
}

export function MarkInboxRowReadButton({ id }: MarkInboxRowReadButtonProps) {
  const t = useTranslations('dashboard.inbox');
  const utils = trpc.useUtils();
  const mutation = trpc.inbox.markRead.useMutation({
    onSuccess: () => {
      void utils.inbox.listAll.invalidate();
      void utils.inbox.listUnread.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => mutation.mutate({ id })}
      disabled={mutation.isPending}
      aria-label={t('markRead')}
    >
      <CheckCheck className="size-4" />
    </Button>
  );
}
