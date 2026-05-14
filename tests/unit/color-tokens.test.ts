/**
 * RED scaffold — Phase 3 Wave 0.
 *
 * Assert the 18 cal-event design tokens × 2 modes (light + dark) in globals.css
 * exist per UI-SPEC §Color (lines 146-202) and the FullCalendar variable
 * overrides + mobile media-query rules per UI-SPEC §FullCalendar built-in
 * CSS-variable overrides.
 *
 * Reference: 03-UI-SPEC.md §Color, 03-PATTERNS.md §Design tokens (CSS);
 *            03-VALIDATION.md Wave 0 Requirements (color-tokens.test.ts row).
 *
 * RED until Wave 2 (or Wave 4 UI lands) appends 36 CSS-variable declarations
 * to `src/app/[locale]/globals.css` + the `.fc` variable overrides.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cssPath = join(process.cwd(), 'src/app/[locale]/globals.css');
// readFileSync would crash the suite if globals.css were missing — but it
// shipped in Phase 1, so it must exist. If it ever disappears, this test is
// the first to fail.
const css = readFileSync(cssPath, 'utf8');

describe('Phase 3 design tokens — UI-SPEC §Color', () => {
  const TYPES = ['training', 'tournament', 'meeting', 'stage', 'evalconv', 'medical'] as const;
  const SLOTS = ['bg', 'fg', 'border'] as const;

  it.each(TYPES)('declares --cal-event-%s-{bg,fg,border} in :root', (type) => {
    for (const slot of SLOTS) {
      expect(css, `missing --cal-event-${type}-${slot} in globals.css`).toContain(
        `--cal-event-${type}-${slot}:`,
      );
    }
  });

  it.each(TYPES)('declares --cal-event-%s-{bg,fg,border} in .dark', (type) => {
    // crude scope detection: ensure both :root and .dark blocks each contain
    // the token name. Wave 2 will add the .dark block per UI-SPEC; until then
    // this fails honestly.
    const darkBlock = css.split('.dark {')[1]?.split('}')[0] ?? '';
    for (const slot of SLOTS) {
      expect(
        darkBlock,
        `missing --cal-event-${type}-${slot} inside .dark block`,
      ).toContain(`--cal-event-${type}-${slot}:`);
    }
  });

  it.todo('FullCalendar variable overrides --fc-border-color / --fc-page-bg-color present in .fc block');
  it.todo('Mobile @media (max-width: 640px) overrides --fc-event-min-height: 2.75rem');
});
