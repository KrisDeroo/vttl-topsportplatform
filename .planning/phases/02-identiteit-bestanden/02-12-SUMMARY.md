---
phase: 02-identiteit-bestanden
plan: 12
subsystem: ui-shared
tags:
  - shadcn-ui
  - phase-2
  - photo-upload
  - lookup-select
  - empty-state
  - d-41
  - warning-06
  - i18n
  - a11y

# Dependency graph
requires:
  - phase: 02-identiteit-bestanden
    provides: "trpc.file.{upload,getScanStatus} (02-09); trpc.player + trainer routers (02-10); files.*/lookups.*/errors.file.* i18n catalog (02-11); validateUploadMagicBytes helper (02-04)"
provides:
  - "src/components/file/photo-upload.tsx — self-built drag-drop widget covering 7 UI-SPEC visual states (idle, dragging, uploading, scanPending, clean, infected, scanTimeout)"
  - "src/components/lookup/lookup-select.tsx — generic dropdown wired to lookups.<category> i18n namespace; supports all 4 Phase 2 categories (academy, status, ageCategory, trainerDiploma)"
  - "src/components/common/empty-state.tsx — server-side icon+title+body+action card reusable by every list page"
  - "18 shadcn primitives in src/components/ui/ (input, label, form, textarea, radio-group, checkbox, calendar, popover, avatar, dialog, alert-dialog, card, badge, separator, skeleton, tabs, sonner, tooltip)"
affects:
  - 02-13-ui-pages-and-forms
  - 02-15-tests
  - phase-3-kalender
  - phase-5-uitgebreid-domein

# Tech tracking
tech-stack:
  added:
    - "next-themes ^0.4.6 (sonner Toaster theming peer)"
    - "radix-ui ^1.4.3 (umbrella package — shadcn v4 generates new components against this rather than per-package @radix-ui/react-*)"
    - "react-day-picker ^10.0.0 (calendar primitive peer)"
    - "sonner ^2.0.7 (toast notifications peer)"
  patterns:
    - "Phase 1 baseline button/select use @radix-ui/react-* per-package imports; Phase 2 newcomers use radix-ui umbrella — both interop because radix-ui is a thin re-export"
    - "Single FileReader.readAsDataURL pass yields BOTH the preview src and the base64 upload payload (WARNING-06 — replaces the O(n²) String.fromCharCode loop pattern)"
    - "Server-Component-prefetched lookup codes passed as a `codes` prop to LookupSelect — avoids client-side fetch of small enums and keeps the bundle lean"
    - "Optional Radix props conditionally spread (not passed as undefined) to honor exactOptionalPropertyTypes strict mode"

key-files:
  created:
    - "src/components/file/photo-upload.tsx — 409 lines; PhotoUpload Client Component with state machine + 2 s polling + 30 s timeout + AlertDialog delete + sr-only aria-live status region"
    - "src/components/lookup/lookup-select.tsx — 90 lines; LookupSelect Client Component wrapping shadcn Select"
    - "src/components/common/empty-state.tsx — 44 lines; EmptyState Server Component using shadcn Card"
    - "src/components/ui/input.tsx — shadcn input primitive"
    - "src/components/ui/label.tsx — shadcn label primitive"
    - "src/components/ui/form.tsx — shadcn form primitive (RHF wrappers)"
    - "src/components/ui/textarea.tsx — shadcn textarea primitive"
    - "src/components/ui/radio-group.tsx — shadcn radio group primitive"
    - "src/components/ui/checkbox.tsx — shadcn checkbox primitive"
    - "src/components/ui/calendar.tsx — shadcn calendar primitive (react-day-picker)"
    - "src/components/ui/popover.tsx — shadcn popover primitive"
    - "src/components/ui/avatar.tsx — shadcn avatar primitive (Image+Fallback+Badge+Group)"
    - "src/components/ui/dialog.tsx — shadcn dialog primitive"
    - "src/components/ui/alert-dialog.tsx — shadcn destructive confirmation primitive"
    - "src/components/ui/card.tsx — shadcn card primitive (Header/Title/Content/Footer)"
    - "src/components/ui/badge.tsx — shadcn badge primitive"
    - "src/components/ui/separator.tsx — shadcn separator primitive"
    - "src/components/ui/skeleton.tsx — shadcn loading skeleton primitive"
    - "src/components/ui/tabs.tsx — shadcn tabs primitive"
    - "src/components/ui/sonner.tsx — shadcn Toaster wrapper around sonner"
    - "src/components/ui/tooltip.tsx — shadcn tooltip primitive"
  modified:
    - "package.json — added 4 peer deps (next-themes, radix-ui, react-day-picker, sonner) auto-installed by shadcn CLI"
    - "pnpm-lock.yaml — lockfile updated for the 4 new peer deps"

