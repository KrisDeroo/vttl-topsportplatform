/**
 * /[locale]/consent — landing page for the post-verification consent
 * step (Plan 12 Task 2 skeleton).
 *
 * After Better Auth's email verification, the user is redirected here to
 * record consent for the three categories (operational required;
 * medical_processing and photo_video optional). The full interactive
 * UI — three `<ConsentStep>` instances submitting to `consent.give` —
 * lands in Plan 15 alongside the typed tRPC client wiring; Phase 1
 * commits the page surface so the URL exists and the layout chrome
 * (locale switcher, title) is consistent across all three locales.
 *
 * Server Component — `getTranslations` runs server-side. The eventual
 * client subtree (consent steps + submit handlers) lives below as a
 * separate "use client" island so the static page chrome is statically
 * rendered.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md
 *            §Registration flow Step 3 (lines 1754-1757);
 *            src/components/consent/consent-step.tsx.
 */
import { getTranslations } from 'next-intl/server';

export default async function ConsentPage() {
  const t = await getTranslations('consent');
  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {/* Plan 15 wires the three <ConsentStep> instances here, each
          calling consent.give via the typed trpc client. The current
          page is the URL anchor + chrome only — `<ReConsentBanner>` is
          the parallel surface that exercises the same primitives for
          mid-session re-consent. */}
    </main>
  );
}
