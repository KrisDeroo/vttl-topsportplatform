/**
 * Zod input schemas for tournament.* tRPC procedures (Phase 4 Wave 2 — D-69..D-81).
 *
 * Mirrors the Phase-3/Plan 04-03 schema conventions:
 *   - Every object uses `.strict()` (VALID-06 carry-forward — rejects unknown
 *     keys, mitigates T-04-INPUT-SMUGGLING-VIA-EXTRA-FIELDS).
 *   - Every error message is an i18n key (I18N-08 + D-46 from Phase 2); the
 *     client renders via `useZodErrorMessage` from `src/lib/forms/zod-i18n.ts`;
 *     server logs the raw English key per I18N-11.
 *   - `_meta.idempotencyKey` is optional on the atomic mutation
 *     (`enterResultInput`) so the idempotency middleware shipped in Plan
 *     04-03 can short-circuit duplicate Save-button mashing (VALID-08).
 *
 * D-69 atomic-entry contract: the form submits ONE payload
 * `{outcome, matches[]}` and the server commits both halves in a single
 * transaction. `matches.min(1, { message: 'errors.tournament.atLeastOneMatchRequired' })`
 * is the input-layer half of that invariant; the transaction in
 * `routers/tournament.ts` is the storage-layer half. Together they make a
 * tournament_results row without ≥1 match_results row structurally impossible.
 *
 * Set-count cross-field refine: a table-tennis match is best-of-5 or best-of-7,
 * so `sets_won + sets_lost ∈ [1, 7]` (best-of-5 = up-to-5 sets; best-of-7 =
 * up-to-7 sets; tally of 0 is meaningless — would mean the match never started).
 * The DB CHECK constraint (`match_results_sets_total_range`) is the
 * authoritative gate; Zod gives the form a friendlier i18n key.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-69..D-81
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 3
 *            src/server/trpc/schemas/training.ts (Phase 4 Plan 04-03 analog)
 *            src/server/trpc/schemas/calendar.ts (tournamentCreateBranch — discriminated union)
 */
import { z } from 'zod';

// ─── Per-match row in the atomic enterResult payload (D-69 + D-80 + D-81) ──

/**
 * One row in the `match_results` table from the form's match-grid.
 *
 * Fields:
 *   - `round`         FK tournament_round.code (lookup; e.g. 'round_final',
 *                     'round_semi'). Required because every match belongs to
 *                     a draw round.
 *   - `opponent`      free text 1..200 chars. CHECK constraint at the DB
 *                     mirrors this. Per D-80 + CONTEXT "Claude's discretion"
 *                     the opponent name is competitive metadata — never an
 *                     account in the platform — so free-text is the right
 *                     shape (no "opponents" lookup table).
 *   - `opponentRanking` integer > 0 OR null. Optional context for analytics.
 *   - `matchDate`     PG `date` column (no time). `z.coerce.date()` accepts
 *                     ISO strings and Date instances.
 *   - `setsWon`/`setsLost` smallint 0..4 each (best-of-5 → max 3 wins, max
 *                     2 losses; best-of-7 → max 4 each). The
 *                     `sets_won + sets_lost ∈ [1,7]` cross-field refine
 *                     enforces "match actually played".
 *   - `videoLink`     optional URL ≤ 500 chars. Zod `.url()` runs first; DB
 *                     CHECK enforces length backstop.
 */
const matchRowSchema = z
  .object({
    round: z.string().min(1, { message: 'errors.field.required' }),
    opponent: z
      .string()
      .min(1, { message: 'errors.field.required' })
      .max(200, { message: 'errors.tournament.opponentLength' }),
    opponentRanking: z.number().int().positive().nullable(),
    matchDate: z.coerce.date(),
    setsWon: z
      .number()
      .int()
      .min(0, { message: 'errors.tournament.setRange' })
      .max(4, { message: 'errors.tournament.setRange' }),
    setsLost: z
      .number()
      .int()
      .min(0, { message: 'errors.tournament.setRange' })
      .max(4, { message: 'errors.tournament.setRange' }),
    videoLink: z
      .string()
      .url({ message: 'errors.tournament.videoLink' })
      .max(500, { message: 'errors.tournament.videoLink' })
      .nullable(),
  })
  .strict()
  .refine((m) => m.setsWon + m.setsLost >= 1 && m.setsWon + m.setsLost <= 7, {
    message: 'errors.tournament.setRange',
    path: ['setsWon'],
  });