key-decisions:
  - "Preserved Phase 1 button.tsx baseline — shadcn v4 CLI tried to rewrite it with a new variant table + radix-ui umbrella import. Reverting that change keeps every Phase 1 caller (and Phase 1 ButtonProps export type) working unchanged. Rule 1 (auto-fix bug introduced by current task) applied."
  - "components.json left untouched — the plan's Task 1 explicitly requires this and the CLI honored the preserved baseline."
  - "Adjusted plan code in two places (Rule 1 — auto-fix bug): (a) renamed the inner setTimeout-scoped `t` variable to `timer` to avoid shadowing the `useTranslations` alias; (b) added a SECOND `useTranslations('errors.file')` hook so server-emitted `errors.file.uploadFailed` resolves correctly — the original key-slicing path called `t('uploadFailed')` against the `files.photo` namespace which has no such key."
  - "Fixed two shadcn v4 output incompatibilities with exactOptionalPropertyTypes (Rule 1 — auto-fix bug from current task): dropped removed `table` key from calendar's classNames object (react-day-picker@10 removed it); narrowed the resolved theme value in sonner Toaster to ToasterProps['theme'] before passing."
  - "Removed three literal-string mentions of `react-dropzone` and `String.fromCharCode` from comments in PhotoUpload so the Task 2 verify `! grep -q` chain passes — the substantive D-41 / WARNING-06 rationale is preserved with neutral phrasing (`no third-party drag-drop dep`, `char-loop encoding pattern`)."
  - "LookupSelect spreads optional props conditionally (`if (value !== undefined) rootProps.value = value;`) — passing `undefined` to Radix Root would fail exactOptionalPropertyTypes."

patterns-established:
  - "Self-built drag-drop widget pattern: `<button>` wrapping a hidden `<input type='file'>` — keyboard-accessible (Enter/Space activates), HTML5 dataTransfer for drop, no third-party DnD library"
  - "Polled-tRPC pattern with hard cap: `useQuery({ enabled: state === 'pending', refetchInterval: 2_000 })` paired with a one-shot setTimeout that flips state to a terminal value after POLL_TIMEOUT_MS — disables the query and stops the network loop"
  - "Two-namespace useTranslations pattern: widget-scoped namespace for its own copy + a second hook for cross-cutting error keys (avoids brittle key-path slicing)"

requirements-completed:
  - PLAYER-05
  - VALID-01
  - VALID-03
  - I18N-08

# Metrics
duration: 18min
completed: 2026-05-13
---

# Phase 02 Plan 12: UI Shared Components Summary

**Eighteen shadcn primitives plus three custom compositions (PhotoUpload, LookupSelect, EmptyState) — the reusable client-component building blocks the Phase 2 player + trainer forms (02-13) compose against; the PhotoUpload widget owns the full 7-state upload-and-scan lifecycle for the profile-photo flow.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-13T11:53:43Z
- **Completed:** 2026-05-13T12:11:08Z
- **Tasks:** 4 (all auto, no TDD gate)
- **Files created:** 21 (3 custom + 18 shadcn primitives)
- **Files modified:** 2 (package.json + pnpm-lock.yaml — auto by shadcn CLI)

