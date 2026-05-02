'use client';

/**
 * <ReConsentBanner> — full-screen blocking banner for D-07 re-consent.
 *
 * Shown when `requireCurrentConsent` middleware (Plan 11) throws
 * `re_consent_required` — i.e. the user has no active row at the
 * `CURRENT_POLICY.operational.version` (legal text was bumped, or this is
 * a new account that hasn't completed the consent step yet).
 *
 * The banner overlays the entire viewport (`fixed inset-0 z-50 bg-white`)
 * and renders a `<ConsentStep>` for the operational category. On accept,
 * we POST to `/api/trpc/consent.give` directly via the fetch API — Plan
 * 15 ships the typed `@/lib/trpc-client` consumer that lets feature
 * components use `trpc.consent.give.useMutation()`. Until Plan 15 lands
 * we bypass the typed client (the request shape is the documented tRPC
 * batch JSON contract) so this banner is functional from Phase 1 day-1
 * without depending on Plan 15.
 *
 * `onComplete` is invoked after a successful consent.give response; the
 * caller (top-level layout in Plan 15) hides the banner and triggers a
 * router refresh so the next protected request passes the middleware
 * check.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal so screen readers treat it as blocking.
 *   - The single Accept button is keyboard-reachable; the consent text
 *     itself is scrollable inside the ConsentStep article.
 *
 * Reference: .planning/phases/01-fundament/01-12-PLAN.md Task 2;
 *            src/server/trpc/middleware/requireConsent.ts (the gate);
 *            src/components/consent/consent-step.tsx (UI primitive).
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { CURRENT_POLICY } from '@/lib/consent';

import { ConsentStep } from './consent-step';

interface ReConsentBannerProps {
  onComplete: () => void;
}

/**
 * Posts a `consent.give` mutation to the tRPC HTTP transport.
 *
 * Plan 15 will replace this with `trpc.consent.give.useMutation()`
 * (typed client). Until Plan 15 lands, we hand-roll the JSON batch
 * shape that `@trpc/server/adapters/fetch` expects:
 *
 *   POST /api/trpc/consent.give?batch=1
 *   Content-Type: application/json
 *   Body: { "0": { "json": { ...input } } }
 *
 * The response shape on success is `[{ result: { data: { json: row } } }]`.
 */
async function callConsentGive(input: {
  category: 'operational';
  version: string;
  locale: 'nl' | 'en' | 'fr';
  textShown: string;
}): Promise<void> {
  const res = await fetch(`/api/trpc/consent.give?batch=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ '0': { json: input } }),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`consent_give_failed_${res.status}`);
  }
}

export function ReConsentBanner({ onComplete }: ReConsentBannerProps) {
  const t = useTranslations('consent');
  const locale = useLocale() as 'nl' | 'en' | 'fr';
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-white p-6 overflow-auto"
    >
      <h2 className="text-xl font-semibold">{t('reConsentRequired')}</h2>
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <ConsentStep
        category="operational"
        version={CURRENT_POLICY.operational.version}
        required
        onAccept={async (textShown) => {
          setError(null);
          try {
            await callConsentGive({
              category: 'operational',
              version: CURRENT_POLICY.operational.version,
              locale,
              textShown,
            });
            onComplete();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
    </div>
  );
}
