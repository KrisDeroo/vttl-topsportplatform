/**
 * Zod input schemas for training.* tRPC procedures (Phase 4 Wave 2 — D-60..D-68).
 *
 * All schemas use `.strict()` (VALID-06 carry-forward from Phase 2 / Phase 3
 * — rejects unknown keys, mitigates T-04-20-INPUT-SMUGGLING-VIA-EXTRA-FIELDS).
 * All error messages are i18n keys (I18N-08 + D-46 from Phase 2); the client
 * renders via `useZodErrorMessage` from `src/lib/forms/zod-i18n.ts`; server
 * logs the raw key in English per I18N-11.
 *
 * `_meta.idempotencyKey` is optional on bulk-mutation inputs so the
 * idempotency middleware (VALID-08, Phase 4 Plan 04-03) can short-circuit
 * duplicate Save-button mashing without breaking type-safety on the call
 * site. Length 8..128 chars accommodates UUIDs, nanoids, and longer
 * client-generated opaque strings.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md D-62, D-64, D-66, D-68
 *            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 2 + §Pitfall 5
 *            src/server/trpc/schemas/calendar.ts (Phase 3 analog — discriminated union)
 */
import { z } from 'zod';

// ─── Per-participant row in the bulk upsert form (D-62) ────────────────

const participantRowSchema = z
  .object({
    userId: z.string().uuid({ message: 'errors.field.invalidUuid' }),
    /**
     * Tri-state per D-62:
     *   true        → "aanwezig"
     *   false       → "afwezig" / "absent_medical" (the form selects which;
     *                 the DB column does not distinguish — feedback_text /
     *                 medical-conflict flag carry the reason).
     *   null        → "nog niet ingevuld" (trainer left the row pending).
     */
    attended: z.boolean().nullable(),
    /**
     * D-60: smallint 1..10 (DB CHECK constraint
     * `session_participants_quality_score_range`). v1 UI is 5-star; map
     * via `src/lib/quality-score.ts` mapStarsToDb. NULL = not scored yet
     * (within the 14d window the trainer can revisit).
     */
    qualityScore: z
      .number()
      .int({ message: 'errors.training.scoreRange' })
      .min(1, { message: 'errors.training.scoreRange' })
      .max(10, { message: 'errors.training.scoreRange' })
      .nullable(),
    /**
     * Free-text feedback per D-61. DB CHECK constraint enforces ≤ 2000
     * chars; Zod gives the user a friendlier i18n key before hitting the
     * DB-level rejection.
     */
    feedbackText: z
      .string()
      .max(2000, { message: 'errors.training.feedbackTooLong' })
      .nullable(),
  })
  .strict();

// ─── markAttendanceAndScore (D-62 bulk combined form) ───────────────────

export const markAttendanceAndScoreInput = z
  .object({
    eventId: z.string().uuid({ message: 'errors.field.invalidUuid' }),
    /**
     * D-82: per-occurrence row. The form submits the date (YYYY-MM-DD)
     * of the specific occurrence — for non-recurring sessions, the
     * starts_at date; for recurring sessions, the trainer-selected
     * occurrence (Phase 3 rrule expansion).
     *
     * `z.coerce.date()` accepts both ISO strings and Date instances so
     * the same schema works from React (string) and from server-side
     * tests (Date).
     */
    occurrenceDate: z.coerce.date(),
    participants: z
      .array(participantRowSchema)
      .min(1, { message: 'errors.training.participantsRequired' }),
    /** VALID-08 idempotency key — picked up by `idempotencyMiddleware`. */
    _meta: z
      .object({
        idempotencyKey: z.string().min(8).max(128).optional(),
      })
      .optional(),
  })
  .strict();
export type MarkAttendanceAndScoreInput = z.infer<
  typeof markAttendanceAndScoreInput
>;

// ─── listPending (D-66 trainer self / D-68 TD all) ──────────────────────

export const listPendingInput = z
  .object({
    /**
     * D-66 = `self` (trainer sees their own pending sessions).
     * D-68 = `all` (TD sees every trainer's pending sessions, used for
     *               nudging trainers + filling gaps). Player/parent/etc.
     *               cannot call this procedure at all (FORBIDDEN before
     *               reaching the handler scope-check).
     */
    scope: z.enum(['self', 'all']).default('self'),
  })
  .strict();
export type ListPendingInput = z.infer<typeof listPendingInput>;

// ─── getSession (D-62 form preload + DOM-MED-CONFLICT-02 pre-flag) ─────

export const getSessionInput = z
  .object({
    eventId: z.string().uuid({ message: 'errors.field.invalidUuid' }),
    occurrenceDate: z.coerce.date(),
  })
  .strict();
export type GetSessionInput = z.infer<typeof getSessionInput>;
