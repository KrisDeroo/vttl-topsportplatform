/**
 * MobileNavToggle — hamburger button for the < md viewport.
 *
 * Lives next to the LocaleSwitcher in the layout header. Toggles the
 * `#mobile-nav-sheet` element via aria-expanded + the `hidden` attribute.
 * Plan 15 fills the sheet with the actual nav links — until then the sheet
 * exists in the DOM but is empty, which keeps a stable surface for E2E.
 *
 * Extracted from src/app/[locale]/layout.tsx because the layout itself is
 * a Server Component (it uses `await params`, getMessages(), notFound()).
 * The onClick handler can only run in a Client Component.
 *
 * Reference:
 *   - .planning/phases/01-fundament/01-08-PLAN.md Task 2 layout snippet
 *   - D-01: LocaleSwitcher MUST stay visible at every viewport — the
 *     hamburger only toggles non-locale nav items.
 */
'use client';

import { Menu } from 'lucide-react';
import { useCallback, useState } from 'react';

interface Props {
  /** Translation for the screen-reader label (defaults to English fallback). */
  label?: string;
}

export function MobileNavToggle({ label = 'Menu' }: Props) {
  const [open, setOpen] = useState(false);

  const onClick = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      // The mobile-nav-sheet is rendered alongside this button (server-side).
      // Toggle its `hidden` attribute so JS-disabled fallback still hides the
      // empty sheet, and CSS can layer additional rules without drift.
      const sheet = document.getElementById('mobile-nav-sheet');
      if (sheet) {
        if (next) sheet.removeAttribute('hidden');
        else sheet.setAttribute('hidden', '');
      }
      return next;
    });
  }, []);

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls="mobile-nav-sheet"
      className="md:hidden p-2"
      onClick={onClick}
    >
      <Menu className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
