---
phase: 4
slug: kerndomein
status: draft
shadcn_initialized: true
preset: "style=new-york, baseColor=neutral, cssVariables=true, iconLibrary=lucide, rsc=true (inherited from Phase 1)"
created: 2026-05-16
inherits_from: 03-kalender/03-UI-SPEC.md
---

# Phase 4 — UI Design Contract — Kerndomein

> Visual and interaction contract for the operational sports-management layer (trainings + tournaments + rankings) atop Phase 3's polymorphic calendar. Builds on the Phase 3 UI design contract (UI3-D01..D12) and extends — does not redesign — the calendar chip variant taxonomy (UI3-D11), the EventDetailSheet CTA matrix (UI3-D13 implicit in Phase 3 EventDetailSheet inventory), and the RruleEditor (UI3-D12). Phase 4-specific decisions are numbered **UI4-D01..D24** below.
>
> **Localization rule (inherited, hard):** Every user-facing UI string is referenced as an i18n key. Literal copy appears only inside the `## Copywriting Contract` table (nl/en/fr columns). No literal strings inside components. New top-level keyspaces: `training.*`, `tournament.*`, `ranking.*`, `nudge.*`, `errors.training.*`, `errors.tournament.*`, `lookup.outcomeLevel.*`, `lookup.belgiumClassification.*`, `lookup.rankingType.*`, `lookup.trainingType.*`, `lookup.organisation.*`, `lookup.tournamentType.*`.
>
> **Phase 4 design defaults are pre-populated from CONTEXT.md D-60..D-91 and RESEARCH.md. Items marked `[default]` are best-fit choices given upstream constraints; the user may override before checker approval. Once checker stamps `status: approved`, all UI4-D-XX rows are locked.**

---

## Design System

Inherited from Phase 1 (init), Phase 2 (visual language), Phase 3 (calendar surface). Phase 4 adds **one charting library** (`recharts`), **one new color family** (Belgium tier bands — 6 tokens), **one new state-overlay color family** (nudge / needs-scoring / needs-result — 3 tokens), and **3 new shadcn primitives**.

| Property | Value | Source |
|----------|-------|--------|
| Tool | shadcn/ui | Phase 1 (`components.json` checked in) |
| Preset | `style=new-york`, `baseColor=neutral`, `cssVariables=true`, `rsc=true`, `iconLibrary=lucide` | Phase 1 |
| Component library | Radix primitives via shadcn | Phase 1/2/3 |
| Icon library | `lucide-react` | Phase 1 |
| Font | system stack (no Google Fonts CDN — GDPR) | Phase 1/2 |
| Tailwind | v4 CSS-first; tokens in `src/app/[locale]/globals.css`. All Phase 4 components MUST consume CSS-variable tokens — never hard-coded hex. | Phase 1/2/3 |
| Dark mode | `@custom-variant dark` already wired. Every new token has both light + dark values. | Phase 1/2/3 |
| Date library | `date-fns` v4 with `nl-BE` / `en-GB` / `fr-BE` locales via `src/lib/i18n-format.ts`. Monday weekstart, `dd/MM/yyyy` display. | Phase 1/2/3 |
| Calendar library | **FullCalendar 6.x** (Phase 3 lock — Phase 4 only consumes the chip-overlay extension hook) | Phase 3 |
| Chart library | **`recharts` 3.8.1** [VERIFIED npm 2026-05-16] — international ranking line chart only; Belgium timeline strip is pure CSS/Tailwind. | Phase 4 (new) |
| Form library | `react-hook-form` v7 + `@hookform/resolvers/zod` + Zod 4.4 | Phase 1/2/3 |

### Components to add via `npx shadcn@latest add`

Phase 4 adds **3 net-new shadcn primitives** beyond what Phase 1/2/3 installed. All from the **official shadcn registry** — no third-party blocks.

| Component | Reason | Used in |
|-----------|--------|---------|
| `table` | DataTable shell for: tournament list, match-results entry table (D-80 add-row-as-needed), tournament-result read view, ranking-entries audit list (TD oversight), "Te scoren" trainer aggregator (D-66 / D-68). Phase 2 has a custom `<UserTable>` but not the shadcn `table` primitive — Phase 4 adopts it as the canonical surface for non-grid data. | `TournamentList`, `MatchResultsTable`, `TournamentResultsReadView`, `TeScorenOverview` |
| `slider` | Reserved for **future v2 use** when v2 swaps the 5-star score to true 1–10 (D-60). Phase 4 does NOT use slider — 5-star v1 is a custom `<StarRatingInput>` (see Component Inventory). Listed here so the planner installs it once and the v2 swap is preset-clean. **Optional install — planner may defer to v2 milestone.** | (none in v1) |
| `progress` | Inline progress affordance inside "Te scoren" widget rows: `[██████░░░░] 6/10 spelers gescoord`. Cheap visual reinforcement of the percentage already in the row's copy. | `TeScorenOverview` (per-session row), `TournamentNudgeBanner` (pending-count visualization) |

> **Already-shipped (reused without re-adding):** `button`, `select`, `dropdown-menu`, `input`, `label`, `form`, `textarea`, `radio-group`, `checkbox`, `calendar` (date-picker, not FullCalendar), `popover`, `avatar`, `dialog`, `alert-dialog`, `card`, `badge`, `separator`, `skeleton`, `tabs`, `sonner`, `tooltip`, `sheet`, `alert`, `command`, `toggle`, `toggle-group`, `scroll-area`.

> **No third-party shadcn-style registries** (`tablecn`, `originui`, `aceternity`, `magic-ui`, etc.). Registry safety gate not triggered.

---

## Spacing Scale

Inherited 1:1 from Phase 1/2/3. No new tokens introduced.

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| xs | 4px | `1`, `gap-1`, `p-1` | Star-rating inter-star gap; tier-band cell internal padding |
| sm | 8px | `2`, `gap-2`, `p-2` | Match-result row internal spacing; nudge banner inline icon-to-text gap |
| md | 16px | `4`, `gap-4`, `p-4` | Default card padding; form-field stack vertical gap |
| lg | 24px | `6`, `gap-6`, `p-6` | Score capture form column padding; chart container padding |
| xl | 32px | `8`, `gap-8` | Vertical break between "outcome" section and "matches" section in TournamentResultEntryForm |
| 2xl | 48px | `12` | Reserved — not used in Phase 4 |
| 3xl | 64px | `16` | Reserved — not used in Phase 4 |

**Phase 4 declared exceptions (all on 4-pt grid):**

- **5-star input inter-star spacing:** `gap-1` (4px) — keeps the 5-star group compact and readable at min tap target.
- **Star tap target (mobile):** each star icon is rendered as a 44×44 `<button>` (28px icon centered in 44px hit-box) — WCAG 2.5.5 inherited from Phase 3 mobile chip rule.
- **Tier-band cell height (Belgium timeline):** `h-12` (48px) per year-cell — keeps tier label legible at 14px / 500 weight on top of the colored band.
- **Tier-band cell min-width:** `min-w-20` (80px) — fits 4-character codes (`A25`, `B0`, `NC`) at all viewports without truncation.
- **Range-pill height:** `h-8` (32px) — matches Phase 3 `<ToggleGroup>` chip height for consistency with the calendar toolbar.
- **TournamentResultEntryForm horizontal split (desktop ≥ 1024px):** match-results table consumes `lg:max-w-screen-lg` (1024px); single-column stack below this width.
- **Persistent nudge banner height:** fixed `h-10` (40px) — sits above page chrome without overwhelming, room for icon (16) + body line + count badge.

---

## Typography

Inherited from Phase 1/2/3. **Three sizes + one display. Phase 4 declares the same 2 weights (400 + 500) as Phase 3 — no new weight role introduced.** Phase 4 has **one declared exception** for the Belgium-timeline tier code label.

### Phase 4 component weights (net-new declarations — none beyond Phase 3)

| Role | Size | Weight | Line Height | Tailwind |
|------|------|--------|-------------|----------|
| Body | 14px | 400 | 1.5 | `text-sm leading-relaxed` |
| Emphasis (Label, form labels, table headers, tier-code cell label, chip count badge) | 14px | 500 | 1.4 | `text-sm font-medium` |

### Inherited from shadcn (NOT a Phase 4 declaration)

shadcn ships `font-semibold` (600) inside primitives for Card titles, AlertDialog titles, Sheet titles, page `<h1>`. Phase 4 reuses unchanged — design-system inheritance, identical to Phase 1/2/3.

| Surface (inherited) | Size | Weight | Tailwind |
|---|---|---|---|
| Heading (Sheet title, Card title, AlertDialog title) | 18px | 600 (semibold, inherited) | `text-lg font-semibold` |
| Display (Page title `<h1>` e.g. "Te scoren") | 24px | 600 (semibold, inherited) | `text-2xl font-semibold` |

### Phase 4 declared exception — tier code label on Belgium timeline

The tier code (e.g. `A25`, `B0`, `NC`) renders **centered within the tier-color band cell at 14px / 500 weight with `text-foreground` on light tiers and `text-background` on dark tiers** (deuteranopia + dark-mode safety). The cell uses `font-mono` for `tabular-nums` so column widths stay equal across `A1`/`B6`/`NC`. **Not a new weight role** — it's the existing 500-weight Label role rendered in monospace within the timeline component only. Scoped to the `<BelgiumTimelineStrip>` component root.

### Recharts text rendering (international ranking chart)

- Axis labels (`<XAxis>`, `<YAxis>` ticks): 12px / 400 — recharts default. **Same 12px exception scope as Phase 3 FullCalendar time-axis** — dense axis labels at 14px push the chart off the visible area. Declared exception lives within `<RankingLineChart>` component root only.
- Tooltip body: 14px / 400 (default body role).
- Chart legend (range pill — see UI4-D14): 14px / 500 (Label role).

**Forbidden elsewhere in Phase 4:** Free use of `text-xs` outside the recharts axis labels and the Belgium-timeline tier-code label. No third weight (no `font-bold`, no `font-light`).

---

## Color

shadcn neutral preset (Phase 1) provides chrome. Phase 3 added 6 event-type tokens. Phase 4 adds **two new color families**:
1. **Belgium classification tier bands** — 6 tokens (A / B / C / D / E / NC) with both light and dark values.
2. **State-overlay colors** — 3 tokens for the "needs action" semantic axis (needs-scoring / needs-result yellow, nudge-warning orange, nudge-critical red).

### Chrome palette (60/30/10 — inherited, unchanged)

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `--background` | Page background, form background, table row default |
| Secondary (30%) | `--muted` / `--card` | Form section dividers, table header row, "Te scoren" widget card |
| Accent (10%) | `--primary` | Reserved for the **explicit list below ONLY** |
| Destructive | `--destructive` | "Verwijder wedstrijdrij" affordance inside match-results table; TD overwrite confirm dialog danger button; tournament-result delete |
| Border | `--border` | Card outline, form-field outline, table outline |
| Foreground | `--foreground` | Body text, headings, table cells |
| Muted foreground | `--muted-foreground` | Helper text, empty-state copy, age-category snapshot label, "Manueel ingevoerd" disclaimer |

**Accent (`--primary`) reserved in Phase 4 for (explicit list — short and audited):**

1. **"Opslaan" primary CTA** at the bottom of: per-session bulk score form (D-62), tournament-result entry form (D-80), ranking-entry form (D-89), tournament create/edit form, "Voeg deelnemer toe" tournament participant registration form.
2. **Active range-pill** in the international ranking chart range selector (D-90 — `1m / 6m / 1y / 2y / all`).
3. **Active ranking-type selector tab** on the Rankings tab (D-88 — Senior World / Youth World / Senior European / Youth European / België).
4. **"Score nu" / "Voer resultaat in" CTA** inside "Te scoren" widget rows and nudge banner — these are the primary action drivers of the discipline-enforcement loop.
5. **Selected 5-star icon fill** — the filled portion of the star group uses `--cal-event-evalconv-border` (the existing yellow token from Phase 3) NOT `--primary`. **See "Star color rationale" below.**

**Accent NOT used for:** form input borders, table row hover, nudge banners (use new `--state-needs-action-*` tokens), tier bands (use new `--cls-tier-*` tokens), "Verwijder rij" button in match table (uses ghost variant with `--destructive` foreground on hover only).

### NEW — Belgium classification tier-band color tokens

D-87 specifies **A=gold, B=silver, C=bronze, D=grey, E=light grey, NC=white**. Implementation: low-saturation tinted backgrounds + dark-or-light foreground per WCAG contrast. Token names follow Phase 3's `--cal-event-*` family pattern.

**Light mode (added to `:root` in `globals.css`):**

```css
:root {
  /* Belgium classification tier bands — Phase 4 UI4-D03 */
  --cls-tier-a-bg:     oklch(0.86 0.10 90);   /* gold tint */
  --cls-tier-a-fg:     oklch(0.32 0.08 80);   /* deep gold-brown — WCAG AA on bg */
  --cls-tier-b-bg:     oklch(0.86 0.01 250);  /* silver / very-light blue-grey */
  --cls-tier-b-fg:     oklch(0.32 0.01 250);  /* deep slate */
  --cls-tier-c-bg:     oklch(0.78 0.08 40);   /* bronze tint */
  --cls-tier-c-fg:     oklch(0.30 0.10 40);   /* deep bronze-brown */
  --cls-tier-d-bg:     oklch(0.78 0.01 285);  /* mid grey */
  --cls-tier-d-fg:     oklch(0.25 0.01 285);  /* near-black */
  --cls-tier-e-bg:     oklch(0.93 0.005 285); /* light grey */
  --cls-tier-e-fg:     oklch(0.30 0.005 285); /* deep grey */
  --cls-tier-nc-bg:    oklch(1 0 0);          /* white (uses --background) */
  --cls-tier-nc-fg:    oklch(0.30 0.005 285); /* deep grey — text on white */
  --cls-tier-nc-border:oklch(0.85 0.005 285); /* visible 1px outline so NC band is not invisible */
}
```

