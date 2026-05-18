'use client';

/**
 * <FeedbackTextarea> — autosizing textarea with inline 2000-char counter.
 *
 * Wraps shadcn `<Textarea>` for D-62 per-player feedback field. Length
 * limit (2000) is server-enforced via DB CHECK constraint + Zod schema
 * `errors.training.feedbackTooLong`; the inline counter is a UX hint, not
 * a security gate.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (FeedbackTextarea row),
 *            04-CONTEXT.md D-62.
 */
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const MAX_LENGTH = 2000;

export interface FeedbackTextareaProps {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
  name?: string;
}

export function FeedbackTextarea({
  value,
  onChange,
  disabled,
  ariaLabel,
  name,
}: FeedbackTextareaProps) {
  const t = useTranslations('training.score.feedback');
  const text = value ?? '';
  const charCount = text.length;
  const id = React.useId();

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        id={id}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          // Soft cap at MAX_LENGTH (defense; server enforces hard limit).
          if (next.length > MAX_LENGTH) return;
          onChange(next.length === 0 ? null : next);
        }}
        placeholder={t('placeholder')}
        disabled={disabled}
        maxLength={MAX_LENGTH}
        aria-label={ariaLabel}
        rows={2}
        name={name}
        className="resize-y"
      />
      <div
        className={cn(
          'text-xs text-muted-foreground tabular-nums self-end',
          charCount >= MAX_LENGTH - 50 && 'text-state-needs-action-fg',
        )}
      >
        {t('charCount', { n: charCount })}
      </div>
    </div>
  );
}
