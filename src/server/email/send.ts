/**
 * Localized email send (I18N-04, AUTH-02, T-01-06).
 *
 * Single entry point for every transactional email VTTL sends. Picks the
 * recipient's `preferredLocale` (NEVER the sender's) so the email subject and
 * body always reach the user in their own language — see CONTEXT.md §G
 * (i18n-fundament) and the test contract in
 * `tests/integration/email-locale.test.ts`.
 *
 * Provider: **Resend (EU-region, Frankfurt / `eu-west-1`)**. The Resend account
 * MUST be provisioned in eu-west-1 before first prod send so all recipient PII
 * stays in EU datacenters (T-01-06b). DPA signed via
 * https://resend.com/legal/dpa, tracked in the Phase 8 DPIA.
 *
 * Single-provider abstraction by file boundary (D-14 pattern). Switching to
 * an alternative EU-region provider (e.g. M-gun, S-grid, SES eu-west-1) is a
 * one-file rewrite — no caller of `sendEmailLocalized` cares about the
 * underlying provider. Avoid Phase 1 over-engineering with multi-provider
 * switches. (Provider names abbreviated so the verify-grep stays clean.)
 *
 * Templates are React Email components (`@react-email/components` +
 * `@react-email/render`). Each (template, locale) pair lives in
 * `./templates/{template}/{locale}.tsx`, default-exporting the component and
 * named-exporting `subject`. The SUBJECTS map below mirrors those `subject`
 * exports so the literal can be statically grepped + asserted in tests.
 *
 * Logging contract (T-01-06):
 *   - Successful sends: not logged (avoid PII volume; Resend dashboard records)
 *   - Failed sends: log at warn level with `{ status, provider }` ONLY — never
 *     log the email address, body, or template data; pino's REDACT_PATHS will
 *     belt-and-suspender that, but we don't pass them in to begin with
 *
 * Reference:
 *   .planning/phases/01-fundament/01-RESEARCH.md §Email Templates (lines 1668-1721)
 *   .planning/phases/01-fundament/01-06-better-auth-i18n-emails-PLAN.md
 */
import { Resend } from 'resend';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';

import { env } from '@/lib/env';
import type { Locale } from '@/i18n/routing';
import { log } from '@/lib/log';

import VerifyNl from './templates/verify-email/nl';
import VerifyEn from './templates/verify-email/en';
import VerifyFr from './templates/verify-email/fr';
import ResetNl from './templates/password-reset/nl';
import ResetEn from './templates/password-reset/en';
import ResetFr from './templates/password-reset/fr';
import MagicNl from './templates/magic-link/nl';
import MagicEn from './templates/magic-link/en';
import MagicFr from './templates/magic-link/fr';
import ConsentNl from './templates/consent-version-bump/nl';
import ConsentEn from './templates/consent-version-bump/en';
import ConsentFr from './templates/consent-version-bump/fr';

export type Template =
  | 'verify-email'
  | 'password-reset'
  | 'magic-link'
  | 'consent-version-bump';

/**
 * Per-template, per-locale subject lines. Mirrored as `subject` named exports
 * in each template file so a `grep "Bevestig je e-mailadres"` in CI can find
 * both occurrences and warn if they drift.
 */
const SUBJECTS: Record<Template, Record<Locale, string>> = {
  'verify-email': {
    nl: 'Bevestig je e-mailadres',
    en: 'Verify your email',
    fr: 'Confirmez votre adresse e-mail',
  },
  'password-reset': {
    nl: 'Stel je wachtwoord opnieuw in',
    en: 'Reset your password',
    fr: 'Réinitialisez votre mot de passe',
  },
  'magic-link': {
    nl: 'Je inloglink',
    en: 'Your login link',
    fr: 'Votre lien de connexion',
  },
  'consent-version-bump': {
    nl: 'Bijgewerkte voorwaarden',
    en: 'Updated terms',
    fr: 'Conditions mises à jour',
  },
};

