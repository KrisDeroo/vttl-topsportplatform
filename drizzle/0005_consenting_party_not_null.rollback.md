# Rollback — 0005_consenting_party_not_null

Reverts the NOT NULL constraint on
`consent_records.consenting_party_user_id`.

## When to roll back

Roll back ONLY if a downstream code path inserts a row without a
consenting party (which the CR-02 fix in
`src/server/trpc/routers/consent.ts` should make impossible — every
write path either passes the caller's user_id or is rejected). The
expected failure mode is a Postgres NOT NULL violation surfacing in
app logs.

## Rollback SQL

```sql
ALTER TABLE consent_records
  ALTER COLUMN consenting_party_user_id DROP NOT NULL;
```

The backfill `UPDATE consent_records SET consenting_party_user_id =
user_id WHERE consenting_party_user_id IS NULL` cannot be reversed
without an external record of the original NULL rows. None such was
preserved here.

## Why this is a separate file (MIG-01)

Drizzle's migration runner does not provide rollback SQL automatically.
Each migration in this directory has a `.rollback.md` companion that
documents the inverse so an SRE can apply it manually with `psql` if a
production rollback is required.
