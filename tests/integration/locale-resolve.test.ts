import { describe, it, expect } from 'vitest';
import { resolveLocale } from '@/i18n/resolve'; // RED until Plan 07

describe('locale resolution chain — I18N-03', () => {
  it('falls back to nl when no signal', async () => {
    expect(
      await resolveLocale({ acceptLanguage: undefined, cookie: undefined, userPref: undefined }),
    ).toBe('nl');
  });
  it('uses Accept-Language fr-BE → fr', async () => {
    expect(
      await resolveLocale({ acceptLanguage: 'fr-BE,fr;q=0.9', cookie: undefined, userPref: undefined }),
    ).toBe('fr');
  });
  it('cookie overrides Accept-Language', async () => {
    expect(
      await resolveLocale({ acceptLanguage: 'fr-BE', cookie: 'en', userPref: undefined }),
    ).toBe('en');
  });
  it('user pref overrides cookie', async () => {
    expect(await resolveLocale({ acceptLanguage: 'fr-BE', cookie: 'en', userPref: 'nl' })).toBe(
      'nl',
    );
  });
});
