/**
 * /[locale]/(auth)/re-auth — re-authentication landing (Plan 15 Task 2).
 *
 * Reached when a `sensitiveProcedure` mutation throws FORBIDDEN
 * `re_auth_required` (SEC-03 — caller's session is older than 1h
 * `freshAge`). Currently the page is a chrome stub: it shows the login
 * form copy and instructs the user to re-enter their password. Better
 * Auth bumps `session.freshUntil` on a successful login, after which
 * the user can return to the original action.
 *
 * Phase 1 commits the URL anchor + chrome only — Phase 7 wires the
 * actual password-only re-auth form (Better Auth supports a "re-verify"
 * mode that issues a new fresh session without the full sign-in
 * round-trip). Until then the operator can sign in normally; their
 * existing session stays valid because Better Auth's freshAge is a
 * window on the existing session, not a separate session.
 *
 * Reference: .planning/phases/01-fundament/01-15-PLAN.md Task 2
 *            src/server/auth/auth.ts (session.freshAge = 1h)
 */
import { getTranslations } from 'next-intl/server';

export default async function ReAuthPage() {
  const t = await getTranslations('auth.login');
  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mt-2">
        {t('forgot')}
      </p>
      {/* Phase 7: re-auth form (email pre-filled from session, password
          input only) submitting to Better Auth's re-verify endpoint. */}
    </main>
  );
}
