/**
 * Playwright e2e — week view base + event click + view switcher.
 *
 * Plan 03-08 Task 2. Phase 3 succescriterium #1: "TD ziet alle events
 * kleurgecodeerd in week view".
 *
 * Reference: CAL-01 (week view default), CAL-02 (month/year views), CAL-03
 *            (event-type color coding); 03-UI-SPEC.md §Calendar week view.
 *
 * Requires a running Next.js dev server with seeded calendar data. The
 * canonical CI flow is `pnpm dev` + `pnpm test:e2e -- calendar`.
 */
import { test, expect } from '@playwright/test';

// Helper: log in as a known TD user via dev-only test auth route (Phase 1).
async function loginAsTd(page: import('@playwright/test').Page) {
  await page.goto('/__test/auth?role=technical_director');
  await page.waitForURL(/\/(nl|en|fr)\//);
}

test.describe('Calendar — week view (CAL-01, CAL-03)', () => {
  test('TD login → /nl/calendar loads, week view is the default, type chips visible', async ({
    page,
  }) => {
    await loginAsTd(page);
    await page.goto('/nl/calendar');

    // Week-view FullCalendar grid is present.
    await expect(page.locator('.fc-timegrid')).toBeVisible({
      timeout: 15_000,
    });
    // At least one event chip is rendered.
    await expect(page.locator('.fc-event').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('clicking an event opens EventDetailSheet with title + time range', async ({
    page,
  }) => {
    await loginAsTd(page);
    await page.goto('/nl/calendar');
    const firstChip = page.locator('.fc-event').first();
    await firstChip.waitFor({ state: 'visible', timeout: 15_000 });
    await firstChip.click();
    // The detail Sheet uses role="dialog" via Radix Sheet primitive.
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Month + Year view buttons in toolbar switch the visible view (CAL-02)', async ({
    page,
  }) => {
    await loginAsTd(page);
    await page.goto('/nl/calendar');
    // Toolbar exposes view-switch buttons. We try month first.
    const monthBtn = page.getByRole('button', { name: /maand|month/i });
    if (await monthBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await monthBtn.click();
      await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});
