# i18n Conventions (nl / en / fr)

VTTL ships a drietalig (nl/en/fr) UI. Every user-facing string is loaded
from `messages/{nl,en,fr}.json` via `next-intl`. Source code, pino logs,
and error codes remain English (I18N-11).

## Proper-noun rule (I18N-06, D-45)

Academy names, club names, person names, tournament event names are
**canonical** — stored once and rendered IDENTICALLY across all three
locales. The fr-UI for `Topsportschool Wilrijk` is `Topsportschool
Wilrijk`, not a translation.

Mechanism:
- `academy.canonical_name` column in `src/server/db/schema/lookups.ts`
  is `text NOT NULL`; the value is the canonical string.
- The i18n catalog keys `lookups.academy.<code>` exist for consistency
  with other lookup categories but their VALUES duplicate the canonical
  name verbatim across nl/en/fr.
- For person names, `users.name` is the canonical string; UI renders it
  identically in every locale.
- For free-text club names, the value stored in `players.club` is what
  the UI shows in every locale.

## Lookup-label resolver (D-44)

Lookup tables use language-neutral codes (e.g., `status_a`,
`age_pre_minor`, `diploma_a_in_training`). Display labels live in
`messages/{nl,en,fr}.json` under `lookups.<table>.<code>` (PLURAL root
— Phase 1 established `lookups`, Phase 2 keeps the plural).

Resolution helpers:

```typescript
// Client (inside a Client Component):
import { useTranslations } from 'next-intl';
const t = useTranslations('lookups.academy');
t('topsportschool')  // → "Topsportschool"

// Server (inside an RSC):
import { getTranslations } from 'next-intl/server';
const t = await getTranslations({ locale, namespace: 'lookups.academy' });
t('academy_brussel')
```

A small wrapper `useLookupLabel(category, code)` may emerge in Phase 5+
if multiple call sites repeat this pattern; Phase 2 keeps it inline.

## Zod error message → i18n key (I18N-08, D-46)

Every Zod schema in `src/server/trpc/schemas/*.ts` emits its `message`
field as an i18n key starting with `errors.` (flat namespace `errors.field.*`
and `errors.file.*`). The client adapter `src/lib/forms/zod-i18n.ts`
`useZodErrorMessage()` resolves the key via `useTranslations('errors')`.

Server-side: tRPC's error formatter (Phase 1) passes the message string
through unchanged; the calling client renders via the adapter.

## Catalog completeness

All keys MUST exist in all three catalogs. Missing keys in dev render
as `MISSING_KEY:nl.players.list.title` (D-20 Phase 1 fail-loud fallback).
The Phase 8 CI gate (I18N-10) will block production deploys with
missing keys.

## Adding a new key

1. Add the key to `messages/nl.json` first (Dutch is the source language).
2. Add the matching key to `messages/en.json` and `messages/fr.json` in
   the same PR (parity is enforced manually until I18N-10 ships).
3. For Zod errors: emit `{ message: 'errors.field.foo' }` in the schema;
   define `errors.field.foo` in all 3 catalogs.
4. For lookup labels: rule depends on whether the value is a proper noun
   (D-45 — identical across catalogs) or descriptive (translate per locale).

## What NOT to do

- **Never** introduce `display_name_nl` / `display_name_en` / `display_name_fr`
  columns on a lookup table. The proper-noun rule applies to all of them.
- **Never** hard-code Dutch (or any locale) strings in components.
- **Never** call `Intl.DateTimeFormat` directly — go through
  `src/lib/i18n-format.ts` (Phase 1) which honors the active locale and
  Belgian conventions (Monday weekstart, dd/MM/yyyy format).
- **Never** rely on the silent English-fallback in dev for missing keys —
  add the key to all 3 catalogs.
