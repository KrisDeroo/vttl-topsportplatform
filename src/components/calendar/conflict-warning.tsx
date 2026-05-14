/**
 * <ConflictWarning> — inline Alert rendered above the submit button in
 * <EventCreateSheet> / <EventEditSheet> when the server returns a CONFLICT
 * error (CAL-07 Surface 1).
 *
 * Body template (D-57b — participant-first):
 *   nl: **{participant}** is al geboekt voor {detail} {start}–{end}. Toch opslaan?
 *
 * Where {detail} is one of:
 *   detailMode='full'     → **{title}** ({typeLabel})
 *   detailMode='redacted' → een **{typeLabel}**
 *
 * Rendering safety (threat T-03-36):
 *   We do NOT use dangerouslySetInnerHTML. Instead we split the message
 *   around the markdown `**bold**` markers and render the bold chunks as
 *   <strong> JSX. Any HTML in the input strings (participant / title /
 *   typeLabel) renders as text — React escapes by default.
 *
 *   The participant + title + typeLabel values flow from server-side
 *   redactConflict() which sources them from DB columns (text NOT NULL on
 *   players.first_name etc.). Defense-in-depth: even if a future change
 *   made the inputs untrusted, the renderer cannot inject HTML.
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Conflict Detection
 *            Surface 1 (lines 436-444)
 *            .planning/phases/03-kalender/03-CONTEXT.md D-57b
 */
'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { RedactedConflict } from '@/lib/calendar/conflicts';

interface Props {
  conflicts: ReadonlyArray<RedactedConflict>;
  onSaveAnyway: () => void;
  onAdjustTime: () => void;
  /** Disables both buttons while a re-submit is in flight. */
  pending?: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function fmtTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Render a string with `**bold**` markdown by splitting around the markers
 * and wrapping bold runs in <strong>. Returns a flat ReactNode list.
 *
 * Example: "Hello **world** today" →
 *          ["Hello ", <strong key=1>world</strong>, " today"]
 *
 * No HTML interpretation — any literal `<…>` in input renders as text.
 */
function renderMarkdownBold(s: string): ReactNode[] {
  // Regex captures bold spans `**…**`. Split yields alternating
  // [plain, bold, plain, bold, …] chunks.
  const parts = s.split(/\*\*(.+?)\*\*/g);
  return parts.map((chunk, i) =>
    i % 2 === 0 ? (
      <span key={i}>{chunk}</span>
    ) : (
      <strong key={i}>{chunk}</strong>
    ),
  );
}

export function ConflictWarning({
  conflicts,
  onSaveAnyway,
  onAdjustTime,
  pending = false,
}: Props) {
  const t = useTranslations('calendar.conflict');
  const tLookup = useTranslations('lookup.eventType');
  if (conflicts.length === 0) return null;

  const first = conflicts[0];
  if (!first) return null;

  const typeLabel = tLookup(first.typeCode);
  // D-57b detail composition — markdown `**bold**` placeholders kept intact.
  const detail =
    first.detailMode === 'full' && first.title
      ? t('detailFull', { title: first.title, typeLabel })
      : t('detailRedacted', { typeLabel });

  const start =
    first.startsAt instanceof Date ? first.startsAt : new Date(first.startsAt);
  const end =
    first.endsAt instanceof Date ? first.endsAt : new Date(first.endsAt);

  const body = t('body', {
    participant: first.participant,
    detail,
    start: fmtTime(start),
    end: fmtTime(end),
  });

  return (
    <Alert>
      <AlertTriangle />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>
        <div className="text-sm leading-relaxed">
          {renderMarkdownBold(body)}
        </div>
        {conflicts.length > 1 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t('extra', { n: conflicts.length - 1 })}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onSaveAnyway}
            disabled={pending}
          >
            {t('saveAnyway')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAdjustTime}
            disabled={pending}
          >
            {t('adjustTime')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
