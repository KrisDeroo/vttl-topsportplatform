'use client';

/**
 * Zod-error → i18n-key resolution adapter (D-46, I18N-08).
 *
 * Convention: every Zod schema in `src/server/trpc/schemas/*.ts` emits its
 * `message` as an i18n key (e.g., `'errors.field.required'`). On the client
 * side, react-hook-form's `formState.errors[field].message` is that key.
 * The shadcn `<FormMessage>` component renders `message` as-is, which would
 * show the literal key. This adapter wraps the resolution.
 *
 * Usage in a Client Component:
 *
 *   import { useZodErrorMessage } from '@/lib/forms/zod-i18n';
 *
 *   function MyForm() {
 *     const resolve = useZodErrorMessage();
 *     return (
 *       <FormMessage>
 *         {resolve(form.formState.errors.firstName?.message)}
 *       </FormMessage>
 *     );
 *   }
 *
 * Or, more idiomatically, plug it directly into the shadcn `<FormMessage>`
 * by composing a wrapper — see Plan 02-12 PhotoUpload widget for the
 * canonical usage.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-46
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 3
 */
import { useTranslations } from 'next-intl';

/**
 * Returns a function that resolves an i18n-key string (or undefined) to a
 * localised label. Pass-through for already-resolved strings is NOT
 * supported — Zod schemas should always emit keys.
 *
 * Missing keys produce `MISSING_KEY:errors.<...>` in dev (D-20 fail-loud
 * fallback from Phase 1); the Phase 8 CI gate (I18N-10) prevents shipping
 * incomplete catalogs.
 */
export function useZodErrorMessage(): (
  key: string | undefined,
) => string | undefined {
  const t = useTranslations('errors');
  return (key) => {
    if (!key) return undefined;
    // Strip the 'errors.' prefix if present — Zod schemas emit full paths
    // (`errors.field.required`) but next-intl's `useTranslations('errors')`
    // already scopes to the 'errors' namespace, so the suffix is the only
    // part it needs.
    const trimmed = key.startsWith('errors.')
      ? key.slice('errors.'.length)
      : key;
    return t(trimmed);
  };
}
