import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendEmailLocalized } from '@/server/email/send'; // RED until Plan 06

describe('email locale — I18N-04', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  it.each(['nl', 'en', 'fr'] as const)('verify-email subject in %s', async (locale) => {
    await sendEmailLocalized({
      to: 'a@b.test',
      locale,
      template: 'verify-email',
      data: { verifyUrl: 'http://x' },
    });
    const body = new URLSearchParams(fetchMock.mock.calls[0]?.[1]?.body as string);
    const subject = body.get('subject') ?? '';
    const expected = {
      nl: 'Bevestig je e-mailadres',
      en: 'Verify your email',
      fr: 'Confirmez votre adresse e-mail',
    };
    expect(subject).toBe(expected[locale]);
  });
});
