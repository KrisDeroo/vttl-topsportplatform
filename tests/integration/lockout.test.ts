/**
 * SEC-06 lockout integration test — 5 failed login attempts within 15 minutes
 * lock the account for the remainder of the window.
 *
 * STAYS RED until Plan 16 lands the email-deliverability bits and the testcontainer
 * can fully exercise Better Auth's signUp -> verify -> signIn round-trip. The
 * assertions below describe the contract Plan 16 must satisfy.
 *
 * The test is intentionally not skipped — when this file goes GREEN the SEC-06
 * lockout is proven end-to-end. Until then it documents expected behaviour.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb } from '../helpers/db';

describe('SEC-06 lockout — 5 failed/15 min', () => {
  let h: Awaited<ReturnType<typeof freshDb>>;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => {
    await h[Symbol.asyncDispose]();
  });

  it('6th attempt with wrong password returns 429 / TOO_MANY_REQUESTS', async () => {
    const { auth } = await import('@/server/auth/auth');
    const email = `lockout-${Date.now()}@vttl.test`;

    // Seed: a user whose email is verified so signInEmail can be exercised
    // (Better Auth's emailAndPassword.requireEmailVerification gates sign-in
    // on emailVerified=true). Plan 16 will provide the verify flow; until
    // then the test stays RED at the signUpEmail boundary.
    await auth.api.signUpEmail({
      body: { email, password: 'CorrectHorseBattery!', name: 'X' },
    });

    for (let i = 0; i < 5; i++) {
      await expect(
        auth.api.signInEmail({ body: { email, password: 'wrongpw1' } }),
      ).rejects.toBeDefined();
    }
    await expect(
      auth.api.signInEmail({ body: { email, password: 'wrongpw1' } }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
