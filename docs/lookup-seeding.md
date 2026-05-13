# Lookup-Tabel Seeding Discipline

Lookup tables (`academy`, `status`, `ranking_type`, `tournament_type`,
`training_type`, `organisation`, `outcome_level`, `age_categories`,
`trainer_diploma`) hold reference data, not user data. The schema convention
is documented in `src/server/db/schema/lookups.ts`:

- `code text PRIMARY KEY` — language-neutral snake_case identifier
- `sort_order integer NOT NULL` — UI render order
- `active boolean NOT NULL DEFAULT true` — soft-retirement flag

Display labels live in `messages/{nl,en,fr}.json` under
`lookups.<table>.<code>` (D-44). Proper nouns (academies, clubs) follow the
I18N-06 / D-45 rule: canonical names stored once on the row, rendered
identically across locales.

## Migration discipline

1. **Always use `ON CONFLICT ("code") DO NOTHING`** so seed migrations can
   be re-run safely against partially-seeded DBs (dev resets, staging
   refreshes, production after a hot-fix).
2. **Never edit a committed seed migration** (MIG-01). If a code's
   `canonical_name` or `sort_order` is wrong post-commit, add a NEW
   migration with an UPDATE statement.
3. **Never DELETE rows from a seed migration** unless the rollback path is
   to restore them (lookups underpin FK constraints on real data).
4. **Document placeholder canonical names** with `[ASSUMED]` until the
   business owner confirms (current open items: 4 academies, age-category
   birth-year boundaries — RESEARCH A1 + A2).

## Current placeholders (TD action required)

| Table | Code | Placeholder | Source of truth | Status |
|-------|------|-------------|-----------------|--------|
| academy | academy_brussel | Academy Brussel | TD-confirmed name | TODO (A1) |
| academy | academy_oost_vlaanderen | Academy Oost-Vlaanderen | TD-confirmed name | TODO (A1) |
| academy | academy_west_vlaanderen | Academy West-Vlaanderen | TD-confirmed name | TODO (A1) |
| academy | academy_limburg | Academy Limburg | TD-confirmed name | TODO (A1) |
| age_categories | age_pre_minor | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
| age_categories | age_minor | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
| age_categories | age_cadet | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
| age_categories | age_junior | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
| age_categories | age_senior | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
| age_categories | age_veteran | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |

Until A2 is resolved, `deriveAgeCategory()` in `src/lib/players.ts` returns
`'age_unknown'` for every player — the seed includes `age_unknown` as a
sentinel row so the FK constraint never blocks a `player.create` mutation.

## Confirmation procedure (when TD supplies the data)

1. Create a new migration `00NN_phase2_age_category_boundaries.sql` with the
   confirmed `UPDATE age_categories SET born_after_or_equal = ?, born_before_or_equal = ? WHERE code = ?` statements.
2. Run the migration through the standard runbook (Phase 1 `docs/migration-runbook.md`).
3. Re-run `tests/unit/players-derive-age-category.test.ts` with the
   confirmed boundaries; expect green.
4. Communicate to the i18n catalog owner that `lookups.ageCategory.*` keys
   can now use confirmed labels (or stay verbatim — display labels are
   independent of boundary correctness).

## When NOT to use a seed migration

- **User data** (players, trainers, evaluations). Use the application-level
  mutation surface (`admin.user.create` etc.).
- **Test fixtures**. Use `tests/helpers/seed.ts` from Phase 1 — those are
  throwaway data, not version-controlled production seed.
