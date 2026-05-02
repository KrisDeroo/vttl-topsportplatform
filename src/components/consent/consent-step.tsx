'use client';

/**
 * <ConsentStep> — single-category consent UI primitive (Plan 12).
 *
 * Renders one consent category as a collapsible block:
 *   - Heading + label from the i18n catalog (e.g.
 *     `consent.operational.label = "Operationele gegevens (verplicht)"`)
 *   - "Toon volledige tekst" toggle revealing the full consent HTML
 *   - Accept button (always visible) + Skip button (only when not
 *     `required`)
 *
 * The consent text is fetched at mount time from `/api/consent-text`
 * (Plan 12 route handler) — NOT inlined into the JSON message catalog.
 * D-04: consent texts are non-translatable boilerplate, owned by the
 * legal team, edited per-locale via the file in `public/locales/`.
 *
 * The accept button passes the FULL fetched text back to `onAccept` so
 * the caller (registration form, re-consent banner) can submit the
 * exact bytes to `consent.give` — that text is then SHA-256-hashed by
 * `recordConsent` (lib/consent.ts) and stored as the legal snapshot.
 *
 * `dangerouslySetInnerHTML` is intentional: the consent HTML is
 * authored by the legal team, committed in `public/locales/`, and
 * served from a same-origin endpoint. It is NOT user-generated. Sandboxed
 * via the parent's `<article>` styles (max-h-64, overflow-auto) so even
 * a layout-breaking template change degrades to a scrolling box, not a
 * page takeover.
 *
 * Reference: .planning/phases/01-fundament/01-12-PLAN.md Task 2;
 *            messages/{nl,en,fr}.json `consent.*` keys.
 */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

interface ConsentStepProps {
  category: 'operational' | 'medical_processing' | 'photo_video';
  version: string;
  required?: boolean;
  /** Receives the EXACT fetched HTML so the caller can submit it to
   *  `consent.give` and the server stores the same bytes the user saw. */
  onAccept: (textShown: string) => Promise<void> | void;
  /** Optional skip handler — only rendered when `required` is false.
   *  Caller decides what skip means (move to next step, mark category
   *  withdrawn, etc.). */
  onSkip?: () => void;
}

/** Maps the snake_case category to the camelCase i18n catalog key. The
 *  message catalog (messages/*.json) uses camelCase by convention. */
function labelKey(
  category: ConsentStepProps['category'],
): 'operational' | 'medicalProcessing' | 'photoVideo' {
  if (category === 'operational') return 'operational';
  if (category === 'medical_processing') return 'medicalProcessing';
  return 'photoVideo';
}

export function ConsentStep({
  category,
  version,
  required = false,
  onAccept,
  onSkip,
}: ConsentStepProps) {
  const t = useTranslations('consent');
  const locale = useLocale();
  const [text, setText] = useState<string>('');
  const [showFull, setShowFull] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/consent-text?category=${encodeURIComponent(category)}&version=${encodeURIComponent(version)}&locale=${encodeURIComponent(locale)}`,
    )
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`status_${r.status}`))))
      .then((t2) => {
        if (!cancelled) setText(t2);
      })
      .catch(() => {
        // Failure to load consent text leaves the accept button disabled
        // (text is empty) — the user cannot proceed without seeing the
        // contract. The error is intentionally swallowed at the UI; the
        // server logs the 404/500 from `/api/consent-text` separately.
      });
    return () => {
      cancelled = true;
    };
  }, [category, version, locale]);

  const handleAccept = async () => {
    if (!text) return;
    setLoading(true);
    try {
      await onAccept(text);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="border rounded-md p-4 my-3">
      <h3 className="font-medium">{t(`${labelKey(category)}.label`)}</h3>
      <button
        type="button"
        onClick={() => setShowFull((v) => !v)}
        className="text-sm text-blue-600 mt-2"
      >
        {t('showFullText')}
      </button>
      {showFull && (
        <article
          className="mt-3 max-h-64 overflow-auto text-sm prose prose-sm"
          // The consent HTML is authored, committed, and served from
          // same-origin /api/consent-text — not user-generated.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: text }}
        />
      )}
      <div className="flex gap-2 mt-3">
        <Button
          type="button"
          disabled={loading || !text}
          onClick={handleAccept}
        >
          {t('submit')}
        </Button>
        {!required && onSkip && (
          <Button type="button" variant="outline" onClick={onSkip}>
            {t('withdraw')}
          </Button>
        )}
      </div>
    </section>
  );
}
