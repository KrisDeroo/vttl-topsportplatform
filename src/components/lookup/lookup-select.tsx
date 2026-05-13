'use client';

/**
 * LookupSelect — generic dropdown for the 4 lookup categories Phase 2 uses.
 *
 * Codes come from the DB (language-neutral); labels resolve via i18n
 * under the `lookups.<category>` namespace (D-44). Phase 2 categories:
 *   - academy        → academy table (PLAYER-02)
 *   - status         → status table (PLAYER-02)
 *   - ageCategory    → age_categories table (DOM-CAT-01)
 *   - trainerDiploma → trainer_diploma table (TRAINER-02)
 *
 * The `codes` prop is provided by the caller — a Server Component
 * pre-fetches the active code list via Drizzle and passes them down.
 * This keeps the client bundle small (no separate lookup tRPC list
 * endpoint) and is what 02-13/02-14 pages compose against.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-44
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md
 *              §Component Inventory (LookupSelect row)
 */
import { useTranslations } from 'next-intl';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type LookupCategory =
  | 'academy'
  | 'status'
  | 'ageCategory'
  | 'trainerDiploma';

export interface LookupSelectProps {
  category: LookupCategory;
  /** Pre-fetched active codes for the category (Server-Component-provided). */
  codes: readonly string[];
  value?: string;
  onValueChange?(code: string): void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
}

export function LookupSelect({
  category,
  codes,
  value,
  onValueChange,
  placeholder,
  disabled,
  name,
}: LookupSelectProps) {
  // Catalog root is `lookups` (plural) — Phase 1 baseline confirmed by
  // messages/{nl,en,fr}.json. Do NOT switch to singular `lookup.*`.
  const t = useTranslations(`lookups.${category}`);

  // Spread only the props the caller actually supplied so that
  // exactOptionalPropertyTypes does not reject `undefined` literals
  // for optional Radix props.
  const rootProps: {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    name?: string;
  } = {};
  if (value !== undefined) rootProps.value = value;
  if (onValueChange !== undefined) rootProps.onValueChange = onValueChange;
  if (disabled !== undefined) rootProps.disabled = disabled;
  if (name !== undefined) rootProps.name = name;

  return (
    <Select {...rootProps}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {codes.map((code) => (
          <SelectItem key={code} value={code}>
            {t(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