**Dark mode (added to `.dark` block):**

```css
.dark {
  --cls-tier-a-bg:     oklch(0.42 0.10 90);
  --cls-tier-a-fg:     oklch(0.92 0.08 90);
  --cls-tier-b-bg:     oklch(0.42 0.02 250);
  --cls-tier-b-fg:     oklch(0.92 0.02 250);
  --cls-tier-c-bg:     oklch(0.42 0.08 40);
  --cls-tier-c-fg:     oklch(0.92 0.08 40);
  --cls-tier-d-bg:     oklch(0.38 0.005 285);
  --cls-tier-d-fg:     oklch(0.92 0.005 285);
  --cls-tier-e-bg:     oklch(0.30 0.005 285);
  --cls-tier-e-fg:     oklch(0.92 0.005 285);
  --cls-tier-nc-bg:    oklch(0.21 0.006 285.885);  /* uses --card */
  --cls-tier-nc-fg:    oklch(0.92 0.005 285);
  --cls-tier-nc-border:oklch(0.40 0.005 285);
}
```

Exposed as Tailwind utilities via `@theme inline { --color-cls-tier-a-bg: var(--cls-tier-a-bg); ... }` so components consume them as `bg-cls-tier-a-bg`, `text-cls-tier-a-fg`, `border-cls-tier-nc-border`.

| Tier code | Light band preview (logical) | Dark band preview (logical) | Token prefix |
|---|---|---|---|
| A (A1..A50) | gold tint + deep gold-brown text | deep gold + light gold text | `--cls-tier-a-*` |
| B (B0/B2/B4/B6) | silver / very-light blue-grey + deep slate | mid blue-grey + light blue-grey | `--cls-tier-b-*` |
| C (C0/C2/C4/C6) | bronze tint + deep bronze-brown | mid bronze + light bronze | `--cls-tier-c-*` |
| D (D0/D2/D4/D6) | mid grey + near-black | dark grey + light grey | `--cls-tier-d-*` |
| E (E0/E2/E4/E6) | light grey + deep grey | dark grey + light grey | `--cls-tier-e-*` |
| NC | white + deep grey + 1px outline | card-bg + light grey + outline | `--cls-tier-nc-*` |

> **Why tinted bands instead of saturated "gold-leaf"?** Same three reasons as Phase 3 D-5 chip rationale: (1) WCAG AA at 14px / 500 weight needs ≥ 0.55 oklch lightness delta — easier with deep text on tinted bg than white-on-gold; (2) deuteranopia safety — bronze and gold confuse at saturation, the tier-code text label (`font-mono`) carries the meaning so color is reinforcement, not the sole carrier; (3) timeline density — 3–5 cells side-by-side at saturation reads as decoration; tinted reads as system.

> **NC tier outline requirement:** Because NC's background equals `--background` (white in light mode, deep-grey in dark mode), a 1px border (`--cls-tier-nc-border`) is mandatory on NC cells to keep the timeline grid visible. Other tier cells get `border-transparent`.

### NEW — State-overlay color tokens

Three tokens for the "user has pending action" semantic axis. Used by: chip overlay (UI4-D07), nudge banners (UI4-D08), "Te scoren" widget row backgrounds (UI4-D04).

**Light mode (added to `:root` in `globals.css`):**

```css
:root {
  /* State-overlay colors — Phase 4 UI4-D02 */
  --state-needs-action-bg:        oklch(0.96 0.05 85);   /* warm yellow tint */
  --state-needs-action-fg:        oklch(0.40 0.12 80);   /* deep amber */
  --state-needs-action-border:    oklch(0.70 0.17 85);   /* mid yellow — chip overlay accent */

  --state-nudge-warning-bg:       oklch(0.94 0.08 50);   /* orange tint — day 10 escalation */
  --state-nudge-warning-fg:       oklch(0.40 0.16 45);   /* deep orange */
  --state-nudge-warning-border:   oklch(0.68 0.18 50);

  --state-nudge-critical-bg:      oklch(0.93 0.10 25);   /* red tint — day 12 critical */
  --state-nudge-critical-fg:      oklch(0.38 0.18 25);   /* deep red */
  --state-nudge-critical-border:  oklch(0.60 0.20 25);
}
```

**Dark mode:**

```css
.dark {
  --state-needs-action-bg:        oklch(0.28 0.05 85);
  --state-needs-action-fg:        oklch(0.88 0.10 85);
  --state-needs-action-border:    oklch(0.70 0.16 85);

  --state-nudge-warning-bg:       oklch(0.28 0.08 45);
  --state-nudge-warning-fg:       oklch(0.88 0.12 50);
  --state-nudge-warning-border:   oklch(0.68 0.18 50);

  --state-nudge-critical-bg:      oklch(0.28 0.10 25);
  --state-nudge-critical-fg:      oklch(0.88 0.14 25);
  --state-nudge-critical-border:  oklch(0.65 0.20 25);
}
```

| Token family | Trigger | Used in |
|---|---|---|
| `--state-needs-action-*` (yellow) | Default nudge intensity (days 0–6 since deadline trigger; chip overlay; "Te scoren" widget row that has at least one NULL score; player tournament with no result row + within 14d) | UI4-D07 chip overlay; UI4-D08 nudge banner default; UI4-D04 "Te scoren" row bg tint |
| `--state-nudge-warning-*` (orange) | Day 7–9 escalation (D-67 channel 4) | Nudge banner background swap; daily inbox message body |
| `--state-nudge-critical-*` (red) | Day 10–12 critical (D-67 channel 4) — "**⚠ {n} dagen tot deadline**" | Nudge banner background swap; daily inbox message body |

> **Conflict with `--destructive` and `--cal-event-medical-*`?** All three "red-family" tokens are distinguishable:
> - `--destructive` (Phase 1): `oklch(0.577 0.245 27.325)` — used for **danger/delete actions only** (button surfaces).
> - `--cal-event-medical-border` (Phase 3): `oklch(0.55 0.20 25)` — used for **medical event chip borders only**.
> - `--state-nudge-critical-border` (Phase 4): `oklch(0.60 0.20 25)` — used for **temporal-urgency banners only**.
>
> **Rule:** Critical-nudge banners do NOT use `--destructive`; the destructive "Verwijder" button does NOT use `--state-nudge-critical-*`; medical chips do NOT use either. The three reds occupy distinct surfaces.

### Star color (5-star score input)

Selected stars fill with `--cal-event-evalconv-border` (the existing Phase 3 mid-yellow token, `oklch(0.70 0.16 90)`). Unselected stars render outline-only with `text-muted-foreground`. **Rationale:** reusing the existing Phase 3 yellow keeps the token surface count small; the yellow reads correctly as "rating" semantics (universal across review UIs); avoids introducing a 4th yellow if we used `--state-needs-action-border` (which is for nudges, not rating).

---

## Page Surfaces (Routes)

All routes live under `src/app/[locale]/(app)/` (D-39 from Phase 2). Phase 4 adds **5 new routes** and extends **1 Phase 3 route**. All pages are Server Components by default; only forms + charts are Client.

