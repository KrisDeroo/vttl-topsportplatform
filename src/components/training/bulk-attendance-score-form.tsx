'use client';

/**
 * <BulkAttendanceScoreForm> — combined attendance + score capture per
 * D-62 + UI4-D04.
 *
 * One screen per session: rows of `[avatar+name | <AttendanceToggle> |
 * <StarRatingInput> | <FeedbackTextarea>]`. Single bottom Save button
 * submits ALL participants atomically via
 * `trpc.training.markAttendanceAndScore.useMutation()` (the server
 * UPSERTs the (event_id, occurrence_date, user_id) composite PK rows
 * inside a single transaction).
 *
 * Idempotency (VALID-08): generates a fresh UUIDv4 `_meta.idempotencyKey`
 * on every mount so accidental double-submit is dedup'd within 24h. Key
 * is regenerated on form re-open to prevent stale-key replay
 * (T-04-51 mitigation).
 *
 * Read-only mode (UI4-D21): when the 14d wall has expired for the
 * caller, the form renders all inputs disabled + a top `<Alert>` with
 * `errors.training.scoreWindowExpired`; no Save button.
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (BulkAttendanceScoreForm
 *            row), §Critical copy samples §Score capture form (D-62),
 *            04-CONTEXT.md D-62 + D-64.
 */
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { AttendanceToggle } from '@/components/training/attendance-toggle';
import { FeedbackTextarea } from '@/components/training/feedback-textarea';
import { StarRatingInput } from '@/components/common/star-rating-input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/trpc-client';

export interface ParticipantRow {
  userId: string;
  userName: string | null;
  attended: boolean | null;
  qualityScore: number | null;
  feedbackText: string | null;
  hasMedicalConflict: boolean;
}

export interface BulkAttendanceScoreFormProps {
  eventId: string;
  occurrenceDate: string; // ISO date YYYY-MM-DD
  participants: ParticipantRow[];
  /** Read-only mode (UI4-D21) — driven by server when 14d wall is expired. */
  readOnly?: boolean;
  /** Locale prefix for nav (e.g. 'nl' → /nl/calendar). */
  locale?: string;
}

interface FormShape {
  participants: ParticipantRow[];
}

function generateIdempotencyKey(): string {
  // RFC 4122 v4 — Crypto.randomUUID is available in modern browsers + Node ≥ 14.17.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback: random + timestamp hex
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

function initials(name: string | null): string {
  if (!name) return '??';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function BulkAttendanceScoreForm({
  eventId,
  occurrenceDate,
  participants,
  readOnly,
  locale,
}: BulkAttendanceScoreFormProps) {
  const t = useTranslations('training.score');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const router = require('next/navigation').useRouter();

  // Fresh idempotency key per mount — regenerated on save attempt below
  // so cache-replay only catches accidental network-retry doubles.
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => generateIdempotencyKey());

  const form = useForm<FormShape>({
    defaultValues: { participants },
  });
  const { fields } = useFieldArray({ control: form.control, name: 'participants' });

  const mutation = trpc.training.markAttendanceAndScore.useMutation({
    onSuccess: () => {
      toast.success(t('saveSuccess'));
      void utils.training.listPending.invalidate();
      // Regenerate the key so the next save starts a fresh idempotency
      // window (prevents stale-key replay if user re-edits and re-submits).
      setIdempotencyKey(generateIdempotencyKey());
      if (locale) {
        router.push(`/${locale}/dashboard`);
      }
    },
    onError: () => {
      toast.error(t('saveError'));
    },
  });

  function onSubmit(data: FormShape) {
    mutation.mutate({
      eventId,
      occurrenceDate: new Date(occurrenceDate),
      participants: data.participants.map((p) => ({
        userId: p.userId,
        attended: p.attended,
        qualityScore: p.qualityScore,
        feedbackText: p.feedbackText,
      })),
      _meta: { idempotencyKey },
    });
  }

  if (readOnly) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>{t('saveError')}</AlertTitle>
            <AlertDescription>
              {useTranslations('errors.training')('scoreWindowExpired')}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          {/* Desktop table-like row layout; collapses to card-stack on mobile. */}
          <div className="hidden md:grid md:grid-cols-[2fr_1fr_1.5fr_2fr] gap-2 border-b pb-2 text-sm font-medium text-muted-foreground">
            <span>{t('column.player')}</span>
            <span>{t('column.attendance')}</span>
            <span>{t('column.score')}</span>
            <span>{t('column.feedback')}</span>
          </div>
          {fields.map((field, idx) => {
            const participant = form.watch(`participants.${idx}`);
            return (
              <div
                key={field.id}
                className="flex flex-col gap-3 rounded-md border p-3 md:grid md:grid-cols-[2fr_1fr_1.5fr_2fr] md:items-center md:gap-2 md:border-0 md:p-0"
              >
                <div className="flex items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback>{initials(participant.userName)}</AvatarFallback>
                  </Avatar>
                  <Label className="text-sm font-medium">{participant.userName ?? participant.userId}</Label>
                </div>
                <AttendanceToggle
                  value={participant.attended}
                  onChange={(v) => form.setValue(`participants.${idx}.attended`, v, { shouldDirty: true })}
                  hasMedicalConflict={participant.hasMedicalConflict}
                />
                <StarRatingInput
                  value={participant.qualityScore}
                  onChange={(v) => form.setValue(`participants.${idx}.qualityScore`, v, { shouldDirty: true })}
                />
                <FeedbackTextarea
                  value={participant.feedbackText}
                  onChange={(v) => form.setValue(`participants.${idx}.feedbackText`, v, { shouldDirty: true })}
                  ariaLabel={t('column.feedback')}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
      {/* Sticky bottom Save (UI-SPEC §Mobile Strategy — Save button row). */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background p-4 md:static md:mx-0 md:border-0 md:p-0">
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {tCommon('loading')}
              </>
            ) : (
              t('save')
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
