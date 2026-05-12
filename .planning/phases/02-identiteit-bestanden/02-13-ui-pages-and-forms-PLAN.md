---
phase: 02-identiteit-bestanden
plan_id: 02-13-ui-pages-and-forms
plan: 13
type: execute
wave: 6
depends_on: [02-12-ui-shared-components, 02-11-i18n-catalog-additions, 02-10-trpc-routers-player-trainer, 02-09-trpc-router-file]
files_modified:
  - src/components/players/player-list-table.tsx
  - src/components/players/player-create-form.tsx
  - src/components/players/player-edit-form.tsx
  - src/components/players/player-header.tsx
  - src/components/players/age-category-change-dialog.tsx
  - src/components/trainers/trainer-list-table.tsx
  - src/components/trainers/trainer-create-form.tsx
  - src/components/trainers/trainer-edit-form.tsx
  - src/components/trainers/trainer-header.tsx
  - src/app/[locale]/(app)/players/page.tsx
  - src/app/[locale]/(app)/players/new/page.tsx
  - src/app/[locale]/(app)/players/[id]/page.tsx
  - src/app/[locale]/(app)/trainers/page.tsx
  - src/app/[locale]/(app)/trainers/new/page.tsx
  - src/app/[locale]/(app)/trainers/[id]/page.tsx
  - src/app/[locale]/(app)/me/profile/page.tsx
  - eslint.config.mjs
autonomous: true
requirements:
  - PLAYER-01
  - PLAYER-02
  - PLAYER-05
  - PLAYER-06
  - PLAYER-07
  - TRAINER-01
  - TRAINER-02
  - TRAINER-03
  - I18N-06
  - I18N-08

must_haves:
  truths:
    - "7 route surfaces shipped: /players, /players/new, /players/[id], /trainers, /trainers/new, /trainers/[id], /me/profile (D-39)"
    - "List pages are Server Components hydrating tRPC initialData (D-40 — UserTable pattern)"
    - "Forms are Client Components using react-hook-form + zodResolver + LookupSelect + PhotoUpload"
    - "Player edit-form switches between TD/academy-mgr/self/parent modes via `mode` prop (UI-SPEC §RBAC-Sensitive UI Behavior)"
    - "Read-only mode renders inputs as styled non-interactive divs (UI-SPEC §RBAC table — trainer view)"
    - "AgeCategoryChangeDialog wraps shadcn Dialog and calls trpc.player.setAgeCategory (TD only)"
    - "ESLint restricted-imports rule blocks @/server/storage/* from Client Components (Pitfall 4 mitigation, second layer)"
  artifacts:
    - path: "src/app/[locale]/(app)/players/page.tsx"
      provides: "Server Component player list with RLS scoping"
      contains: "use server\\|Suspense"
      min_lines: 40
    - path: "src/components/players/player-create-form.tsx"
      provides: "RHF + zod client form for player creation"
      contains: "'use client'"
      min_lines: 100
    - path: "src/components/players/player-edit-form.tsx"
      provides: "Unified edit form with mode-based rendering"
      contains: "mode:"
      min_lines: 100
    - path: "src/app/[locale]/(app)/me/profile/page.tsx"
      provides: "self-profile page routing to player or trainer self-form"
      contains: "me.profile.title"
    - path: "eslint.config.mjs"
      provides: "restricted-imports rule for server-only modules"
      contains: "@/server/storage"
  key_links:
    - from: "src/app/[locale]/(app)/players/page.tsx"
      to: "src/server/trpc/routers/player.ts (player.list)"
      via: "Server-side tRPC caller (Phase 1 pattern from admin/users/page.tsx)"
      pattern: "trpc\\.player\\.list"
---

<objective>
Ship the 7 page-level route surfaces declared in UI-SPEC §Page Surfaces and the supporting form components (`PlayerCreateForm`, `PlayerEditForm`, `TrainerCreateForm`, `TrainerEditForm`, `PlayerListTable`, `TrainerListTable`, `PlayerHeader`, `TrainerHeader`, `AgeCategoryChangeDialog`). Pattern matches Phase 1's `admin/users/page.tsx` (Server Component → tRPC caller → Client table with `initialData`).

Forms compose `PhotoUpload`, `LookupSelect`, shadcn `Form` primitives (RHF + zod resolver), and the i18n adapter from 02-04. Field-level RBAC is enforced by passing `mode` to `PlayerEditForm` — read-only mode renders inputs as styled non-interactive divs (UI-SPEC pattern).

