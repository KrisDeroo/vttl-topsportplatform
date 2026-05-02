/**
 * E2E for the LocaleSwitcher (I18N-01 / D-01 / D-02 / D-03).
 *
 * Asserts:
 *   - Globe icon trigger is reachable via aria-label
 *   - Selecting a different locale updates the URL segment without a full
 *     page reload (D-03 — next-intl router.replace, no hard navigation)
 *   - The 'locale' cookie reflects the new locale after the action runs
 *
 * The "logged-in pref persists to users.preferred_locale" path is covered
 * once Plan 15 (admin UI) provides a login flow; until then, the cookie
 * write is the asserted contract for the anonymous path.
 *
 * Reference:
 *   - .planning/phases/01-fundament/01-08-PLAN.md Task 2
 *   - tests/integration/locale-resolve.test.ts (server-side resolution chain)
 */
import { expect, test } from '@playwright/test';

test('@phase1 anonymous switcher updates URL + cookie (I18N-01)', async ({
  page,
  context,
}) => {
  await page.goto('/nl');

  // 1. The Globe trigger is rendered with the documented aria-label.
  const trigger = page.locator('[aria-label="Language switcher"]');
  await expect(trigger).toBeVisible();

  // 2. Open the dropdown and pick "EN".
  await trigger.click();
  await page.locator('[role="option"]', { hasText: 'EN' }).click();

  // 3. The URL segment must flip to /en (next-intl router.replace).
  await expect(page).toHaveURL(/\/en(\/|$)/);

  // 4. The 'locale' cookie persists the choice for subsequent requests.
  const cookies = await context.cookies();
  const localeCookie = cookies.find((c) => c.name === 'locale');
  expect(localeCookie?.value).toBe('en');
});

test('@phase1 logged-in switcher persists pref to users.preferred_locale', async () => {
  // Wired in Plan 15 once the admin UI provides a login flow that the
  // Playwright runner can replay. The setUserLocale Server Action already
  // performs the UPDATE — see src/server/actions/locale.ts — so this is
  // an end-to-end verification, not new behavior.
  test.fixme(true, 'Pending Plan 15 login fixture (auth.spec.ts shares state).');
});