| Route | Component layout | Visible to | Title key |
|---|---|---|---|
| `/calendar/event/[id]` *(Phase 3 route, EXTENDED)* | Same as Phase 3 + auto-opens `<EventDetailSheet>` with **new Phase 4 CTAs in the action footer**: "Open scoring" (training, trainer-in-scope, within 14d) → opens `/trainings/[eventId]/score`; "Voer resultaat in" (tournament, player + within 14d OR trainer-in-academy/TD anytime) → opens `/tournaments/[eventId]/result`; "Resultaat bekijken" (tournament with existing result) → opens `/tournaments/[eventId]/result?mode=read`. | Inherits Phase 3 | inherits |
| `/trainings/[eventId]/score` *(NEW)* | Page header (H1 `training.score.title` + session metadata strip: datum / starttijd / trainer / training-type / organisation) → `<BulkAttendanceScoreForm>` → bottom sticky `<SaveButton>`. | trainer of session + TD only (D-61 write scope). RLS-filtered server-side; out-of-scope → 404 page. | `training.score.title` |
| `/dashboard` *(NEW, Phase 4 — owned here, extended Phase 7)* | Page header → `<NudgeBannerStack>` (slot above all content — see UI4-D08) → `<TeScorenOverview>` (trainer + TD) OR `<MyTournamentResultPendingWidget>` (player) → `<MinimalSystemInbox>` (anyone). **Phase 7 will replace `/dashboard` with the cross-domain player view dashboard; Phase 4 ships the minimal home for trainers + players where Phase 4 widgets live until then.** | Authenticated user. Trainer/TD see "Te scoren". Player sees own pending tournament result widget. Parent + sparring-partner see only the minimal inbox. | `dashboard.title` |
| `/tournaments` *(NEW)* | Page header + `<TournamentFilterBar>` (extends Phase 3 Filter Bar pattern) + `<TournamentList>` (DataTable, columns: naam / startdatum / stad / land / leeftijdscategorie / tornooitype / aantal deelnemers (TD-view) / "Mijn resultaat" status (player-view)). | All authenticated roles (scope via RLS — players see tournaments they're registered for + public history; trainers see academy-scope; TD sees all). | `tournament.list.title` |
| `/tournaments/[eventId]` *(NEW)* | Tournament detail: metadata card (naam, datums, locatie, categorie, type) → `<TournamentParticipantsPanel>` (TD-only edit panel per D-79) → `<TournamentResultsLeaderboard>` (academy-wide results visible per D-78) → action footer with role-conditional CTAs. | All authenticated; participants panel write only for TD. | `tournament.detail.title` |
| `/tournaments/[eventId]/result` *(NEW)* | Page header (H1 + player name if TD viewing on behalf) → `<TournamentResultEntryForm>` (D-80 atomic single-screen) → bottom sticky `<SaveButton>`. Read-only mode if 14d wall expired for player caller OR `?mode=read`. | Player (own + within 14d), trainer-in-academy (anytime per D-73), TD (anytime). RLS-filtered. | `tournament.result.title` |
| `/players/[playerId]/rankings` *(NEW — Phase 4 canonical home per D-91)* | Tab-router shell (placeholder for Phase 7 player view) → `<RankingsTab>` with `<RankingTypeSelector>` + `<RankingLineChart>` (international) OR `<BelgiumTimelineStrip>` (when Belgium type active) + `<RangePillSelector>` + `<NewRankingEntryButton>` → secondary tab "Geschiedenis" with `<RankingEntriesTable>` (all entries for player, audit/correction surface). | Player (own only via URL guard); trainer + TD + academy_manager (academy scope); parent (own child). | `ranking.title` |

> **Why `/dashboard` as a Phase 4 surface when Phase 7 owns the player-view dashboard?** Phase 4 ships the trainer/TD "Te scoren" widget + player pending-result widget + minimal inbox AS the home page until Phase 7 builds the full player-view. The route is the same `/dashboard` slug Phase 7 reuses — Phase 7 swaps the body without changing the URL. **Planner note:** make `/dashboard` extensible (slot-based) so Phase 7 can add tabs without rebuilding.

> **Why `/players/[playerId]/rankings` instead of just `/rankings`?** Per D-91, Rankings tab is the canonical home in Phase 4 and **must work for any player a viewer is allowed to see**. A TD or trainer viewing their athlete's rankings hits `/players/[playerId]/rankings`. A player viewing their own rankings is redirected to `/players/{self}/rankings` from a header nav link or from `/dashboard`. URL guard (Phase 7 VIEW-02 pattern in nascent form) enforces: player role can only access `/players/{ownId}/rankings`.

### Page-level layout grid

Inherited from Phase 2 forms + Phase 3 calendar shell:
- App chrome: 56px (`h-14`) — Phase 1.
- Content max-width: `mx-auto max-w-screen-xl` (1280px) for forms + tables; `max-w-screen-2xl` (1536px) only for `/calendar` (Phase 3). Phase 4 surfaces use the Phase 2 `max-w-screen-xl` standard.
- Side padding: `px-4` mobile, `px-6` `md:` up.
- Vertical rhythm: `py-6` (24px) below chrome; `py-8` between page-H1 and content for form pages.
- Nudge banner stack: **above page chrome** (outside the `max-w-screen-xl` container) so it spans full viewport width.

---

## Component Inventory (Phase 4 — new files)

Drop-in shadcn primitives are not listed; only project-specific compositions are.

| Component | Path | Role | Server/Client |
|---|---|---|---|
| `BulkAttendanceScoreForm` | `src/components/training/bulk-attendance-score-form.tsx` | Per-session combined attendance + score capture (D-62). Repeating row component: `[<Avatar/> | <PlayerNameLabel/> | <AttendanceToggle/> | <StarRatingInput/> | <FeedbackTextarea/>]`. Uses `react-hook-form` with a `useFieldArray` over `participants`. Submits a single mutation upserting all `session_participants` for `(event_id, occurrence_date)`. | Client |
| `StarRatingInput` | `src/components/common/star-rating-input.tsx` | Custom 5-star input. Five `<button type="button">` elements, each rendering a lucide `Star` icon at 28px filled in `--cal-event-evalconv-border` or outline in `text-muted-foreground`. Keyboard: `1`-`5` set value, `←`/`→` step, `0` or `Esc` clear, `Enter`/`Space` commit. Click already-filled star → clear. Maps to DB values 2/4/6/8/10 per D-60. ARIA: `role="radiogroup"`, each star `role="radio"` with `aria-label="{n} sterren"`. | Client |
| `AttendanceToggle` | `src/components/training/attendance-toggle.tsx` | Three-state toggle: aanwezig / afwezig / nog niet ingevuld (default). Visual: shadcn `<ToggleGroup type="single">` with 2 toggles + neutral "—" state. DOM-MED-CONFLICT-02: when server flags a medical-overlap, the toggle is pre-selected to "afwezig met geldige reden" (a 4th hidden state in the field, rendered identically to "afwezig" with a tooltip on hover: "Medische conflict gedetecteerd"). Trainer can override. | Client |
| `FeedbackTextarea` | `src/components/training/feedback-textarea.tsx` | Wraps shadcn `<Textarea>` with 2000 char limit, autosize. Optional field. Inline char-count `[N / 2000]` below in `text-muted-foreground`. | Client |
| `TeScorenOverview` | `src/components/training/te-scoren-overview.tsx` | Trainer/TD dashboard widget (D-66 + D-68). Card with title `training.teScoren.heading`. Body: shadcn `<Table>` with rows `[datum | trainer (TD-view only) | type | aanwezig N/M | <Progress value=N% /> | "Score nu" button → /trainings/[eventId]/score]`. Empty state when 0 pending: success illustration + `training.teScoren.empty`. | Server (server-component data fetch via tRPC) — wraps Client `<TeScorenScoreNowButton>` per row |
| `NudgeBannerStack` | `src/components/nudge/nudge-banner-stack.tsx` | Slot above page chrome. Renders up to **N persistent banners stacked vertically** (max 2 in v1: trainer score nudge + player tournament-result nudge). Each banner: `<NudgeBanner>` component. **Non-dismissible per D-67.** Server pre-fetches counts; updates on focus (no polling). | Server (slot) wrapping Client `<NudgeBanner>` |
| `NudgeBanner` | `src/components/nudge/nudge-banner.tsx` | Single-banner row. Background = state-overlay color based on max-days-since-deadline across pending items (yellow → orange → red). Icon: lucide `AlertTriangle` 16px in fg color. Body: localized text with pending count + max-days remaining badge. Right side: "Bekijken" link → relevant overview. **No dismiss-X — non-dismissible per D-67.** Disappears only when server count = 0. | Client (reads count via tRPC subscription/refetch) |
| `MyTournamentResultPendingWidget` | `src/components/tournament/my-tournament-result-pending-widget.tsx` | Player dashboard widget when player has at least one tournament with no result row + within 14d. List of rows `[tournament naam | dagen tot deadline countdown | "Voer resultaat in" button]`. Empty state: success illustration. | Server wraps Client buttons |
| `MinimalSystemInbox` | `src/components/inbox/minimal-system-inbox.tsx` | Phase 4 thin inbox list. Reads from `system_inbox` table (pg_cron deposits per D-67 ch2 / D-72 ch2). Chronological list, newest first. Each row: icon (lucide `Bell` for nudge, `Trophy` for tournament-result-needed, `Dumbbell` for training-score-needed) + body + relative date + read/unread state (subtle background tint when unread). No threading, no compose, no avatars. **Phase 6 replaces this with the full Inbox UI.** | Server |
| `TournamentList` | `src/components/tournament/tournament-list.tsx` | Browsable history table. Card-stack on mobile. shadcn `<Table>` with columns per RBAC (player sees own + status; trainer sees academy; TD sees all + participant counts). Filter bar above (`<TournamentFilterBar>`). Pagination via cursor (10 per page). | Server (table) + Client `<TournamentFilterBar>` |
| `TournamentFilterBar` | `src/components/tournament/tournament-filter-bar.tsx` | Phase 3 Filter Bar pattern (UI3-D08 styling). Filters: `[Type ▾]` (tournament_type multi-select), `[Leeftijdscategorie ▾]`, `[Periode ▾]` (date range: dit jaar / vorig jaar / aangepast), `[Toon: ✓ Met mijn resultaat ✓ Zonder resultaat]` (player-only). URL-synced state via `?filter=`. | Client |
| `TournamentCreateForm` | `src/components/tournament/tournament-create-form.tsx` | TD-only tournament create/edit form (TOURN-01 / TOURN-02). Fields: naam, start/einddatum, stad, land, leeftijdscategorie (lookup), tornooitype (lookup), beschrijving. Submits via `tournament.create` (creates underlying `calendar_event` of type `event_type_tournament` + `tournaments` extension row atomically). **NOT visible to non-TD roles** — Phase 3 calendar `EventCreateSheet` route also remains valid (TD can create tournaments via the calendar Sheet OR via this dedicated form; both paths hit the same server endpoint). | Client |
| `TournamentParticipantsPanel` | `src/components/tournament/tournament-participants-panel.tsx` | TD-only panel on `/tournaments/[eventId]` (D-79). Two columns desktop: "Geregistreerd" (`<Table>` with player name + ingeschreven-op + "Verwijder" button) + "Voeg deelnemer toe" (`<FilterCombobox kind="player">` from Phase 3 — reused). Subscribing player creates `calendar_event_participants` row → triggers 14d entry window + nudge chain. Read-only view for non-TD: just the list, no add/remove. | Client |
| `TournamentResultEntryForm` | `src/components/tournament/tournament-result-entry-form.tsx` | Atomic single-screen entry form (D-69 + D-80). Two sections: **Top — Final ranking**: `<LookupSelect category="outcome_level">` (9 options sorted 1=winnaar best → 9=groepsfase) + read-only `<AgeCategorySnapshotLabel>` showing `tournament_results.player_age_category_code` derived from server. **Bottom — Match results**: `<MatchResultsTable>` with one pre-seeded row (round derived from outcome selection — "Finalist" → "Finale" first row). `[+ Wedstrijd toevoegen]` button below table. Single sticky `<SaveButton>` at page bottom commits `{outcome, matches[]}` atomically. **States:** read-only when 14d wall expired for player caller; "Overwrite mode" badge in form header when TD edits existing; "Backfill mode" badge when trainer-in-academy edits past 14d wall. | Client |
| `MatchResultsTable` | `src/components/tournament/match-results-table.tsx` | Repeating match-row composer (D-80 add-row-as-needed). shadcn `<Table>` header: `[Ronde* | Tegenstander* | Ranking opp. | Datum* | Sets gewonnen* | Sets verloren* | Resultaat | Video | ✕]`. Body rows: `[<LookupSelect category="tournament_round"> | <Input maxLength=200> | <Input type="number" optional> | <DateTimePicker dateOnly> | <SetTallyInput max=4> | <SetTallyInput max=4> | <DerivedWonLostIndicator/> (green/red dot + label, NOT editable per D-81) | <Input type="url" maxLength=500 optional> | <RemoveRowButton/>]`. Mobile: cards stack — each match becomes a card with same fields stacked vertically. Reorderable not in v1. | Client |
| `SetTallyInput` | `src/components/tournament/set-tally-input.tsx` | Numeric stepper-style input. Range 0–4 (D-81 CHECK constraint). Visual: shadcn `<Input type="number" min=0 max=4>` with `tabular-nums`, +/- buttons on sides. Server-validates `sets_won + sets_lost BETWEEN 1 AND 7` (a match has at least 1 set, max 4-3). | Client |
| `DerivedWonLostIndicator` | `src/components/tournament/derived-won-lost-indicator.tsx` | Derived display (D-81). Shows `<span class="dot green" />` Gewonnen when `sets_won > sets_lost`, `<span class="dot red" />` Verloren when `sets_won < sets_lost`, neutral `—` when equal or incomplete. Color paired with text label — never color-only. | Client |
| `TournamentResultsLeaderboard` | `src/components/tournament/tournament-results-leaderboard.tsx` | Academy-wide results visibility (D-78). On `/tournaments/[eventId]`. shadcn `<Table>`: speler + eindrangschikking + #wedstrijden + #gewonnen + link "Bekijk wedstrijden". Sort by outcome_level sort_order ascending (winnaar first). | Server |
| `TournamentResultsReadView` | `src/components/tournament/tournament-results-read-view.tsx` | Read-only mirror of `TournamentResultEntryForm` content for `?mode=read` or non-editable callers. Same layout shape — input components swap to read-only spans. "Bewerken" CTA visible if caller has edit permission. | Server |
| `RankingsTab` | `src/components/ranking/rankings-tab.tsx` | Container with `<RankingTypeSelector>` + conditional `<RankingLineChart>` (4 international types) OR `<BelgiumTimelineStrip>` (Belgium type). Above chart area: `<RangePillSelector>` (only when international type active). Bottom-right of card: `<NewRankingEntryButton>` → opens `<NewRankingEntrySheet>` (right-side `<Sheet>` with `<RankingEntryForm>` inside). | Server (data fetch) wrapping Client children |
| `RankingTypeSelector` | `src/components/ranking/ranking-type-selector.tsx` | Tab-style selector. 5 tabs: Senior Wereld / Jeugd Wereld / Senior Europees / Jeugd Europees / België. Default = player's primary type (D-88 — server-derived from age category). shadcn `<Tabs>` primitive. Persists selection in URL `?type=ranking_senior_world`. | Client |
| `RangePillSelector` | `src/components/ranking/range-pill-selector.tsx` | Range pill row (D-90). 5 pills: `1m / 6m / 1y / 2y / Alles`. Default = `2y` (24 months per D-90). shadcn `<ToggleGroup type="single">`. Hidden when Belgium type active (Belgium timeline shows all-time always per D-90). | Client |
| `RankingLineChart` | `src/components/ranking/ranking-line-chart.tsx` | recharts `<ResponsiveContainer><LineChart>`. **Y-axis inverted** (`<YAxis reversed />` — rank 1 at top per D-87). X-axis dates formatted via `formatDate()`. Tooltip per point: date + value + source (`manual` vs `federation_official`, with badge). Empty state when 0 entries: localized message. Loading skeleton: `<Skeleton class="h-64 w-full" />`. | Client |
| `BelgiumTimelineStrip` | `src/components/ranking/belgium-timeline-strip.tsx` | Annual horizontal strip (D-87). Pure CSS/Tailwind component — NO chart library. Horizontal scroll on overflow (max 30 cells comfortable; older history scrolls in). Each cell: `[year label above | colored band cell with tier-code label centered]`. Band background = `--cls-tier-{tier}-bg`, fg = `--cls-tier-{tier}-fg`, border = `--cls-tier-nc-border` for NC only. Click cell → opens `<RankingEntryDetailPopover>` with date + value + source. | Client |
| `NewRankingEntryButton` + `NewRankingEntrySheet` | `src/components/ranking/new-ranking-entry-sheet.tsx` | Right-side `<Sheet>` (max-w-md). Form: `<LookupSelect category="ranking_type">` (5 options) + `<DateTimePicker dateOnly>` (defaults to today) + conditional value input: `<Input type="number" min=1>` for international OR `<LookupSelect category="belgium_classification">` for Belgium (sorted by sort_order — A1, A2, ..., NC last). "Manueel ingevoerd, controleer tegen officiële bron" `<FormDescription>` always visible. **Player + TD only per D-89** — trainer role hides the button entirely. | Client |
| `RankingEntriesTable` | `src/components/ranking/ranking-entries-table.tsx` | Audit/correction table. shadcn `<Table>` columns: datum / type / waarde / bron (`Badge` "manueel" / "officieel federatie") / ingevoerd door (avatar + naam) + delete affordance (TD only). Sortable by date desc default. | Server |
| `MultiDayPicker` | `src/components/common/multi-day-picker.tsx` | RruleEditor BYDAY extension (D-85). Row of 7 toggle buttons `[Ma|Di|Wo|Do|Vr|Za|Zo]` (week-start Monday). Each toggle is a `<Toggle>` (shadcn). At least 1 day required (Zod validation). Preview line below: `lookup.rrule.bydayPreview` → "Bv. Di + Do" derived from selection. Only rendered when FREQ=WEEKLY in parent `<RruleEditor>`. | Client |
| `RruleScopePickerDialog` | `src/components/calendar/rrule-scope-picker-dialog.tsx` | shadcn `<AlertDialog>`. Triggers BEFORE save in `EventEditSheet` when event has `rrule != null` (D-84 wires backend). Radio-group with 3 options: "Deze afspraak" (writes `calendar_event_exceptions` — Phase 3 path) / "Deze en toekomstige" (server split-and-rewrite per D-84) / "Alle in de reeks" (server in-place update). Each option shows a sentence-style preview ("Wijzigingen worden toegepast op **deze afspraak op {formatDate(occurrenceDate)}**" etc.). **Replaces Phase 3 UI3-D12's disabled-with-"Komt in Fase 4" tooltip.** | Client |
| `EventDetailSheetActionFooter` *(extension)* | `src/components/calendar/event-detail-sheet.tsx` *(EXTENDS Phase 3)* | Phase 3 EventDetailSheet adds new Phase-4-conditional CTAs in the action footer. See UI4-D11 CTA matrix below. | Client (Phase 3 existing) |
| `EventChip needs-scoring overlay` *(extension)* | `src/components/calendar/event-chip.tsx` *(EXTENDS Phase 3)* | Adds the yellow ⚠ overlay variant per D-67 channel 3. See UI4-D07 chip variant extension table. **The Phase 3 `event.extendedProps` gets two new boolean flags:** `needsScoring: boolean` (training, trainer in scope, has NULL participant scores, within 14d) and `needsResult: boolean` (tournament, player is participant, no `tournament_results` row, within 14d). | Client (Phase 3 existing) |

### Form-field contract (reused from Phase 2 shadcn `<Form>` composition)

Same `<FormField>` / `<FormItem>` / `<FormLabel>` / `<FormControl>` / `<FormDescription>` / `<FormMessage>` composition as Phase 2. Required fields marked `*` in `text-destructive`. Zod messages emit i18n keys per Phase 2 D-46 and I18N-08.

---

## UI4-D01..D24 — Phase 4 Design Decisions (DEFAULTS — locked at checker approval)

### A. Foundation + design tokens

| ID | Decision | Default | Alternative | Why default |
|---|---|---|---|---|
| **UI4-D01** | Net-new shadcn components | `table`, `progress` (slider optional/v2) | Custom-build a data-table primitive | shadcn `table` is the canonical primitive in 2026; matches Phase 3 component-library hygiene |
| **UI4-D02** | State-overlay color family | 3 tokens (`--state-needs-action-*` yellow / `--state-nudge-warning-*` orange / `--state-nudge-critical-*` red) — light + dark variants | Reuse Phase 1 `--destructive` for critical | `--destructive` is "delete intent", not "deadline urgency"; conflating them blunts both semantics |
| **UI4-D03** | Belgium tier color family | 6 tokens (`--cls-tier-{a,b,c,d,e,nc}-*`) light + dark + NC outline | Use Tailwind palette literals | Tailwind v4 is CSS-first with no `tailwind.config.*` — no place for "gold-100" semantics; token approach keeps audit single-source |

### B. Trainer score capture surfaces

| ID | Decision | Default | Alternative | Why default |
|---|---|---|---|---|
| **UI4-D04** | Score capture form layout | Per-session screen at `/trainings/[eventId]/score`, list of `[avatar+name | attendance | 5-star | feedback]` rows, single bottom Save | Inline-on-EventDetailSheet | EventDetailSheet (max-w-md) is too narrow for 5-column row × N players; a dedicated page lets feedback textarea breathe |
| **UI4-D05** | 5-star input mechanics | Custom `<StarRatingInput>` writing DB values 2/4/6/8/10; clear by clicking already-filled star | shadcn `<Slider>` 1–10 | D-60 specifies 5-star v1 with zero-migration to v2 1–10; slider is v2 surface |
| **UI4-D06** | "Te scoren" widget location | `/dashboard` home for trainer + TD | Dedicated `/te-scoren` route | Dashboard home is the first stop after login; surfacing here creates the discipline-loop pressure D-67 demands |

### C. Nudge / state-overlay surfaces

| ID | Decision | Default | Alternative | Why default |
|---|---|---|---|---|
| **UI4-D07** | Calendar chip "needs-scoring" overlay variant | **Top-right corner badge: 12px lucide `AlertTriangle` filled in `--state-needs-action-fg` on a 16×16 circle of `--state-needs-action-bg` with 1px `--state-needs-action-border`. Positioned `absolute top-0.5 right-0.5`.** Hover: tooltip "Score nog niet ingevuld" (training) / "Resultaat nog niet ingevuld" (tournament). Click chip: opens `EventDetailSheet` → CTA "Open scoring" / "Voer resultaat in". Extends Phase 3 UI3-D11 chip variant taxonomy. | (a) Full background-color shift; (b) top-edge stripe; (c) icon next to title text | Corner badge keeps the existing event-type tinted chip readable while adding an unambiguous "action needed" flag. Background shift would conflict with event-type color identity; top-edge stripe is too subtle at week-view density; inline icon next-to-title eats truncation budget on already-narrow chips |
| **UI4-D08** | Nudge banner stack location + escalation | **Above page chrome (full-width, outside `max-w-*` container), max 2 stacked banners, h-10 each, non-dismissible.** Background color escalates by max-days-since-deadline across pending items: yellow (days 0–6) → orange (days 7–9) → red (days 10–12). Critical (≥ day 10) prefix copy with `⚠ {n} dagen tot deadline`. | (a) Toast (Sonner) — would disappear; (b) inline alert per page — easier to skip | D-67 specifies **persistent non-dismissible** — toasts violate this; per-page inline alerts don't ride the user through navigation; above-chrome captures every screen |
| **UI4-D09** | Minimal `system_inbox` UI ship | Ship a thin `system_inbox` table + read-only list widget in Phase 4; Phase 6 replaces with full Inbox UI | Defer channel 2 entirely until Phase 6 | RESEARCH.md recommends ship-minimal — keeps D-67 channel 2 contract complete; the pg_cron job needs a destination row by design |

### D. Tournament surfaces

| ID | Decision | Default | Alternative | Why default |
|---|---|---|---|---|
| **UI4-D10** | Tournament-result entry layout | Single screen at `/tournaments/[eventId]/result`: section 1 final-ranking dropdown + age-category snapshot label, section 2 match-results table with add-row-as-needed, single atomic Save commits `{outcome, matches[]}` per D-69 + D-80 | (a) Two-step wizard (outcome first, matches second); (b) two routes | D-80 explicitly chose atomic single-screen; wizard fragments the atomicity invariant |
| **UI4-D11** | EventDetailSheet CTA matrix extensions | Adds 3 conditional CTAs per UI4-D11 CTA matrix (see below) | Embed score/result entry inline inside the sheet | Sheet is max-w-md; sub-pages get the breathing room of `/trainings/[eventId]/score` or `/tournaments/[eventId]/result`; sheet stays a directional hub |
| **UI4-D12** | TD overwrite + backfill mode UX | Form header badge in `--state-needs-action-*` palette: "Overschrijven (TD)" or "Achteraf invullen (trainer)" with subtle icon and tooltip explaining attribution will be recorded | (a) No visual difference from player entry; (b) modal warning per save | Header badge is honest about the asymmetric authority without nagging on every save — matches D-75/D-73 "trust the staff" tone |
| **UI4-D13** | Player tournament-result pending widget | Standalone widget on `/dashboard` for player when ≥1 pending tournament + within 14d | Inline alert on `/tournaments` list page | Dashboard surfacing matches the discipline-loop pressure pattern from D-67/D-72; list-page alert would be lower visibility |

### E. Rankings surfaces

| ID | Decision | Default | Alternative | Why default |
|---|---|---|---|---|
| **UI4-D14** | Ranking range pill default + scope | Default = 2y (24 months per D-90); applies to international types only; Belgium timeline always shows all-time | (a) Default 1y; (b) Belgium also gets pill | D-90 explicit; Belgium annual data (3–5 points) doesn't benefit from range filtering |
| **UI4-D15** | International chart Y-axis inversion | `<YAxis reversed />`; tick formatter prepends "#" (e.g. "#127" not "127") to reinforce ranking semantics; axis label `ranking.chart.yAxis` = "Ranking (lager = beter)" | (a) Non-inverted with deeper-rank-better legend; (b) no axis label | Inversion + label + tick prefix is the redundant-encoding accessibility pattern; one signifier doesn't carry the meaning |
| **UI4-D16** | Belgium timeline interaction | Click cell → opens `<RankingEntryDetailPopover>` (shadcn `<Popover>`) anchored to the cell, showing date + value + source + ingevoerd-door | (a) Hover-only tooltip; (b) link to entries table | Click-popover works on touch + keyboard; hover-only fails on mobile + keyboard; deep link to table loses spatial context |
| **UI4-D17** | Ranking-entry form scope | Single sheet form, ranking_type dropdown drives the value-input swap (numeric for international, classification dropdown for Belgium) | Two separate forms (international + Belgium) | One form, conditional input matches the schema split (D-86); two forms would duplicate validation |

### F. RRULE polish

| ID | Decision | Default | Alternative | Why default |
|---|---|---|---|---|
| **UI4-D18** | RruleEditor scope picker UX | `<AlertDialog>` (modal) triggered on Save in `EventEditSheet` when event has `rrule != null` — radio-group with 3 options, each option shows a sentence-style preview rendered with `formatDate()` | (a) Always-visible radio in the form; (b) action-bar dropdown | Modal at save-time forces conscious choice; always-visible eats form vertical space; dropdown hides the choice |
| **UI4-D19** | BYDAY picker layout | 7-toggle row `[Ma\|Di\|Wo\|Do\|Vr\|Za\|Zo]` (Monday weekstart, locale-aware abbreviations) with min-1 validation + preview line below | Multi-select dropdown | Toggle row is more scannable + better mobile tap target (each toggle is 44×44 on mobile); dropdown is a click-to-discover pattern |
| **UI4-D20** | Inert exception garbage collection (planner concern, surfaces UX-side) | Leave inert exceptions in place; **do NOT** render them in the calendar list — server expansion already ignores them | Active GC nightly | Cheap + defensive against rrule-revert; user never sees the artifact |

### G. Cross-cutting

| ID | Decision | Default | Alternative | Why default |
|---|---|---|---|---|
| **UI4-D21** | 14d-wall read-only mode rendering | Form renders all inputs disabled + a top-of-form `<Alert variant="default">` with i18n key `errors.training.scoreWindowExpired` or `errors.tournament.entryWindowExpired`; no Save button | (a) Redirect to read view; (b) hide form entirely with toast | Disabled in-place preserves spatial context + lets the user see the data they would have entered — useful when they ask trainer/TD to backfill |
| **UI4-D22** | Mobile strategy for match-results table | Below `md:` breakpoint: each row collapses to a Card stack `<Card>` per match with fields stacked vertically; remove-row affordance is a `<DropdownMenu>` "⋮" trigger | Horizontal-scroll table | 9-column table at < 768px requires scroll; cards are more scannable + preserve label visibility |
| **UI4-D23** | Empty states tone + copy | Direct + operational ("Er zijn nog geen toernooien geregistreerd. Vraag de TD om er een toe te voegen.") — never apologetic, never clever, always next-action-oriented | Generic "Geen data" | Inherits Phase 2 tone — every empty state names the next action |
| **UI4-D24** | "Manueel ingevoerd, controleer tegen officiële bron" disclaimer placement | Always visible as `<FormDescription>` below the value input in `NewRankingEntrySheet`; in the read view (RankingEntriesTable) → `Badge "manueel"` next to the value | Footer note on chart | Inline-with-input puts the disclaimer at the moment of decision; footer-note risks being missed |

---

## Chip Variant Extension — UI4-D07 — extends Phase 3 UI3-D11

Phase 3 declared the EventChip with status overlays: `past event` (opacity-60), `currently happening` (ring), `recurring` (Repeat icon), `conflict` (AlertTriangle icon), `cancelled` (strikethrough). Phase 4 adds **two new state overlays** for the discipline-loop pattern.

| Variant name | Trigger (server-set in `event.extendedProps`) | Visual treatment | Role-visibility |
|---|---|---|---|
| `needs-scoring` | training event + `event.ends_at < now()` + `now() - ends_at <= 14d` + ≥1 NULL `session_participants.quality_score` for participants visible to caller | Top-right corner badge: 16×16 circle filled `--state-needs-action-bg`, 1px `--state-needs-action-border`, lucide `AlertTriangle` 12px in `--state-needs-action-fg` centered. Positioned `absolute top-0.5 right-0.5` on the event chip. Pulses subtly (1Hz, `prefers-reduced-motion: reduce` disables). Tooltip on hover: `training.chip.needsScoringTooltip`. | Trainer of session + TD (D-66 / D-68 scope). Other roles never see this overlay. |
| `needs-result` | tournament event + caller IS a `calendar_event_participants` row + `event.ends_at < now()` + `now() - ends_at <= 14d` + no `tournament_results` row exists for `(player_user_id, event_id)` | Identical visual to `needs-scoring` (same badge position, same colors, same icon). Tooltip on hover: `tournament.chip.needsResultTooltip`. | Player only when participant of their own tournament. Trainer-in-academy + TD see the equivalent on `TournamentResultsLeaderboard` row (NOT on the chip) — chip overlay is reserved for the action-owner role (player). |

**Why same visual for two distinct semantics?** Both signal "user must take action within 14d on this past event"; both link to a CTA on EventDetailSheet. Different tooltips disambiguate. **Single visual = single CSS class** (`event-chip--needs-action`) — implementation simplicity.

**Accessibility:**
- The chip's `aria-label` (Phase 3 `eventDidMount` hook) appends ", actie vereist" / ", action required" / ", action requise" when either flag is true.
- Color is NEVER the sole carrier — the lucide `AlertTriangle` icon is the redundant signifier; deuteranopia-safe.
- Pulse animation is purely decorative; `prefers-reduced-motion` disables.

---

## EventDetailSheet CTA Matrix — UI4-D11 — extends Phase 3 EventDetailSheet

Phase 3 EventDetailSheet declared CTAs: "Bewerken", "Verwijderen", "Ik kan niet aanwezig zijn", "Sluiten". Phase 4 adds **3 conditional CTAs** in the action footer.

| CTA | i18n key | Visibility condition | Target |
|---|---|---|---|
| **Open scoring** | `training.eventSheet.openScoring` | (`event.type === 'event_type_training'`) AND (`caller.role IN ('trainer', 'technical_director')`) AND (`caller.id === training_session.trainer_id` OR `caller.role === 'technical_director'`) AND (`event.ends_at < now()`) AND (`now() - event.ends_at <= 14d`) AND (occurrence is for a date with ≥1 NULL score row) | Navigate to `/trainings/[eventId]/score?occurrenceDate=YYYY-MM-DD` |
| **Voer resultaat in** | `tournament.eventSheet.enterResult` | (`event.type === 'event_type_tournament'`) AND ((`caller.role === 'player'` AND caller IS `calendar_event_participants` row AND `event.ends_at < now()` AND `now() - event.ends_at <= 14d` AND no `tournament_results` row) OR (`caller.role IN ('trainer','technical_director')` AND `event.ends_at < now()` AND (trainer in player's academy OR TD) — backfill mode)) | Navigate to `/tournaments/[eventId]/result` |
| **Resultaat bekijken** | `tournament.eventSheet.viewResult` | (`event.type === 'event_type_tournament'`) AND (`tournament_results` row exists visible to caller per D-78) | Navigate to `/tournaments/[eventId]/result?mode=read` |

**Ordering in the action footer (top-to-bottom for vertical Sheet bottom, left-to-right when horizontal allows):**
1. **Open scoring** / **Voer resultaat in** (primary action) — uses `<Button variant="default">` with `--primary` accent (Phase 4 accent list).
2. **Resultaat bekijken** (secondary action) — uses `<Button variant="outline">`.
3. **Bewerken** (Phase 3 — secondary).
4. **Verwijderen** (Phase 3 — destructive variant).
5. **Ik kan niet aanwezig zijn** (Phase 3 — ghost).
6. **Sluiten** (Phase 3 — ghost).

When a conditional CTA does not apply, it is hidden entirely (not disabled). **No "Komt in Fase 4" placeholders** — Phase 4 ships these.

---

## RruleEditor Scope Picker + BYDAY Layout — UI4-D18 / UI4-D19

### Scope picker dialog (UI4-D18) — extends Phase 3 UI3-D12

Phase 3 UI3-D12 declared the scope picker affordance with two scope options disabled ("Komt in Fase 4"). Phase 4 enables both and adds a confirmation dialog that fires on Save.

**Trigger:** When user clicks "Wijzigingen opslaan" in `EventEditSheet` and the event has `rrule != null` (recurring), a shadcn `<AlertDialog>` appears BEFORE the mutation is submitted.

**Dialog content:**
- Title: `calendar.event.recurrence.scopeTitle` — "Hoe toepassen op de reeks?"
- Body: `calendar.event.recurrence.scopeBody` — "Je wijzigt een afspraak die deel uitmaakt van een reeks. Kies hoe je wijzigingen wilt toepassen:"
- Radio-group with 3 options (uses shadcn `<RadioGroup>`):
  1. **"Deze afspraak"** (`calendar.event.recurrence.scopeThis`) — default. Sentence preview: "Alleen de afspraak op **{formatDate(occurrenceDate)}** wordt aangepast. De rest van de reeks blijft ongewijzigd."
  2. **"Deze en toekomstige"** (`calendar.event.recurrence.scopeFuture`) — sentence preview: "Wijzigingen worden toegepast op de afspraak van **{formatDate(occurrenceDate)}** én alle toekomstige afspraken in deze reeks. Eerdere afspraken blijven ongewijzigd."
  3. **"Alle in de reeks"** (`calendar.event.recurrence.scopeAll`) — sentence preview: "Wijzigingen worden toegepast op alle afspraken in deze reeks — verleden, heden en toekomst — maar **reeds ingevulde aanwezigheid en scores blijven onaangetast**."
- Action buttons: `[Annuleren]` (ghost) + `[Toepassen]` (primary).

**Sentence-style preview rationale:** Plain-language preview prevents the "I clicked the wrong radio and lost a year of data" anxiety. Each preview names the concrete dates affected — no abstraction.

### BYDAY picker (UI4-D19)

Renders inside `<RruleEditor>` **only when `frequency === 'weekly'`** is selected.

**Layout (desktop ≥ 640px):**

```
[ Ma ] [ Di ] [ Wo ] [ Do ] [ Vr ] [ Za ] [ Zo ]
Bv. Di + Do
```

- 7 `<Toggle>` buttons in a row (`<ToggleGroup type="multiple">`), each 40×40 (`size="default"` for shadcn Toggle).
- Locale-aware abbreviations: Dutch `Ma Di Wo Do Vr Za Zo`, English `Mon Tue Wed Thu Fri Sat Sun`, French `Lu Ma Me Je Ve Sa Di`.
- Below toggle row: a 14px `text-muted-foreground` preview line showing localized day names joined with `+`: "Di + Do" → `lookup.rrule.bydayPreview` with parameter `{days}`.

**Layout (mobile < 640px):**

- Same row, scaled tap targets to 44×44 (`min-h-11 min-w-11`).
- Preview line wraps if needed.

**Validation:**
- At least 1 day required when FREQ=WEEKLY (Zod: `.min(1, { message: 'errors.calendar.rruleBydayRequired' })`).
- Validation error renders as `<FormMessage>` below the preview line.

**Server contract:**
- Selected days serialize to RFC 5545 BYDAY string: `MO,TU,WE,TH,FR,SA,SU` (always English 2-letter codes regardless of UI locale — RFC compliance).
- Maps directly to `rrule@2.8.1`'s `byweekday` option per RESEARCH.md.

---

## Two Ranking Widgets — UI4-D15 / UI4-D16

### International ranking line chart — UI4-D15

**Component:** `<RankingLineChart>` using `recharts` 3.8.1.

**Layout structure:**

```
┌─────────────────────────────────────────────────────────┐
│ [Senior Wereld] [Jeugd Wereld] [Senior Eur.] [Jeugd]    │  ← <RankingTypeSelector> (shadcn Tabs)
├─────────────────────────────────────────────────────────┤
│  [1m] [6m] [1y] [▶2y] [Alles]              [+ Toevoegen]│  ← <RangePillSelector> (active=2y default) + CTA
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Ranking (lager = beter)                                 │
│  #1                  ●                                   │  ← Y-axis label + ranks ascending TOP-TO-BOTTOM
│  #50         ●─────●                                     │
│  #100  ●───●                                             │
│  #200        ●─────●─────●                               │
│                                                          │
│              ←────────── X-axis: time ──────────→        │
└─────────────────────────────────────────────────────────┘
```

**recharts configuration:**
- `<ResponsiveContainer width="100%" height={320}>` on desktop; `height={240}` below `md:`.
- `<LineChart data={entries}>` with single `<Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 4, fill: 'var(--primary)' }} />`.
- `<YAxis reversed tickFormatter={(v) => `#${v}`}>`.
- `<XAxis dataKey="recordedAt" tickFormatter={(ts) => formatDate(ts, 'dd/MM/yy')} />`.
- `<Tooltip content={<CustomRankingTooltip />} />` — custom tooltip renders 3 lines: formatted date, `#{value}`, badge `manueel` or `officieel federatie`.
- `<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />`.

**Empty state (no entries for this type):**

Centered within the chart container (320px height):
- lucide `LineChart` icon (24px, `text-muted-foreground`).
- Heading: `ranking.empty.heading` — "Nog geen rankings ingevoerd".
- Body: `ranking.empty.body` — "Voeg je eerste ranking toe om je evolutie te volgen."
- CTA button: `ranking.empty.cta` — "+ Ranking toevoegen" → opens `<NewRankingEntrySheet>`.

**Loading state:** `<Skeleton className="h-80 w-full" />` while data fetches.

**Error state:** `<Alert variant="destructive">` with `errors.ranking.fetchFailed` + "Probeer opnieuw" button.

### Belgium timeline strip — UI4-D16

**Component:** `<BelgiumTimelineStrip>` — pure CSS/Tailwind, no chart library.

**Layout structure (light mode example for player with history 2022-A25, 2023-B0, 2024-A18, 2025-A12):**

```
┌──────────┬──────────┬──────────┬──────────┐
│   2022   │   2023   │   2024   │   2025   │   ← year label, text-sm font-medium text-muted-foreground
├──────────┼──────────┼──────────┼──────────┤
│   A25    │    B0    │   A18    │   A12    │   ← tier code, text-sm font-medium font-mono, centered in band
│  [GOLD]  │ [SILVER] │  [GOLD]  │  [GOLD]  │   ← band background = --cls-tier-{tier}-bg, fg = --cls-tier-{tier}-fg
└──────────┴──────────┴──────────┴──────────┘
```

**Tailwind structure:**

```jsx
<div className="flex w-full overflow-x-auto gap-px rounded-md border bg-border">
  {entries.map((entry) => (
    <div key={entry.id} className="flex flex-col flex-1 min-w-20">
      <div className="text-sm font-medium text-muted-foreground text-center py-1">{entry.year}</div>
      <button
        type="button"
        onClick={() => openPopover(entry)}
        className={cn(
          "h-12 flex items-center justify-center text-sm font-medium font-mono",
          `bg-cls-tier-${entry.tier}-bg text-cls-tier-${entry.tier}-fg`,
          entry.tier === 'nc' && "border border-cls-tier-nc-border"
        )}
      >
        {entry.classificationCode}
      </button>
    </div>
  ))}
</div>
```

**Interaction:**
- Click year cell → opens `<Popover>` anchored to cell with: date, value, source badge, ingevoerd door (avatar + naam), and (TD only) a "Verwijder" affordance.
- Keyboard navigable: each cell is a `<button>` reachable via Tab; Enter / Space opens popover.

**Empty state:**

Centered within timeline container:
- lucide `Award` icon (24px, `text-muted-foreground`).
- Heading: `ranking.belgium.empty.heading` — "Nog geen Belgische classificatie ingevoerd".
- Body: `ranking.belgium.empty.body` — "Voeg je actuele klassement toe (zoals A12, B4 of NC)."
- CTA: `ranking.belgium.empty.cta` — "+ Klassement toevoegen".

**Overflow:**
- Horizontal scroll when history exceeds visible width (`overflow-x-auto`).
- "Vroegste jaar" label at the leftmost cell when scrolling visible (sticky-left optional).

---

## Multilingual Copy — Top-Level Keyspaces + Samples

Per I18N-05..I18N-08, every Phase 4 user-facing string is an i18n key with nl/en/fr canonical text. Below: the complete top-level keyspace inventory + samples for the most critical phrases. **Planner ships these into `messages/{nl,en,fr}.json` as part of the i18n bundle migration.**

### Keyspace inventory

```
messages/{nl,en,fr}.json
├── dashboard.*                          — page title, sectie headings, empty states
├── training.*                           — score capture screen, "Te scoren" widget, event sheet CTAs
│   ├── training.score.*                 — form labels, save, success/error
│   ├── training.teScoren.*              — widget heading, columns, empty state
│   ├── training.chip.*                  — needs-scoring tooltip
│   └── training.eventSheet.*            — "Open scoring" CTA copy
├── tournament.*                         — tournament list, detail, result entry/read, participants panel
│   ├── tournament.list.*                — page title, columns, filters
│   ├── tournament.detail.*              — section headings
│   ├── tournament.create.*              — TD-only form labels
│   ├── tournament.participants.*        — TD-only participant panel
│   ├── tournament.result.*              — entry form labels, atomic save
│   ├── tournament.matchResults.*        — table column headers, won/lost labels
│   ├── tournament.leaderboard.*         — academy-wide leaderboard headings
│   ├── tournament.chip.*                — needs-result tooltip
│   ├── tournament.eventSheet.*          — "Voer resultaat in" / "Resultaat bekijken" CTA copy
│   └── tournament.pendingWidget.*       — player dashboard widget
├── ranking.*                            — Rankings tab, type selector, range pills, charts, entry form
│   ├── ranking.title                    — Rankings tab page title
│   ├── ranking.types.*                  — display labels for 5 types (paired with lookup.rankingType.*)
│   ├── ranking.range.*                  — pill labels (1m, 6m, 1y, 2y, all)
│   ├── ranking.chart.*                  — axis labels, tooltip headings
│   ├── ranking.belgium.*                — timeline-specific copy + empty
│   ├── ranking.empty.*                  — international chart empty state
│   ├── ranking.entry.*                  — new entry sheet labels + disclaimer
│   └── ranking.entries.*                — entries table column headers
├── nudge.*                              — banner copy templates per channel + escalation
│   ├── nudge.trainerScore.*             — training score nudge (channels 1+2+4)
│   ├── nudge.playerResult.*             — tournament result nudge (channels 1+2+4)
│   └── nudge.inbox.*                    — system_inbox row body templates
├── errors.training.*                    — Zod validation messages
│   ├── errors.training.scoreWindowExpired
│   └── errors.training.scoreRange
├── errors.tournament.*                  — Zod validation messages
│   ├── errors.tournament.entryWindowExpired
│   ├── errors.tournament.outcomeRequired
│   ├── errors.tournament.atLeastOneMatch
│   ├── errors.tournament.setRange
│   └── errors.tournament.videoLink
├── errors.ranking.*
│   ├── errors.ranking.valueRequired
│   ├── errors.ranking.classificationRequired
│   └── errors.ranking.dateRequired
├── errors.calendar.rruleBydayRequired    — extends Phase 3 errors.calendar.*
├── lookup.outcomeLevel.*                — 9 codes (winnaar, finalist, laatste_4..128, groepsfase)
├── lookup.belgiumClassification.*       — ~25 codes (A1..A50 + B0/2/4/6 + C0/2/4/6 + D0/2/4/6 + E0/2/4/6 + NC)
├── lookup.rankingType.*                 — 5 codes
├── lookup.trainingType.*                — TD-defined; seeded set TBD by planner
├── lookup.organisation.*                — TD-defined; seeded set TBD by planner
├── lookup.tournamentType.*              — TD-defined; seeded set TBD by planner
├── lookup.tournamentRound.*             — Finale, Halve finale, Kwartfinale, 1/8 finale, 1/16, 1/32, 1/64, 1/128, Groepsfase, Andere
└── lookup.rrule.bydayPreview            — preview line template
```

### Critical copy samples (nl / en / fr)

**Nudge banners (escalating tone — D-67 ch4):**

| Key | nl | en | fr |
|---|---|---|---|
| `nudge.trainerScore.day0to6` | Je hebt {n} trainingen waarvoor scores ontbreken. | You have {n} trainings missing scores. | Vous avez {n} entraînements sans scores. |
| `nudge.trainerScore.day7to9` | **Let op:** {n} trainingen wachten al meer dan een week op je scores. | **Heads up:** {n} trainings have been waiting over a week for your scores. | **Attention :** {n} entraînements attendent vos scores depuis plus d'une semaine. |
| `nudge.trainerScore.day10to12` | ⚠ **{n} trainingen** — nog **{daysLeft} dagen** om te scoren voordat de deadline verstrijkt. | ⚠ **{n} trainings** — only **{daysLeft} days left** to score before the deadline expires. | ⚠ **{n} entraînements** — plus que **{daysLeft} jours** pour saisir les scores avant l'expiration. |
| `nudge.playerResult.day0to6` | Je hebt {n} toernooien waarvan het resultaat nog niet is ingevoerd. | You have {n} tournaments with results not yet entered. | Vous avez {n} tournois dont les résultats n'ont pas été saisis. |
| `nudge.playerResult.day10to12` | ⚠ Nog **{daysLeft} dagen** om je toernooiresultaten in te voeren — daarna kan alleen de TD of trainer dit nog doen. | ⚠ Only **{daysLeft} days left** to enter your tournament results — after that, only the TD or trainer can do it. | ⚠ Plus que **{daysLeft} jours** pour saisir vos résultats — ensuite, seul le DT ou l'entraîneur pourra le faire. |
| `nudge.cta.scoreNow` | Score nu | Score now | Saisir les scores |
| `nudge.cta.enterResult` | Voer resultaat in | Enter result | Saisir le résultat |
| `nudge.cta.viewPending` | Bekijken | View | Voir |

**Score capture form (D-62):**

| Key | nl | en | fr |
|---|---|---|---|
| `training.score.title` | Aanwezigheid en score invoeren | Enter attendance and score | Saisir présence et score |
| `training.score.metadataDate` | Datum: {date} | Date: {date} | Date : {date} |
| `training.score.metadataTrainer` | Trainer: {name} | Trainer: {name} | Entraîneur : {name} |
| `training.score.metadataType` | Type: {type} | Type: {type} | Type : {type} |
| `training.score.metadataOrg` | Organisatie: {org} | Organization: {org} | Organisation : {org} |
| `training.score.column.player` | Speler | Player | Joueur |
| `training.score.column.attendance` | Aanwezig | Present | Présent |
| `training.score.column.score` | Score | Score | Score |
| `training.score.column.feedback` | Feedback | Feedback | Retour |
| `training.score.attendance.present` | Aanwezig | Present | Présent |
| `training.score.attendance.absent` | Afwezig | Absent | Absent |
| `training.score.attendance.absentMedical` | Afwezig (medische reden) | Absent (medical) | Absent (raison médicale) |
| `training.score.attendance.pending` | — | — | — |
| `training.score.stars.aria` | {n} van 5 sterren | {n} of 5 stars | {n} sur 5 étoiles |
| `training.score.stars.clear` | Score wissen | Clear score | Effacer le score |
| `training.score.feedback.placeholder` | Optionele feedback voor deze speler... | Optional feedback for this player... | Retour facultatif pour ce joueur... |
| `training.score.feedback.charCount` | {n} / 2000 | {n} / 2000 | {n} / 2000 |
| `training.score.save` | Opslaan | Save | Enregistrer |
| `training.score.saveSuccess` | Aanwezigheid en scores opgeslagen | Attendance and scores saved | Présence et scores enregistrés |
| `training.score.saveError` | Opslaan mislukt — controleer de gegevens en probeer opnieuw | Save failed — review the data and try again | Échec de l'enregistrement — vérifiez les données et réessayez |
| `errors.training.scoreWindowExpired` | Het scoren-venster voor deze training is verstreken (14 dagen). | The scoring window for this training has expired (14 days). | La fenêtre de saisie pour cet entraînement est expirée (14 jours). |
| `errors.training.scoreRange` | De score moet tussen 1 en 10 liggen. | The score must be between 1 and 10. | Le score doit être compris entre 1 et 10. |

**Te Scoren overview:**

| Key | nl | en | fr |
|---|---|---|---|
| `training.teScoren.heading` | Te scoren | Pending scores | À saisir |
| `training.teScoren.column.date` | Datum | Date | Date |
| `training.teScoren.column.trainer` | Trainer | Trainer | Entraîneur |
| `training.teScoren.column.type` | Type | Type | Type |
| `training.teScoren.column.progress` | Voortgang | Progress | Progression |
| `training.teScoren.progressLabel` | {scored} / {total} spelers gescoord | {scored} / {total} players scored | {scored} / {total} joueurs notés |
| `training.teScoren.scoreNow` | Score nu | Score now | Saisir |
| `training.teScoren.empty` | Alle scores zijn ingevoerd. Goed gedaan. | All scores are entered. Well done. | Tous les scores sont saisis. Bien joué. |
| `training.chip.needsScoringTooltip` | Score nog niet ingevuld | Score not yet entered | Score non encore saisi |

**Tournament result entry (D-80):**

| Key | nl | en | fr |
|---|---|---|---|
| `tournament.result.title` | Toernooiresultaat invoeren | Enter tournament result | Saisir le résultat du tournoi |
| `tournament.result.section.outcome` | Eindrangschikking | Final ranking | Classement final |
| `tournament.result.section.matches` | Wedstrijdresultaten | Match results | Résultats des matchs |
| `tournament.result.field.outcome` | Behaald niveau | Outcome reached | Niveau atteint |
| `tournament.result.field.ageCategory` | Leeftijdscategorie (op tornooidatum) | Age category (at tournament date) | Catégorie d'âge (à la date du tournoi) |
| `tournament.result.addMatch` | + Wedstrijd toevoegen | + Add match | + Ajouter un match |
| `tournament.matchResults.column.round` | Ronde | Round | Tour |
| `tournament.matchResults.column.opponent` | Tegenstander | Opponent | Adversaire |
| `tournament.matchResults.column.opponentRanking` | Ranking opp. | Opp. ranking | Classement adv. |
| `tournament.matchResults.column.date` | Datum | Date | Date |
| `tournament.matchResults.column.setsWon` | Sets gewonnen | Sets won | Sets gagnés |
| `tournament.matchResults.column.setsLost` | Sets verloren | Sets lost | Sets perdus |
| `tournament.matchResults.column.result` | Resultaat | Result | Résultat |
| `tournament.matchResults.column.video` | Videolink | Video link | Lien vidéo |
| `tournament.matchResults.won` | Gewonnen | Won | Gagné |
| `tournament.matchResults.lost` | Verloren | Lost | Perdu |
| `tournament.matchResults.draw` | Gelijkspel | Draw | Égalité |
| `tournament.matchResults.removeRow.aria` | Wedstrijd verwijderen | Remove match | Supprimer le match |
| `tournament.result.save` | Resultaat opslaan | Save result | Enregistrer le résultat |
| `tournament.result.overwriteBadge` | Overschrijven (TD) | Overwrite (TD) | Écraser (DT) |
| `tournament.result.backfillBadge` | Achteraf invullen (trainer) | Backfill (trainer) | Saisie a posteriori (entraîneur) |
| `errors.tournament.entryWindowExpired` | Het invoer-venster voor dit toernooi is verstreken (14 dagen). Vraag je trainer of TD om het resultaat in te voeren. | The entry window for this tournament has expired (14 days). Ask your trainer or TD to enter the result. | La fenêtre de saisie pour ce tournoi est expirée (14 jours). Demandez à votre entraîneur ou au DT de saisir le résultat. |
| `errors.tournament.atLeastOneMatch` | Voeg minstens één wedstrijd toe. | Add at least one match. | Ajoutez au moins un match. |
| `errors.tournament.outcomeRequired` | Kies een eindrangschikking. | Select a final outcome. | Sélectionnez un classement final. |
| `errors.tournament.setRange` | Sets gewonnen + verloren moet tussen 1 en 7 liggen. | Sets won + lost must be between 1 and 7. | La somme des sets gagnés et perdus doit être entre 1 et 7. |
| `errors.tournament.videoLink` | Videolink moet een geldige URL zijn (max 500 tekens). | Video link must be a valid URL (max 500 characters). | Le lien vidéo doit être une URL valide (max 500 caractères). |

**Ranking surface:**

| Key | nl | en | fr |
|---|---|---|---|
| `ranking.title` | Rankings | Rankings | Classements |
| `ranking.types.international.senior_world` | Senior Wereld | Senior World | Senior Monde |
| `ranking.types.international.youth_world` | Jeugd Wereld | Youth World | Jeunes Monde |
| `ranking.types.international.senior_european` | Senior Europees | Senior European | Senior Europe |
| `ranking.types.international.youth_european` | Jeugd Europees | Youth European | Jeunes Europe |
| `ranking.types.belgium` | België | Belgium | Belgique |
| `ranking.range.1m` | 1m | 1m | 1m |
| `ranking.range.6m` | 6m | 6m | 6m |
| `ranking.range.1y` | 1j | 1y | 1a |
| `ranking.range.2y` | 2j | 2y | 2a |
| `ranking.range.all` | Alles | All | Tout |
| `ranking.chart.yAxisLabel` | Ranking (lager = beter) | Ranking (lower is better) | Classement (plus bas = meilleur) |
| `ranking.chart.tooltip.source.manual` | Manueel | Manual | Manuel |
| `ranking.chart.tooltip.source.federationOfficial` | Officieel (federatie) | Official (federation) | Officiel (fédération) |
| `ranking.empty.heading` | Nog geen rankings ingevoerd | No rankings entered yet | Aucun classement saisi |
| `ranking.empty.body` | Voeg je eerste ranking toe om je evolutie te volgen. | Add your first ranking to track your evolution. | Ajoutez votre premier classement pour suivre votre évolution. |
| `ranking.empty.cta` | + Ranking toevoegen | + Add ranking | + Ajouter un classement |
| `ranking.belgium.empty.heading` | Nog geen Belgische classificatie ingevoerd | No Belgian classification entered yet | Aucune classification belge saisie |
| `ranking.belgium.empty.body` | Voeg je actuele klassement toe (zoals A12, B4 of NC). | Add your current classification (such as A12, B4, or NC). | Ajoutez votre classification actuelle (comme A12, B4 ou NC). |
| `ranking.belgium.empty.cta` | + Klassement toevoegen | + Add classification | + Ajouter une classification |
| `ranking.entry.title` | Ranking toevoegen | Add ranking | Ajouter un classement |
| `ranking.entry.field.type` | Type ranking | Ranking type | Type de classement |
| `ranking.entry.field.date` | Datum | Date | Date |
| `ranking.entry.field.value.international` | Ranking-waarde | Ranking value | Valeur de classement |
| `ranking.entry.field.value.belgium` | Klassement | Classification | Classification |
| `ranking.entry.disclaimer` | Manueel ingevoerd — controleer tegen officiële bron. | Manually entered — verify against the official source. | Saisi manuellement — à vérifier auprès de la source officielle. |
| `ranking.entry.save` | Toevoegen | Add | Ajouter |

**Lookup outcomeLevel (9 entries, codes language-neutral):**

| Code | nl | en | fr |
|---|---|---|---|
| `outcome_winner` | Winnaar | Winner | Vainqueur |
| `outcome_finalist` | Finalist | Finalist | Finaliste |
| `outcome_last_4` | Halve finale (laatste 4) | Semifinal (last 4) | Demi-finale (4 derniers) |
| `outcome_last_8` | Kwartfinale (laatste 8) | Quarterfinal (last 8) | Quart de finale (8 derniers) |
| `outcome_last_16` | Laatste 16 | Last 16 | 16es de finale |
| `outcome_last_32` | Laatste 32 | Last 32 | 32es de finale |
| `outcome_last_64` | Laatste 64 | Last 64 | 64es de finale |
| `outcome_last_128` | Laatste 128 | Last 128 | 128es de finale |
| `outcome_group_stage` | Groepsfase | Group stage | Phase de groupes |

**Lookup belgiumClassification (samples — A/B/C/D/E/NC tier):**

| Code | nl / en / fr (codes language-neutral; same label across locales) |
|---|---|
| `A1` | A1 |
| `A12` | A12 |
| `A50` | A50 |
| `B0` | B0 |
| `B6` | B6 |
| `C0` | C0 |
| `D6` | D6 |
| `E0` | E0 |
| `NC` | NC |

> **Important:** Belgium classification codes are proper nouns of the federation taxonomy (per I18N-06). The code IS the label across all three locales. The localized helper text (e.g., tier descriptor) lives in `lookup.belgiumClassification.tier.{A|B|C|D|E|NC}` if needed for tooltips — DEFER tooltip copy decision to planner (out-of-scope to fully specify here).

**Lookup rankingType (5 entries):**

| Code | nl | en | fr |
|---|---|---|---|
| `ranking_senior_world` | Senior Wereld (ITTF) | Senior World (ITTF) | Senior Monde (ITTF) |
| `ranking_youth_world` | Jeugd Wereld (ITTF) | Youth World (ITTF) | Jeunes Monde (ITTF) |
| `ranking_senior_european` | Senior Europees (ETTU) | Senior European (ETTU) | Senior Europe (ETTU) |
| `ranking_youth_european` | Jeugd Europees (ETTU) | Youth European (ETTU) | Jeunes Europe (ETTU) |
| `ranking_belgium` | België (KBTTB) | Belgium (KBTTB) | Belgique (KBTTB) |

**Lookup tournamentRound (10 entries):**

| Code | nl | en | fr |
|---|---|---|---|
| `round_final` | Finale | Final | Finale |
| `round_semi` | Halve finale | Semifinal | Demi-finale |
| `round_quarter` | Kwartfinale | Quarterfinal | Quart de finale |
| `round_eighth` | 1/8 finale | Round of 16 | 8es de finale |
| `round_sixteenth` | 1/16 finale | Round of 32 | 16es de finale |
| `round_thirty_second` | 1/32 finale | Round of 64 | 32es de finale |
| `round_sixty_fourth` | 1/64 finale | Round of 128 | 64es de finale |
| `round_one_twenty_eighth` | 1/128 finale | Round of 256 | 128es de finale |
| `round_group_stage` | Groepsfase | Group stage | Phase de groupes |
| `round_other` | Andere | Other | Autre |

**Outcome → first-row round derivation map (server logic):**

| Outcome | Derived first-row round |
|---|---|
| `outcome_winner` | `round_final` |
| `outcome_finalist` | `round_final` |
| `outcome_last_4` | `round_semi` |
| `outcome_last_8` | `round_quarter` |
| `outcome_last_16` | `round_eighth` |
| `outcome_last_32` | `round_sixteenth` |
| `outcome_last_64` | `round_thirty_second` |
| `outcome_last_128` | `round_sixty_fourth` |
| `outcome_group_stage` | `round_group_stage` |

---

## Mobile Strategy

Phase 4 inherits Phase 2 (form mobile) + Phase 3 (calendar mobile) conventions. Net-new mobile rules below.

| Surface | Desktop (≥ 768px) | Mobile (< 768px) |
|---|---|---|
| `BulkAttendanceScoreForm` | Table-row layout `[avatar+name | attend | stars | feedback]` | Card stack per player: avatar + name + attendance toggle row on top; star row below; feedback textarea bottom; per-card card padding `p-4` |
| Save button | Inline at form bottom | Sticky `<div className="sticky bottom-0 bg-background border-t p-4">` containing the Save button — always reachable without scroll |
| `MatchResultsTable` | 9-column shadcn `<Table>` | Card-stack per match (`MatchResultCard`); each card stacks fields vertically; per-row remove via "⋮" `<DropdownMenu>` |
| `TournamentList` | shadcn `<Table>` (8 columns) | Card-stack (`TournamentCard`): naam + datums prominently; lookups as Badge row below; right-arrow tap navigates to detail |
| `RankingsTab` chart | recharts 320px height | recharts 240px height; `<RangePillSelector>` becomes horizontal-scrollable; `<RankingTypeSelector>` becomes scrollable Tabs row |
| `BelgiumTimelineStrip` | min-w-20 cells, fit-content with overflow-x-auto if > 6 cells | min-w-20 cells, horizontal scroll mandatory if > 4 cells; cell tap = popover |
| `NudgeBannerStack` | Above chrome, h-10 each | Above chrome, h-12 each (account for safe-area-inset-top); body copy truncates at 1 line; "Bekijken" button always visible |
| `TeScorenOverview` | shadcn `<Table>` | Card-stack per session; progress bar prominent; "Score nu" button full-width |
| Calendar chip overlay (UI4-D07) | 16×16 badge at top-right of chip | 16×16 badge unchanged; chip min-height already 44px per Phase 3 |
| `RruleScopePickerDialog` | shadcn `<AlertDialog>` centered, max-w-md | shadcn `<AlertDialog>` full-screen on mobile (Radix default); radio options stack with sentence preview below each |
| BYDAY picker | 7 toggles in row | 7 toggles in row with min 44×44 tap target each — may wrap to 2 lines on narrow viewports |
| `NewRankingEntrySheet` | Right-side `<Sheet>` (max-w-md) | Bottom `<Sheet side="bottom">` with `h-[90vh]` |

**Touch interactions:**
- All interactive elements ≥ 44×44 (WCAG 2.5.5) — already enforced by Phase 3 mobile rules.
- No drag-to-reorder on match rows in v1 (deferred — planner may revisit if user feedback demands).

**Safe-area inset:** Nudge banner stack reads `env(safe-area-inset-top)` so it sits below the iOS notch / Android status bar.

---

## Empty + Error States Catalog

| Surface | Empty state | Error state |
|---|---|---|
| `/dashboard` (no nudges, no inbox) | "Geen openstaande acties." + lucide `Check` icon (24px, `text-muted-foreground`) | `<Alert variant="destructive">` with `errors.generic` + retry |
| `TeScorenOverview` (0 pending) | `training.teScoren.empty` — "Alle scores zijn ingevoerd. Goed gedaan." + lucide `CheckCircle2` (24px) | Page-level Alert |
| `MyTournamentResultPendingWidget` (0 pending) | "Geen openstaande toernooiresultaten." + lucide `CheckCircle2` | Page-level Alert |
| `MinimalSystemInbox` (0 messages) | "Geen berichten." + lucide `Inbox` (24px) | Page-level Alert |
| `TournamentList` (no tournaments) | "Er zijn nog geen toernooien geregistreerd." + lucide `Trophy` (32px) + TD-conditional CTA "+ Toernooi aanmaken" | Page-level Alert + retry |
| `TournamentList` (filtered, 0 match) | "Geen toernooien voor deze filters." + "Filters wissen" CTA | n/a |
| `TournamentResultsLeaderboard` (no results entered yet) | "Nog geen resultaten ingevoerd voor dit toernooi." + lucide `Award` icon | n/a |
| `TournamentResultEntryForm` (14d wall expired, player caller) | Form disabled + top `<Alert>` with `errors.tournament.entryWindowExpired` + helper text "Vraag je trainer of TD om het resultaat in te voeren." | Sonner toast + form retains values |
| `BulkAttendanceScoreForm` (no participants — should not happen for valid session but guarded) | "Geen spelers ingeschreven voor deze sessie." + back-to-calendar link | Sonner toast + form retains values |
| `BulkAttendanceScoreForm` (14d wall expired) | Form disabled + top `<Alert>` with `errors.training.scoreWindowExpired` | Sonner toast |
| `RankingLineChart` (no entries) | See "International ranking line chart" § above | `<Alert>` with `errors.ranking.fetchFailed` + retry |
| `BelgiumTimelineStrip` (no entries) | See "Belgium timeline strip" § above | `<Alert>` with retry |
| `RankingEntriesTable` (no entries — type filter) | "Geen entries voor dit type." | n/a |
| `MatchResultsTable` (intentionally empty — should never happen on Save attempt; Zod prevents) | n/a — server-side reject with `errors.tournament.atLeastOneMatch` | Inline `<FormMessage>` |

**Tone rule (UI4-D23):** Every empty state names the next action (CTA or instructional sentence). No apologetic copy ("Helaas, geen data..."), no clever copy ("Het is hier wel erg stil..."). Direct + operational.

---

## RBAC-Sensitive UI Behavior

Inherits Phase 3 patterns: server-side RLS + tRPC middleware decide visibility; UI mirrors server decisions and never branches on role beyond safe affordance rules.

### Phase 4 role-affordance matrix

| Caller role | Sees nudge banner (training-score) | Sees nudge banner (player-result) | "Te scoren" widget | Pending-result widget | Tournament create CTA | Tournament participant register | Tournament result entry | Ranking entry | Calendar chip needs-scoring overlay | Calendar chip needs-result overlay |
|---|---|---|---|---|---|---|---|---|---|---|
| TD | when sessions pending across academies | n/a (TD never has player-result pending unless TD is also a player) | yes (cross-trainer per D-68) | n/a | yes | yes | yes (any player, anytime per D-75) | yes (any player) | yes | n/a |
| trainer | when own sessions pending | n/a | yes (own sessions only) | n/a | no | no | yes (player in own academy, anytime backfill per D-73) | no (per D-89 — trainer cannot enter rankings) | yes (own sessions only) | n/a |
| academy_manager | no (read-only on scores) | no | no | no | no | no | no (read only per D-78 visibility) | no | no | n/a |
| player | n/a | when own tournament result pending + within 14d | no | yes | no | no | yes (own + within 14d only per D-71) | yes (own only per D-89) | n/a | yes (on own tournament chip) |
| parent of player | no | no | no | no | no | no | no (read only of own child results per D-78) | no | no | no |
| sparring partner | no | no | no | no | no | no | no | no | no | no |

**Visual rule for read-only callers (academy_manager, parent, sparring partner):**

- Pages render fully; data visible per RLS. No CTAs that would require write permission.
- `TournamentResultEntryForm` accessed via deep link → renders in read-only mode (UI4-D21 pattern).
- `RankingsTab` accessed via deep link → renders charts but `<NewRankingEntryButton>` hidden.
- `BulkAttendanceScoreForm` accessed via deep link → returns 404 (these roles never have any reason to be there).

**Critical RBAC invariants (enforced server-side, mirrored client-side):**
1. Player URL `/players/[playerId]/rankings` where `[playerId] !== self.id` → 403 (URL guard).
2. Trainer URL `/trainings/[eventId]/score` where caller is not session.trainer_id AND not TD → 403.
3. Player URL `/tournaments/[eventId]/result` after 14d wall → form renders read-only with banner.
4. Any caller URL `/dashboard` → renders whatever widgets they're entitled to; never errors on lack of widgets.

---

## Loading & Error States

### Initial-paint loading

- `/dashboard`: page-level `<Skeleton>` for nudge banner area + `<Skeleton>` for each widget card (h-32 each).
- `/trainings/[eventId]/score`: `<Skeleton>` matching the eventual row layout — N rows of `[Skeleton circle | Skeleton text | Skeleton toggle | Skeleton stars | Skeleton textarea]` where N is the participant count from the SSR initial fetch.
- `/tournaments/[eventId]/result`: `<Skeleton>` for outcome section + `<Skeleton>` for table + Save button skeleton.
- `/players/[playerId]/rankings`: `<Skeleton className="h-80 w-full" />` for chart area.

Suspense boundary: max visible loading time 200ms before skeleton appears (Phase 3 convention).

### Mutation loading (Save button states)

- Idle: "Opslaan" with primary fill.
- Loading: button disabled, lucide `Loader2` 16px spinning + "Opslaan...".
- Success: brief 800ms `<Button variant="default">` with `Check` icon + "Opgeslagen" (CSS animation), then nav-to-result-view or stay-on-form per surface.
- Error: button returns to idle; Sonner toast surfaces the error key.

### Network / data errors

| Surface | Error | Handling |
|---|---|---|
| `dashboard.*` query failure | Sonner toast + show partial data if any | `errors.generic` + "Probeer opnieuw" |
| `training.scoreSession` mutation failure | Sonner toast + form retains values | `training.score.saveError` |
| `tournament.enterResult` mutation failure | Sonner toast + form retains values | `tournament.result.saveError` |
| `tournament.enterResult` returns idempotency-key-replay (VALID-08) | Sonner success toast — replay is a success in idempotent terms | `tournament.result.saveSuccess` |
| `ranking.addEntry` failure | Sonner toast + sheet retains values | `ranking.entry.saveError` |
| 403 from any mutation (RLS, role check) | Sonner toast + redirect to prior page | `errors.forbidden` |
| 14d-wall response (403 with `entryWindowExpired` code) | Re-render form in read-only mode + top `<Alert>` | `errors.tournament.entryWindowExpired` / `errors.training.scoreWindowExpired` |

### Optimistic UI

- 5-star input: optimistic local update on click; server reconciles on Save.
- Attendance toggle: optimistic local update on click; server reconciles on Save.
- Range pill selector: optimistic URL update + immediate chart re-render with cached data while server fetches new range.

### Background polling / refresh

- No polling. Nudge counts refresh on (a) page focus (visibilitychange event) + (b) after a successful mutation that could change the count (score saved → re-fetch nudge count; result entered → re-fetch nudge count). Saves on bandwidth and matches Phase 3's "no polling" convention.
- Realtime updates (Supabase Realtime) → out of scope; Phase 6 owns this for messaging.

---

## Responsive Breakpoints

Inherits Phase 3 + adds rule for chart heights.

| Breakpoint | Width | Phase 4 layout change |
|---|---|---|
| (default) | < 640px | Forms: card-stack rows; tables → card stacks; sticky bottom Save button; nudge banner h-12. recharts height=240. BelgiumTimelineStrip mandatory overflow-x-auto. |
| `sm:` | ≥ 640px | Forms still card-stack but card max-width caps at viewport-12px; tables remain stacks. |
| `md:` | ≥ 768px | Forms switch to multi-column where applicable; tables become shadcn `<Table>`. MatchResultsTable horizontal layout. TournamentList horizontal layout. recharts height=320. |
| `lg:` | ≥ 1024px | Full breathing room — RankingsTab uses 2-column layout with chart left, recent-entries-list right. TournamentResultEntryForm gets `max-w-screen-lg`. |
| `2xl:` | ≥ 1536px | No further layout change (content max-width caps at `screen-xl` for Phase 4 — `screen-2xl` reserved for `/calendar`). |

---

## Accessibility Contract

Inherits Phase 2 + Phase 3 patterns. Net-new Phase 4 a11y rules below.

### Star rating accessibility

- `<StarRatingInput>` is `role="radiogroup"` with 5 `role="radio"` children.
- Each star button: `aria-label="{n} sterren"` (or `aria-label={training.score.stars.aria}` with `{n}` interpolation).
- Selected star: `aria-checked="true"`; others `aria-checked="false"`.
- Keyboard: `Tab` moves into the group; `←` `→` step the value (with wraparound at 1↔5); `1`-`5` direct-set; `0` or `Esc` clears; `Enter`/`Space` commits and moves focus to the next field.
- Clear-star affordance: extra `<button aria-label={training.score.stars.clear}>` rendered immediately after the 5-star group, visually a small "×" icon at `text-muted-foreground` — only enabled when value > 0.

### Color is NEVER the only signifier

Inherits Phase 3 rule. Net-new Phase 4 instances:
- **Belgium tier bands:** color is paired with the tier-code label rendered inside the band (`font-mono` `font-medium`). Deuteranopia-safe.
- **Calendar chip needs-action overlay:** color is paired with the lucide `AlertTriangle` icon. Deuteranopia-safe.
- **Nudge banner escalation:** yellow/orange/red colors are paired with the body text containing `{daysLeft}` value + `⚠` glyph on critical level. Color is reinforcement, not primary.
- **Derived won/lost indicator in match results:** green/red dot paired with "Gewonnen" / "Verloren" / "Gelijkspel" / "—" text label. Deuteranopia-safe.

### Contrast

- All `--cls-tier-{tier}-fg` on `--cls-tier-{tier}-bg`: lightness delta ≥ 0.55 oklch units — WCAG AA at 14px / 500 weight.
- All `--state-{flavor}-fg` on `--state-{flavor}-bg`: lightness delta ≥ 0.55.
- 5-star yellow fill on light bg: filled-star icon is rendered with `text-cal-event-evalconv-border` (mid-yellow, `oklch(0.70 0.16 90)`) against `--background` — contrast ≥ 4.5:1.

### Screen reader announcements

- `<NudgeBanner>` is `<div role="status" aria-live="polite">` so SR announces count changes (e.g., when a save clears the last pending item).
- `<NudgeBannerStack>` does NOT have its own aria-live (each child banner manages its own).
- `<StarRatingInput>` `aria-valuetext="{n} sterren"` updates on each change.
- `<RankingLineChart>` accessibility: recharts has limited SR support; pair the chart with an `<aria-live="polite">` summary line below: "Huidige ranking: #{value} ({rankingType}), {entriesCount} entries van {firstDate} tot {lastDate}." Generated server-side.
- `<BelgiumTimelineStrip>` cells: each `<button>` has `aria-label="{year}: {classificationCode} ({tierLabel})"`.

### Focus

- All interactive elements receive focus ring via `--ring` token (shadcn default).
- Match-results table: focus order is `[row 1 round → round 1 opponent → ... → row 1 video → row 1 remove → row 2 round → ...]` (DOM order, no `tabindex` > 0).
- Match-result Add-row button: located after the last row's last field; pressing it inserts a new row and moves focus to its `round` field.

### Reduced motion

- `@media (prefers-reduced-motion: reduce)`:
  - Nudge banner pulse on critical tier: disabled (color is still visible, animation removed).
  - Calendar chip needs-action overlay pulse: disabled (badge still visible).
  - Sheet slide-in animation: disabled, fades only (inherits Phase 3).
  - Save-success "Check" animation: disabled (button instantly returns to idle).

### Keyboard shortcuts (Phase 4 additions to Phase 3 shortcut set)

- On `/trainings/[eventId]/score`: `Ctrl/Cmd + Enter` submits the form (Save) — common form shortcut, deferred from Phase 2 minimal set.
- On `/tournaments/[eventId]/result`: same.
- On `/players/[playerId]/rankings`: `← →` keys when chart is focused = step through time-buckets (recharts built-in keyboard support, enabled via `<LineChart accessibilityLayer={true}>` per recharts 3.8.1).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|---|---|---|
| shadcn official (`https://ui.shadcn.com`) | NEW in Phase 4: `table`, `progress`, (optional v2: `slider`). Reused from Phase 1/2/3: all existing primitives (see `src/components/ui/` for full list — 26 components installed). | not required (official shadcn registry) |
| `recharts` (npm) | n/a — npm package, NOT a shadcn registry. License: MIT (verified [recharts.org/en-US/license](https://recharts.org/en-US/license)). | npm dependency review covers this; no shadcn-registry safety gate applies |
| (third-party shadcn-style registries) | **none declared** | not applicable — Phase 4 declares NO third-party shadcn registries; `view + diff` safety gate not triggered |

**Confirmation:** No third-party registry blocks declared. If a future plan introduces one (e.g., `tablecn`, `originui`, `aceternity`, `magic-ui`), gsd-ui-researcher must re-run with the safety gate.

---

## Out of Scope for Phase 4 (declared so the planner doesn't drift)

- **TD trainer-evaluation dashboard** (per-trainer aggregates, comparison charts, missing-score trend visualizations) → post-Phase-7 or dedicated phase. Phase 4 ships only the data foundation (D-64 14d wall + scored attendance) for this future capability.
- **Detailed set-by-set scores** (`match_results.score_sets jsonb`) → v2 with AI video analysis. Phase 4 stores set tally only (D-81).
- **BYMONTHDAY in RruleEditor** (monthly-on-the-Nth) → v2. Phase 4 ships BYDAY only (D-85).
- **Federation ranking sync** (KBTTB/ETTU/ITTF API integration) → v2. Phase 4 = manual only (DOM-RANK-01).
- **Full Inbox UI** (threading, compose, archive, search, filters) → Phase 6 owns. Phase 4 ships minimal read-only list only (UI4-D09).
- **Phase 7 player view shell** (multi-tab player profile with Basisgegevens / Kalender / Resultaten / Trainingen / Ambities / Rankings / Medische info / Evaluaties / AI-videoanalyses / Dashboard) → Phase 7. Phase 4 lives in standalone routes for now (`/dashboard`, `/players/[id]/rankings`, etc.).
- **Phase 5 ambition comparison** (tournament_results → ambitions delta visualization) → Phase 5. Phase 4 ships only the read-side data.
- **Sparring-partner scoring** (separate from player scoring) → out of scope per D-63. Phase 4 only scores players.
- **Mandatory `edit_reason`** on tournament-result edits → dropped per D-76.
- **Right-click context menu** on calendar chips → deferred (Phase 3 deferral, still deferred).
- **Per-user "verberg gedeclineerde events" toggle, ICS export, per-user timezone, color customization** → all carry-forward deferreds from Phase 3.
- **Realtime updates** for nudge counts → Phase 6 owns Realtime; Phase 4 = focus-event refresh only.
- **AI score recommendations** ("Op basis van vorige sessies stellen we score 7 voor") → v2.
- **Tournament editing scope picker** for recurring tournaments → moot, tournaments don't recur as a domain pattern (one-shot events). Match results within a tournament use their own dates.

---

## Open Questions for Planner / Follow-Up

These are decisions the UI-SPEC has DEFERRED to the planner — they don't affect the design contract but are flagged for execution clarity:

1. **`MultiDayPicker` weekstart locale handling:** Belgium uses Monday week-start; FullCalendar config in Phase 3 confirmed this. Planner verifies `date-fns` locale config + `MultiDayPicker` toggle order matches across `nl-BE` / `en-GB` / `fr-BE` (locale-aware abbreviations: Dutch `Ma Di...`, English `Mon Tue...`, French `Lu Ma...`).
2. **`system_inbox` schema:** UI-SPEC declares "thin table with id / user_id / kind / payload_jsonb / read_at / created_at". Planner finalizes exact column types + RLS policy (user sees own only).
3. **pg_cron job naming + cadence:** UI-SPEC assumes one job per nudge stream firing at 18:00 daily. Planner names jobs (`phase4_daily_trainer_score_nudge`, `phase4_daily_player_tournament_result_nudge`) + handles UTC/CET DST per RESEARCH.md Pitfall 2.
4. **Lookup labels for `belgiumClassification` tier descriptors** (tooltip text): Planner decides whether to add a `lookup.belgiumClassification.tier.{A|B|C|D|E|NC}` keyspace or surface only the code in tooltips. UI-SPEC's default is "code only" — planner may add descriptors.
5. **`TournamentList` pagination strategy:** UI-SPEC says cursor-based with 10/page default. Planner sets exact cursor key + sort (recommend: `tournaments.starts_at DESC, calendar_events.id ASC`).
6. **`RankingEntriesTable` correction UX:** Planner decides whether deletes are hard or soft (audit_log handles forensic recovery per Phase 1 pattern). Recommend: hard delete + audit_log snapshot.
7. **Conflict warning UI on training-session create** (DOM-MED-CONFLICT-01): Phase 3 ships the `<ConflictWarning>` component (shadcn `<Alert variant="default">`). Phase 4 piggy-backs — planner confirms `BulkAttendanceScoreForm` does NOT re-display a conflict warning (the warning fired at event-create time per Phase 3).
8. **DOM-MED-CONFLICT-02 attendance default:** UI-SPEC describes a 4th "absent with medical reason" hidden state pre-selected by server flag. Planner verifies server payload includes the flag per participant + UI mounts the pre-selected state without overwriting trainer's explicit changes.
9. **Sticky-bottom Save button on iOS Safari:** Known issue with sticky positioning + iOS keyboard. Planner tests + adds `env(safe-area-inset-bottom)` if needed.
10. **Empty-state illustrations:** UI-SPEC uses lucide icons (24-32px) as empty-state illustrations. Planner decides whether to upgrade to custom SVG illustrations later (out-of-scope for Phase 4 — icons are sufficient).

---

## Phase 3 Carry-Forward (used as-is — DO NOT REBUILD)

| Phase 3 asset | Phase 4 usage |
|---|---|
| `<LocaleSwitcher>`, `<ReConsentBanner>`, app chrome | Reused unchanged across all Phase 4 routes |
| `<CalendarView>` (FullCalendar) | Phase 4 only extends `event.extendedProps` payload with `needsScoring` / `needsResult` flags + adds chip overlay rendering branch |
| `<EventDetailSheet>` | Phase 4 adds 3 conditional CTAs in action footer (UI4-D11 matrix) |
| `<EventCreateSheet>` / `<EventEditSheet>` | Phase 4 only wires the RruleEditor backend (scope picker behavior) — no new fields |
| `<RruleEditor>` | Phase 4 adds `<MultiDayPicker>` (BYDAY) + `<RruleScopePickerDialog>` (scope picker at save) |
| `<DateTimePicker>` (Phase 3 common) | Reused for: tournament create form datums, match-result datum, ranking-entry date, training session form (Phase 3 inherited) |
| `<FilterCombobox>` (Phase 3 common) | Reused for: `TournamentParticipantsPanel` "Voeg deelnemer toe" player picker, `TournamentFilterBar` filter combos |
| `<ConflictWarning>` (Phase 3 calendar) | Reused for DOM-MED-CONFLICT-01 at event-create time (no Phase 4 changes) |
| Phase 3 form contract (shadcn `<Form>` composition) | Reused across all Phase 4 forms |
| Phase 3 Filter Bar pattern (UI3-D08 styling — inline desktop, bottom-sheet mobile) | Reused for `TournamentFilterBar` + `RankingEntriesTable` filters |
| Phase 3 Sheet pattern (right-side max-w-md / max-w-lg) | Reused for `NewRankingEntrySheet` |
| Phase 3 `--cal-event-{type}-{bg,fg,border}` tokens | Reused for calendar chip rendering; Phase 4 only adds the `--state-needs-action-*` overlay tokens |
| Phase 3 FullCalendar CSS-variable overrides in `globals.css` | Reused unchanged |
| Phase 3 mobile breakpoint conventions | Reused; Phase 4 layers form-specific mobile rules on top |
| Phase 3 accessibility patterns (keyboard, aria-live, focus rings) | Reused |
| Phase 3 sonner toast surface | Reused for all Phase 4 toasts |

---

## Phase 1 / Phase 2 Carry-Forward (used as-is — DO NOT REBUILD)

| Phase 1/2 asset | Phase 4 usage |
|---|---|
| Phase 1 `errors.{forbidden,notFound,generic,validationFailed,csrfRejected}` | Reused for all Phase 4 API failures |
| Phase 1 `common.{save,cancel,delete,edit,loading,submit,yes,no,confirm,back}` | Reused in all Phase 4 surfaces |
| Phase 1 audit_log + `writeAudit()` | Mandatory on every Phase 4 mutation (D-76 — audit_log is the forensic recovery layer) |
| Phase 1 idempotency_keys table + middleware | Wired on `tournament.enterResult` + `ranking.addEntry` per VALID-08 |
| Phase 1 RLS-bound transactions (`withRlsContext`) | Inherited by all Phase 4 tRPC routes |
| Phase 1 `tstz()` schema helper | Mandatory for all new TIMESTAMPTZ columns (GDPR-08) |
| Phase 2 `<LookupSelect>` | Reused for: outcome_level dropdown, tournament_round dropdown, ranking_type dropdown, belgium_classification dropdown, training_type, organisation, tournament_type, age_category |
| Phase 2 form contract (`<FormField>`, `<FormControl>`, `<FormMessage>`) | Reused in all Phase 4 forms |
| Phase 2 `<EmptyState>` (in `common/`) | Reused on `/dashboard` widget empty states |
| Phase 2 `<Avatar>` | Reused in `BulkAttendanceScoreForm` participant rows, `TournamentParticipantsPanel`, `RankingEntriesTable` "ingevoerd door" |
| Phase 2 `lib/i18n-format.ts` (`formatDate`, `formatNumber`) | Reused for all date renders + value formatting in tooltips + axis labels |
| Phase 2 `<Toaster />` in app layout | Reused for all Phase 4 toasts |
| Phase 2 `getAgeCategoryAt(playerId, date)` helper | Reused at server-side mutation for `tournament_results.player_age_category_code` snapshot (DOM-CAT-02) |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PENDING  *(all UI strings declared as i18n keys with nl/en/fr canonical text in §Multilingual Copy; tone consistent with Phase 2/3 — direct, operational, second-person singular for player surfaces, neutral imperative for staff actions; "⚠" used only in critical-level nudge bodies — matches maximalist nudging tone from CONTEXT §specifics; no emoji elsewhere; FullCalendar built-in locale-file boundary inherited)*
- [ ] Dimension 2 Visuals: PENDING  *(component inventory complete with 22 new components + 2 Phase 3 extensions; 6 new Phase 4 routes + 1 extended Phase 3 route; loading + error + empty + read-only + 14d-wall states declared per surface; chip variant extension table specified; EventDetailSheet CTA matrix specified; two ranking widgets explicitly specified — recharts for international with inverted Y + plain CSS strip for Belgium with tier bands; responsive behavior at sm/md/lg/2xl specified per surface)*
- [ ] Dimension 3 Color: PENDING  *(60/30/10 inherits Phase 2 neutral preset; accent reserved-for list short and explicit — 5 items; 6 new Belgium tier tokens with both light and dark values + NC outline rule; 3 new state-overlay tokens (yellow/orange/red) with both light + dark values; three "red-family" tokens distinguished (`--destructive` for delete intent, `--cal-event-medical-*` for medical chips, `--state-nudge-critical-*` for deadline urgency); star-fill color reuses Phase 3 `--cal-event-evalconv-border` to avoid yellow proliferation)*
- [ ] Dimension 4 Typography: PENDING  *(3 sizes + 1 display; Phase 4 declares same 2 weights as Phase 3 — 400 + 500; inherited shadcn 600 on Card/Sheet/AlertDialog/page-H1 documented as design-system inheritance; one declared exception: tier-code label in BelgiumTimelineStrip uses font-mono within the existing 500 weight role — not a new weight; recharts axis labels at 12px — declared exception scoped to chart root only)*
- [ ] Dimension 5 Spacing: PENDING  *(8-pt scale inherited 1:1 from Phase 2/3; declared exceptions all on 4-pt grid: 44×44 star tap targets, 48px tier-band cell height, 80px tier cell min-width, 32px range-pill height, 40px nudge banner height, lg:max-w-screen-lg for tournament result form)*
- [ ] Dimension 6 Registry Safety: PENDING  *(shadcn official only; new primitives: `table`, `progress` (slider optional/v2); no third-party shadcn registries declared; recharts is npm-tracked MIT, not a shadcn registry; safety gate not triggered)*

**Approval:** pending  *(awaiting gsd-ui-checker review)*