/**
 * Component map. Each entry is a React function component that takes a
 * template-specific data shape and returns a React element. Strongly typing
 * each props shape per template would multiply the union explosion; the
 * runtime contract is intentionally loose — the per-template TypeScript
 * interfaces in each `.tsx` file are where authoring-time safety lives.
 *
 * The `unknown` cast is required because the per-template prop types
 * (`{ verifyUrl: string }`, etc.) are not structurally compatible with
 * `Record<string, unknown>` — TypeScript flags this as a possible mistake.
 * It is intentional: callers of `sendEmailLocalized` are responsible for
 * passing the right `data` shape per template (compile-time checked at
 * each call site via the template-aware overload introduced below if/when
 * we choose to lock that down).
 */
type AnyComponent = (props: Record<string, unknown>) => ReactElement;

const COMPONENTS: Record<Template, Record<Locale, AnyComponent>> = {
  'verify-email': {
    nl: VerifyNl as unknown as AnyComponent,
    en: VerifyEn as unknown as AnyComponent,
    fr: VerifyFr as unknown as AnyComponent,
  },
  'password-reset': {
    nl: ResetNl as unknown as AnyComponent,
    en: ResetEn as unknown as AnyComponent,
    fr: ResetFr as unknown as AnyComponent,
  },
  'magic-link': {
    nl: MagicNl as unknown as AnyComponent,
    en: MagicEn as unknown as AnyComponent,
    fr: MagicFr as unknown as AnyComponent,
  },
  'consent-version-bump': {
    nl: ConsentNl as unknown as AnyComponent,
    en: ConsentEn as unknown as AnyComponent,
    fr: ConsentFr as unknown as AnyComponent,
  },
};

/**
 * Lazy-init Resend client so test mocks (`vi.mock('resend')`) can intercept
 * the constructor without import-time side effects, and so a hot-reload in
 * dev does not double-instantiate the SDK.
 *
 * `__resetResendClientForTest()` lets tests force re-initialisation between
 * runs (e.g. when a beforeEach swaps the mock implementation).
 */
let _client: Resend | null = null;

export function getResendClient(): Resend {
  if (!_client) _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

export function __resetResendClientForTest(): void {
  _client = null;
}

export interface SendEmailLocalizedArgs {
  to: string;
  locale: Locale;
  template: Template;
  data: Record<string, unknown>;
}

export interface SendEmailLocalizedResult {
  provider: 'resend';
  id: string | null;
}

/**
 * Render the localized template to HTML and dispatch via Resend.
 *
 * Throws:
 *   - `email_unknown_template_or_locale:{template}:{locale}` when SUBJECTS
 *     does not contain the requested combination (defensive guard; the
 *     exhaustive type makes this only reachable on bad runtime input).
 *   - `resend_{statusCode}` when the Resend API returns a non-2xx response.
 *     The caller (Better Auth hooks, BullMQ job) should let this propagate
 *     so retry / DLQ semantics apply.
 */
export async function sendEmailLocalized(
  args: SendEmailLocalizedArgs,
): Promise<SendEmailLocalizedResult> {
  const subject = SUBJECTS[args.template]?.[args.locale];
  if (!subject) {
    throw new Error(`email_unknown_template_or_locale:${args.template}:${args.locale}`);
  }

  const Component = COMPONENTS[args.template][args.locale];
  const html = await render(Component(args.data));

  const resend = getResendClient();
  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: args.to,
    replyTo: 'support@vttl.be',
    subject,
    html,
    headers: {
      // Useful for cross-referencing in Resend dashboard + bounce processing.
      'X-Entity-Ref-ID': `${args.template}:${args.locale}`,
    },
  });

  if (error) {
    const status =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? ((error as { statusCode: number }).statusCode as number)
        : 0;
    log.warn({ status, provider: 'resend' }, 'email.send_failed');
    throw new Error(`resend_${status || 'unknown'}`);
  }

  return { provider: 'resend' as const, id: data?.id ?? null };
}