Add an ESLint rule blocking `@/server/storage/*` imports from Client Components (Pitfall 4 second-layer mitigation).

Output: 9 component files + 7 page files + 1 ESLint patch.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-UI-SPEC.md
@.planning/phases/02-identiteit-bestanden/02-07-trpc-schemas-PLAN.md
@.planning/phases/02-identiteit-bestanden/02-12-ui-shared-components-PLAN.md
@src/app/[locale]/(app)/admin/users/page.tsx
@src/components/admin/user-table.tsx
@eslint.config.mjs
@CLAUDE.md

<interfaces>
<!-- BLOCKER-03 fix: Phase 1's canonical Server Component caller pattern.
     `@/lib/trpc-server` does NOT exist in this codebase. The Phase 1 admin
     page (src/app/[locale]/(app)/admin/users/page.tsx) uses createCaller
     directly — match that pattern. -->

```typescript
// Phase 1 canonical pattern — Server Component prefetches via createCaller.
import { redirect } from 'next/navigation';
import { createContext } from '@/server/trpc/server-context';
import { appRouter } from '@/server/trpc/routers/_app';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ctx = await createContext();
  if (ctx.scope?.role !== 'technical_director') {
    redirect(`/${locale}/players`);   // WARNING-11: locale-aware redirect
  }
  const caller = appRouter.createCaller(ctx);
  const initial = await caller.player.list({ limit: 50 });
  return <PlayerListTable initialData={initial} />;
}
```

<!-- Phase 2 RHF + zod pattern: -->

```typescript
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { playerCreateInput } from '@/server/trpc/schemas/player';
import { trpc } from '@/lib/trpc-client';

const form = useForm({ resolver: zodResolver(playerCreateInput) });
const mutation = trpc.player.create.useMutation();
```

<!-- Read-only "styled disabled" pattern (UI-SPEC line 384): -->

