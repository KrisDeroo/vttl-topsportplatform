/**
 * Landing page — minimal smoke surface for Phase 1.
 *
 * Plan 15 expands this with the actual signed-out / signed-in dashboard.
 * Today the page exists so:
 *   - the locale switcher has a route to render in
 *   - tests/e2e/locale-switcher.spec.ts can navigate to /nl, /en, /fr
 *   - the layout chrome (header + LocaleSwitcher) gets exercised in dev
 */
import { getTranslations } from 'next-intl/server';

export default async function LandingPage() {
  const t = await getTranslations('common');
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">VTTL Topsport</h1>
      <p>{t('loading')}</p>
    </div>
  );
}
