/**
 * Zod input schemas for player.* tRPC mutations (Plan 02-09).
 *
 * All schemas use `.strict()` (VALID-06): the client cannot smuggle extra
 * fields. All error messages are i18n keys (D-46 + I18N-08); the client
 * resolves them via `useZodErrorMessage` from `src/lib/forms/zod-i18n.ts`
 * (plan 02-04 client adapter); the server logs the raw key in English.
 *
 * Field-level RBAC matrix (D-37):
 *   playerCreateInput          — TD only; full PLAYER-01..02 field set.
 *   playerUpdateAsTdInput      — TD / academy_manager (RLS narrows the
 *                                academy_manager scope); same shape as
 *                                create plus profile photo file id and a
 *                                separate `playerId` path param.
 *   playerSelfUpdateInput      — player editing self; whitelist of
 *                                non-sensitive fields only (address, phone,
 *                                email, emergency contact, profile photo).
 *                                Fields NOT in this schema are NOT accepted
 *                                — `.strict()` rejects unknown keys.
 *   playerOnBehalfOfInput      — parent of minor; same whitelist as
 *                                self-update + the target playerId. The
 *                                tRPC handler verifies parent_child_links.
 *   playerSetAgeCategoryInput  — TD only (D-32 mutation input).
 *   playerListInput            — pagination + optional filters.
 *   playerGetInput             — read by id.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-37
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md
 *              §Zod schema with i18n-key error messages
 */
import { z } from 'zod';

// ─── Shared field groups ────────────────────────────────────────────────

/** Belgian postal code: exactly 4 digits (e.g., "2000" for Antwerp). */
const belgianPostalCode = z.string().regex(/^[0-9]{4}$/, {
  message: 'errors.field.belgianPostalCode',
});

/** ISO-3166-1 alpha-2 country code; default BE. */
const countryCode = z.string().length(2, { message: 'errors.field.country' });

/** Address subset (D-27 — flat columns). Both create and update include these. */
const addressFields = {
  street: z.string().min(1, { message: 'errors.field.required' }),
  streetNumber: z.string().optional(),
  postalCode: belgianPostalCode,
  city: z.string().min(1, { message: 'errors.field.required' }),
  province: z.string().min(1, { message: 'errors.field.required' }),
  country: countryCode.default('BE'),
};

/** Emergency contact subset (D-28). Optional in the schema; the
 *  `players_minor_emergency_contact` CHECK constraint enforces presence
 *  when `is_minor` is true. The router computes `is_minor` from DOB and
 *  surfaces the constraint violation as a translated error. */
const emergencyContactFields = {
  emergencyContactName: z.string().min(1).optional(),
  emergencyContactPhone: z.string().min(1).optional(),
  emergencyContactRelation: z.string().min(1).optional(),
};

/** Contact subset shared between self-update and create. */
const contactFields = {
  phone: z.string().min(1).optional(),
  email: z.string().email({ message: 'errors.field.email' }).optional(),
};

// ─── Schemas ────────────────────────────────────────────────────────────

/** player.create — TD only. PLAYER-01..04.
 *  Initial `age_category_code` + `categoryYear` come from
 *  `deriveAgeCategory()` at the router layer (PLAYER-04). They are NOT
 *  accepted from the client; to override, use `setAgeCategory`. */
export const playerCreateInput = z
  .object({
    userId: z.string().uuid(), // existing user row (admin.user.create runs first)
    firstName: z.string().min(1, { message: 'errors.field.required' }),
    lastName: z.string().min(1, { message: 'errors.field.required' }),
    dateOfBirth: z.coerce
      .date()
      .max(new Date(), { message: 'errors.field.dateInPast' }),
    gender: z.enum(['male', 'female', 'x']),
    school: z.string().optional(),
    ...addressFields,
    ...contactFields,
    club: z.string().optional(),
    statusCode: z.string().min(1, { message: 'errors.field.required' }),
    academyCode: z.string().min(1, { message: 'errors.field.required' }),
    ...emergencyContactFields,
  })
  .strict();

/** player.updateAsTd — TD / academy_manager (RLS narrows the
 *  academy_manager scope to their own academy). Same shape as create
 *  minus `userId` (the row id is supplied as a separate path param) plus
 *  the optional profile photo file id (D-29). */
export const playerUpdateAsTdInput = z
  .object({
    playerId: z.string().uuid(),
    firstName: z.string().min(1, { message: 'errors.field.required' }),
    lastName: z.string().min(1, { message: 'errors.field.required' }),
    dateOfBirth: z.coerce
      .date()
      .max(new Date(), { message: 'errors.field.dateInPast' }),
    gender: z.enum(['male', 'female', 'x']),
    school: z.string().optional(),
    ...addressFields,
    ...contactFields,
    club: z.string().optional(),
    statusCode: z.string().min(1, { message: 'errors.field.required' }),
    academyCode: z.string().min(1, { message: 'errors.field.required' }),
    profilePhotoFileId: z.string().uuid().nullable().optional(),
    ...emergencyContactFields,
  })
  .strict();

/** player.updateSelf — D-37 whitelist. Fields NOT in this schema are NOT
 *  accepted; `.strict()` rejects unknown keys (so a player who POSTs
 *  `{ statusCode: 'a' }` gets a Zod failure with the unrecognised-key
 *  error before the router touches the database). */
export const playerSelfUpdateInput = z
  .object({
    ...addressFields,
    ...contactFields,
    ...emergencyContactFields,
    profilePhotoFileId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** player.updateOnBehalfOf — parent of minor. Same whitelist as
 *  self-update plus the target player id. The tRPC handler verifies the
 *  `parent_child_links` row before allowing the mutation. */
export const playerOnBehalfOfInput = z
  .object({
    playerId: z.string().uuid(),
    ...addressFields,
    ...contactFields,
    ...emergencyContactFields,
    profilePhotoFileId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** player.setAgeCategory — TD only (D-32). The router enforces the
 *  audit-trail INSERT into `age_category_history` and updates the
 *  denormalised `players.age_category_code` + `category_year`. */
export const playerSetAgeCategoryInput = z
  .object({
    playerId: z.string().uuid(),
    ageCategoryCode: z.string().min(1, { message: 'errors.field.required' }),
    categoryYear: z.coerce.number().int().min(1900).max(2100),
    effectiveFrom: z.coerce.date(),
  })
  .strict();

/** player.list — pagination + optional filters. */
export const playerListInput = z
  .object({
    academyCode: z.string().optional(),
    statusCode: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** player.get — read by id. */
export const playerGetInput = z
  .object({
    playerId: z.string().uuid(),
  })
  .strict();

export type PlayerCreateInput = z.infer<typeof playerCreateInput>;
export type PlayerUpdateAsTdInput = z.infer<typeof playerUpdateAsTdInput>;
export type PlayerSelfUpdateInput = z.infer<typeof playerSelfUpdateInput>;
export type PlayerOnBehalfOfInput = z.infer<typeof playerOnBehalfOfInput>;
export type PlayerSetAgeCategoryInput = z.infer<typeof playerSetAgeCategoryInput>;
export type PlayerListInput = z.infer<typeof playerListInput>;
export type PlayerGetInput = z.infer<typeof playerGetInput>;
