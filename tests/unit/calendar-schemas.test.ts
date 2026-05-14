/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Zod discriminated-union per event_type — strict mode, i18n-key error
 * messages, write-time RRULE horizon validation, per-type required fields.
 *
 * Reference: 03-CONTEXT.md D-47 (six event types), D-48 (per-type RBAC),
 *            D-55 (write-time horizon), VALID-06 (.strict() everywhere);
 *            03-RESEARCH.md §Pattern 5 (Zod discriminated union);
 *            03-VALIDATION.md Wave 0 Requirements (calendar-schemas.test.ts).
 *
 * RED until Wave 3 ships `@/server/trpc/schemas/calendar`.
 */
import { describe, it, expect } from 'vitest';
// The schemas module lands in Wave 3. Sketch of expected surface:
//   import { eventCreateInput } from '@/server/trpc/schemas/calendar';

describe('eventCreateInput — discriminated union per event type', () => {
  it.todo('accepts a valid training payload (type=event_type_training + TRAIN-01 fields)');
  it.todo('accepts a valid tournament payload (type=event_type_tournament + TOURN-01 fields)');
  it.todo('accepts a valid meeting payload (type=event_type_meeting + invited users)');
  it.todo('accepts a valid stage payload (type=event_type_stage + players + trainers)');
  it.todo(
    'accepts a valid eval_conversation payload (type=event_type_eval_conversation + player + evaluator)',
  );
  it.todo('accepts a valid medical payload (type=event_type_medical + MED-EVENT fields)');
  it.todo('rejects training payload with unknown field (.strict() — VALID-06)');
  it.todo('emits i18n-key error messages (errors.calendar.endBeforeStart / errors.field.required)');
  it.todo('rejects when endsAt <= startsAt');
  it.todo('rejects rrule string with UNTIL beyond createdAt + 2y (D-55 write-time)');
  it.todo('rejects when type is unknown (discriminator branch missing)');
});
