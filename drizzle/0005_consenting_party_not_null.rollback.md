# Rollback — 0005_consenting_party_not_null

**Risk:** Reverts the NOT NULL constraint on `consent_records.consenting_party_user_id`. Reopens the GDPR Art. 7 evidentiary gap that WR-11 closed: rows with a missing consenting-party identity become possible again, weakening the legal proof chain. Roll back only as an emergency measure when a downstream insert path is rejecting writes that should succeed.

**Procedure:** Apply the rollback SQL below inside a single transaction. Pair with an immediate follow-up ticket to identify the offending insert path and re-enable the constraint after the fix lands. Note the backfill `UPDATE consent_records SET consenting_party_user_id = user_id WHERE consenting_party_user_id IS NULL` is irreversible — original NULL rows are not preserved.

**Verification:** After rollback, confirm:
1. `\d+ consent_records` shows `consenting_party_user_id` as nullable.
2. The previously-rejected insert path now writes successfully — verify in application logs and that the GDPR consent flow proceeds end-to-end.
3. A follow-up incident ticket exists in `docs/security-incidents.md` (or equivalent) committing to re-add the NOT NULL constraint within an agreed window. Without that commitment the GDPR Art. 7 contract remains weakened indefinitely.

## When to roll back

Roll back ONLY if a downstream code path inserts a row without a consenting party (which the CR-02 fix in `src/server/trpc/routers/consent.ts` should make impossible — every write path either passes the caller's user_id or is rejected). The expected failure mode is a Postgres NOT NULL violation surfacing in app logs.

## Rollback SQL

```sql
BEGIN;

ALTER TABLE consent_records
  ALTER COLUMN consenting_party_user_id DROP NOT NULL;

COMMIT;
```

The backfill `UPDATE consent_records SET consenting_party_user_id = user_id WHERE consenting_party_user_id IS NULL` cannot be reversed without an external record of the original NULL rows. None such was preserved here.

## Why this is a separate file (MIG-01 / MIG-05)

Drizzle's migration runner does not provide rollback SQL automatically. Each migration in this directory has a `.rollback.md` companion that documents the inverse so an SRE can apply it manually with `psql` if a production rollback is required.