export type MatchRowInput = z.infer<typeof matchRowSchema>;

// ─── enterResult (D-69 atomic + D-71 player wall + D-73 trainer/TD bypass) ──

export const enterResultInput = z
  .object({
    tournamentEventId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
    playerUserId: z.string().uuid({ message: 'errors.field.invalidUuid' }),
    /**
     * FK `outcome_level.code` (lookup seeded by 0017). 9 codes:
     * outcome_winner / outcome_finalist / outcome_last_4 / outcome_last_8 /
     * outcome_last_16 / outcome_last_32 / outcome_last_64 / outcome_pool /
     * outcome_dnp.
     */
    outcome: z.string().min(1, { message: 'errors.tournament.outcomeRequired' }),
    /**
     * D-69 atomic invariant: at least one match row required. `.min(1)`
     * rejects an empty array at the input layer; the handler's transaction
     * is the storage-layer backstop (no INSERT happens at all on rejection).
     */
    matches: z
      .array(matchRowSchema)
      .min(1, { message: 'errors.tournament.atLeastOneMatchRequired' }),
    /** VALID-08 idempotency key — picked up by `idempotencyMiddleware`. */
    _meta: z
      .object({
        idempotencyKey: z.string().min(8).max(128).optional(),
      })
      .optional(),
  })
  .strict();
export type EnterResultInput = z.infer<typeof enterResultInput>;

// ─── Tournament management (D-79 — TD-only) ────────────────────────────

export const tournamentCreateInput = z
  .object({
    /** Tournament name — surfaces as `calendar_events.title`. */
    naam: z
      .string()
      .min(1, { message: 'errors.field.required' })
      .max(200, { message: 'errors.tournament.opponentLength' }),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    city: z
      .string()
      .min(1, { message: 'errors.field.required' })
      .max(120, { message: 'errors.tournament.opponentLength' }),
    /** ISO 3166-1 alpha-2 — DB CHECK enforces length=2. */
    country: z.string().length(2, { message: 'errors.field.country' }),
    ageCategoryCode: z
      .string()
      .min(1, { message: 'errors.field.required' }),
    tournamentTypeCode: z
      .string()
      .min(1, { message: 'errors.field.required' }),
    description: z.string().max(2000).nullable(),
  })
  .strict()
  .refine((t) => t.endsAt >= t.startsAt, {
    message: 'errors.calendar.endsAfterStarts',
    path: ['endsAt'],
  });
export type TournamentCreateInput = z.infer<typeof tournamentCreateInput>;

export const addParticipantInput = z
  .object({
    tournamentEventId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
    playerUserId: z.string().uuid({ message: 'errors.field.invalidUuid' }),
  })
  .strict();
export type AddParticipantInput = z.infer<typeof addParticipantInput>;

export const removeParticipantInput = z
  .object({
    tournamentEventId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
    playerUserId: z.string().uuid({ message: 'errors.field.invalidUuid' }),
  })
  .strict();
export type RemoveParticipantInput = z.infer<typeof removeParticipantInput>;

// ─── Read-only inputs ──────────────────────────────────────────────────

export const listResultsInput = z
  .object({
    tournamentEventId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
  })
  .strict();
export type ListResultsInput = z.infer<typeof listResultsInput>;

export const listPendingForPlayerInput = z
  .object({
    /** Optional override — defaults to the caller's own user id when omitted. */
    playerUserId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' })
      .optional(),
  })
  .strict();
export type ListPendingForPlayerInput = z.infer<
  typeof listPendingForPlayerInput
>;

export const tournamentListInput = z
  .object({
    ageCategoryCodes: z.array(z.string()).optional(),
    tournamentTypeCodes: z.array(z.string()).optional(),
    startFrom: z.coerce.date().optional(),
    startTo: z.coerce.date().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();
export type TournamentListInput = z.infer<typeof tournamentListInput>;

export const tournamentGetInput = z
  .object({
    tournamentEventId: z
      .string()
      .uuid({ message: 'errors.field.invalidUuid' }),
  })
  .strict();
export type TournamentGetInput = z.infer<typeof tournamentGetInput>;
