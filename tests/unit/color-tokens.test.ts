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

  it('FullCalendar variable overrides --fc-border-color / --fc-page-bg-color present in .fc block', () => {
    // Find the .fc { ... } block in globals.css.
    const fcBlockMatch = css.match(/\.fc\s*\{([\s\S]*?)\}/);
    expect(fcBlockMatch, '.fc {} block not found in globals.css').toBeTruthy();
    const fcBlock = fcBlockMatch?.[1] ?? '';
    expect(fcBlock).toContain('--fc-border-color:');
    expect(fcBlock).toContain('--fc-page-bg-color:');
    // Spot-check a couple more tokens declared by UI-SPEC.
    expect(fcBlock).toContain('--fc-today-bg-color:');
    expect(fcBlock).toContain('--fc-event-min-height:');
  });

  it('Mobile @media (max-width: 640px) overrides --fc-event-min-height: 2.75rem', () => {
    // Match the @media block precisely so the assertion can't drift on any
    // surrounding declaration.
    const mediaMatch = css.match(
      /@media\s*\(\s*max-width:\s*640px\s*\)\s*\{[\s\S]*?\.fc\s*\{([\s\S]*?)\}\s*\}/,
    );
    expect(
      mediaMatch,
      '@media (max-width: 640px) { .fc { ... } } block not found',
    ).toBeTruthy();
    const block = mediaMatch?.[1] ?? '';
    expect(block).toMatch(/--fc-event-min-height:\s*2\.75rem/);
  });
});

describe('Phase 4 design tokens — UI4-D02 + UI4-D03 (Belgium tier + state-overlay)', () => {
  const CLS_TIERS = ['a', 'b', 'c', 'd', 'e', 'nc'] as const;
  const STATE_FLAVORS = ['needs-action', 'nudge-warning', 'nudge-critical'] as const;
  const SLOTS = ['bg', 'fg', 'border'] as const;

  it.each(CLS_TIERS)(
    'declares --cls-tier-%s-{bg,fg,border} in :root (light mode)',
    (tier) => {
      for (const slot of SLOTS) {
        expect(
          css,
          `missing --cls-tier-${tier}-${slot} in globals.css`,
        ).toContain(`--cls-tier-${tier}-${slot}:`);
      }
    },
  );

  it.each(CLS_TIERS)(
    'declares --cls-tier-%s-{bg,fg,border} in .dark block (dark mode)',
    (tier) => {
      const darkBlocks = css.split('.dark {').slice(1);
      const containsAll = darkBlocks.some((after) => {
        const block = after.split('}')[0] ?? '';
        return SLOTS.every((slot) =>
          block.includes(`--cls-tier-${tier}-${slot}:`),
        );
      });
      expect(
        containsAll,
        `--cls-tier-${tier}-{bg,fg,border} not all found inside any .dark block`,
      ).toBe(true);
    },
  );

  it.each(STATE_FLAVORS)(
    'declares --state-%s-{bg,fg,border} in :root (light mode)',
    (flavor) => {
      for (const slot of SLOTS) {
        expect(
          css,
          `missing --state-${flavor}-${slot} in globals.css`,
        ).toContain(`--state-${flavor}-${slot}:`);
      }
    },
  );

  it.each(STATE_FLAVORS)(
    'declares --state-%s-{bg,fg,border} in .dark block (dark mode)',
    (flavor) => {
      const darkBlocks = css.split('.dark {').slice(1);
      const containsAll = darkBlocks.some((after) => {
        const block = after.split('}')[0] ?? '';
        return SLOTS.every((slot) =>
          block.includes(`--state-${flavor}-${slot}:`),
        );
      });
      expect(
        containsAll,
        `--state-${flavor}-{bg,fg,border} not all found inside any .dark block`,
      ).toBe(true);
    },
  );

  it('exposes new Phase 4 tokens via @theme inline (Tailwind utility surface)', () => {
    // Per UI-SPEC §Color: tokens consumed as `bg-cls-tier-a-bg`,
    // `text-state-nudge-critical-fg`, etc. requires `--color-*` aliases
    // inside `@theme inline { ... }`.
    expect(css).toContain('--color-cls-tier-a-bg:');
    expect(css).toContain('--color-cls-tier-nc-border:');
    expect(css).toContain('--color-state-needs-action-bg:');
    expect(css).toContain('--color-state-nudge-critical-border:');
  });
});