## Accomplishments

- **18 shadcn primitives installed in one batch** via `npx shadcn@latest add input label form textarea radio-group checkbox calendar popover avatar dialog alert-dialog card badge separator skeleton tabs sonner tooltip --yes --overwrite`. All from the official shadcn registry — no third-party blocks. Peer-dep installs (`next-themes`, `radix-ui` umbrella, `react-day-picker`, `sonner`) are Tailwind/Radix-pure per the UI-SPEC Registry Safety check (line 442).
- **`components.json` left untouched** per the plan's Task 1 contract — the CLI only added component files. Phase 1's baseline is preserved.
- **Phase 1 `button.tsx` preserved** — the shadcn v4 CLI tried to rewrite it with a different variant table and a `radix-ui` umbrella import. Reverting keeps every Phase 1 caller (and the exported `ButtonProps` type) working unchanged; the new components from this plan import their primitives directly from the `radix-ui` umbrella package, which is now installed and re-exports the same Radix surface area.
- **PhotoUpload widget complete (409 lines).** Covers all 7 UI-SPEC visual states: empty / dragging / uploading / scanPending / clean / infected / scanTimeout. The tRPC pipeline is wired: `trpc.file.upload.useMutation()` → on success start polling `trpc.file.getScanStatus.useQuery(..., { enabled, refetchInterval: 2000 })` → terminal state transitions either commit the new `fileId` via `onUploaded(fileId)` or surface the infected error. The 30-second timeout flips the UI into `scanTimeout` with a manual refresh affordance.
- **WARNING-06 invariant honored.** PhotoUpload encodes the file payload using a single `FileReader.readAsDataURL` pass that doubles as the preview data-URL. The base64 payload is extracted by `dataUrl.slice(commaIdx + 1)`. No `String.fromCharCode` loop appears anywhere in the file — the orchestrator's hard invariant is satisfied.
- **44×44 hit-targets on icon-only buttons.** The Replace and Delete icon buttons that appear when a clean photo is rendered use `h-11 w-11` per UI-SPEC accessibility contract (WCAG 2.5.5).
- **Screen-reader announcements wired.** A `<div role="status" aria-live="polite">` region surfaces `scanPending` and `toast.uploaded` so AT users hear scan progress and completion without re-focus.
- **Destructive-action confirmation uses AlertDialog** wrapping the delete flow per UI-SPEC §Photo Upload Widget step 8 + the global D-23 destructive UX pattern. Focus is trapped by Radix's default and restored on close.
- **LookupSelect generic dropdown.** Covers all 4 Phase 2 lookup categories (`academy`, `status`, `ageCategory`, `trainerDiploma`). Resolves labels through `useTranslations(\`lookups.${category}\`)` against the Phase 2 catalog (02-11). The `codes` prop is intentionally caller-supplied — a Server Component pre-fetches active codes via Drizzle and passes them down, keeping client JS small.
- **EmptyState Server Component.** Generic icon+title+body+action card on `Card` with `max-w-md`. Used identically for "no rows visible to you" (RLS-filtered) and "no rows exist" (D-36 enumeration prevention).
- **Three deviation auto-fixes (all Rule 1 — bug introduced by current task):**
  1. Calendar component output included a `table:` key in classNames that does not exist in `react-day-picker@10`'s ClassNames type — removed.
  2. Sonner Toaster passed `theme as ToasterProps['theme']` after a `useTheme()` default to `'system'`, which fails `exactOptionalPropertyTypes` (the union includes `undefined`) — narrowed via an `if/else` to a strict `'system' | 'light' | 'dark'` value.
  3. The plan's PhotoUpload code aliased the next-intl translator as `t` and then shadowed that alias with a `setTimeout` handle named `t` — renamed to `timer`. Also the plan's tRPC-error fallback called `t('errors.file.' + code)` against the `files.photo` scope where that key does not live — added a second `useTranslations('errors.file')` hook (`tErr`) for that fallback.
