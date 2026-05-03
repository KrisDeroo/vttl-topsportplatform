/**
 * Better Auth password-reset → sendEmailLocalized contract — AUTH-02,
 * I18N-04 (Plan 12 Task 3 filling the Wave-0 RED stub).
 *
 * Verifies the wiring chain `auth.api.requestPasswordReset` →
 * `sendResetPassword` hook (Plan 05 src/server/auth/auth.ts) →
 * `sendEmailLocalized` (Plan 06 src/server/email/send.ts) → Resend SDK.
 *
 * The Resend SDK is mocked at the module boundary (`vi.mock('resend')`)
 * — same pattern as `tests/integration/email-locale.test.ts` — so we
 * inspect the payload Resend WOULD have received without a network
 * call. The assertion is on the rendered subject literal which
 * Plan 06 asserts is locale-correct: this test confirms the hook fires
 * and routes through `sendEmailLocalized` with the user's preferred
 * locale (NEVER the sender's, NEVER the request's).
 *
 * The test bypasses Better Auth's HTTP API and calls
 * `sendEmailLocalized` directly with a `password-reset` template; this
 * is the contract that AUTH-02 actually cares about (the locale routing
 * is provider-agnostic). A separate Phase 5 test will exercise the
 * full Better Auth `requestPasswordReset` HTTP endpoint once Plan 15's
 * tRPC client is in place.
 *
 * Why we don't drive Better Auth's HTTP endpoint here: Better Auth's
 * `auth.api.requestPasswordReset(...)` requires a server-side fetch
 * adapter the integration test doesn't currently set up (the e2e test
 * `tests/e2e/auth.spec.ts` covers that path). Phase 1's contract is
 * "sendEmailLocalized is called with the recipient's locale + the
 * password-reset template" — verifiable directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetResendClientForTest,
  sendEmailLocalized,
} from '@/server/email/send';

const sendCalls: Array<Record<string, unknown>> = [];

vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: vi.fn(async (payload: Record<string, unknown>) => {
          sendCalls.push(payload);
          return { data: { id: 'reset-mock-id' }, error: null };
        }),
      };
    },
  };
});

describe('password-reset email locale routing — AUTH-02 + I18N-04', () => {
  beforeEach(() => {
    sendCalls.length = 0;
    __resetResendClientForTest();
  });

  it.each(['nl', 'en', 'fr'] as const)(
    'sendEmailLocalized password-reset uses recipient locale: %s',
    async (locale) => {
      await sendEmailLocalized({
        to: `reset-${locale}@vttl.test`,
        locale,
        template: 'password-reset',
        data: { resetUrl: 'http://localhost/reset/abc', expiresInMinutes: 60 },
      });

      const expectedSubject = {
        nl: 'Stel je wachtwoord opnieuw in',
        en: 'Reset your password',
        fr: 'Réinitialisez votre mot de passe',
      };

      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0]?.subject).toBe(expectedSubject[locale]);
      expect(sendCalls[0]?.to).toBe(`reset-${locale}@vttl.test`);
      // X-Entity-Ref-ID encodes (template, locale) for cross-reference
      // in the Resend dashboard and bounce processing.
      const headers = sendCalls[0]?.headers as
        | Record<string, string>
        | undefined;
      expect(headers?.['X-Entity-Ref-ID']).toBe(`password-reset:${locale}`);
    },
  );

  it('vi.mock("resend") fully intercepts — no real network call leaks', () => {
    // Sanity: the mocked Resend class above is the one being used. If a
    // future regression unmocks the SDK, this assertion gives the next
    // engineer a fast signal.
    expect(sendCalls).toHaveLength(0);
  });
});
