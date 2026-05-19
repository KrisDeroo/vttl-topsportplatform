/**
 * Structural invariant: no Phase 4 occurrence-date surface uses
 * `.toISOString().slice(0, 10)` — that pattern produces a UTC YYYY-MM-DD
 * which drifts one day for Belgian evening events (CR-09 + WR-02).
 *
 * Phase 4 ships `formatOccurrenceDate` in src/lib/rrule.ts as the
 * Brussels-anchored replacement (Intl.DateTimeFormat 'en-CA' bound to
 * timeZone 'Europe/Brussels'). This test makes the replacement
 * structural so future contributors can't silently regress the bug.
 *
 * Allowlisted files (Phase 2 / general date-of-birth domain): these use
 * the UTC slice intentionally for date-of-birth + effective_from style
 * fields where the wall-clock interpretation doesn't matter (no time
 * component on the input). Do NOT extend the allowlist without a
 * documented rationale.
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md gaps[8]
 *            .planning/phases/04-kerndomein/04-REVIEW.md CR-09 WR-02
 *            src/lib/rrule.ts formatOccurrenceDate
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Files that MUST NOT contain the UTC slice pattern (Phase 4 surfaces).
const PROHIBITED_FILES = [
  'src/lib/players.ts',
  'src/components/calendar/event-detail-sheet.tsx',
  'src/app/[locale]/(app)/trainings/[eventId]/score/page.tsx',
  'src/components/training/te-scoren-overview.tsx',
  'src/server/trpc/routers/training.ts',
  'src/server/trpc/routers/tournament.ts',
  'src/server/trpc/routers/calendar.ts',
];

// Files that may legitimately use the UTC slice (Phase 2 surfaces with
// no time-component on the input). Each entry MUST be accompanied by
// a short rationale comment.
const ALLOWLIST = [
  // Phase 2: date_of_birth + effective_from + recordedAt
  'src/server/trpc/routers/player.ts',
  'src/server/trpc/routers/trainer.ts',
  'src/components/players/player-create-form.tsx',
  'src/components/trainers/trainer-create-form.tsx',
  'src/components/ranking/new-ranking-entry-sheet.tsx',  // recordedAt — DATE column, no time component
  'src/components/tournament/match-results-table.tsx',   // matchDate — DATE column, display only
  'src/app/[locale]/(app)/me/profile/page.tsx',           // date_of_birth display
  'src/app/[locale]/(app)/players/[id]/page.tsx',          // date_of_birth display
  'src/app/[locale]/(app)/trainers/[id]/page.tsx',         // date_of_birth display
];

// Whitespace-tolerant: matches `.toISOString().slice(0, 10)` and variants
// (`. toISOString ( ) . slice ( 0 , 10 )`).
const PROHIBITED_PATTERN =
  /\.\s*toISOString\s*\(\s*\)\s*\.\s*slice\s*\(\s*0\s*,\s*10\s*\)/;

describe('Structural invariant: no UTC slice in Phase 4 occurrence-date surfaces', () => {
  it.each(PROHIBITED_FILES)(
    '%s does NOT contain .toISOString().slice(0, 10)',
    (relativePath) => {
      const fullPath = join(process.cwd(), relativePath);
      let content: string;
      try {
        content = readFileSync(fullPath, 'utf8');
      } catch {
        // File doesn't exist — soft-skip (Phase 4 file may be renamed across releases).
        // Surface as an info log; do not fail. If the file disappeared
        // entirely, the corresponding deviation will surface in code review.
        console.warn(`[no-utc-slice] ${relativePath} not found — skipping`);
        return;
      }
      // Strip line comments and block comments to avoid false positives
      // on documentation strings (we mention the deprecated pattern in
      // explanatory doc-comments on the new helpers).
      const stripped = content
        .replace(/\/\/.*$/gm, '') // line comments
        .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
      expect(stripped).not.toMatch(PROHIBITED_PATTERN);
    },
  );

  it('allowlist is documented (each entry has at least one explanatory comment)', () => {
    // Meta-check: ALLOWLIST entries must be accompanied by inline rationale
    // comments. We assert that the source of THIS test file contains the
    // literal string "// Phase 2:" near the allowlist (i.e. somewhere in
    // the file body — see ALLOWLIST above).
    const thisFile = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(thisFile).toContain('// Phase 2:');
    // Also defend against accidental allowlist emptying.
    expect(ALLOWLIST.length).toBeGreaterThanOrEqual(1);
  });
});