For trainer-viewing-player or any non-editable role:
- No primary submit Button
- Inputs replaced with `<div className="rounded-md border border-input px-3 py-2 text-sm" aria-disabled="true">{value}</div>`
- Read-only Badge in header
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Build the 4 player components (list-table, create-form, edit-form, header)</name>
  <read_first>
    - src/components/admin/user-table.tsx (Phase 1 — copy structure for player-list-table)
    - src/server/trpc/schemas/player.ts (02-07 — input schemas)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Component Inventory + §Form-field contract + §RBAC-Sensitive UI Behavior
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-37, D-40, D-41, D-42
  </read_first>
  <files>
    src/components/players/player-list-table.tsx
    src/components/players/player-create-form.tsx
    src/components/players/player-edit-form.tsx
    src/components/players/player-header.tsx
  </files>
  <action>
    Create the 4 files. Each is a Client Component using shadcn primitives. Patterns documented in UI-SPEC line 175-191.

    **File 1 — `src/components/players/player-list-table.tsx`** (Client Component, list with avatar+name+statuut+academy+age category+minor-badge+action menu):
    - `'use client'` directive
    - Uses `trpc.player.list.useQuery({ initialData })` to hydrate Server-rendered initial data
    - Columns: avatar (40×40, lookup via `trpc.file.getSignedUrl` if profile_photo_file_id non-null), name (firstName + lastName, canonical D-45), statuut letter (A/B/C — Badge with `lookups.status.{code}`), academy (LookupSelect text via `lookups.academy.{code}`), age category (`lookups.ageCategory.{code}`), minor flag (Badge variant=outline + User icon if `isMinor`)
    - Action menu (shadcn DropdownMenu — already shipped Phase 1): `Open profile` (Link to `/players/[id]`), `Leeftijdscategorie wijzigen` (TD only — opens AgeCategoryChangeDialog)
    - Uses shadcn Table primitives (NOT react-table — UI-SPEC line 181 confirms)
    - Empty state via `<EmptyState icon={Users} ... />` (UI-SPEC line 156)

    **File 2 — `src/components/players/player-create-form.tsx`** (Client Component, TD-only):
    - `'use client'`
    - `useForm({ resolver: zodResolver(playerCreateInput) })` (02-07)
    - Renders all PLAYER-01..04 fields grouped by section (Identity / Sport / Address / Emergency Contact / Photo) — Card per section per UI-SPEC line 51
    - Uses shadcn `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage` for every field
    - `<FormMessage>` value runs through `useZodErrorMessage()` from `src/lib/forms/zod-i18n.ts` (02-04)
    - `LookupSelect` for academyCode (codes prop = `['topsportschool', 'academy_antwerpen', 'academy_brussel', 'academy_oost_vlaanderen', 'academy_west_vlaanderen', 'academy_limburg']` — passed in by the Server Component that mounts this form)
    - `LookupSelect` for statusCode (codes = `['status_a','status_b','status_c']`)
    - `RadioGroup` for gender (male / female / x — labels via `players.fields.gender.{male|female|x}` keys to be added in 02-11 if missing — fallback: hardcoded labels are NOT allowed; if catalog gap, file as a Phase 2 follow-up rather than smuggling raw strings)
    - `Calendar`+`Popover` for dateOfBirth (date-fns locale from `src/lib/i18n-format.ts`)
    - `PhotoUpload` for profile photo (initialFileId=null, onUploaded sets form field)
    - On submit: call `trpc.player.create.useMutation().mutateAsync(form.getValues())` then `router.push(\`/${locale}/players/${result.userId}\`)` and `toast.success(...)`.
    - Required `*` markers per UI-SPEC line 358 (text-destructive after label)

    **File 3 — `src/components/players/player-edit-form.tsx`** (Client Component, mode-aware):
    - `'use client'`
    - Props: `{ player: Player, mode: 'td' | 'academyManager' | 'self' | 'parent' | 'readOnly', academyCodes: readonly string[], statusCodes: readonly string[], ageCategoryCodes: readonly string[] }`
    - For `td` / `academyManager` modes: `useForm({ resolver: zodResolver(playerUpdateAsTdInput) })`; uses `trpc.player.updateAsTd.useMutation()`. All fields editable.
    - For `self` mode: `useForm({ resolver: zodResolver(playerSelfUpdateInput) })`; uses `trpc.player.updateSelf.useMutation()`. Renders ONLY the D-37 whitelist; renders non-editable fields as styled non-interactive divs (`<div className="rounded-md border border-input px-3 py-2 text-sm" aria-disabled="true">`).
    - For `parent` mode: same as self but uses `trpc.player.updateOnBehalfOf.useMutation({ playerId })`.
    - For `readOnly` mode: renders every field as the styled non-interactive div; NO submit Button; H1 carries `<Badge variant="outline">{t('players.detail.readOnly')}</Badge>`.
    - On save: `toast.success(t('players.edit.toast.saved'))` then router.refresh()

    **File 4 — `src/components/players/player-header.tsx`** (Server Component):
    - 96×96 Avatar with initials fallback (resolved via `getSignedUrl` server-side and passed as `photoUrl` prop — or null)
    - H1 = first + last name (canonical D-45)
    - Status Badge (`lookups.status.{code}` via `getTranslations`)
    - Minor Badge if `isMinor` (outline variant + User icon)
    - Back link to `/players` (← arrow)

    Do NOT hardcode any user-facing string — every label is an i18n key.
    Do NOT use `disabled` attribute on `<input>` — use the styled-div pattern (UI-SPEC line 208).
    Do NOT submit forms with `statusCode` etc. via the self-update path — Zod `.strict()` would reject anyway; the schema-narrowed form makes this structurally impossible.
  </action>
  <verify>
    <automated>for f in src/components/players/player-list-table.tsx src/components/players/player-create-form.tsx src/components/players/player-edit-form.tsx src/components/players/player-header.tsx; do test -f "$f" || { echo "missing: $f"; exit 1; }; done && head -1 src/components/players/player-create-form.tsx | grep -q "'use client'" && head -1 src/components/players/player-edit-form.tsx | grep -q "'use client'" && head -1 src/components/players/player-list-table.tsx | grep -q "'use client'" && ! head -1 src/components/players/player-header.tsx | grep -q "'use client'" && grep -q "zodResolver" src/components/players/player-create-form.tsx && grep -q "playerCreateInput" src/components/players/player-create-form.tsx && grep -q "PhotoUpload" src/components/players/player-create-form.tsx && grep -q "LookupSelect" src/components/players/player-create-form.tsx && grep -q "mode:" src/components/players/player-edit-form.tsx && grep -q "playerSelfUpdateInput\|playerUpdateAsTdInput" src/components/players/player-edit-form.tsx && grep -q "aria-disabled" src/components/players/player-edit-form.tsx && grep -q "useZodErrorMessage" src/components/players/player-create-form.tsx && npx tsc --noEmit 2>&1 | (! grep -i "error.*src/components/players/")</automated>
  </verify>
  <acceptance_criteria>
    - 3 Client Components + 1 Server Component (header)
    - `player-edit-form.tsx` has `mode` prop with at least 5 values
    - All forms use `useZodErrorMessage` for `<FormMessage>` text
    - Read-only mode uses styled non-interactive divs (NOT real disabled inputs)
    - PhotoUpload integrated into create + edit forms
    - LookupSelect used for academy + status (+ ageCategory in setAgeCategoryDialog — see Task 2)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Player UI surfaces composable.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Build AgeCategoryChangeDialog</name>
  <read_first>
    - src/components/ui/dialog.tsx (02-12 — shadcn primitive)
    - src/server/trpc/schemas/player.ts (playerSetAgeCategoryInput)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Destructive confirmation copy
  </read_first>
  <files>
    src/components/players/age-category-change-dialog.tsx
  </files>
  <action>
    Client Component using shadcn Dialog. TD-only (caller renders it conditionally).

    Shape:
    - `'use client'`
    - Props: `{ playerId: string, currentCode: string, ageCategoryCodes: readonly string[], open: boolean, onOpenChange(open: boolean): void }`
    - `useForm({ resolver: zodResolver(playerSetAgeCategoryInput) })`
    - LookupSelect for `ageCategoryCode` (category='ageCategory')
    - Calendar+Popover for `effectiveFrom` (date input — locale-aware via i18n-format)
    - NumberInput (shadcn Input type=number) for `categoryYear`
    - Two buttons in DialogFooter: Cancel + Confirm
    - On confirm: `trpc.player.setAgeCategory.useMutation().mutateAsync({...})` → toast.success → onOpenChange(false) → router.refresh()
    - All copy via `useTranslations('players.ageCategoryChange')`
  </action>
  <verify>
    <automated>test -f src/components/players/age-category-change-dialog.tsx && head -1 src/components/players/age-category-change-dialog.tsx | grep -q "'use client'" && grep -q "playerSetAgeCategoryInput" src/components/players/age-category-change-dialog.tsx && grep -q "trpc.player.setAgeCategory" src/components/players/age-category-change-dialog.tsx && grep -q "useTranslations('players.ageCategoryChange')" src/components/players/age-category-change-dialog.tsx && npx tsc --noEmit 2>&1 | (! grep -i "error.*age-category-change-dialog\.tsx")</automated>
  </verify>
  <acceptance_criteria>
    - Client Component
    - Uses zod-validated `playerSetAgeCategoryInput`
    - All copy from i18n
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>TD-only age-category change UI ready.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Build the 4 trainer components (list, create-form, edit-form, header)</name>
  <read_first>
    - src/components/players/player-list-table.tsx (Task 1 — clone pattern with trainer columns)
    - src/components/players/player-create-form.tsx (Task 1 — clone for trainer fields)
    - src/server/trpc/schemas/trainer.ts (02-07)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Page Surfaces (trainer rows)
  </read_first>
  <files>
    src/components/trainers/trainer-list-table.tsx
    src/components/trainers/trainer-create-form.tsx
    src/components/trainers/trainer-edit-form.tsx
    src/components/trainers/trainer-header.tsx
  </files>
  <action>
    Mirror Task 1 structure for trainers. Trainer-specific differences:
    - No emergency contact section (TRAINER-01 doesn't require it)
    - No status/academy/age_category dropdowns in the form — `diplomaCode` (LookupSelect category='trainerDiploma') + `hasPedagogicalQualification` (shadcn Checkbox)
    - Edit-form modes: `'td' | 'self' | 'readOnly'` (no academyManager edit; no parent — trainers don't have parents)
    - `trainerSelfUpdateInput` whitelist (D-38) does NOT include diplomaCode or hasPedagogicalQualification
    - Trainer-list-table columns: avatar, name, diploma (`lookups.trainerDiploma.{code}`), pedagogical qual (Badge variant=outline + checkmark icon if true), academies (text — comma-joined `academy_memberships.academy_code` resolved via i18n), action menu
    - Action menu has only "Open profile" (no setAgeCategory analog)

    All copy via i18n keys (no hardcoded labels).
  </action>
  <verify>
    <automated>for f in src/components/trainers/trainer-list-table.tsx src/components/trainers/trainer-create-form.tsx src/components/trainers/trainer-edit-form.tsx src/components/trainers/trainer-header.tsx; do test -f "$f" || { echo "missing: $f"; exit 1; }; done && grep -q "trainerCreateInput" src/components/trainers/trainer-create-form.tsx && grep -q "trainerSelfUpdateInput\|trainerUpdateAsTdInput" src/components/trainers/trainer-edit-form.tsx && grep -q "diplomaCode" src/components/trainers/trainer-create-form.tsx && grep -q "hasPedagogicalQualification" src/components/trainers/trainer-create-form.tsx && grep -q "lookups.trainerDiploma" src/components/trainers/trainer-list-table.tsx && grep -q "'use client'" src/components/trainers/trainer-edit-form.tsx && npx tsc --noEmit 2>&1 | (! grep -i "error.*src/components/trainers/")</automated>
  </verify>
  <acceptance_criteria>
    - 4 files (3 Client + 1 Server)
    - `trainer-edit-form.tsx` mode prop covers TD / self / readOnly
    - Diploma + pedagogical qual surfaced in create-form
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Trainer UI ready.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Build 7 page files (Server Components)</name>
  <read_first>
    - src/app/[locale]/(app)/admin/users/page.tsx (entire — Phase 1 Server-Component-prefetches-tRPC pattern)
    - src/server/trpc/server-context.ts (Phase 1 `createContext` helper)
    - src/server/trpc/routers/_app.ts (Phase 1 `appRouter` — supports `appRouter.createCaller(ctx)`)
    - src/app/[locale]/(app)/admin/users/page.tsx (Phase 1 canonical Server Component caller pattern — copy this shape, not the non-existent `@/lib/trpc-server`)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Page Surfaces
  </read_first>
  <files>
    src/app/[locale]/(app)/players/page.tsx
    src/app/[locale]/(app)/players/new/page.tsx
    src/app/[locale]/(app)/players/[id]/page.tsx
    src/app/[locale]/(app)/trainers/page.tsx
    src/app/[locale]/(app)/trainers/new/page.tsx
    src/app/[locale]/(app)/trainers/[id]/page.tsx
    src/app/[locale]/(app)/me/profile/page.tsx
  </files>
  <action>
    Each page is a Server Component (no `'use client'`) that:
    1. Resolves locale + session via Phase 1 helpers
    2. Calls the relevant tRPC procedure via the server caller (RLS-bound)
    3. Renders chrome (PageHeader + back link) + the Client component (List or Form) with `initialData` and `mode`

    **`/players/page.tsx`**:
    - Caller: `trpc.player.list({ limit: 50 })`
    - Title: `t('players.list.title')`
    - TD CTA in header: `<Link to /players/new>{t('players.list.empty.ctaTd')}</Link>` (only when `session.role === 'technical_director'`)
    - Renders `<PlayerListTable initialData={players} />`
    - Empty state if 0 rows: `<EmptyState icon={Users} title={t('players.list.empty.title')} body={...} action={td-cta} />`

    **`/players/new/page.tsx`**:
    - Server-side check: redirect to `/players` if `session.role !== 'technical_director'` (defense-in-depth above tRPC's tdProcedure)
    - Renders `<PlayerCreateForm academyCodes={...} statusCodes={...} ageCategoryCodes={...} />`
    - Lookup codes prefetched server-side via Drizzle (NOT tRPC — keep this in the Server Component as `db.query.academy.findMany({ where: eq(academy.active, true) })`)

    **`/players/[id]/page.tsx`**:
    - Caller: `trpc.player.get({ playerId })` — RLS filters → throws NOT_FOUND → Next.js 404 page
    - Compute `mode` per UI-SPEC §RBAC table: TD/academyManager → `'td'` / `'academyManager'`; self → `'self'`; parent of minor → `'parent'`; trainer → `'readOnly'`
    - Renders `<PlayerHeader player={...} photoUrl={...} mode={mode} />` + 5 stacked Cards via `<PlayerEditForm mode={mode} ... />`

    **`/trainers/page.tsx`**, **`/trainers/new/page.tsx`**, **`/trainers/[id]/page.tsx`** — mirror player pages with `trpc.trainer.*` and trainer-specific components.

    **`/me/profile/page.tsx`**:
    - Determines whether session is `player` or `trainer` (look up `players.findFirst({ where: userId === scope.userId })` then `trainers.findFirst`)
    - Routes to `<PlayerEditForm mode="self">` or `<TrainerEditForm mode="self">` based on which row exists; if neither, renders a neutral "complete your profile" placeholder Card

    Every page sets `<title>{t(...)}</title>` via Next.js `generateMetadata` or via `metadata` export.

    Do NOT call `trpc.file.getSignedUrl` for every avatar in the list — that's N+1. Either:
    1. Batch (out of scope — would need a new procedure), OR
    2. Render the AvatarFallback initials by default and lazy-load signed URLs in the row's hover state (UI-SPEC compromise — keeps the list under 100 row latency budget).
    Choose option 2 for Phase 2: render Avatar with fallback initials in list rows; the detail page (`/players/[id]/page.tsx`) does fetch the single signed URL.
  </action>
  <verify>
    <automated>for p in src/app/\[locale\]/\(app\)/players/page.tsx src/app/\[locale\]/\(app\)/players/new/page.tsx src/app/\[locale\]/\(app\)/players/\[id\]/page.tsx src/app/\[locale\]/\(app\)/trainers/page.tsx src/app/\[locale\]/\(app\)/trainers/new/page.tsx src/app/\[locale\]/\(app\)/trainers/\[id\]/page.tsx src/app/\[locale\]/\(app\)/me/profile/page.tsx; do test -f "$p" || { echo "missing: $p"; exit 1; }; done && grep -l "PlayerListTable\|PlayerCreateForm\|PlayerEditForm" src/app/\[locale\]/\(app\)/players/page.tsx src/app/\[locale\]/\(app\)/players/new/page.tsx src/app/\[locale\]/\(app\)/players/\[id\]/page.tsx && grep -l "TrainerListTable\|TrainerCreateForm\|TrainerEditForm" src/app/\[locale\]/\(app\)/trainers/page.tsx src/app/\[locale\]/\(app\)/trainers/new/page.tsx src/app/\[locale\]/\(app\)/trainers/\[id\]/page.tsx && ! grep -l "'use client'" src/app/\[locale\]/\(app\)/players/page.tsx src/app/\[locale\]/\(app\)/trainers/page.tsx && npx tsc --noEmit 2>&1 | (! grep -i "error.*src/app/\[locale\]/(app)/players\|error.*src/app/\[locale\]/(app)/trainers\|error.*me/profile")</automated>
  </verify>
  <acceptance_criteria>
    - 7 page files exist
    - All page files are Server Components (no `'use client'`)
    - List pages use the SC→tRPC-server-caller→Client-with-initialData pattern from Phase 1
    - `/me/profile` route adapts to player vs trainer self-edit
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>UI surfaces routable; visible at `/nl/players`, `/en/trainers`, etc.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 5: Add ESLint restricted-imports rule for server-only modules</name>
  <read_first>
    - eslint.config.mjs (entire file — current Phase 1 rules)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pitfall 4 (service-role key bundle leak)
  </read_first>
  <files>
    eslint.config.mjs
  </files>
  <action>
    Add a `no-restricted-imports` rule with override scope for client paths.

    Inside the existing flat config array, append a new config block (or extend an existing one targeting Client paths):

    BLOCKER-08 fix: `src/app/**/*.tsx` includes Phase 1 Server Components that legitimately import `@/server/storage/*` and similar (e.g. server-side prefetch in `/admin/users/page.tsx`). The original glob would mis-fire on those. Scope this rule to `src/components/**/*.tsx` ONLY — that directory contains exclusively components, and the convention is that Client/Server distinction in `src/app/**` is enforced by the `'use client'` directive, not by file path.

    ```javascript
    {
      files: ['src/components/**/*.tsx'],   // BLOCKER-08: components only — Server Components in src/app/ are excluded
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@/server/storage/*'],
                message:
                  'Server-only module imported from Client Component. Service-role key MUST NOT bundle into the client. Move the call to a Server Component or tRPC mutation. See Pitfall 4 in 02-RESEARCH.md.',
              },
              {
                group: ['@/server/workers/*'],
                message:
                  'Worker modules are server-only — BullMQ + ioredis cannot run in the browser. Move the call to a tRPC mutation.',
              },
              {
                group: ['@/server/db/client'],
                message:
                  'Direct DB client imported from Client Component. Use tRPC procedures from `@/lib/trpc-client` instead.',
              },
            ],
          },
        ],
      },
    }
    ```

    This rule is in addition to (not a replacement for) the `'server-only'` directive on the modules themselves (02-04). Defense in depth.

    Server-side files (`src/server/**/*.ts`, `src/app/**/page.tsx` Server Components, `src/lib/players.ts`, etc.) are excluded by the `files` glob so they can still import `@/server/storage/*`.

    Do NOT add an overrides block at the top level — flat config uses array-of-configs; just append.
    Do NOT remove existing rules from eslint.config.mjs.
  </action>
  <verify>
    <automated>grep -q "no-restricted-imports" eslint.config.mjs && grep -q "@/server/storage/" eslint.config.mjs && grep -q "@/server/workers/" eslint.config.mjs && grep -q "@/server/db/client" eslint.config.mjs && grep -qE "files:\s*\[['\"]src/components/\*\*/\*\.tsx['\"]\]" eslint.config.mjs && pnpm exec eslint src/components/ 2>&1 | tail -5 | grep -vE "warning|hint" | (! grep -i "error")</automated>
  </verify>
  <acceptance_criteria>
    - 3 patterns blocked (storage, workers, db/client) from Client paths
    - Rule scoped to `src/components/**/*.tsx` ONLY (BLOCKER-08 fix — `src/app/**/*.tsx` excluded because it contains Phase 1 Server Components that legitimately import `@/server/storage/*`)
    - Phase 1 ESLint rules preserved
  </acceptance_criteria>
  <done>Pitfall 4 has a second layer of defense.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Server Component RSC payload ↔ Client hydration | initialData is serialised; cannot contain sensitive secrets (service-role key) |
| Form mode prop ↔ Client trust | The Server Component decides `mode`; the Client form respects it but the server-side tRPC procedure enforces the real RBAC |
| ESLint restricted-imports ↔ runtime bundle | Lint-time guard; runtime `'server-only'` directive is the absolute backstop |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-13-CLIENT-ROLE-CHECK | Elevation of Privilege | UI hides "Edit" button for trainer, but server returns 200 on PUT | mitigate | RLS UPDATE policy + tRPC schema-level whitelist BOTH enforce; UI is cosmetic |
| T-02-13-FORM-MODE-SPOOF | Elevation of Privilege | Client overrides `mode` prop via React DevTools | accept | UI-level only; server is authoritative; documented in inline comments |
| T-02-13-AVATAR-N+1 | Resource Exhaustion | Each list row fetches signed URL → 100 round trips | mitigate | Render initials fallback in list; signed-URL fetch deferred to detail page (Task 4) |
| T-02-13-SR-KEY-BUNDLE | Information Disclosure | Client file imports service-role storage client | mitigate | ESLint `no-restricted-imports` (Task 5) + `'server-only'` directive (02-04) |
| T-02-13-XSS-CANONICAL-NAME | Tampering | Academy canonical name with `<script>` payload | mitigate | React auto-escapes; canonical_name is operator-set (TD-controlled), not user-supplied; lookups RLS write is `lookup.write` permission (TD only) |
| T-02-13-SUBMIT-WITHOUT-CSRF | Tampering | Cross-site form post | mitigate | Phase 1 SEC-02 CSRF middleware applies to every tRPC mutation; the schema validates body shape too |
</threat_model>

<verification>
- 7 pages routable in Next.js (`pnpm dev` then navigate to `/nl/players` etc.)
- 9 component files compile
- ESLint detects an attempted `@/server/storage` import from a Client file
- `npx tsc --noEmit` exits 0
- `pnpm exec eslint` exits 0
</verification>

<success_criteria>
- All UI-SPEC §Page Surfaces routes shipped
- Mode-aware edit form covers all 5 RBAC variants
- AgeCategoryChangeDialog wired
- ESLint guards Pitfall 4 a second time
- Phase 1 UI surfaces (admin/users, login) unchanged
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-13-SUMMARY.md` listing the 7 routes, 9 components, and the explicit `mode` values supported by PlayerEditForm + TrainerEditForm.
</output>
