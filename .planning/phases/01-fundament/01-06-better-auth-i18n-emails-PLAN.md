---
phase: 01-fundament
plan: 06
type: execute
wave: 4
depends_on: [05, 07]
files_modified:
  - src/server/email/send.ts
  - src/server/email/templates/verify-email/nl.tsx
  - src/server/email/templates/verify-email/en.tsx
  - src/server/email/templates/verify-email/fr.tsx
  - src/server/email/templates/password-reset/nl.tsx
  - src/server/email/templates/password-reset/en.tsx
  - src/server/email/templates/password-reset/fr.tsx
  - src/server/email/templates/magic-link/nl.tsx
  - src/server/email/templates/magic-link/en.tsx
  - src/server/email/templates/magic-link/fr.tsx
  - src/server/email/templates/consent-version-bump/nl.tsx
  - src/server/email/templates/consent-version-bump/en.tsx
  - src/server/email/templates/consent-version-bump/fr.tsx
  - src/server/auth/auth.ts
autonomous: true
requirements:
  - AUTH-02
  - I18N-04
threat_refs:
  - T-01-06
tags:
  - phase-1
  - i18n
  - email
  - better-auth

must_haves:
  truths:
    - "sendEmailLocalized({ to, locale, template, data }) selects the recipient's locale (NOT sender's) for subject + body — I18N-04"
    - "Resend (EU-region) is the email provider; abstracted behind src/server/email/send.ts so a swap to Mailgun/SendGrid/SES is a 1-file change"
    - "12 template files: 4 templates × 3 locales (verify-email, password-reset, magic-link, consent-version-bump) as React Email components"
    - "Better Auth sendResetPassword + sendVerificationEmail hooks now CALL sendEmailLocalized with user.preferredLocale (replaces Plan 05 stubs)"
    - "tests/integration/email-locale.test.ts (Plan 17) is now GREEN — assertion strings match the 3 subjects per template"
  artifacts:
    - path: "src/server/email/send.ts"
      provides: "sendEmailLocalized backed by Resend SDK"
      exports: ["sendEmailLocalized"]
    - path: "src/server/email/templates/verify-email/nl.tsx"
      provides: "React Email component for Dutch verify-email; default-export the component, named-export `subject`"
      exports: ["default", "subject"]
  key_links:
    - from: "src/server/auth/auth.ts"
      to: "src/server/email/send.ts"
      via: "sendResetPassword/sendVerificationEmail hooks call sendEmailLocalized"
      pattern: "sendEmailLocalized"
---

