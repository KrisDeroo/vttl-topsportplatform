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
    - "Mailgun EU endpoint https://api.eu.mailgun.net/v3/{domain}/messages used by default; SendGrid fallback when SENDGRID_API_KEY set instead"
    - "12 template files: 4 templates × 3 locales (verify-email, password-reset, magic-link, consent-version-bump)"
    - "Better Auth sendResetPassword + sendVerificationEmail hooks now CALL sendEmailLocalized with user.preferredLocale (replaces Plan 05 stubs)"
    - "tests/integration/email-locale.test.ts (Plan 17) is now GREEN — assertion strings match the 3 subjects per template"
  artifacts:
    - path: "src/server/email/send.ts"
      provides: "sendEmailLocalized + provider abstraction (Mailgun / SendGrid)"
      exports: ["sendEmailLocalized"]
    - path: "src/server/email/templates/verify-email/nl.tsx"
      provides: "render(data) function returning subject+html for Dutch verify-email"
      exports: ["render"]
  key_links:
    - from: "src/server/auth/auth.ts"
      to: "src/server/email/send.ts"
      via: "sendResetPassword/sendVerificationEmail hooks call sendEmailLocalized"
      pattern: "sendEmailLocalized"
---

<objective>
Localize Better Auth's transactional emails. Plan 05 stubbed the hooks; this plan replaces them with `sendEmailLocalized()` against Mailgun EU. 12 templates total (4 × 3 locales). Recipient's `preferredLocale` (NOT sender's) determines which template is rendered (I18N-04).

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
  <name>Task 1: send.ts (Mailgun EU + SendGrid fallback) + 12 template files</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §Email Templates (lines 1670–1726) — exact send pattern + subject map
    - .planning/phases/01-fundament/01-CONTEXT.md §B (D-04..07 — consent-version-bump template uses these)
    - tests/integration/email-locale.test.ts (Plan 17 — RED until this plan; expected subjects in all 3 locales)
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
    - Test 1 (integration): sendEmailLocalized({ to, locale: 'nl', template: 'verify-email', data: { verifyUrl } }) calls Mailgun with subject "Bevestig je e-mailadres"
    - Test 2 (integration): same with locale: 'en' → subject "Verify your email"
    - Test 3 (integration): same with locale: 'fr' → subject "Confirmez votre adresse e-mail"
    - Test 4 (integration): missing template/locale combo throws
  </behavior>
  <action>
    Create `src/server/email/send.ts` per RESEARCH §send.ts (lines 1678–1722) and add SendGrid fallback:
    ```ts
    import { env } from '@/lib/env';
    import type { Locale } from '@/i18n/routing';
    import { log } from '@/lib/log';

    export type Template = 'verify-email' | 'password-reset' | 'magic-link' | 'consent-version-bump';

    const SUBJECTS: Record<Template, Record<Locale, string>> = {
      'verify-email':         { nl: 'Bevestig je e-mailadres',           en: 'Verify your email',          fr: 'Confirmez votre adresse e-mail' },
      'password-reset':       { nl: 'Stel je wachtwoord opnieuw in',     en: 'Reset your password',        fr: 'Réinitialisez votre mot de passe' },
      'magic-link':           { nl: 'Je inloglink',                      en: 'Your login link',            fr: 'Votre lien de connexion' },
      'consent-version-bump': { nl: 'Bijgewerkte voorwaarden',           en: 'Updated terms',              fr: 'Conditions mises à jour' },
    };

    async function renderTemplate(template: Template, locale: Locale, data: Record<string, unknown>) {
      const mod = await import(`./templates/${template}/${locale}`);
      return mod.render(data);
    }

    export async function sendEmailLocalized(args: {
      to: string;
      locale: Locale;
      template: Template;
      data: Record<string, unknown>;
    }) {
      const subject = SUBJECTS[args.template]?.[args.locale];
      if (!subject) throw new Error(`email_unknown_template_or_locale:${args.template}:${args.locale}`);

      const html = await renderTemplate(args.template, args.locale, args.data);

      // Provider selection: Mailgun first, SendGrid fallback
      if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN) {
        return sendViaMailgun({ to: args.to, subject, html });
      }
      if (env.SENDGRID_API_KEY) {
        return sendViaSendGrid({ to: args.to, subject, html });
      }
      throw new Error('email_no_provider_configured');
    }

    async function sendViaMailgun(args: { to: string; subject: string; html: string }) {
      const res = await fetch(`https://api.eu.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          from: 'VTTL Topsport <noreply@vttl.be>',
          to: args.to,
          subject: args.subject,
          html: args.html,
          'h:Reply-To': 'support@vttl.be',
        }),
      });
      if (!res.ok) {
        log.warn({ status: res.status, provider: 'mailgun' }, 'email.send_failed');
        throw new Error(`mailgun_${res.status}`);
      }
      return { provider: 'mailgun' as const, status: res.status };
    }

    async function sendViaSendGrid(args: { to: string; subject: string; html: string }) {
      const res = await fetch('https://api.eu.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: args.to }] }],
          from: { email: 'noreply@vttl.be', name: 'VTTL Topsport' },
          subject: args.subject,
          content: [{ type: 'text/html', value: args.html }],
          reply_to: { email: 'support@vttl.be' },
        }),
      });
      if (!res.ok) {
        log.warn({ status: res.status, provider: 'sendgrid' }, 'email.send_failed');
        throw new Error(`sendgrid_${res.status}`);
      }
      return { provider: 'sendgrid' as const, status: res.status };
    }
    ```

    Create 12 template files. Each exports `render(data)` returning HTML string. Templates are SIMPLE strings (Phase 1) — Phase 8 may move to react-email. Example for `src/server/email/templates/verify-email/nl.tsx`:
    ```ts
    interface Data { verifyUrl: string; }
    export function render(data: Data | Record<string, unknown>): string {
      const d = data as Data;
      return `
        <!doctype html>
        <html lang="nl">
        <body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a">
          <h1 style="color:#0066cc">Bevestig je e-mailadres</h1>
          <p>Welkom bij VTTL Topsport. Klik op de knop om je e-mailadres te bevestigen.</p>
          <p style="margin:24px 0">
            <a href="${d.verifyUrl}" style="background:#0066cc;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Bevestig e-mail</a>
          </p>
          <p style="color:#666;font-size:14px">Of kopieer deze link: ${d.verifyUrl}</p>
          <p style="color:#666;font-size:14px">Deze link is 24 uur geldig.</p>
          <hr style="margin:32px 0;border:0;border-top:1px solid #eee">
          <p style="color:#999;font-size:12px">VTTL — Vlaamse Tafeltennis Liga · vttl.be</p>
        </body>
        </html>
      `;
    }
    ```

    Mirror for en (heading "Verify your email", body in English) and fr (heading "Confirmez votre adresse e-mail", body in French).

    Repeat for `password-reset/{nl,en,fr}.tsx`, `magic-link/{nl,en,fr}.tsx`, `consent-version-bump/{nl,en,fr}.tsx`.

    Data shapes per template:
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
    <automated>test -f src/server/email/send.ts && [ $(ls src/server/email/templates/*/*.tsx 2>/dev/null | wc -l) -eq 12 ] && grep -q "Bevestig je e-mailadres" src/server/email/send.ts && grep -q "Verify your email" src/server/email/send.ts && grep -q "Confirmez votre adresse e-mail" src/server/email/send.ts && grep -q "api.eu.mailgun.net" src/server/email/send.ts && grep -q "api.eu.sendgrid.com" src/server/email/send.ts && grep -q "Bevestig je e-mailadres" src/server/email/templates/verify-email/nl.tsx && grep -q "Verify your email" src/server/email/templates/verify-email/en.tsx && grep -q "Confirmez votre adresse e-mail" src/server/email/templates/verify-email/fr.tsx && grep -q "sendEmailLocalized" src/server/auth/auth.ts && ! grep -q "sendResetPasswordStub" src/server/auth/auth.ts && npx vitest run tests/integration/email-locale.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/email/send.ts` exports `sendEmailLocalized` with subject map for all 4 templates × 3 locales
    - 12 template files exist (verify-email, password-reset, magic-link, consent-version-bump × nl/en/fr)
    - Each template exports `render(data)` returning HTML string
    - Mailgun EU endpoint + SendGrid EU fallback both implemented
    - `auth.ts` no longer references stubs; calls `sendEmailLocalized` with `user.preferredLocale`
    - `tests/integration/email-locale.test.ts` passes for all 3 locales
  </acceptance_criteria>
  <done>Email pipeline localized; recipient locale drives template selection.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| App ↔ Mailgun EU / SendGrid EU | API key in env (Coolify secret); HTTPS to api.eu.* |
| User input ↔ Email body | URLs interpolated into HTML — Better Auth-controlled, not user-controlled (no XSS surface) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-06 | Information Disclosure | Email content in logs | mitigate | pino REDACT_PATHS strips `*.email`; `email.send_failed` log entries omit body content |
</threat_model>

<verification>
- 12 template files exist
- `npx tsc --noEmit` exits 0
- `tests/integration/email-locale.test.ts` GREEN
- Plan 17's `tests/integration/email-locale.test.ts` mocks fetch — no real Mailgun calls in tests
</verification>

<success_criteria>
- 4 templates × 3 locales = 12 files
- Recipient locale (preferredLocale) drives selection (I18N-04)
- Mailgun EU primary, SendGrid EU fallback
- Better Auth hooks now use `sendEmailLocalized`
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-06-SUMMARY.md` documenting:
- Provider chosen (Mailgun vs SendGrid) — A2 + Open Question 4 resolution
- DNS records (SPF/DKIM/DMARC) NOT yet configured — Phase 8 OPS-11 task
- Note: production-readiness blocked until DNS records on `vttl.be` are live
</output>
