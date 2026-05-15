/**
 * <EventFilterBar> — Desktop inline + Mobile bottom Sheet (UI-SPEC
 * §Filter Bar Contract, lines 398-429).
 *
 * Single component renders BOTH the desktop inline row (≥ md) and the mobile
 * bottom Sheet (< md). The mobile Sheet opens in response to the
 * `calendar:open-filters` custom DOM event dispatched by <CalendarToolbar>
 * (Plan 06).
 *
 * Filter state is URL-canonical:
 *   ?filter=<base64(JSON({ types, playerIds, trainerIds, sparringPartnerIds, academies }))>
 *
 * Empty arrays are omitted from the encoded payload. The Server Component
 * <CalendarPage> decodes the same shape for its `calendar.list` pre-fetch.
 *
 * Browser-side base64 uses `btoa`/`atob` (UTF-8 safe via TextEncoder for
 * names containing non-ASCII characters — academy names sometimes carry
 * accented characters in fr).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Filter Bar Contract
 *            .planning/phases/03-kalender/03-UI-SPEC.md §URL persistence
 *            (lines 420-422 — base64 JSON schema)
 *            <CalendarToolbar> dispatches `calendar:open-filters`
 */
'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  FilterCombobox,
  type FilterComboboxKind,
} from '@/components/calendar/filter-combobox';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const EVENT_TYPES = [
  'event_type_training',
  'event_type_tournament',
  'event_type_meeting',
  'event_type_stage',
  'event_type_eval_conversation',
  'event_type_medical',
] as const;

interface FilterState {
  types: string[];
  playerIds: string[];
  trainerIds: string[];
  sparringPartnerIds: string[];
  academies: string[];
}

const EMPTY: FilterState = {
  types: [],
  playerIds: [],
  trainerIds: [],
  sparringPartnerIds: [],
  academies: [],
};

/** UTF-8-safe base64 encode for browser context. */
function b64encode(value: string): string {
  if (typeof window === 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }
  // Re-encode UTF-8 → binary string → btoa (RFC 3986 round-trip).
  return btoa(
    new TextEncoder()
      .encode(value)
      .reduce((acc, b) => acc + String.fromCharCode(b), ''),
  );
}

