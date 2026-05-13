# Rollback — 0008_phase2_lookup_seed

**Risk:** Low. Removing seed rows leaves the lookup tables empty (except for Phase 1's pre-seeded `topsportschool` and `academy_antwerpen`). After rollback, ANY `players` row with `academy_code` or `age_category` referencing a removed code would have its FK constraint violated — the migration must be rolled back BEFORE 0006 (the schema migration) OR the operator must accept that Phase 2 player data is non-existent at rollback time (which is the case during the Phase 2 build window).

**Procedure:**
1. Confirm `SELECT count(*) FROM players` returns 0 (rollback during build/test) OR confirm no `players.academy_code` value references one of the codes we are about to remove.
2. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;

   -- Reverse the trainer_diploma seed.
   DELETE FROM "trainer_diploma" WHERE "code" IN (
     'diploma_none', 'diploma_a', 'diploma_b',
     'diploma_a_in_training', 'diploma_b_in_training'
   );

   -- Reverse the age_categories seed.
   DELETE FROM "age_categories" WHERE "code" IN (
     'age_pre_minor', 'age_minor', 'age_cadet',
     'age_junior', 'age_senior', 'age_veteran', 'age_unknown'
   );

   -- Reverse the academy seed (preserve Phase 1 rows!).
   DELETE FROM "academy" WHERE "code" IN (
     'academy_brussel', 'academy_oost_vlaanderen',
     'academy_west_vlaanderen', 'academy_limburg'
   );
   -- DO NOT delete 'topsportschool' or 'academy_antwerpen' — those are Phase 1 seed.

   COMMIT;
   ```

3. Update `drizzle/meta/_journal.json` to remove the `idx 8` entry; delete `drizzle/meta/0008_snapshot.json`.
4. `git revert` the commit.

**Verification:**
1. `psql "$DIRECT_DATABASE_URL" -c "SELECT code FROM academy ORDER BY sort_order"` returns only `topsportschool` and `academy_antwerpen` (Phase 1 baseline).
2. `psql "$DIRECT_DATABASE_URL" -c "SELECT count(*) FROM age_categories"` returns 0.
3. `psql "$DIRECT_DATABASE_URL" -c "SELECT count(*) FROM trainer_diploma"` returns 0.
4. Any `players` row still in the DB has had its FK to age_categories nullified beforehand (otherwise the DELETE would fail with FK violation — RESTRICT on the FK).

## When to roll back

Use this rollback if the seed codes are wrong AND no production data references them. Once Phase 4 lands and `players.academy_code` rows reference the new codes, full rollback requires data migration (DELETE players first, which is a GDPR-implicating action).

## Why this is a separate file (MIG-01 / MIG-05)

Drizzle's migration runner does not provide rollback SQL automatically. Each migration in `drizzle/` has a `.rollback.md` companion that documents the inverse so an SRE can apply it manually with `psql` if a production rollback is required. The CI guard `.github/workflows/protect-migrations.yml` fails the PR if the companion is missing.
