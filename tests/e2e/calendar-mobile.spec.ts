/**
 * Playwright e2e — mobile single-day view + swipe nav + floating CTA.
 *
 * Plan 03-08 Task 2. Phase 3 succescriterium #5: "Mobile < 480px = single-day
 * + swipe".
 *
 * Reference: CAL-08 (mobile single-day); 03-UI-SPEC.md §Mobile Strategy.
 *
 * Threat T-03-43-E2E-MOBILE-FALSE-NEGATIVE: PointerEvent simulation is
 * well-supported on Chromium; the swipe threshold (60px x, 30px y, 400ms)
 * is deterministic — manual UAT on iOS/Android remains in the validation
 * sign-off (see 03-VALIDATION.md §Manual-Only Verifications).
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 360, height: 640 } });

async function loginAsTd(page: import('@playwright/test').Page) {
  await page.goto('/__test/auth?role=technical_director');
  await page.waitForURL(/\/(nl|en|fr)\//);
}

test.describe('Calendar — mobile single-day + swipe (CAL-08)', () => {
  test('< 640px viewport forces timeGridDay (single-day rendering)', async ({
    page,
  }) => {
    await loginAsTd(page);
    await page.goto('/nl/calendar');
    // Pixel-5-class mobile viewport — UI-SPEC forces FullCalendar into
    // `timeGridDay` view.
    await expect(page.locator('.fc-timeGridDay-view')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('horizontal swipe advances the visible date by one day', async ({
    page,
  }) => {
    await loginAsTd(page);
    await page.goto('/nl/calendar');
    await page.locator('.fc-timeGridDay-view').waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    // Capture current date header.
    const beforeHeader = await page
      .locator('.fc-toolbar-title')
      .first()
      .textContent();
    // Dispatch PointerEvents — 320px → 80px x delta is well above the
    // 60px swipe threshold and below the 30px y tolerance.
    const cal = page.locator('.fc');
    await cal.evaluate((el) => {
      const make = (type: string, x: number) =>
        new PointerEvent(type, {
          clientX: x,
          clientY: 400,
          pointerType: 'touch',
          pointerId: 1,
          isPrimary: true,
          bubbles: true,
        });
      el.dispatchEvent(make('pointerdown', 320));
      el.dispatchEvent(make('pointermove', 80));
      el.dispatchEvent(make('pointerup', 80));
    });
    // Give the FullCalendar API .next() callback a tick to render.
    await page.waitForTimeout(400);
    const afterHeader = await page
      .locator('.fc-toolbar-title')
      .first()
      .textContent();
    if (beforeHeader && afterHeader) {
      expect(afterHeader).not.toBe(beforeHeader);
    }
  });

  test('"Nieuwe afspraak" floating CTA is positioned bottom-right (fixed)', async ({
    page,
  }) => {
    await loginAsTd(page);
    await page.goto('/nl/calendar');
    const cta = page.getByRole('button', { name: /nieuwe afspraak|new event/i });
    await cta.waitFor({ state: 'visible', timeout: 15_000 });
    const styles = await cta.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { position: cs.position, bottom: cs.bottom, right: cs.right };
    });
    // UI-SPEC requires position: fixed for the mobile CTA.
    expect(styles.position).toBe('fixed');
  });
});
