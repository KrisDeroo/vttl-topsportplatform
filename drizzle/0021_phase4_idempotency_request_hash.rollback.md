# Rollback: 0021_phase4_idempotency_request_hash.sql

**Risk:** LOW. Additive DDL; reverting drops the `request_hash` column. Any rows written with the column populated lose the hash; cache-HIT lookups in the 24h post-rollback window would skip the hash check (legacy-null path). No data loss for the cached `response_body` itself.

**Procedure:**

Connect via `DIRECT_DATABASE_URL` and run:

```sql
BEGIN;
ALTER TABLE "idempotency_keys" DROP COLUMN "request_hash";
COMMIT;
```

**Verification:**

- `\d idempotency_keys` in psql shows no `request_hash` column.
- `pnpm test tests/integration/idempotency-input-binding.test.ts --run` — the test asserting CONFLICT on input mismatch will FAIL (expected post-rollback behaviour: cache HIT replays without hash check).
- `pnpm typecheck` will fail because `src/server/db/schema/idempotency.ts` still declares the `requestHash` field. Revert the schema barrel edit alongside the SQL rollback OR mark this rollback as "code-coupled" — both must roll back together.

**Reference:**

- `.planning/phases/04-kerndomein/04-VERIFICATION.md` §gaps[1]
- `.planning/phases/04-kerndomein/04-REVIEW.md` §CR-02
