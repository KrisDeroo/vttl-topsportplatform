/**
 * Unit tests for `trainerCreateInput`, `trainerSelfUpdateInput` — Plan 02-15
 * Task 1.
 *
 * Coverage (mirrors player-schemas.test.ts, focused on trainer-specific
 * forbidden fields):
 *   - D-37 trainer whitelist: `trainerSelfUpdateInput` rejects `diplomaCode`
 *     and `hasPedagogicalQualification` (TD-only fields tracking the
 *     pedagogical-qualification credential — D-12 Belgian sports-coach law).
 *   - I18N-08: `errors.field.*` messages on `trainerCreateInput`.
 *
 * RED until Plan 02-07 ships `@/server/trpc/schemas/trainer`.
 */
import { describe, it, expect } from 'vitest';

describe('trainerSelfUpdateInput — D-37 field whitelist', () => {
  it('rejects diplomaCode (TD-only field)', async () => {
    const { trainerSelfUpdateInput } = await import('@/server/trpc/schemas/trainer');
    const result = trainerSelfUpdateInput.safeParse({
      phone: '+32 12 34 56 78',
      email: 'trainer@vttl.be',
      diplomaCode: 'diploma_a',
    });
    expect(result.success).toBe(false);
  });

  it('rejects hasPedagogicalQualification (TD-only field, D-12)', async () => {
    const { trainerSelfUpdateInput } = await import('@/server/trpc/schemas/trainer');
    const result = trainerSelfUpdateInput.safeParse({
      phone: '+32 12 34 56 78',
      email: 'trainer@vttl.be',
      hasPedagogicalQualification: true,
    });
    expect(result.success).toBe(false);
  });

  it.each(['firstName', 'lastName', 'dateOfBirth', 'gender'] as const)(
    'rejects %s (identity field)',
    async (field) => {
      const { trainerSelfUpdateInput } = await import('@/server/trpc/schemas/trainer');
      const result = trainerSelfUpdateInput.safeParse({
        phone: '+32 12 34 56 78',
        [field]: 'whatever',
      });
      expect(result.success, `${field} should be rejected by .strict()`).toBe(false);
    },
  );

  it('accepts contact-only whitelist (phone, email, emergency*)', async () => {
    const { trainerSelfUpdateInput } = await import('@/server/trpc/schemas/trainer');
    const result = trainerSelfUpdateInput.safeParse({
      phone: '+32 1234',
      email: 'trainer@vttl.be',
      emergencyContactName: 'EC',
      emergencyContactPhone: '+32 9876',
      emergencyContactRelation: 'Partner',
    });
    expect(result.success).toBe(true);
  });
});

describe('trainerCreateInput — Zod messages are i18n keys (I18N-08)', () => {
  it('emits errors.field.required when firstName missing', async () => {
    const { trainerCreateInput } = await import('@/server/trpc/schemas/trainer');
    const result = trainerCreateInput.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: { message: string }) => i.message);
      expect(messages).toContain('errors.field.required');
    }
  });
});
