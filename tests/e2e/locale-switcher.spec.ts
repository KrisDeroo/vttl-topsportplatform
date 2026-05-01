import { test, expect } from '@playwright/test';

test('@phase1 locale switcher persists pref after login (I18N-01)', async ({ page }) => {
  await page.goto('/nl');
  await page.click('[aria-label=Language]');
  await page.click('text=EN');
  await expect(page).toHaveURL(/\/en/);
  // After login, users.preferred_locale must update — Plan 08 server action
});
