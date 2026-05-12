---
phase: 02-identiteit-bestanden
plan_id: 02-12-ui-shared-components
plan: 12
type: execute
wave: 5
depends_on: [02-09-trpc-router-file, 02-10-trpc-routers-player-trainer, 02-11-i18n-catalog-additions, 02-04-storage-magic-bytes-helpers]
files_modified:
  - src/components/file/photo-upload.tsx
  - src/components/lookup/lookup-select.tsx
  - src/components/common/empty-state.tsx
  - components.json
autonomous: true
requirements:
  - PLAYER-05
  - VALID-01
  - VALID-03
  - I18N-08

must_haves:
  truths:
    - "shadcn primitives added via `npx shadcn@latest add ...`: input, label, form, textarea, radio-group, checkbox, calendar, popover, avatar, dialog, alert-dialog, card, badge, separator, skeleton, tabs, sonner, tooltip"
    - "PhotoUpload component supports all 7 visual states from UI-SPEC (empty, dragging, uploading, scanPending, clean, infected, disabled)"
    - "PhotoUpload polls trpc.file.getScanStatus every 2s, stops at 30s timeout or terminal state"
    - "PhotoUpload client-side checks size + type (UX hint per D-23) but server is authoritative"
    - "LookupSelect wraps shadcn Select; takes `category` prop ∈ {'academy'|'status'|'age_category'|'trainer_diploma'}; renders i18n labels"
    - "EmptyState component: icon + title + body + optional CTA; used by /players empty + /trainers empty"
  artifacts:
    - path: "src/components/file/photo-upload.tsx"
      provides: "self-built drag-drop photo upload widget"
      contains: "'use client'"
      min_lines: 150
    - path: "src/components/lookup/lookup-select.tsx"
      provides: "i18n-aware lookup dropdown"
      contains: "'use client'"
      min_lines: 30
    - path: "src/components/common/empty-state.tsx"
      provides: "shared empty-state card"
      contains: "EmptyState"
      min_lines: 20
  key_links:
    - from: "src/components/file/photo-upload.tsx"
      to: "tRPC client (trpc.file.upload + trpc.file.getScanStatus)"
      via: "useMutation + useQuery polling"
      pattern: "trpc\\.file\\."
    - from: "src/components/lookup/lookup-select.tsx"
      to: "next-intl useTranslations"
      via: "translate lookup codes to active locale"
      pattern: "useTranslations\\("
---

<objective>
Build the 3 reusable Client Components that the page-level forms (02-13) compose:

1. **PhotoUpload** (`src/components/file/photo-upload.tsx`): self-built drag-drop widget per D-41 + UI-SPEC §Photo Upload Widget. Implements the 7 visual states with i18n keys, runs the upload → poll → clean/infected lifecycle. NO `react-dropzone` dependency.
2. **LookupSelect** (`src/components/lookup/lookup-select.tsx`): generic dropdown for the 4 lookup categories Phase 2 uses (academy, status, age_category, trainer_diploma). Resolves labels via i18n.
3. **EmptyState** (`src/components/common/empty-state.tsx`): icon + title + body + optional CTA card.

Also install the 18 shadcn primitives from UI-SPEC §Components to add (input, label, form, textarea, radio-group, checkbox, calendar, popover, avatar, dialog, alert-dialog, card, badge, separator, skeleton, tabs, sonner, tooltip) — these go into `src/components/ui/` via `pnpm dlx shadcn@latest add`.

Output: 3 custom components + 18 shadcn primitive files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-UI-SPEC.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@components.json
@CLAUDE.md

<interfaces>
<!-- shadcn primitives (added in this plan): -->
- Avatar, AvatarImage, AvatarFallback — `src/components/ui/avatar.tsx`
- Badge — `src/components/ui/badge.tsx`
- Button — already shipped in Phase 1
- Card, CardHeader, CardTitle, CardContent, CardFooter — `src/components/ui/card.tsx`
- Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter — `src/components/ui/dialog.tsx`
- AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel — `src/components/ui/alert-dialog.tsx`
- Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage — `src/components/ui/form.tsx`
- Select — already shipped in Phase 1
- Skeleton — `src/components/ui/skeleton.tsx`
- Sonner toast — `src/components/ui/sonner.tsx`
- Tooltip — `src/components/ui/tooltip.tsx`
- Input, Label, Textarea, RadioGroup, Checkbox, Calendar, Popover, Tabs, Separator — all `src/components/ui/*`

