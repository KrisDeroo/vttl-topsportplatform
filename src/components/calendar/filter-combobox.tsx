/**
 * <FilterCombobox> — shadcn Command + Popover typeahead backed by
 * `trpc.calendar.filterOptions.list` (scope-filtered server-side).
 *
 * Two surfaces consume this:
 *   1. <EventFilterBar> — one combo per kind (player / trainer /
 *      sparring_partner / academy)
 *   2. <EventCreateSheet> / <EventEditSheet> participant picker (player +
 *      trainer + sparring_partner kinds composed into a single multi-select
 *      per UI-SPEC §Form-field contract line 324)
 *
 * Scope enforcement is the server's responsibility (D-50 + D-36 carry-forward):
 *   - Each FilterCombobox calls the same tRPC procedure with a `kind` arg.
 *   - The server returns ONLY options visible in the caller's scope
 *     (calendar.ts router lines 1004-1054).
 *   - `sparring_partner` kind returns `[]` for every role in Phase 3
 *     (D-50 no-op; Phase 4 introduces the entity). UI renders the combo
 *     for layout consistency — the empty options list is the only signal.
 *
 * The combobox lets `cmdk` do its own client-side filtering disabled
 * (`shouldFilter={false}`) so the server's name-LIKE search is authoritative
 * (otherwise we'd double-filter and the user would see "no results" when
 * the server returned a paged subset that doesn't match the local cmdk
 * substring algorithm).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Filter Bar Contract
 *            (lines 398-429, especially §RBAC scope enforcement)
 *            src/server/trpc/routers/calendar.ts filterOptions.list
 */
'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { trpc } from '@/lib/trpc-client';
import { cn } from '@/lib/utils';

export type FilterComboboxKind =
  | 'player'
  | 'trainer'
  | 'sparring_partner'
  | 'academy';

interface Props {
  kind: FilterComboboxKind;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Button label (e.g. "Speler", "Trainer"). */
  label: string;
}

export function FilterCombobox({
  kind,
  selectedIds,
  onChange,
  label,
}: Props) {
  const t = useTranslations('calendar.filters');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // tRPC's React Query layer dedupes identical inputs; the staleTime here is
  // the cheap form of debounce — repeat keystrokes don't re-fire while the
  // last result is still fresh. A true 200ms debounce ships in Phase 4 when
  // the filter row grows additional combos.
  const { data: options = [] } = trpc.calendar.filterOptions.list.useQuery(
    { kind, query },
    {
      staleTime: 30_000,
      // Render an empty list while loading so the combo stays usable.
      placeholderData: (prev) => prev ?? [],
    },
  );

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className="min-w-[10rem] justify-between"
        >
          <span className="truncate">
            {label}
            {selectedIds.length > 0 && (
              <span className="ml-1 text-muted-foreground">
                · {selectedIds.length}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('searchPlaceholder')}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => toggle(o.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      selectedIds.includes(o.id) ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
