/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Pure-function RRULE coverage for `@/lib/rrule`.
 *
 * Reference: 03-CONTEXT.md D-52, D-53, D-54, D-55;
 *            03-RESEARCH.md §Pattern 3 (RRULE expansion + horizon clamp);
 *            03-VALIDATION.md Wave 0 Requirements (rrule.test.ts row).
 *
 * `@/lib/rrule` does not exist yet — these tests are RED until Wave 3 lands
 * the pure-function helpers. `it.todo` keeps them in the runnable suite as
 * pending (no false positives via never-asserted blocks).
 */
import { describe, it, expect } from 'vitest';
// The `@/lib/rrule` module lands in Wave 3. We DO NOT import it here so that
// the RED test file can still parse and execute under vitest pre-Wave 3.
// Once Wave 3 lands, the imports become real and each `it.todo` flips to `it`.
// Sketch of expected surface:
//   import { expandRrule, validateHorizon, parseRrule } from '@/lib/rrule';

describe('expandRrule — RFC 5545 expansion (D-53)', () => {
  it.todo('DST boundary: weekly Tuesday 10:00 Europe/Brussels — Oct 25 stays at 10:00 local');
  it.todo('applies exceptions: cancelled occurrences are skipped');
  it.todo('applies overrides: overrideStartsAt + overrideEndsAt replace original');
  it.todo('clamps read-time at dtstart + 2y per D-55');
});

describe('validateHorizon — D-55 write-time gate', () => {
  it.todo('rejects RRULE without UNTIL or COUNT');
  it.todo('rejects UNTIL beyond createdAt + 2y');
  it.todo('accepts UNTIL within window');
  it.todo('rejects rrule string containing DTSTART: per RESEARCH Anti-Pattern 1');
});

describe('parseRrule', () => {
  it.todo('throws on invalid RFC 5545 string');
  it.todo('parses FREQ=WEEKLY;UNTIL=... with explicit dtstart');
});

// Sanity guard: prove the test file is syntactically valid and the runner
// picks it up. This passes today; substantive coverage is the it.todo set
// above which converts to real assertions in Wave 3.
describe('rrule test scaffold metadata', () => {
  it('declares the canonical RRULE describe blocks', () => {
    expect(true).toBe(true);
  });
});
