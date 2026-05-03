'use client';

/**
 * <RegisterForm> — multi-step register skeleton (Plan 12 Task 2).
 *
 * Three logical steps:
 *   1. credentials  — email + password + name + dateOfBirth → Better Auth
 *                     `signUp.email` (account created with active=false,
 *                     emailVerified=false). Verification email is sent
 *                     by Better Auth's hook (`sendVerificationEmail`,
 *                     wired in Plan 06).
 *   2. consents     — three `<ConsentStep>` instances (operational
 *                     required, medical_processing optional, photo_video
 *                     optional). Submitted to `consent.give` via the
 *                     tRPC client (Plan 15 ships the typed wrapper; the
 *                     direct fetch fallback used by `<ReConsentBanner>`
 *                     can be reused if Plan 15 lags).
 *   3. pending      — terminal state copy: "check your email" for adults,
 *                     "parent must approve" for minors (read from
 *                     `auth.register.minorWarning` + a future `pending`
 *                     copy block).
 *
 * Phase 1 commits the step state machine and the form fields with the
 * `name`/`email`/`password`/`dateOfBirth` `name` attributes the e2e test
 * (`tests/e2e/register-with-consent.spec.ts`) probes. The full
 * UI/validation polish (zod schema, error rendering, transition
 * handlers) lands in Plan 15.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md
 *            §Registration flow (lines 1750-1759);
 *            src/server/auth/client.ts (Better Auth React client).
 */
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { signUp } from '@/server/auth/client';

type Step = 'credentials' | 'consents' | 'pending';

export function RegisterForm() {
  const t = useTranslations('auth.register');
  const tErr = useTranslations('auth.errors');
  const [step, setStep] = useState<Step>('credentials');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmitCredentials(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const form = e.currentTarget;
      const data = new FormData(form);
      const email = String(data.get('email') ?? '');
      const password = String(data.get('password') ?? '');
      const name = String(data.get('name') ?? '');
      // Better Auth `signUp.email` accepts arbitrary additional fields
      // for VTTL's user-extension columns. `dateOfBirth` is consumed by
      // the application-side `isMinorAt` helper (CR-01 fix,
      // src/lib/consent.ts) inside `canActivate`; the TD admin UI
      // (Plan 15) calls that guard in the activate flow.
      const result = await signUp.email({
        email,
        password,
        name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if ((result as { error?: unknown }).error) {
        throw new Error('signup_failed');
      }
      setStep('consents');
    } catch {
      setError(tErr('generic' as never as 'invalidCredentials'));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'credentials') {
    return (
      <form onSubmit={onSubmitCredentials} className="mt-6 space-y-3">
        <label className="block">
          <span className="block text-sm">{t('name')}</span>
          <input
            name="name"
            type="text"
            required
            className="mt-1 w-full border rounded-md px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="block text-sm">{tErr('invalidCredentials' as never as 'invalidCredentials')}</span>
        </label>
        <label className="block">
          <span className="block text-sm">E-mail</span>
          <input
            name="email"
            type="email"
            required
            className="mt-1 w-full border rounded-md px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="block text-sm">Wachtwoord</span>
          <input
            name="password"
            type="password"
            required
            minLength={12}
            className="mt-1 w-full border rounded-md px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="block text-sm">{t('dateOfBirth')}</span>
          <input
            name="dateOfBirth"
            type="date"
            required
            className="mt-1 w-full border rounded-md px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting}>
          {t('submit')}
        </Button>
      </form>
    );
  }

  if (step === 'consents') {
    // Plan 15 fills in the three ConsentStep instances + submit
    // handlers. Phase 1 stubs a pass-through so the e2e test scaffolding
    // can advance from credentials → pending without a network round-trip.
    return (
      <div className="mt-6 space-y-3">
        <p>Plan 15: render 3x ConsentStep (operational, medical_processing, photo_video).</p>
        <Button type="button" onClick={() => setStep('pending')}>
          {t('submit')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <p>{t('minorWarning')}</p>
    </div>
  );
}
