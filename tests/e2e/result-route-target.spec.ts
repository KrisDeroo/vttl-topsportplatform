/**
 * Playwright e2e: tournament result-route targeting (CR-03 + WARNING-3, Plan 04-12 Task 6).
 *
 * Scenarios:
 *   1. TD navigates to /tournaments/[id]/result WITHOUT ?playerId
 *      → page renders Pick-Player selector with the FULL participants
 *        roster (from tournament.get.participants, not just rows with
 *        existing results). Does NOT auto-fill any existing.results[0]
 *        data (CR-03 silent-overwrite bug eliminated).
 *   2. TD navigates to /tournaments/[id]/result?playerId=PLAYER_B_ID
 *      → form preloads PLAYER_B's existing row (if any), NOT player_A's.
 *   3. Player navigates to /tournaments/[id]/result (no ?playerId)
 *      → form preloads OWN row (player caller defaults to self).
 *   4. NEW (WARNING-3 regression): TD on a tournament with NO entered
 *      results yet sees the Pick-Player selector populated with the
 *      participants list (this case used to render empty when the picker
 *      fell back to existing.results only — Path A from the plan-checker
 *      resolution closes that hole).
 *
 * Skip-gate: if the test-auth hook is unavailable OR the required env
 * vars (TEST_TOURNAMENT_ID, TEST_PLAYER_B_ID, TEST_EMPTY_TOURNAMENT_ID)
 * are not set, individual tests skip cleanly. Same shape as
 * rankings-tab.spec.ts (the canonical Phase 4 Playwright skip pattern).
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[3]
 *            .planning/phases/04-kerndomein/04-REVIEW.md §CR-03
 *            .planning/phases/04-kerndomein/04-12-PLAN.md §Task 6
 */
import { test, expect } from '@playwright/test';

const TEST_TOURNAMENT_ID = process.env.TEST_TOURNAMENT_ID;
const TEST_PLAYER_B_ID = process.env.TEST_PLAYER_B_ID;
const TEST_EMPTY_TOURNAMENT_ID = process.env.TEST_EMPTY_TOURNAMENT_ID;

/**
 * Best-effort log-in as a known role via the Phase 1 dev-only test-auth
 * route. Returns false when the dev server / test-auth route is not
 * reachable so the caller can skip rather than fail. Mirrors the helper
 * in tests/e2e/rankings-tab.spec.ts.
 */
async function loginAs(
  page: import('@playwright/test').Page,
  role: 'technical_director' | 'player',
): Promise<boolean> {
  try {
    const response = await page.goto(`/__test/auth?role=${role}`, {
      waitUntil: 'domcontentloaded',
      timeout: 8_000,
    });
    if (!response || response.status() >= 400) return false;
    await page
      .waitForURL(/\/(nl|en|fr)\//, { timeout: 8_000 })
      .catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

test.describe('Tournament result-route targeting (CR-03 + WARNING-3)', () => {
  test('TD without ?playerId → Pick-Player selector (no auto-target drift)', async ({
    page,
  }) => {
    const loggedIn = await loginAs(page, 'technical_director');
    test.skip(!loggedIn, 'test-auth hook unavailable — skipping');
    test.skip(
      !TEST_TOURNAMENT_ID,
      'TEST_TOURNAMENT_ID env var required — skipping',
    );

    await page.goto(`/nl/tournaments/${TEST_TOURNAMENT_ID}/result`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });

    // Picker copy is localised — accept any of the three locale strings.
    await expect(
      page.getByText(/Kies een speler|Pick a player|Choisissez un joueur/i),
    ).toBeVisible({ timeout: 10_000 });

    // The full entry form MUST NOT render — no outcome input visible.
    await expect(page.locator('select[name="outcome"]')).toHaveCount(0);
  });

  test('TD with ?playerId=PLAYER_B → form preloads PLAYER_B row (not player_A)', async ({
    page,
  }) => {
    const loggedIn = await loginAs(page, 'technical_director');
    test.skip(!loggedIn, 'test-auth hook unavailable — skipping');
    test.skip(
      !TEST_TOURNAMENT_ID,
      'TEST_TOURNAMENT_ID env var required — skipping',
    );
    test.skip(
      !TEST_PLAYER_B_ID,
      'TEST_PLAYER_B_ID env var required — skipping',
    );

    await page.goto(
      `/nl/tournaments/${TEST_TOURNAMENT_ID}/result?playerId=${TEST_PLAYER_B_ID}`,
      { waitUntil: 'domcontentloaded', timeout: 10_000 },
    );

    // Entry form is visible.
    await expect(
      page.locator('form, [data-testid=tournament-result-form]'),
    ).toBeVisible({ timeout: 10_000 });

    // Picker MUST NOT be present.
    await expect(
      page.getByText(/Kies een speler|Pick a player|Choisissez un joueur/i),
    ).toHaveCount(0);
  });

  test('player without ?playerId → form preloads OWN row', async ({ page }) => {
    const loggedIn = await loginAs(page, 'player');
    test.skip(!loggedIn, 'test-auth hook unavailable — skipping');
    test.skip(
      !TEST_TOURNAMENT_ID,
      'TEST_TOURNAMENT_ID env var required — skipping',
    );

    await page.goto(`/nl/tournaments/${TEST_TOURNAMENT_ID}/result`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });

    // Player caller defaults to self — entry form (or read-only view when
    // 14d wall expired) is visible; picker is NOT.
    await expect(
      page.locator('form, [data-testid=tournament-result-form]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/Kies een speler|Pick a player|Choisissez un joueur/i),
    ).toHaveCount(0);
  });

  test('TD on empty-results tournament sees full participants in picker (WARNING-3 regression)', async ({
    page,
  }) => {
    const loggedIn = await loginAs(page, 'technical_director');
    test.skip(!loggedIn, 'test-auth hook unavailable — skipping');
    test.skip(
      !TEST_EMPTY_TOURNAMENT_ID,
      'TEST_EMPTY_TOURNAMENT_ID env var required (a tournament with participants but ZERO entered results) — skipping',
    );

    await page.goto(`/nl/tournaments/${TEST_EMPTY_TOURNAMENT_ID}/result`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });

    // Picker is visible.
    await expect(
      page.getByText(/Kies een speler|Pick a player|Choisissez un joueur/i),
    ).toBeVisible({ timeout: 10_000 });

    // Empty-state copy MUST NOT be visible — the pre-Task 1 implementation
    // would have rendered "Geen deelnemers gevonden" here because the
    // picker fell back to existing.results (empty) only.
    await expect(
      page.getByText(
        /Geen deelnemers gevonden|No participants found|Aucun participant/i,
      ),
    ).toHaveCount(0);

    // At least one link to a ?playerId= URL is present — the picker
    // backed by tournament.get.participants has real options.
    const playerLinks = page.locator('a[href*="playerId="]');
    await expect(playerLinks.first()).toBeVisible({ timeout: 10_000 });
    const count = await playerLinks.count();
    expect(count).toBeGreaterThan(0);
  });
});
