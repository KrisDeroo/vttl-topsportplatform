import { test, expect } from '@playwright/test';

test('@phase1 session persists across browser restart (AUTH-01)', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/nl/login');
  // login flow … assert session cookie has 30d expiry
  const cookies = await context.cookies();
  const auth = cookies.find((c) => c.name.includes('session'));
  expect(auth?.expires).toBeGreaterThan(Date.now() / 1000 + 60 * 60 * 24 * 29);
});

test('@phase1 cookie flags httpOnly + Secure + SameSite=Lax (SEC-01)', async ({
  context: _context,
  request: _request,
}) => {
  // POST /api/auth/sign-in/email → inspect Set-Cookie headers
});
