/**
 * Unit tests for `playerCreateInput`, `playerSelfUpdateInput`, `playerSetAgeCategoryInput`
 * — Plan 02-15 Task 1 (Phase 2 surface).
 *
 * Coverage:
 *   1. D-37 field whitelist: `playerSelfUpdateInput` MUST .strict()-reject any
 *      TD-only field smuggled by a player into their own self-update payload.
 *      The forbidden set includes `statusCode`, `academyCode`, `firstName`,
 *      `lastName`, `dateOfBirth`, `gender`, `school`, `club` (i.e. anything
 *      that defines identity or organisational placement).
 *   2. I18N-08: Zod issue `.message` strings are i18n catalogue keys
 *      (`errors.field.required`, `errors.field.belgianPostalCode`,
 *      `errors.field.dateInPast`), NOT raw English. The UI layer (RHF +
 *      next-intl) resolves the key to the user's locale.
 *   3. `playerSetAgeCategoryInput` accepts a well-formed payload (TD-only
 *      override path; DOM-CAT-01 history primitive).
 *
 * RED-state caveat: the source module `@/server/trpc/schemas/player` lands in
 * Plan 02-07. Until then this file errors at import time — that is the
 * documented contract (Wave-0 plan; tests sit at Wave 8 after 02-14 push).
 */
import { describe, it, expect } from 'vitest';

// Phase 2 source — lands in 02-07; tests are RED until then.
// Importing inside the describe via dynamic import keeps the file loadable
// even when the module is missing — vitest reports the failure per-test
// rather than aborting the suite.

describe('playerSelfUpdateInput — D-37 field whitelist (T-02-07-FIELD-SMUGGLING)', () => {
  it('rejects statusCode (TD-only field)', async () => {
    const { playerSelfUpdateInput } = await import('@/server/trpc/schemas/player');
    const result = playerSelfUpdateInput.safeParse({
      street: 'X',
      postalCode: '2000',
      city: 'Y',
      province: 'Z',
      statusCode: 'status_a',
    });
    expect(result.success).toBe(false);
  });

  it('rejects academyCode (TD-only field)', async () => {
    const { playerSelfUpdateInput } = await import('@/server/trpc/schemas/player');
    const result = playerSelfUpdateInput.safeParse({
      street: 'X',
      postalCode: '2000',
      city: 'Y',
      province: 'Z',
      academyCode: 'topsportschool',
    });
    expect(result.success).toBe(false);
  });

  it.each(['firstName', 'lastName', 'dateOfBirth', 'gender', 'school', 'club'] as const)(
    'rejects %s (identity/placement field)',
    async (field) => {
      const { playerSelfUpdateInput } = await import('@/server/trpc/schemas/player');
      const result = playerSelfUpdateInput.safeParse({
        street: 'X',
        postalCode: '2000',
        city: 'Y',
        province: 'Z',
        [field]: 'whatever',
      });
      expect(result.success, `${field} should be rejected by .strict()`).toBe(false);
    },
  );

  it('accepts the D-37 whitelist (street, postalCode, city, province, country, phone, email, emergency*)', async () => {
    const { playerSelfUpdateInput } = await import('@/server/trpc/schemas/player');
    const result = playerSelfUpdateInput.safeParse({
      street: 'Long Street',
      streetNumber: '1',
      postalCode: '2000',
      city: 'Antwerpen',
      province: 'Antwerpen',
      country: 'BE',
      phone: '+32 1234',
      email: 'a@b.com',
      emergencyContactName: 'EC',
      emergencyContactPhone: '+32 9876',
      emergencyContactRelation: 'Parent',
    });
    expect(result.success).toBe(true);
  });
});

describe('playerCreateInput — Zod messages are i18n keys (I18N-08)', () => {
  it('emits errors.field.required for missing firstName', async () => {
    const { playerCreateInput } = await import('@/server/trpc/schemas/player');
    const result = playerCreateInput.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: { message: string }) => i.message);
      // At least one message must be the canonical i18n key.
      expect(messages).toContain('errors.field.required');
    }
  });

  it('emits errors.field.belgianPostalCode for non-4-digit postal codes', async () => {
    const { playerCreateInput } = await import('@/server/trpc/schemas/player');
    const result = playerCreateInput.safeParse({
      userId: '00000000-0000-0000-0000-000000000000',
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '2010-01-01',
      gender: 'male',
      street: 'X',
      postalCode: 'NOT4DIGITS',
      city: 'Y',
      province: 'Z',
      statusCode: 'status_a',
      academyCode: 'topsportschool',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: { message: string }) => i.message);
      expect(messages).toContain('errors.field.belgianPostalCode');
    }
  });

  it('emits errors.field.dateInPast for future DOB', async () => {
    const { playerCreateInput } = await import('@/server/trpc/schemas/player');
    const future = new Date(Date.now() + 365 * 86400 * 1000).toISOString().slice(0, 10);
    const result = playerCreateInput.safeParse({
      userId: '00000000-0000-0000-0000-000000000000',
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: future,
      gender: 'male',
      street: 'X',
      postalCode: '2000',
      city: 'Y',
      province: 'Z',
      statusCode: 'status_a',
      academyCode: 'topsportschool',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i: { message: string }) => i.message === 'errors.field.dateInPast'),
      ).toBe(true);
    }
  });
});

describe('playerSetAgeCategoryInput — TD-only override (DOM-CAT-01)', () => {
  it('accepts a valid payload', async () => {
    const { playerSetAgeCategoryInput } = await import('@/server/trpc/schemas/player');
    const result = playerSetAgeCategoryInput.safeParse({
      playerId: '00000000-0000-0000-0000-000000000000',
      ageCategoryCode: 'age_minor',
      categoryYear: 2026,
      effectiveFrom: '2026-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid year (non-integer)', async () => {
    const { playerSetAgeCategoryInput } = await import('@/server/trpc/schemas/player');
    const result = playerSetAgeCategoryInput.safeParse({
      playerId: '00000000-0000-0000-0000-000000000000',
      ageCategoryCode: 'age_minor',
      categoryYear: 2026.5,
      effectiveFrom: '2026-01-01',
    });
    expect(result.success).toBe(false);
  });
});
