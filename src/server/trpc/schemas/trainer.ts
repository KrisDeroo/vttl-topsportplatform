/**
 * Zod input schemas for trainer.* tRPC mutations (Plan 02-09).
 *
 * All schemas use `.strict()` (VALID-06) — unknown keys are rejected. All
 * error messages are i18n keys (D-46 + I18N-08); the client resolves via
 * `useZodErrorMessage` adapter (plan 02-04).
 *
 * Field-level RBAC matrix (D-38):
 *   trainerCreateInput     — TD only. Full TRAINER-01..02 fields.
 *   trainerUpdateAsTdInput — TD only. Same shape as create plus the
 *                            optional profile photo file id and the
 *                            target trainerId as a separate path param.
 *   trainerSelfUpdateInput — trainer editing self; non-sensitive
 *                            whitelist (address, phone, email, profile
 *                            photo). `diplomaCode` and
 *                            `hasPedagogicalQualification` are TD-only —
 *                            the trainer-self schema deliberately omits
 *                            them so `.strict()` rejects a self-upgrade.
 *   trainerListInput       — pagination + optional filters.
 *   trainerGetInput        — read by id.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-38
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md
 *              §Zod schema with i18n-key error messages
 */
import { z } from 'zod';

// ─── Shared field groups ────────────────────────────────────────────────

/** Belgian postal code: exactly 4 digits. */
const belgianPostalCode = z.string().regex(/^[0-9]{4}$/, {
  message: 'errors.field.belgianPostalCode',
});

/** ISO-3166-1 alpha-2 country code; default BE. */
const countryCode = z.string().length(2, { message: 'errors.field.country' });

const addressFields = {
  street: z.string().min(1, { message: 'errors.field.required' }),
  streetNumber: z.string().optional(),
  postalCode: belgianPostalCode,
  city: z.string().min(1, { message: 'errors.field.required' }),
  province: z.string().min(1, { message: 'errors.field.required' }),
  country: countryCode.default('BE'),
};

const contactFields = {
  phone: z.string().min(1).optional(),
  email: z.string().email({ message: 'errors.field.email' }).optional(),
};

// ─── Schemas ────────────────────────────────────────────────────────────

/** trainer.create — TD only. TRAINER-01..02. */
export const trainerCreateInput = z
  .object({
    userId: z.string().uuid(), // existing user row (admin.user.create runs first)
    firstName: z.string().min(1, { message: 'errors.field.required' }),
    lastName: z.string().min(1, { message: 'errors.field.required' }),
    dateOfBirth: z.coerce
      .date()
      .max(new Date(), { message: 'errors.field.dateInPast' }),
    gender: z.enum(['male', 'female', 'x']),
    ...addressFields,
    ...contactFields,
    diplomaCode: z.string().min(1, { message: 'errors.field.required' }),
    hasPedagogicalQualification: z.boolean().default(false),
  })
  .strict();

/** trainer.updateAsTd — TD only. Same shape as create plus profile photo
 *  file id and the target trainerId; minus `userId` (the trainerId IS
 *  the user_id but it is supplied as a separate path param so the URL
 *  matches the players router shape). */
export const trainerUpdateAsTdInput = z
  .object({
    trainerId: z.string().uuid(),
    firstName: z.string().min(1, { message: 'errors.field.required' }),
    lastName: z.string().min(1, { message: 'errors.field.required' }),
    dateOfBirth: z.coerce
      .date()
      .max(new Date(), { message: 'errors.field.dateInPast' }),
    gender: z.enum(['male', 'female', 'x']),
    ...addressFields,
    ...contactFields,
    diplomaCode: z.string().min(1, { message: 'errors.field.required' }),
    hasPedagogicalQualification: z.boolean(),
    profilePhotoFileId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** trainer.updateSelf — D-38 whitelist. `diplomaCode` and
 *  `hasPedagogicalQualification` are NOT keys here — `.strict()`
 *  rejects a self-upgrade attempt before the router sees it. */
export const trainerSelfUpdateInput = z
  .object({
    ...addressFields,
    ...contactFields,
    profilePhotoFileId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** trainer.list — pagination + optional filters. */
export const trainerListInput = z
  .object({
    academyCode: z.string().optional(),
    diplomaCode: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** trainer.get — read by id. */
export const trainerGetInput = z
  .object({
    trainerId: z.string().uuid(),
  })
  .strict();

export type TrainerCreateInput = z.infer<typeof trainerCreateInput>;
export type TrainerUpdateAsTdInput = z.infer<typeof trainerUpdateAsTdInput>;
export type TrainerSelfUpdateInput = z.infer<typeof trainerSelfUpdateInput>;
export type TrainerListInput = z.infer<typeof trainerListInput>;
export type TrainerGetInput = z.infer<typeof trainerGetInput>;