<objective>
Localize Better Auth's transactional emails. Plan 05 stubbed the hooks; this plan replaces them with `sendEmailLocalized()` backed by Resend (EU-region). 12 templates total (4 × 3 locales) implemented as React Email components. Recipient's `preferredLocale` (NOT sender's) determines which template is rendered (I18N-04).

Provider is wrapped behind `src/server/email/send.ts` — switching to Mailgun, SendGrid or SES later is a single-file change (D-14 abstraction pattern, mirrored from `lib/cache.ts`).

Output: working email pipeline; Plan 17's `tests/integration/email-locale.test.ts` GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: send.ts (Resend EU) + 12 React Email template files</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Email Templates — subject map + send pattern (provider lines now read Resend; see overview)
    - .planning/phases/01-fundament/01-CONTEXT.md §B (D-04..07 — consent-version-bump template uses these)
    - tests/integration/email-locale.test.ts (Plan 17 — RED until this plan; expected subjects in all 3 locales)
    - https://resend.com/docs/send-with-nextjs and https://react.email/docs/components/html — Resend SDK + React Email reference
  </read_first>
  <files>
    src/server/email/send.ts
    src/server/email/templates/verify-email/nl.tsx
    src/server/email/templates/verify-email/en.tsx
    src/server/email/templates/verify-email/fr.tsx
    src/server/email/templates/password-reset/nl.tsx
    src/server/email/templates/password-reset/en.tsx
    src/server/email/templates/password-reset/fr.tsx
    src/server/email/templates/magic-link/nl.tsx
    src/server/email/templates/magic-link/en.tsx
    src/server/email/templates/magic-link/fr.tsx
    src/server/email/templates/consent-version-bump/nl.tsx
    src/server/email/templates/consent-version-bump/en.tsx
    src/server/email/templates/consent-version-bump/fr.tsx
  </files>
  <behavior>
    - Test 1 (integration): sendEmailLocalized({ to, locale: 'nl', template: 'verify-email', data: { verifyUrl } }) calls Resend with subject "Bevestig je e-mailadres"
    - Test 2 (integration): same with locale: 'en' → subject "Verify your email"
    - Test 3 (integration): same with locale: 'fr' → subject "Confirmez votre adresse e-mail"
    - Test 4 (integration): missing template/locale combo throws "email_unknown_template_or_locale:..."
    - Test 5 (integration): when Resend SDK returns 4xx/5xx, sendEmailLocalized throws "resend_<status>" and `email.send_failed` is logged at warn level (provider: 'resend')
  </behavior>
  <action>
    Install dependencies (Plan 01's package.json picks these up; Plan 06 just adds them):
    ```
    npm i resend @react-email/components @react-email/render
    npm i -D @types/react
    ```

    Create `src/server/email/send.ts`:
    ```ts
    import { Resend } from 'resend';
    import { render } from '@react-email/render';
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

    export type Template = 'verify-email' | 'password-reset' | 'magic-link' | 'consent-version-bump';

    const SUBJECTS: Record<Template, Record<Locale, string>> = {
      'verify-email':         { nl: 'Bevestig je e-mailadres',           en: 'Verify your email',          fr: 'Confirmez votre adresse e-mail' },
      'password-reset':       { nl: 'Stel je wachtwoord opnieuw in',     en: 'Reset your password',        fr: 'Réinitialisez votre mot de passe' },
      'magic-link':           { nl: 'Je inloglink',                      en: 'Your login link',            fr: 'Votre lien de connexion' },
      'consent-version-bump': { nl: 'Bijgewerkte voorwaarden',           en: 'Updated terms',              fr: 'Conditions mises à jour' },
    };

    const COMPONENTS = {
      'verify-email':         { nl: VerifyNl,  en: VerifyEn,  fr: VerifyFr  },
      'password-reset':       { nl: ResetNl,   en: ResetEn,   fr: ResetFr   },
      'magic-link':           { nl: MagicNl,   en: MagicEn,   fr: MagicFr   },
      'consent-version-bump': { nl: ConsentNl, en: ConsentEn, fr: ConsentFr },
    } as const;

    // Lazy-init so test mocks can intercept the constructor.
    let _client: Resend | null = null;
    export function getResendClient(): Resend {
      if (!_client) _client = new Resend(env.RESEND_API_KEY);
      return _client;
    }
    export function __resetResendClientForTest() { _client = null; }

    export async function sendEmailLocalized(args: {
      to: string;
      locale: Locale;
      template: Template;
      data: Record<string, unknown>;
    }) {
      const subject = SUBJECTS[args.template]?.[args.locale];
      if (!subject) throw new Error(`email_unknown_template_or_locale:${args.template}:${args.locale}`);

      const Component = COMPONENTS[args.template][args.locale] as (props: any) => JSX.Element;
      const html = await render(Component(args.data as any));

      const resend = getResendClient();
      const { data, error } = await resend.emails.send({
        from: env.EMAIL_FROM,
        to: args.to,
        replyTo: 'support@vttl.be',
        subject,
        html,
        headers: { 'X-Entity-Ref-ID': `${args.template}:${args.locale}` },
      });

      if (error) {
        log.warn({ status: (error as any).statusCode ?? 0, provider: 'resend' }, 'email.send_failed');
        throw new Error(`resend_${(error as any).statusCode ?? 'unknown'}`);
      }
      return { provider: 'resend' as const, id: data?.id ?? null };
    }
    ```

    Notes:
    - **EU-region**: account must be provisioned with `eu-west-1` / Frankfurt (verify in Resend dashboard before first prod send). Resend SDK call signature is region-agnostic; the API key is bound to the region of the account.
    - **No fallback provider** in Phase 1 — abstraction is at the file boundary (`src/server/email/send.ts`); switching to Mailgun/SendGrid/SES is a one-file rewrite. Avoid Phase 1 over-engineering with a multi-provider switch.

    Create 12 React Email template files. Each exports a default React component AND a named `subject` constant (mirrors what's in SUBJECTS for static analysis). Example for `src/server/email/templates/verify-email/nl.tsx`:
    ```tsx
    import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from '@react-email/components';

    export const subject = 'Bevestig je e-mailadres';

    interface Props { verifyUrl: string; }

    export default function VerifyEmailNl({ verifyUrl }: Props) {
      return (
        <Html lang="nl">
          <Head />
          <Preview>Bevestig je e-mailadres voor VTTL Topsport</Preview>
          <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
            <Container>
              <Heading style={{ color: '#0066cc' }}>Bevestig je e-mailadres</Heading>
              <Text>Welkom bij VTTL Topsport. Klik op de knop om je e-mailadres te bevestigen.</Text>
              <Section style={{ margin: '24px 0' }}>
                <Link
                  href={verifyUrl}
                  style={{
                    background: '#0066cc',
                    color: '#fff',
                    padding: '12px 24px',
                    textDecoration: 'none',
                    borderRadius: 4,
                    display: 'inline-block',
                  }}
                >
                  Bevestig e-mail
                </Link>
              </Section>
              <Text style={{ color: '#666', fontSize: 14 }}>Of kopieer deze link: {verifyUrl}</Text>
              <Text style={{ color: '#666', fontSize: 14 }}>Deze link is 24 uur geldig.</Text>
              <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
              <Text style={{ color: '#999', fontSize: 12 }}>VTTL — Vlaamse Tafeltennis Liga · vttl.be</Text>
            </Container>
          </Body>
        </Html>
      );
    }
    ```

    Mirror the same component shape for `en.tsx` (heading "Verify your email", body English) and `fr.tsx` (heading "Confirmez votre adresse e-mail", body French).

    Repeat the structure for the other three templates × 3 locales = 9 more files. Data shapes per template:
    - verify-email: `{ verifyUrl: string }`
    - password-reset: `{ resetUrl: string; expiresInMinutes: number }`
    - magic-link: `{ loginUrl: string; expiresInMinutes: number }`
    - consent-version-bump: `{ oldVersion: string; newVersion: string; category: string }`

    UPDATE `src/server/auth/auth.ts` — replace the Plan 05 stubs with real calls:
    ```ts
    import { sendEmailLocalized } from '@/server/email/send';

    // ... inside emailAndPassword:
        sendResetPassword: async ({ user, url }) => {
          await sendEmailLocalized({
            to: user.email,
            locale: ((user as any).preferredLocale ?? 'nl') as 'nl' | 'en' | 'fr',
            template: 'password-reset',
            data: { resetUrl: url, expiresInMinutes: 60 },
          });
        },

    // ... inside emailVerification:
        sendVerificationEmail: async ({ user, url }) => {
          await sendEmailLocalized({
            to: user.email,
            locale: ((user as any).preferredLocale ?? 'nl') as 'nl' | 'en' | 'fr',
            template: 'verify-email',
            data: { verifyUrl: url },
          });
        },
    ```
    Remove the `sendResetPasswordStub` and `sendVerificationEmailStub` placeholders (delete the unused functions).

    Verify `tests/integration/email-locale.test.ts` (created in Plan 17) is now able to import `@/server/email/send` and asserts the 3 expected subjects.
  </action>
  <verify>
    <automated>test -f src/server/email/send.ts && [ $(ls src/server/email/templates/*/*.tsx 2>/dev/null | wc -l) -eq 12 ] && grep -q "Bevestig je e-mailadres" src/server/email/send.ts && grep -q "Verify your email" src/server/email/send.ts && grep -q "Confirmez votre adresse e-mail" src/server/email/send.ts && grep -q "from 'resend'" src/server/email/send.ts && grep -q "@react-email/render" src/server/email/send.ts && ! grep -q "mailgun\|sendgrid\|MAILGUN\|SENDGRID" src/server/email/send.ts && grep -q "Bevestig je e-mailadres" src/server/email/templates/verify-email/nl.tsx && grep -q "Verify your email" src/server/email/templates/verify-email/en.tsx && grep -q "Confirmez votre adresse e-mail" src/server/email/templates/verify-email/fr.tsx && grep -q "sendEmailLocalized" src/server/auth/auth.ts && ! grep -q "sendResetPasswordStub" src/server/auth/auth.ts && npx vitest run tests/integration/email-locale.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/email/send.ts` exports `sendEmailLocalized` with subject map for all 4 templates × 3 locales
    - `send.ts` imports `Resend` from `'resend'` and `render` from `'@react-email/render'`
    - `send.ts` does NOT reference Mailgun, SendGrid, or any other provider (single-provider cleanly abstracted)
    - 12 template files exist (verify-email, password-reset, magic-link, consent-version-bump × nl/en/fr) as React Email components with default export + named `subject` const
    - `auth.ts` no longer references stubs; calls `sendEmailLocalized` with `user.preferredLocale`
    - `tests/integration/email-locale.test.ts` passes for all 3 locales (mocks `Resend` constructor via `__resetResendClientForTest` + module mock)
    - Failure path: when mocked Resend returns `{ error: { statusCode: 422 } }`, `sendEmailLocalized` throws `resend_422`
  </acceptance_criteria>
  <done>Email pipeline localized via Resend; recipient locale drives template selection.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| App ↔ Resend EU | API key in env (Coolify secret); HTTPS via Resend SDK; account region locked to eu-west-1 / Frankfurt |
| User input ↔ Email body | Variables interpolated via React component props — XSS handled by React's escaping; URLs come from Better Auth (not user-controlled) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-06 | Information Disclosure | Email content in logs | mitigate | pino REDACT_PATHS strips `*.email`; `email.send_failed` log entries omit body content; only status code + provider name logged |
| T-01-06b | Information Disclosure | Resend account region drift | accept | Account is provisioned in eu-west-1 / Frankfurt before first prod send; documented in DPIA (Phase 8); recipient PII never leaves EU |
</threat_model>

<verification>
- 12 React Email template files exist
- `src/server/email/send.ts` imports `Resend` and `@react-email/render`; contains no Mailgun/SendGrid references
- `npx tsc --noEmit` exits 0
- `tests/integration/email-locale.test.ts` GREEN with the Resend SDK mocked (no real Resend calls in tests)
</verification>

<success_criteria>
- 4 templates × 3 locales = 12 files (React Email components)
- Recipient locale (preferredLocale) drives selection (I18N-04)
- Resend (EU-region) is the sole provider; abstraction at `src/server/email/send.ts`
- Better Auth hooks now use `sendEmailLocalized`
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-06-SUMMARY.md` documenting:
- Provider: Resend (EU-region, eu-west-1 / Frankfurt) — verified pre-deploy in Resend dashboard
- DPA signed via [resend.com/legal/dpa](https://resend.com/legal/dpa) — track in Phase 8 DPIA
- DNS records (SPF/DKIM/DMARC for `vttl.be`) NOT yet configured — Phase 8 OPS-11 task
- Note: production-readiness blocked until DNS records on `vttl.be` are live
</output>
