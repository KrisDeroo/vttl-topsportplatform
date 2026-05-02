/**
 * /[locale]/register — multi-step register shell (Plan 12 Task 2 skeleton).
 *
 * Phase 1 ships the bare scaffold: page chrome + minor-warning copy +
 * client-side `<RegisterForm>` that owns the step state machine. The
 * full credentials → consents → pending UI lands in Plan 15 (TD admin
 * UI / user-flow polish); Phase 1's job is to put the consent flow
 * primitives (`<ConsentStep>`, `recordConsent`, `canActivate`) in place
 * so the multi-step UI can be wired without further backend changes.
 *
 * The minor-warning copy is sourced from the i18n catalog
 * (`auth.register.minorWarning`) so all three locales display:
 *   - nl: "Voor spelers jonger dan 16 jaar moet een ouder/voogd
 *         toestemming geven."
 *   - en: "Players under 16 require a parent/guardian consent."
 *   - fr: "Les joueurs de moins de 16 ans nécessitent le consentement
 *         d'un parent/tuteur."
 *
 * Server Component by default — `getTranslations` runs on the server,
 * so the static copy is rendered in the locale-correct language without
 * shipping the message catalog to the browser. The interactive form
 * below ("use client" inside RegisterForm) hydrates on demand.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md
 *            §Registration flow (lines 1750-1759);
 *            messages/{nl,en,fr}.json `auth.register.*`.
 */
import { getTranslations } from 'next-intl/server';

import { RegisterForm } from '@/components/auth/register-form';

export default async function RegisterPage() {
  const t = await getTranslations('auth.register');
  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('minorWarning')}</p>
      <RegisterForm />
    </main>
  );
}