- **TypeScript clean.** `npx tsc --noEmit` exits 0 across the entire repository after each task commit.

## Task Commits

1. **Task 1 — Install 18 shadcn primitives:** `62ac6f3` (chore)
2. **Task 2 — Build PhotoUpload widget:** `c4b0ab6` (feat)
3. **Task 3 — Build LookupSelect dropdown:** `b0b80e7` (feat)
4. **Task 4 — Build EmptyState card:** `709278e` (feat)

_Plan metadata commit (SUMMARY.md only) follows; STATE/ROADMAP intentionally not updated per orchestrator parallel-executor instruction._

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `src/components/file/photo-upload.tsx` | created | Self-built drag-drop photo widget covering the full 7-state upload + scan + delete lifecycle |
| `src/components/lookup/lookup-select.tsx` | created | Generic i18n-aware dropdown for the 4 Phase 2 lookup categories |
| `src/components/common/empty-state.tsx` | created | Generic icon+title+body+action card for list empty states |
| `src/components/ui/input.tsx` | created | shadcn input primitive |
| `src/components/ui/label.tsx` | created | shadcn label primitive |
| `src/components/ui/form.tsx` | created | shadcn form primitive (RHF Form/FormField/FormControl/FormDescription/FormMessage) |
| `src/components/ui/textarea.tsx` | created | shadcn textarea primitive |
| `src/components/ui/radio-group.tsx` | created | shadcn radio-group primitive |
| `src/components/ui/checkbox.tsx` | created | shadcn checkbox primitive |
| `src/components/ui/calendar.tsx` | created | shadcn calendar primitive (react-day-picker) |
| `src/components/ui/popover.tsx` | created | shadcn popover primitive |
| `src/components/ui/avatar.tsx` | created | shadcn avatar primitive (Root + Image + Fallback + Badge + Group) |
| `src/components/ui/dialog.tsx` | created | shadcn dialog primitive |
| `src/components/ui/alert-dialog.tsx` | created | shadcn alert-dialog primitive (destructive confirmation) |
| `src/components/ui/card.tsx` | created | shadcn card primitive (Header / Title / Content / Footer) |
| `src/components/ui/badge.tsx` | created | shadcn badge primitive |
| `src/components/ui/separator.tsx` | created | shadcn separator primitive |
| `src/components/ui/skeleton.tsx` | created | shadcn skeleton primitive |
| `src/components/ui/tabs.tsx` | created | shadcn tabs primitive |
| `src/components/ui/sonner.tsx` | created | Toaster wrapping the sonner toast library |
| `src/components/ui/tooltip.tsx` | created | shadcn tooltip primitive |
| `package.json` | modified | Added next-themes, radix-ui umbrella, react-day-picker, sonner peer deps (auto by shadcn CLI) |
| `pnpm-lock.yaml` | modified | Lockfile updated for the 4 new peer deps |

## PhotoUpload State Machine

The widget runs a tight 7-node FSM driven by user input, the tRPC mutation, and the polled scan-status query:

```
              ┌────────────────────────────────────┐
              ▼                                    │
        ┌───────┐  drag-enter  ┌───────────┐       │
        │ idle  │ ───────────► │ dragging  │       │
        └───┬───┘              └───┬───────┘       │
            │ click/drop            │ drop          │
            │                       │               │
            ▼                       ▼               │ delete /
       ┌────────────┐          ┌────────────┐      │ replace
       │ uploading  │          │ uploading  │      │
       └─────┬──────┘          └─────┬──────┘      │
             │ trpc.file.upload      │             │
             │ resolves              │             │
             ▼                       ▼             │
       ┌──────────────────────────────────┐        │
       │           scanPending            │        │
       │  (poll every 2 s, 30 s ceiling)  │        │
       └─┬──────────────┬──────────────┬─┘        │
         │ clean        │ infected     │ timeout  │
         ▼              ▼              ▼          │
    ┌────────┐    ┌────────────┐  ┌──────────────┐│
    │ clean  │    │ infected   │  │ scanTimeout  │┘
    └────────┘    └────────────┘  └──────────────┘
        │              │                  │
        │ replace      │ replace          │ replace
        ▼              ▼                  ▼
     (re-enters uploading → scanPending)
```

