/**
 * Playwright e2e — photo upload visual state machine.
 *
 * Plan 02-15 Task 3.
 *
 * UI states walked (per 02-UI-SPEC.md §PhotoUpload):
 *   idle → uploading → scanPending → scanClean    (happy path)
 *   idle → uploading → scanPending → scanInfected (EICAR branch)
 *
 * The TD logs in via a helper that requests a fresh dev session through the
 * test-only `/__test/auth` route (Phase 1) — no email link is hit in tests.
 *
 * EICAR fixture: tests/fixtures/eicar.png — a file whose magic bytes are PNG
 * but whose body contains the EICAR test signature. ClamAV (or any AV
 * scanner) reports it as infected, but it is the public-domain standard
 * AV-test string with zero malicious payload. See
 * tests/fixtures/README.md for the rationale (T-02-15-FIXTURE-LEAK).
 *
 * RED until Plans 02-12 + 02-13 ship the PhotoUpload component and the
 * /players/new page.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

// Helper: log in as a known TD user via dev-only test auth route.
// The route is gated behind NODE_ENV==='development' in middleware.
async function loginAsTd(page: import('@playwright/test').Page) {
  await page.goto('/__test/auth?role=technical_director');
  await page.waitForURL(/\/(nl|en|fr)\//);
}

test.describe('PhotoUpload — visual state machine (Plan 02-15 Task 3)', () => {
  test('happy path: idle → uploading → scanPending → scanClean', async ({ page }) => {
    await loginAsTd(page);
    await page.goto('/nl/players/new');

    // idle state — the drag-drop affordance is visible.
    const uploadAffordance = page.getByRole('button', {
      name: /sleep een foto|drag a photo|upload/i,
    });
    await expect(uploadAffordance).toBeVisible();

    // Upload a clean fixture PNG (under 2 MB).
    const filePath = path.resolve(__dirname, 'fixtures/test-avatar.png');
    await page.setInputFiles('input[type=file]', filePath);

    // uploading state.
    await expect(
      page.getByText(/Bezig met uploaden|Uploading/i),
    ).toBeVisible({ timeout: 5_000 });

    // scanPending state — backend has accepted the file, worker is scanning.
    await expect(
      page.getByText(/Foto wordt gescand|Scanning photo|scan pending/i),
    ).toBeVisible({ timeout: 10_000 });

    // scanClean state — success toast.
    await expect(
      page.getByText(/Foto opgeslagen|Photo saved|opgeslagen/i),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('infected branch: EICAR fixture → scanInfected with explicit reject message', async ({
    page,
  }) => {
    await loginAsTd(page);
    await page.goto('/nl/players/new');

    // EICAR-as-PNG fixture (built by tests/fixtures/build-eicar-png.ts ahead
    // of the test run).
    const filePath = path.resolve(__dirname, 'fixtures/eicar.png');
    await page.setInputFiles('input[type=file]', filePath);

    // After the scan worker reports infected, the UI surfaces a clear
    // rejection state — scanInfected with i18n key errors.file.scanInfected.
    await expect(
      page.getByText(/afgekeurd|infected|rejected|geweigerd/i),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('over-2MB file → idle state with errors.file.tooLarge message (client-side validation)', async ({
    page,
  }) => {
    await loginAsTd(page);
    await page.goto('/nl/players/new');

    // Create a > 2MB buffer client-side via DataTransfer.
    await page.setInputFiles('input[type=file]', {
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0),
    });

    // Client-side check rejects before upload starts.
    await expect(
      page.getByText(/te groot|too large|bestand te groot/i),
    ).toBeVisible({ timeout: 5_000 });
  });
});