/** UTF-8-safe base64 decode. Returns `null` on malformed input. */
function b64decode(raw: string): string | null {
  try {
    if (typeof window === 'undefined') {
      return Buffer.from(raw, 'base64').toString('utf8');
    }
    const bin = atob(raw);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function decodeFilter(raw: string | null): FilterState {
  if (!raw) return EMPTY;
  const json = b64decode(raw);
  if (!json) return EMPTY;
  try {
    const parsed = JSON.parse(json) as Partial<FilterState>;
    return {
      types: Array.isArray(parsed.types) ? parsed.types : [],
      playerIds: Array.isArray(parsed.playerIds) ? parsed.playerIds : [],
      trainerIds: Array.isArray(parsed.trainerIds) ? parsed.trainerIds : [],
      sparringPartnerIds: Array.isArray(parsed.sparringPartnerIds)
        ? parsed.sparringPartnerIds
        : [],
      academies: Array.isArray(parsed.academies) ? parsed.academies : [],
    };
  } catch {
    return EMPTY;
  }
}

function encodeFilter(state: FilterState): string | null {
  const compact: Partial<FilterState> = {};
  if (state.types.length > 0) compact.types = state.types;
  if (state.playerIds.length > 0) compact.playerIds = state.playerIds;
  if (state.trainerIds.length > 0) compact.trainerIds = state.trainerIds;
  if (state.sparringPartnerIds.length > 0)
    compact.sparringPartnerIds = state.sparringPartnerIds;
  if (state.academies.length > 0) compact.academies = state.academies;
  if (Object.keys(compact).length === 0) return null;
  return b64encode(JSON.stringify(compact));
}

function countActive(s: FilterState): number {
  return (
    s.types.length +
    s.playerIds.length +
    s.trainerIds.length +
    s.sparringPartnerIds.length +
    s.academies.length
  );
}

interface ComboSpec {
  kind: FilterComboboxKind;
  key: keyof Pick<
    FilterState,
    'playerIds' | 'trainerIds' | 'sparringPartnerIds' | 'academies'
  >;
  labelKey: 'byPlayer' | 'byTrainer' | 'bySparring' | 'byAcademy';
}

const COMBOS: readonly ComboSpec[] = [
  { kind: 'player', key: 'playerIds', labelKey: 'byPlayer' },
  { kind: 'trainer', key: 'trainerIds', labelKey: 'byTrainer' },
  {
    kind: 'sparring_partner',
    key: 'sparringPartnerIds',
    labelKey: 'bySparring',
  },
  { kind: 'academy', key: 'academies', labelKey: 'byAcademy' },
] as const;

export function EventFilterBar() {
  const t = useTranslations('calendar');
  const tFilters = useTranslations('calendar.filters');
  const tLookup = useTranslations('lookup.eventType');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initial = useMemo(
    () => decodeFilter(search.get('filter')),
    [search],
  );
  const [state, setState] = useState<FilterState>(initial);

  // Keep local state in sync if the URL changes externally (e.g. browser
  // back/forward). useMemo above re-runs on searchParams change; this effect
  // mirrors the result into local state.
  useEffect(() => {
    setState(initial);
  }, [initial]);

  // CalendarToolbar's "Filters" button (mobile only) dispatches this event.
  useEffect(() => {
    const handler = () => setMobileOpen(true);
    document.addEventListener('calendar:open-filters', handler);
    return () => document.removeEventListener('calendar:open-filters', handler);
  }, []);

  const pushFilter = useCallback(
    (next: FilterState) => {
      const params = new URLSearchParams(search);
      const encoded = encodeFilter(next);
      if (encoded) params.set('filter', encoded);
      else params.delete('filter');
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, search],
  );

  const update = useCallback(
    (patch: Partial<FilterState>) => {
      const next = { ...state, ...patch };
      setState(next);
      pushFilter(next);
    },
    [state, pushFilter],
  );

  const clear = useCallback(() => {
    setState(EMPTY);
    pushFilter(EMPTY);
  }, [pushFilter]);

  const activeCount = countActive(state);
  const isActive = activeCount > 0;

  // ── Desktop inline (≥ md) ───────────────────────────────────────────
  const inline = (
    <div className="hidden flex-wrap items-center gap-2 md:flex">
      <ToggleGroup
        type="multiple"
        value={state.types}
        onValueChange={(types) => update({ types })}
        aria-label={tFilters('byType')}
      >
        {EVENT_TYPES.map((code) => (
          <ToggleGroupItem
            key={code}
            value={code}
            aria-label={tLookup(code)}
            className="min-w-20"
          >
            {tLookup(code)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {COMBOS.map((c) => (
        <FilterCombobox
          key={c.kind}
          kind={c.kind}
          selectedIds={state[c.key]}
          onChange={(ids) => update({ [c.key]: ids } as Partial<FilterState>)}
          label={tFilters(c.labelKey)}
        />
      ))}
      {isActive && (
        <Button variant="ghost" size="sm" onClick={clear}>
          {tFilters('clear')}
        </Button>
      )}
    </div>
  );

  // ── Mobile FAB-style trigger + bottom Sheet (< md) ──────────────────
  const mobileTrigger = (
    <div className="flex md:hidden">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setMobileOpen(true)}
        aria-label={t('actions.filters')}
      >
        <SlidersHorizontal className="mr-2 size-4" />
        {t('actions.filters')}
        {isActive && (
          <span className="ml-1 text-muted-foreground"> · {activeCount}</span>
        )}
      </Button>
    </div>
  );

  const mobileSheet = (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="bottom" className="md:hidden">
        <SheetHeader>
          <SheetTitle>{t('actions.filters')}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          <ToggleGroup
            type="multiple"
            value={state.types}
            onValueChange={(types) => update({ types })}
            aria-label={tFilters('byType')}
            className="flex-wrap"
          >
            {EVENT_TYPES.map((code) => (
              <ToggleGroupItem
                key={code}
                value={code}
                aria-label={tLookup(code)}
                className="min-w-20"
              >
                {tLookup(code)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {COMBOS.map((c) => (
            <FilterCombobox
              key={c.kind}
              kind={c.kind}
              selectedIds={state[c.key]}
              onChange={(ids) =>
                update({ [c.key]: ids } as Partial<FilterState>)
              }
              label={tFilters(c.labelKey)}
            />
          ))}
          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={clear}>
              {tFilters('clear')}
            </Button>
            <Button onClick={() => setMobileOpen(false)}>
              {tFilters('apply')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <>
      {inline}
      {mobileTrigger}
      {mobileSheet}
    </>
  );
}