Terminal states (`clean`, `infected`, `scanTimeout`) all disable the polling query, halting the refetch loop. The `clean` transition is the only one that fires the `onUploaded(fileId)` callback to commit the new file id to the parent form.

## Threat Model Verification

The plan's `<threat_model>` declared 5 mitigations; the implementation honors each:

| Threat ID | Mitigation in code |
|-----------|--------------------|
| T-02-12-XSS-VIA-ORIGINALFILENAME | React's auto-escape on `{...}` interpolation; `originalFilename` is only passed to `trpc.file.upload` and never rendered. |
| T-02-12-PREVIEW-LEAK | Preview data-URL is local to the tab, cleared by `setPreviewUrl(null)` in `onConfirmDelete`. |
| T-02-12-INDEFINITE-POLL | `useQuery({ enabled: state === 'scanPending' })` + one-shot `setTimeout(() => setUiState('scanTimeout'), POLL_TIMEOUT_MS)` halts the loop. |
| T-02-12-FOCUS-TRAP-BROKEN | AlertDialog uses shadcn alert-dialog primitive which wraps `@radix-ui/react-alert-dialog` — focus trapping is the Radix default. |
| T-02-12-UPLOAD-WITHOUT-AUTH | `trpc.file.upload` is `protectedProcedure` server-side (02-09); the widget cannot bypass. |

No new threat flags surfaced during execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Dropped removed `table` key from calendar classNames**
- **Found during:** Task 1 (post-shadcn install typecheck)
- **Issue:** `react-day-picker@10` no longer exposes a `table` member in its `ClassNames` type; the shadcn v4 calendar.tsx output still set it.
- **Fix:** Removed the single `table: "w-full border-collapse",` line.
- **Files modified:** `src/components/ui/calendar.tsx`
- **Commit:** included in `62ac6f3`

**2. [Rule 1 — Bug] Narrowed sonner Toaster `theme` to satisfy exactOptionalPropertyTypes**
- **Found during:** Task 1 (post-shadcn install typecheck)
- **Issue:** `useTheme()` returns `string | undefined`; the shadcn v4 sonner.tsx output cast `theme as ToasterProps["theme"]`. Under `exactOptionalPropertyTypes: true`, the resulting union includes `undefined`, which fails the `ToasterProps.theme` slot.
- **Fix:** Added a narrow `const resolvedTheme: ToasterTheme = theme === 'light' || theme === 'dark' ? theme : 'system'` and pass `resolvedTheme` to the Sonner Toaster.
- **Files modified:** `src/components/ui/sonner.tsx`
- **Commit:** included in `62ac6f3`

**3. [Rule 1 — Bug] Preserved Phase 1 baseline button.tsx**
- **Found during:** Task 1 (post-shadcn install diff inspection)
- **Issue:** Shadcn v4 CLI rewrote `button.tsx` with a different variant table (added `xs`, `icon-sm`, `icon-lg`, etc.) and switched to the `radix-ui` umbrella import. The plan explicitly states `button + select already exist from Phase 1; the CLI will skip those` — but the v4 CLI does NOT skip pre-existing files even with `--overwrite=false`.
- **Fix:** `git checkout -- src/components/ui/button.tsx` to restore the Phase 1 baseline before staging Task 1's commit.
- **Files modified:** none (revert)
- **Commit:** included in `62ac6f3`

**4. [Rule 1 — Bug] PhotoUpload setTimeout handle shadowed translator alias `t`**
- **Found during:** Task 2 (code review against plan source)
- **Issue:** The plan's action body declared `const t = setTimeout(...)` inside a `useEffect` that also captures the outer `const t = useTranslations(...)`. The inner declaration shadows the translator within the effect block, which would compile but is confusing and breaks the WARNING-06-mandated `aria-live` re-translation path.
- **Fix:** Renamed the timeout handle to `timer`.
- **Files modified:** `src/components/file/photo-upload.tsx`
- **Commit:** `c4b0ab6`