<!-- tRPC client (Phase 1, src/lib/trpc-client.ts) -->
import { trpc } from '@/lib/trpc-client';
const upload = trpc.file.upload.useMutation();
const status = trpc.file.getScanStatus.useQuery({ fileId }, { refetchInterval: 2000, enabled: ... });
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Install 18 shadcn primitives via CLI</name>
  <read_first>
    - components.json (current shadcn config)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Components to add via `npx shadcn@latest add`
  </read_first>
  <files>
    components.json
  </files>
  <action>
    Run (single command — shadcn batches the install):

    ```bash
    pnpm dlx shadcn@latest add \
      input label form textarea radio-group checkbox \
      calendar popover avatar dialog alert-dialog \
      card badge separator skeleton tabs sonner tooltip
    ```

    Accept the CLI's overwrite prompts only for new files (button + select already exist from Phase 1; the CLI will skip those). Each component lands in `src/components/ui/<name>.tsx`.

    After the install:
    - Confirm `components.json` was NOT modified (Phase 1 baseline preserved — the CLI only adds component files).
    - If `pnpm dlx` reports peer-dep installs (e.g., `react-day-picker` for Calendar), accept — those are Tailwind-pure and add no third-party registry blocks (Registry Safety check from UI-SPEC line 442).

    Do NOT install `tablecn`, `originui`, or any non-official-shadcn registry.
    Do NOT install Heroicons or material-icons — UI-SPEC mandates lucide-react only.
  </action>
  <verify>
    <automated>for c in input label form textarea radio-group checkbox calendar popover avatar dialog alert-dialog card badge separator skeleton tabs sonner tooltip; do test -f "src/components/ui/${c}.tsx" || { echo "missing: $c"; exit 1; }; done && ls src/components/ui/ | wc -l | xargs -I{} test {} -ge 18 && npx tsc --noEmit 2>&1 | (! grep -i "error.*components/ui/")</automated>
  </verify>
  <acceptance_criteria>
    - All 18 component files present in `src/components/ui/`
    - `npx tsc --noEmit` exits 0
    - No third-party registry deps in package.json (`react-dropzone` still absent — VALID by 02-01 contract)
  </acceptance_criteria>
  <done>shadcn primitives ready for composition.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Build src/components/file/photo-upload.tsx</name>
  <read_first>
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Photo Upload Widget (entire section — visual states + interactions + accessibility)
    - src/lib/trpc-provider.tsx (Phase 1 — tRPC client context)
    - src/lib/forms/zod-i18n.ts (02-04 — useZodErrorMessage)
    - src/components/ui/avatar.tsx (Task 1 — Avatar composition)
    - src/components/ui/alert-dialog.tsx (Task 1)
  </read_first>
  <files>
    src/components/file/photo-upload.tsx
  </files>
  <action>
    ```tsx
    'use client';

    /**
     * PhotoUpload — self-built drag-drop photo upload widget (D-41, PLAYER-05).
     *
     * State machine (UI-SPEC §Photo Upload Widget):
     *   idle → dragging | uploading
     *   uploading → scanPending | error
     *   scanPending → clean | infected | scanTimeout
     *   clean | infected → idle (on Replace)
     *
     * No external deps (D-41 forbids react-dropzone). HTML5 drag/drop on a
     * <button> wrapping a hidden <input type="file"> — keyboard accessible.
     *
     * Server is authoritative on size + type (D-23 — client checks are UX hints).
     */
    import { Loader2, ImagePlus, ShieldAlert, X, RefreshCw } from 'lucide-react';
    import { useTranslations } from 'next-intl';
    import { useEffect, useRef, useState } from 'react';
    import { toast } from 'sonner';

    import { trpc } from '@/lib/trpc-client';
    import { cn } from '@/lib/utils';
    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import { Button } from '@/components/ui/button';
    import {
      AlertDialog,
      AlertDialogAction,
      AlertDialogCancel,
      AlertDialogContent,
      AlertDialogDescription,
      AlertDialogFooter,
      AlertDialogHeader,
      AlertDialogTitle,
    } from '@/components/ui/alert-dialog';
    import { Badge } from '@/components/ui/badge';

    const MAX_BYTES = 2 * 1024 * 1024;
    const ACCEPT_MIME = ['image/jpeg', 'image/png'] as const;
    const POLL_MS = 2_000;
    const POLL_TIMEOUT_MS = 30_000;

    type UiState =
      | 'idle'
      | 'dragging'
      | 'uploading'
      | 'scanPending'
      | 'clean'
      | 'infected'
      | 'scanTimeout';

    export interface PhotoUploadProps {
      /** Currently-saved file id (passed in by the parent form when editing). */
      initialFileId?: string | null;
      /** Currently-saved signed URL preview (parent fetches via trpc.file.getSignedUrl). */
      initialUrl?: string | null;
      /** Initials for the AvatarFallback (e.g., "JD"). */
      initials: string;
      /** Called when a scan completes successfully and a new fileId is ready to persist. */
      onUploaded(fileId: string): void;
      /** Called when the parent should clear `profile_photo_file_id`. */
      onDeleted?(): void;
      disabled?: boolean;
    }

    export function PhotoUpload({
      initialFileId,
      initialUrl,
      initials,
      onUploaded,
      onDeleted,
      disabled = false,
    }: PhotoUploadProps): JSX.Element {
      const t = useTranslations('files.photo');
      const inputRef = useRef<HTMLInputElement | null>(null);
      const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl ?? null);
      const [uiState, setUiState] = useState<UiState>('idle');
      const [activeFileId, setActiveFileId] = useState<string | null>(initialFileId ?? null);
      const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);
      const [deleteOpen, setDeleteOpen] = useState(false);

      const uploadMutation = trpc.file.upload.useMutation();

      // Poll scan status for the active file. The query is enabled only when
      // we have an active id and we are in scanPending state.
      const scanQuery = trpc.file.getScanStatus.useQuery(
        { fileId: activeFileId ?? '' },
        {
          enabled: Boolean(activeFileId) && uiState === 'scanPending',
          refetchInterval: POLL_MS,
        },
      );

      // Drive the state machine when the polled status arrives.
      useEffect(() => {
        if (!activeFileId || uiState !== 'scanPending') return;
        const data = scanQuery.data;
        if (!data) return;
        if (data.scanStatus === 'clean') {
          setUiState('clean');
          toast.success(t('toast.uploaded'));
          onUploaded(activeFileId);
        } else if (data.scanStatus === 'infected') {
          setUiState('infected');
        }
      }, [scanQuery.data, activeFileId, uiState, t, onUploaded]);

      // Poll timeout enforcement.
      useEffect(() => {
        if (uiState !== 'scanPending' || !pollStartedAt) return;
        const elapsed = Date.now() - pollStartedAt;
        if (elapsed >= POLL_TIMEOUT_MS) {
          setUiState('scanTimeout');
        }
        const remaining = POLL_TIMEOUT_MS - elapsed;
        if (remaining > 0) {
          const t = setTimeout(() => setUiState('scanTimeout'), remaining);
          return () => clearTimeout(t);
        }
      }, [uiState, pollStartedAt]);

      async function handleFile(file: File): Promise<void> {
        if (disabled) return;
        // Client-side UX hints (server-authoritative).
        if (file.size > MAX_BYTES) {
          toast.error(t('errors.tooLarge'));
          return;
        }
        if (!ACCEPT_MIME.includes(file.type as (typeof ACCEPT_MIME)[number])) {
          toast.error(t('errors.wrongType'));
          return;
        }

        // WARNING-06 fix: one FileReader pass produces both the preview
        // data-URL AND the upload base64 — avoids the O(n²) String.fromCharCode
        // loop that froze the main thread for ~200 ms on 2 MB files.
        // readAsDataURL returns "data:<mime>;base64,<payload>"; we slice off
        // the prefix to get the raw base64 the server expects.
        setUiState('uploading');
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
          reader.readAsDataURL(file);
        });
        setPreviewUrl(dataUrl);

        // "data:image/png;base64,...." → strip prefix to the bare payload.
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx < 0) {
          setUiState('idle');
          toast.error(t('errors.file.uploadFailed'));
          return;
        }
        const contentBase64 = dataUrl.slice(commaIdx + 1);

        try {
          const res = await uploadMutation.mutateAsync({
            bucket: 'profiles',
            claimedMimeType: file.type,
            originalFilename: file.name,
            contentBase64,
          });
          setActiveFileId(res.fileId);
          setUiState('scanPending');
          setPollStartedAt(Date.now());
        } catch (err: unknown) {
          setUiState('idle');
          const message = err instanceof Error ? err.message : 'errors.file.uploadFailed';
          toast.error(message.startsWith('errors.') ? t(message.slice('errors.file.'.length)) : message);
        }
      }

      function onPick(): void {
        if (disabled) return;
        inputRef.current?.click();
      }

      function onDrop(e: React.DragEvent<HTMLButtonElement>): void {
        e.preventDefault();
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length === 0) return;
        if (files.length > 1) {
          toast.error(t('errors.multiFile'));
        }
        void handleFile(files[0]!);
        setUiState((s) => (s === 'dragging' ? 'idle' : s));
      }

      function onConfirmDelete(): void {
        setDeleteOpen(false);
        setPreviewUrl(null);
        setActiveFileId(null);
        setUiState('idle');
        onDeleted?.();
      }

      // ─── Render ────────────────────────────────────────────────────────────
      const isShowingPhoto =
        previewUrl != null && (uiState === 'clean' || uiState === 'scanPending');

      return (
        <div className="flex flex-col items-start gap-2">
          {isShowingPhoto ? (
            <div className="relative">
              <Avatar className={cn('h-24 w-24', uiState === 'scanPending' && 'grayscale opacity-70')}>
                <AvatarImage src={previewUrl ?? undefined} alt="" />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              {uiState === 'scanPending' && (
                <Badge variant="secondary" className="absolute -bottom-2 -right-2">
                  <Loader2 className="size-3 animate-spin mr-1" />
                  {t('scanPending')}
                </Badge>
              )}
              {uiState === 'clean' && !disabled && (
                <div className="absolute -top-2 -right-2 flex gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-11 w-11"  // 44×44 hit target (UI-SPEC accessibility)
                    onClick={onPick}
                    aria-label={t('actions.replace')}
                    title={t('actions.replace')}
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="destructive"
                    className="h-11 w-11"
                    onClick={() => setDeleteOpen(true)}
                    aria-label={t('actions.delete')}
                    title={t('actions.delete')}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          ) : uiState === 'infected' ? (
            <div className="flex flex-col gap-2 rounded-md border-2 border-destructive p-4 text-destructive">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4" />
                <span>{t('scanInfected')}</span>
              </div>
              <Button onClick={onPick} variant="outline">
                {t('actions.replace')}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onPick}
              onDragOver={(e) => {
                e.preventDefault();
                if (!disabled) setUiState('dragging');
              }}
              onDragLeave={() => uiState === 'dragging' && setUiState('idle')}
              onDrop={onDrop}
              disabled={disabled}
              className={cn(
                'flex h-40 w-40 flex-col items-center justify-center rounded-md border-2 border-dashed border-input bg-muted',
                uiState === 'dragging' && 'border-primary bg-primary/5',
                disabled && 'opacity-60 cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-describedby="photo-upload-help"
            >
              {uiState === 'uploading' ? (
                <>
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                  <span className="mt-2 text-sm text-muted-foreground">{t('uploading')}</span>
                </>
              ) : uiState === 'scanTimeout' ? (
                <>
                  <RefreshCw className="size-8 text-muted-foreground" />
                  <span className="mt-2 text-sm text-muted-foreground">{t('scanTimeout')}</span>
                </>
              ) : (
                <>
                  <ImagePlus className="size-8 text-muted-foreground" />
                  <span className="mt-2 text-sm text-muted-foreground text-center">
                    {uiState === 'dragging' ? t('dropzone.dragging') : t('dropzone.idle')}
                  </span>
                </>
              )}
              <span id="photo-upload-help" className="sr-only">
                {t('dropzone.idle')}
              </span>
            </button>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_MIME.join(',')}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />

          <div role="status" aria-live="polite" className="sr-only">
            {uiState === 'scanPending' ? t('scanPending') : uiState === 'clean' ? t('toast.uploaded') : null}
          </div>

          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
                <AlertDialogDescription>{t('deleteConfirm.body')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('deleteConfirm.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={onConfirmDelete}>
                  {t('deleteConfirm.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      );
    }
    ```

    Do NOT use `react-dropzone` (D-41).
    Do NOT keep polling indefinitely — the 30s timeout transitions to `scanTimeout` state with a manual refresh button.
    Do NOT trust client size/type check as authoritative — server is the truth (validates magic-bytes).
    Do NOT block keyboard users — the dropzone is a `<button>` so Enter/Space opens the picker.
  </action>
  <verify>
    <automated>test -f src/components/file/photo-upload.tsx && head -1 src/components/file/photo-upload.tsx | grep -q "'use client'" && grep -q "trpc.file.upload" src/components/file/photo-upload.tsx && grep -q "trpc.file.getScanStatus" src/components/file/photo-upload.tsx && grep -q "POLL_MS = 2_000" src/components/file/photo-upload.tsx && grep -q "POLL_TIMEOUT_MS = 30_000" src/components/file/photo-upload.tsx && grep -q "MAX_BYTES = 2 \* 1024 \* 1024" src/components/file/photo-upload.tsx && grep -q "scanInfected\|scanPending\|scanTimeout" src/components/file/photo-upload.tsx && grep -q "h-11 w-11" src/components/file/photo-upload.tsx && grep -q "aria-live" src/components/file/photo-upload.tsx && ! grep -q "react-dropzone" src/components/file/photo-upload.tsx && npx tsc --noEmit 2>&1 | (! grep -i "error.*photo-upload\.tsx")</automated>
  </verify>
  <acceptance_criteria>
    - `'use client'` directive line 1
    - 7 UiState values supported
    - tRPC calls: `trpc.file.upload.useMutation()` + `trpc.file.getScanStatus.useQuery(..., { refetchInterval: 2000, enabled: ... })`
    - 30-second polling timeout transitions to `scanTimeout` state
    - 44×44 hit targets (`h-11 w-11`) on replace + delete buttons
    - `aria-live="polite"` region for screen reader announcements
    - No `react-dropzone` import
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>PhotoUpload widget ready for player+trainer forms.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Build src/components/lookup/lookup-select.tsx</name>
  <read_first>
    - src/components/ui/select.tsx (existing — Phase 1 shadcn primitive)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-44
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Component Inventory (LookupSelect row)
  </read_first>
  <files>
    src/components/lookup/lookup-select.tsx
  </files>
  <action>
    ```tsx
    'use client';

    /**
     * LookupSelect — generic dropdown for the 4 lookup categories Phase 2 uses.
     *
     * Codes come from the DB (language-neutral); labels resolve via i18n
     * (D-44 — lookups.<category>.<code>). Phase 2 categories:
     *   - academy        → academy table (PLAYER-02)
     *   - status         → status table (PLAYER-02)
     *   - ageCategory    → age_categories table (DOM-CAT-01)
     *   - trainerDiploma → trainer_diploma table (TRAINER-02)
     *
     * Codes are fetched from the corresponding tRPC list endpoint when added
     * in a future plan (Phase 2 lookups don't have their own routers — the
     * data is small enough that we hardcode the active code list per
     * category as a server-side prop. Plans 02-13/14 pre-fetch via Server
     * Component and pass `codes` here.)
     */
    import { useTranslations } from 'next-intl';

    import {
      Select,
      SelectContent,
      SelectItem,
      SelectTrigger,
      SelectValue,
    } from '@/components/ui/select';

    export type LookupCategory = 'academy' | 'status' | 'ageCategory' | 'trainerDiploma';

    export interface LookupSelectProps {
      category: LookupCategory;
      codes: readonly string[];  // pre-fetched active codes for the category
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
    }: LookupSelectProps): JSX.Element {
      // `lookups` is the catalog root (Phase 1 plural — see UI-SPEC line 271).
      const t = useTranslations(`lookups.${category}`);

      return (
        <Select value={value} onValueChange={onValueChange} disabled={disabled} name={name}>
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
    ```

    Note: The `codes` prop is intentionally provided by the caller (a Server Component prefetches active codes via Drizzle and passes them down). This keeps the bundle small (no client-side fetch of lookup tables) and respects the canonical-name rule (D-45 — academy labels are identical across locales, so showing them via the same key path is consistent).

    Do NOT fetch lookups from the client (would require a tRPC list endpoint that does not exist in Phase 2 scope).
  </action>
  <verify>
    <automated>test -f src/components/lookup/lookup-select.tsx && head -1 src/components/lookup/lookup-select.tsx | grep -q "'use client'" && grep -q "type LookupCategory" src/components/lookup/lookup-select.tsx && grep -q "useTranslations" src/components/lookup/lookup-select.tsx && grep -q "lookups\.\${category}" src/components/lookup/lookup-select.tsx && npx tsc --noEmit 2>&1 | (! grep -i "error.*lookup-select\.tsx")</automated>
  </verify>
  <acceptance_criteria>
    - Exports `LookupSelect` + `LookupCategory` type
    - `useTranslations(\`lookups.${category}\`)` resolves keys
    - Reusable for all 4 categories
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>One component covers all dropdowns Phase 2 needs.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Build src/components/common/empty-state.tsx</name>
  <read_first>
    - src/components/ui/card.tsx (Task 1)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Empty state (used on every list)
  </read_first>
  <files>
    src/components/common/empty-state.tsx
  </files>
  <action>
    ```tsx
    /**
     * Generic EmptyState card — used by /players list, /trainers list, and any
     * future RLS-filtered "no data" surface. Per UI-SPEC §Empty state, the
     * copy is identical between "no rows visible to you" and "no rows exist"
     * to honor D-36 enumeration prevention.
     */
    import type { LucideIcon } from 'lucide-react';
    import type { ReactNode } from 'react';

    import { Card } from '@/components/ui/card';

    export interface EmptyStateProps {
      icon: LucideIcon;
      title: string;       // already-localised string
      body: string;        // already-localised string
      action?: ReactNode;  // optional CTA (e.g., "Nieuwe speler" Button — TD-only at the call site)
    }

    export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps): JSX.Element {
      return (
        <Card className="mx-auto max-w-md p-6 text-center">
          <Icon className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          {action ? <div className="mt-4">{action}</div> : null}
        </Card>
      );
    }
    ```

    Note: This is a Server Component (no `'use client'`) — `icon` is a function reference and `action` can hold either a server-side or client-side element. Callers in 02-13 import like `<EmptyState icon={Users} title={t('players.list.empty.title')} ... />`.

    Do NOT introduce a `cta` prop with text + onClick — use the `action` ReactNode slot so callers can choose Server or Client buttons.
  </action>
  <verify>
    <automated>test -f src/components/common/empty-state.tsx && grep -q "export function EmptyState" src/components/common/empty-state.tsx && grep -q "LucideIcon" src/components/common/empty-state.tsx && ! grep -q "'use client'" src/components/common/empty-state.tsx && npx tsc --noEmit 2>&1 | (! grep -i "error.*empty-state\.tsx")</automated>
  </verify>
  <acceptance_criteria>
    - Server Component (no `'use client'` directive)
    - Props match UI-SPEC §Empty state shape
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Generic empty-state primitive ready.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| PhotoUpload state machine ↔ server scan status | Polling client state can lag the server; UI never grants access to a `pending`/`infected` file (server gates getSignedUrl) |
| Drag-drop ↔ multi-file payload | Browser may emit multiple files; we explicitly take only `[0]` and toast a warning |
| Client-side size/type check ↔ server authority | UX-only; documented in JSDoc + D-23 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-12-XSS-VIA-ORIGINALFILENAME | Tampering | original_filename rendered inline | mitigate | React auto-escapes text in `{}`; we never use `dangerouslySetInnerHTML`; filename never echoed in PhotoUpload output (only used internally for the file picker) |
| T-02-12-PREVIEW-LEAK | Information Disclosure | Object-URL preview of a pending/infected file persists in the browser tab | accept | URL is local to the tab; cleared on `setPreviewUrl(null)` (delete confirmation) and on page navigation; no cross-origin exposure |
| T-02-12-INDEFINITE-POLL | Resource Exhaustion | Network requests every 2s forever | mitigate | 30-second timeout transitions to `scanTimeout`; `enabled: status === 'scanPending'` stops polling on terminal state |
| T-02-12-FOCUS-TRAP-BROKEN | Accessibility | Dialog focus trap missing | mitigate | shadcn AlertDialog wraps Radix primitive which traps focus by default; tested in 02-15 e2e |
| T-02-12-UPLOAD-WITHOUT-AUTH | Elevation of Privilege | client tries to upload to a public endpoint | mitigate | `trpc.file.upload` is `protectedProcedure` server-side; UI never bypasses |
</threat_model>

<verification>
- 18 shadcn primitives in `src/components/ui/`
- 3 custom components compile and import resolved
- PhotoUpload state machine covers all 7 UI-SPEC states
- LookupSelect renders correct i18n keys
- `npx tsc --noEmit` exits 0
</verification>

<success_criteria>
- shadcn registry inventory matches UI-SPEC
- PhotoUpload is the only file widget Phase 2 ships
- LookupSelect covers all 4 Phase 2 lookup categories
- EmptyState reusable across list pages
- No `react-dropzone` or third-party registry adopted
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-12-SUMMARY.md` listing the 18 shadcn primitives + 3 custom components + the PhotoUpload state machine transitions.
</output>
