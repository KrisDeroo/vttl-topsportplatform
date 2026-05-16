# Rollback — 0017_phase4_lookup_seeds

**Risk:** LOW. Seed data only; the INSERTs are idempotent and the only structural change is the `DEFAULT` drop on `ranking_type.value_shape`. The DELETEs are safe because Phase 4 application code is the only consumer (FK from `tournament_results.outcome_level_code` etc. — those FKs use `ON DELETE restrict`, so the DELETE will fail if any operational rows reference them; remove those operational rows first or use the 0014/0015/0016 rollbacks before this one).

**Procedure:**

1. If operational rows in `tournament_results`, `match_results`, or `ranking_entries` reference these lookup codes, roll those tables back first (via 0014/0015/0016 rollbacks).
2. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;

   -- 1. Re-add the DEFAULT 'numeric' on ranking_type.value_shape so
   --    the expand-contract is fully reversed.
   ALTER TABLE "ranking_type" ALTER COLUMN "value_shape" SET DEFAULT 'numeric';

   -- 2. Delete the 67 belgium_classification rows.
   DELETE FROM "belgium_classification" WHERE "code" IN (
     'A1','A2','A3','A4','A5','A6','A7','A8','A9','A10',
     'A11','A12','A13','A14','A15','A16','A17','A18','A19','A20',
     'A21','A22','A23','A24','A25','A26','A27','A28','A29','A30',
     'A31','A32','A33','A34','A35','A36','A37','A38','A39','A40',
     'A41','A42','A43','A44','A45','A46','A47','A48','A49','A50',
     'B0','B2','B4','B6','C0','C2','C4','C6','D0','D2','D4','D6',
     'E0','E2','E4','E6','NC'
   );

   -- 3. Delete the 10 tournament_round rows.
   DELETE FROM "tournament_round" WHERE "code" IN (
     'round_final','round_semi','round_quarter','round_eighth',
     'round_sixteenth','round_thirty_second','round_sixty_fourth',
     'round_one_twenty_eighth','round_group_stage','round_other'
   );

   -- 4. Delete the 7 tournament_type rows.
   DELETE FROM "tournament_type" WHERE "code" IN (
     'tournament_wtt','tournament_wtt_star','tournament_ettu','tournament_ejk',
     'tournament_wk','tournament_international','tournament_belgium'
   );

   -- 5. Delete the 6 organisation rows.
   DELETE FROM "organisation" WHERE "code" IN (
     'org_private','org_kbttb','org_topsportschool','org_academie',
     'org_provinciaal','org_club'
   );

   -- 6. Delete the 4 training_type rows.
   DELETE FROM "training_type" WHERE "code" IN (
     'training_type_group','training_type_individual',
     'training_type_physical','training_type_mental'
   );

   -- 7. Delete the 5 ranking_type rows.
   DELETE FROM "ranking_type" WHERE "code" IN (
     'ranking_senior_world','ranking_youth_world',
     'ranking_senior_european','ranking_youth_european',
     'ranking_belgium'
   );

   -- 8. Delete the 9 outcome_level rows.
   DELETE FROM "outcome_level" WHERE "code" IN (
     'outcome_winner','outcome_finalist','outcome_last_4','outcome_last_8',
     'outcome_last_16','outcome_last_32','outcome_last_64','outcome_last_128',
     'outcome_group_stage'
   );

   COMMIT;
   ```

**Verification:**

- `SELECT COUNT(*) FROM "outcome_level";` returns 0 (pre-seed count).
- `SELECT COUNT(*) FROM "ranking_type";` returns 0.
- `SELECT COUNT(*) FROM "training_type";` returns 0.
- `SELECT COUNT(*) FROM "organisation";` returns 0.
- `SELECT COUNT(*) FROM "tournament_type";` returns 0.
- `SELECT COUNT(*) FROM "tournament_round";` returns 0.
- `SELECT COUNT(*) FROM "belgium_classification";` returns 0.
- `SELECT column_default FROM information_schema.columns WHERE table_name='ranking_type' AND column_name='value_shape';` returns `'numeric'::text` (DEFAULT restored).