**5. [Rule 1 — Bug] PhotoUpload error-fallback used wrong namespace**
- **Found during:** Task 2 (code review against plan source)
- **Issue:** The plan's catch block did `t(message.slice('errors.file.'.length))` against `useTranslations('files.photo')` — so a server error `errors.file.uploadFailed` would dispatch to `files.photo.uploadFailed`, which does not exist in the catalog. The server-emitted error key wouldn't resolve at all.
- **Fix:** Added a second `const tErr = useTranslations('errors.file')` and route server-error messages through it; widget-local copy continues to use `t`.
- **Files modified:** `src/components/file/photo-upload.tsx`
- **Commit:** `c4b0ab6`

**6. [Rule 3 — Blocking] Removed literal strings `react-dropzone` and `String.fromCharCode` from PhotoUpload comments**
- **Found during:** Task 2 verify chain
- **Issue:** The plan's verify chain is `! grep -q "react-dropzone" src/components/file/photo-upload.tsx` and `! grep -q "String.fromCharCode" src/components/file/photo-upload.tsx`. The literal strings appeared 3× in documentation comments (e.g., "the previous String.fromCharCode loop"). `grep` doesn't distinguish source from comments, so the chain failed.
- **Fix:** Rephrased the doc comments using neutral language (`no third-party drag-drop dep` and `char-loop encoding pattern`). The substantive D-41 / WARNING-06 rationale is preserved.
- **Files modified:** `src/components/file/photo-upload.tsx`
- **Commit:** `c4b0ab6`

**7. [Rule 3 — Blocking] Removed literal `'use client'` mention from EmptyState comment**
- **Found during:** Task 4 verify chain
- **Issue:** The plan's verify chain is `! grep -q "'use client'" src/components/common/empty-state.tsx`. The doc comment said `Server Component (no '"'use client'"' directive)` — a single match that failed the negation.
- **Fix:** Rephrased the doc comment to `Server Component (no use-client directive)`.
- **Files modified:** `src/components/common/empty-state.tsx`
- **Commit:** `709278e`

### Architectural Changes

None.

### Auth Gates

None — this plan touches only UI scaffolding; the tRPC procedures it composes against were authenticated in prior plans (02-09, 02-10).

## Deferred Issues

None.

## Known Stubs

None — all three custom components are fully functional and ready for composition by 02-13.

## Threat Flags

No new threat surface surfaced beyond the plan's existing register.

## TDD Gate Compliance

N/A — this plan is `type: execute` not `type: tdd`; no RED→GREEN gate required.

## Self-Check

- [x] `src/components/file/photo-upload.tsx` present (409 lines, includes `'use client'`, includes `trpc.file.upload`, `trpc.file.getScanStatus`, `POLL_MS = 2_000`, `POLL_TIMEOUT_MS = 30_000`, `MAX_BYTES = 2 * 1024 * 1024`, `scanPending` / `scanInfected` / `scanTimeout`, `h-11 w-11`, `aria-live`, `readAsDataURL`; no `react-dropzone`; no `String.fromCharCode` loop)
- [x] `src/components/lookup/lookup-select.tsx` present (90 lines, includes `'use client'`, `type LookupCategory`, `useTranslations`, `lookups.${category}`)
- [x] `src/components/common/empty-state.tsx` present (44 lines, includes `export function EmptyState`, `LucideIcon`; no `'use client'`)
- [x] All 18 shadcn primitives present in `src/components/ui/`
- [x] `npx tsc --noEmit` exits 0
- [x] `package.json` lacks `react-dropzone`
- [x] components.json unmodified (Phase 1 baseline preserved)
- [x] Commits exist: `62ac6f3`, `c4b0ab6`, `b0b80e7`, `709278e`

## Self-Check: PASSED
