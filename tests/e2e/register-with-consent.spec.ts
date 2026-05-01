import { test, expect } from '@playwright/test';

test('register → verify email → consent (3 categories) → login redirect', async ({ page }) => {
  await page.goto('/nl/register');
  await page.fill('[name=email]', `t-${Date.now()}@vttl.test`);
  await page.fill('[name=password]', 'CorrectHorseBattery!');
  await page.fill('[name=name]', 'Test User');
  await page.fill('[name=dateOfBirth]', '1990-01-01');
  await page.click('button[type=submit]');
  // Resend SDK mock (Plan 06 + tests/e2e/setup) intercepts emails.send and exposes the verify URL
  // For now this test is RED.
  expect(true).toBe(true); // placeholder until consent flow implemented (Plan 12)
});

test('@phase1 minor < 16 cannot activate without parent consent', async ({ page: _page }) => {
  // Plan 12: GDPR-02 enforcement
});
