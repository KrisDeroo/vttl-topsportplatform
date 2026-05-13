# File Upload Pipeline (Phase 2)

Single source of truth for how a file gets from the browser to a clean, signed-URL-retrievable state. Audience: developers debugging upload bugs + operators tuning the ClamAV sidecar.

> Phase 2 ships exactly one user-visible upload surface: **player profile photo** (PLAYER-05, FILE-01..04). FILE-02 (medical bucket) and FILE-05 (evaluation attachments) are explicitly **Phase 5 deliverables** — the buckets are bootstrapped, the magic-bytes registry is extensible, but no router or UI touches them in Phase 2. Do not regress that scope by adding either bucket to Phase 2 code.

## Region

The Supabase project is in **`eu-west-1` (Dublin)** — pooler hostname `aws-0-eu-west-1.pooler.supabase.com`, confirmed by the `02-14-MIGRATION-LOG.md` staging push. Older draft material (and the original PROJECT.md) referenced `eu-central-1` (Frankfurt); this was corrected in the staging push. Both are EU/GDPR jurisdictions — there is no functional impact, but operator-facing material must name the correct region.

## Lifecycle (happy path)

```
Browser                      Next.js Server               Postgres        Supabase Storage     BullMQ (Redis)      ClamAV sidecar
───────                      ──────────────                ────────        ────────────────     ──────────────      ──────────────
PhotoUpload widget
 ─ file picked
 ─ base64 encode
 ─ trpc.file.upload  ───────►
                               1. protectedProcedure
                               2. zod parse (.strict())
                               3. size check (2 MB)
                               4. fileTypeFromBuffer(buf)
                               5. uploaded_files INSERT
                                  scan_status='pending'  ─►
                               6. supabase.storage
                                  .upload(storageKey,buf) ─────────────────────────────►
                               7. malwareScanQueue.add  ────────────────────►
                               8. writeAudit('file.upload')                ─►
 ◄────── {fileId, 'pending'}
 ─ start polling every 2s
 ─ trpc.file.getScanStatus
                                                                              Worker picks up job ───►
                                                                                                      1. storage.download
                                                                                                      2. clamscan.scanStream
                                                                                                      3. UPDATE uploaded_files
                                                                                                         scan_status='clean'|'infected'
 ◄────── 'clean'
 ─ stop polling
 ─ form persists fileId
```

**Reference files:**

- `src/server/trpc/routers/file.ts` — orchestration (upload + getSignedUrl + delete)
- `src/server/storage/client.ts` — service-role Supabase Storage client (server-only)
- `src/server/storage/magic-bytes.ts` — MIME whitelist registry + `fileTypeFromBuffer` wrapper
- `src/server/storage/profile-photo.ts` — UUID storage key minting (`profiles/{user_id}/{uuid}.{ext}`)
- `src/server/storage/signed-url.ts` — 1h TTL + `Content-Disposition: attachment`
- `src/server/workers/jobs/malware-scan.ts` — clamd TCP scan worker (BullMQ consumer)

## Magic-bytes registry (MIME whitelist per bucket)

Edit `src/server/storage/magic-bytes.ts` `MIME_BY_BUCKET`. Phase 2:

| Bucket     | Allowed MIME              | Allowed via magic-bytes              |
| ---------- | ------------------------- | ------------------------------------ |
| `profiles` | `image/jpeg`, `image/png` | JPEG SOI + EXIF, PNG signature       |

**Future buckets (DO NOT enable in Phase 2):**

| Bucket        | Phase | Allowed MIME (planned)                | Status      |
| ------------- | ----- | ------------------------------------- | ----------- |
| `medical`     | 5     | `application/pdf`, `image/jpeg`, `image/png` | FILE-02 — bucket exists from Phase 1, no Phase 2 writer  |
| `evaluations` | 5     | `application/pdf`, `image/jpeg`, `image/png` | FILE-05 — Phase 5 evaluation attachments                  |

The registry is a single object keyed by bucket id; Phase 5 will add the two missing keys and ship the corresponding routers. The whitelist is consumed by `assertMimeAllowed(bucket, buf)` which (a) sniffs magic bytes via the `file-type` npm package and (b) cross-references against the registry. The client's declared `Content-Type` is informational only — magic-bytes is the gate (D-23, VALID-02).

## Request body size limit (App Router) — BLOCKER-04

**Important:** the `export const config = { api: { bodyParser: { sizeLimit: '5mb' } } }` convention is **Pages Router**. The VTTL platform runs **App Router** (`src/app/api/trpc/[trpc]/route.ts` uses `fetchRequestHandler`), where that export has **no effect**. Don't add it — it would give operators a false sense of extra protection without actually capping anything.

Real defenses are layered. The body-size cap is the outer ring; the validation/scan flow is the inner rings.

| Layer            | Enforcement                                                                  | Where                                                  |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| Zod input cap    | `contentBase64.max(3 * 1024 * 1024)` (~2.25 MB raw) — fails fast with `BAD_REQUEST` | `src/server/trpc/schemas/file.ts` (Plan 02-07)         |
| Reverse-proxy cap | Caddy `request_body { max_size 5MB }` — drops request before it reaches Node | Coolify proxy config (see `docs/deployment.md` ##Proxy) |
| Runtime cap      | Next.js App Router defaults the Node runtime body to whatever the platform allows — typically ~10 MB on Coolify | implicit |
| Rate limit       | SEC-08 — 10 uploads/min/user via `rateLimit` middleware                      | Phase 1                                                |

The Zod cap (3 MB base64 ≈ 2.25 MB raw) is the **declared** limit — the Caddy 5 MB cap is set higher than the Zod cap so legitimate requests within the declared limit get a JSON `BAD_REQUEST` error (with the i18n-key `errors.file.tooLarge`) instead of an opaque proxy-level 413. The reverse-proxy cap is purely a DoS shield: a malicious client that posts 100 MB never reaches Node.

Phase 5 medical PDFs (5 MB raw → ~6.66 MB base64) will need both the Zod cap and the Caddy cap raised; revisit when Phase 5 lands. Update both in the same PR; updating only one is a latent bug.

### Coolify Caddy proxy snippet

```caddyfile
# Per-app section in Coolify's proxy config
request_body {
  max_size 5MB
}
```

Without this, a malicious client can post a 100 MB body and Node will buffer it before Zod validates — wasted CPU + RAM. The Caddy gate rejects with HTTP 413 before any request handler runs.

## Transport choice: base64-in-JSON vs multipart

Phase 2 uses **base64-encoded bytes inside the tRPC JSON envelope** (`contentBase64: z.string()`). Rationale (RESEARCH §Open Question 2):

- Keeps the tRPC layer homogeneous — no separate `app/api/upload/route.ts` HTTP handler with its own auth + rate-limit + magic-bytes plumbing.
- 33% inflation (base64 overhead) is acceptable for 2 MB profile photos; the wire cost is 2.66 MB max.
- Validation, rate-limit, and audit-trail wrapping are inherited automatically from `protectedProcedure`.

When Phase 5 introduces 5 MB medical PDFs, base64 grows to 6.66 MB on the wire. That is still within the Caddy 5 MB cap after we raise it to (probably) 10 MB; if profiling shows the inflation hurts, the Phase 5 reviewer can swap that one router to multipart over a dedicated `route.ts` handler — but the migration scope is one router, not the whole upload stack.

## DB row vs storage object ordering

The upload mutation inserts the `uploaded_files` row **first**, then uploads to Supabase Storage (RESEARCH §Open Question 3). This deliberately privileges DB-orphan rows (queryable, recoverable via sweep) over storage-orphan objects (require a bucket scan to discover). See `## Orphan cleanup` below for the sweep query.

## ClamAV daemon (D-22)

Deployment: Coolify sidecar service running `clamav/clamav:stable`. The worker (`pnpm worker`) connects via TCP to `${CLAMAV_HOST}:${CLAMAV_PORT}` (defaults `clamav:3310`). The clamd wire protocol is **INSTREAM**, not HTTP — the worker uses the `clamscan` npm package's TCP transport, not HTTP requests.

### Health check (EICAR)

EICAR is the industry-standard non-malicious AV test string. If clamd signatures are fresh and reachable, scanning it returns `isInfected=true`.

```bash
# From the worker container (clamdscan CLI is bundled in clamav/clamav:stable):
docker exec <clamav_container> sh -c '
  printf "X5O!P%%@AP[4\\PZX54(P^)7CC)7}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H+H*" \
    | clamdscan --stream -
'
# Expect: stream: Win.Test.EICAR_HDB-1 FOUND
```

The literal EICAR string (do NOT copy from web pages that may have munged the backslashes):

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

Quick smoke test via the integration test (Plan 02-15):

```bash
pnpm test tests/integration/malware-scan
```

This exercises the full path: BullMQ enqueue → worker → `clamscan.scanStream` → row update. If your ClamAV sidecar is healthy and signatures are loaded, the test asserts `scan_status='infected'` for the EICAR payload.

### Signature freshness (Pitfall 3)

`clamav/clamav:stable` bundles a `freshclam` daemon that refreshes signatures every 24 h (configurable). Verify in Coolify logs:

```bash
# Inside the clamav sidecar container:
docker exec <clamav_container> tail -f /var/log/clamav/freshclam.log
# Expect a daily "ClamAV update process started" entry.
```

If signatures are stale, manually trigger:

```bash
docker exec <clamav_container> freshclam
```

After a manual refresh, clamd reloads signatures automatically. Verify with another EICAR scan — `Win.Test.EICAR_HDB-1` should be found.

### Failure modes

| Symptom                                   | Likely cause                                | Fix                                                                              |
| ----------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `scan_status='pending'` for >30 s         | clamd unreachable; check Coolify sidecar logs | restart sidecar, verify `CLAMAV_HOST` resolves                                  |
| EICAR scan returns `isInfected: false`    | stale or missing signatures                 | run `freshclam` inside the sidecar                                              |
| `ECONNREFUSED` in worker logs             | wrong `CLAMAV_HOST` or `CLAMAV_PORT`        | check Coolify Secrets for both env vars                                          |
| Stuck `pending` rows accumulating         | BullMQ retries exhausted                    | triage failed jobs; sweep via Phase 8 cron (see `## Phase 8 cron sweeps` below) |
| Worker process killed by OOM              | ClamAV + Node + signatures > container RAM  | size up host or move ClamAV to a separate box (see `docs/deployment.md`)         |

## Signed URL TTL (D-24)

Profile photos: **1 hour** TTL, `Content-Disposition: attachment` header on the response so the browser downloads rather than renders the binary inline (defense in depth against `<script>` smuggled inside an SVG — though SVG is not in the MIME whitelist, the header is still set as a future-proofing convention).

RBAC check runs BEFORE URL minting (D-24 — never rely on TTL alone, per RISK-FILE-SCOPE). The `file.getSignedUrl(fileId)` procedure resolves the player owner, applies the `players_visible_to(caller_id, caller_role)` predicate, and **only then** asks Supabase for a signed URL. A signed URL minted for a player the caller cannot see is a defect — the integration test in `tests/integration/file-signed-url.test.ts` asserts that path.

Client guidance: refresh signed URL at the 50-minute mark (5-minute safety margin). TanStack Query handles this declaratively:

```ts
useQuery({
  queryKey: ['file', fileId, 'url'],
  queryFn: () => trpc.file.getSignedUrl.query({ fileId }),
  staleTime: 50 * 60 * 1000,  // refetch after 50 min
});
```

Pitfall 8 mitigation: this avoids the "browser cached a long-expired URL" bug. Without `staleTime`, TanStack Query's defaults could let a 1h-old URL live in the client cache indefinitely.

## Audit trail (GDPR-04)

Every file mutation writes an `audit_log` row:

- `file.upload` — at successful upload + queue enqueue
- `file.signed_url_issued` — at every URL mint (Pitfall — even read access is auditable for medical-adjacent contexts; Phase 2 sets the precedent for Phase 5)
- `file.delete` — at TD-driven soft-delete (sets `superseded_at = now()` on the row)
- `file.delete_storage_failed` — when TD requested `removeStorage=true` and the Supabase API call failed. The DB row is already soft-deleted; this audit entry signals operator follow-up (manual storage cleanup or sweep)

PII (`original_filename`, raw bytes, signed URL strings) are intentionally **NOT** in `audit_log` per `src/lib/log-redact-paths.ts` convention. The audit row carries `actor_user_id`, `action`, `resource_type='uploaded_files'`, `resource_id=<file_id>`, and `new_values` JSONB shaped as `{bucket, storage_key, scan_status}` — enough for forensic reconstruction without leaking content.

## Service-role key — rotation procedure (WARNING-15)

The Supabase **service-role** key bypasses Storage RLS. It is the only key the server uses; the client never sees it. Treat it like a database password.

### Where it lives

- **Production:** Coolify Secrets, scoped to both the `web` and `worker` services.
- **Dev:** `.env.local` (gitignored, never committed).
- **Source of truth:** Supabase Dashboard → Project Settings → API → service_role (eye icon to reveal).

### Rotation procedure

1. Generate a new key in the Supabase Dashboard (API → service_role → Rotate).
2. Update Coolify Secret `SUPABASE_SERVICE_ROLE_KEY` for both `web` and `worker` services.
3. Redeploy both services (Coolify will rolling-deploy).
4. Confirm post-deploy with the smoke check below.
5. Note the 5-second window: in-flight signed URLs minted with the old key remain valid until their TTL expires — they were signed against the storage JWT secret, which Supabase rotates atomically with the service-role key. If the rotation revoked the storage JWT secret in parallel, all old signed URLs are immediately invalid; if not, they survive until 1 h TTL.

### `DIRECT_DATABASE_URL` revocation (post-migration)

After the Phase 2 migration push (02-14) completes, `DIRECT_DATABASE_URL` carries the Supabase **owner** credential and should NOT live on `web` or `worker` runtime services. Migration runs are gated by a separate Coolify job (or local operator `npx drizzle-kit migrate` against a tmpfile env). The runbook (also in `docs/deployment.md`):

```
1. coolify env unset DIRECT_DATABASE_URL --app vttl-web
2. coolify env unset DIRECT_DATABASE_URL --app vttl-worker
3. Confirm via   coolify env list --app vttl-web | grep -i direct   returns nothing
4. Restart both apps to pick up the smaller env set
```

`DATABASE_URL` (transaction pooler, port 6543, bound to `app_user` — RLS-enabled) stays. That is the runtime path; only the migration runner needs the bypass-pooler owner connection.

### Post-rotation smoke check

After rotating the service-role key, confirm the `mark_scan_result` function path is still healthy (the staging push verified `prosecdef=true` and `app_user` has EXECUTE; rotating the key doesn't affect grants, but the smoke confirms the worker can still reach the DB):

```bash
psql "$DATABASE_URL" <<'SQL'
-- Expect: 1 row, prosecdef=t (SECURITY DEFINER)
SELECT proname, prosecdef
FROM pg_proc
WHERE proname = 'mark_scan_result';

-- Expect: t (app_user can EXECUTE)
SELECT has_function_privilege('app_user', 'mark_scan_result(uuid,text,text)', 'EXECUTE');
SQL
```

If either check fails, the worker will start logging `permission denied for function mark_scan_result` and `scan_status` rows will accumulate at `pending`. Recovery: re-run `drizzle/0007_phase2_rls_policies.sql` (idempotent — the GRANT is `IF NOT EXISTS`-safe via Drizzle's transaction).

## Orphan cleanup (Phase 8 OPS routine)

Two orphan scenarios are possible despite the DB-first ordering:

- **DB row, no storage object** — upload mutation failed between `INSERT` and `storage.upload`. The tRPC mutation surfaces an `INTERNAL_SERVER_ERROR` and writes a `file.upload_storage_failed` audit row (WARNING-08 mitigation). Detection: `scan_status='pending' AND uploaded_at < now() - INTERVAL '5 minutes'` AND no matching `storage.objects` row by `(bucket, name)`.
- **Storage object, no DB row** — should never happen (DB INSERT precedes storage upload), but a worst-case cron scans `storage.objects WHERE bucket_id='profiles'` and `LEFT JOIN uploaded_files ON storage_key = name`, flagging unmatched objects.

Both sweeps are documented under `## Phase 8 cron sweeps` below. Phase 2 does **not** implement them; the file pipeline's create/update paths are tight enough that ad-hoc sweeps during early operation are unnecessary.

## Phase 8 cron sweeps (deferred but planned now)

The following sweeps live in `pg_cron` (Supabase Pro enables `pg_cron` in the `extensions` schema; jobs are declared as Drizzle migration files in Phase 8 per MIG-01 discipline). They are listed here so operators know what's coming and so Phase 2 doesn't accidentally implement them ad-hoc.

### 1. `recompute_player_minor_flags()` — BLOCKER-10

`players.is_minor` is a denormalised boolean computed at create/update time from `dateOfBirth` (`isMinorAt(dob, now)`). It does NOT auto-flip on the player's 16th birthday — `player.updateSelf` doesn't touch DOB, and no other Phase 2 code path runs daily. A 15-year-old created last year stays `is_minor=true` forever unless a TD manually edits them.

**Risk:** downstream consumers (parent permissions, consent flow, future Phase 5 medical visibility) make wrong decisions about freshly-16 players.

**Phase 8 sweep:**

```sql
-- Runs nightly at 02:00 Europe/Brussels (server time UTC+1 / UTC+2 with DST).
-- Recomputes is_minor for every player whose DOB makes them ≥ 16 today.
-- Belgian Patient Rights Act minor consent threshold is 16; align is_minor
-- with that even though the JS helper `isMinorAt` uses the same constant.
CREATE OR REPLACE FUNCTION recompute_player_minor_flags()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE flipped INTEGER;
BEGIN
  UPDATE players p
  SET is_minor = (
    EXTRACT(YEAR FROM AGE(now(), p.date_of_birth::date))::int < 16
  ),
  updated_at = now()
  WHERE p.is_minor <> (
    EXTRACT(YEAR FROM AGE(now(), p.date_of_birth::date))::int < 16
  );
  GET DIAGNOSTICS flipped = ROW_COUNT;
  INSERT INTO audit_log (action, resource_type, new_values, actor_user_id)
  VALUES (
    'cron.recompute_minor_flags',
    'players',
    jsonb_build_object('flipped_count', flipped),
    NULL  -- system actor
  );
  RETURN flipped;
END $$;

SELECT cron.schedule(
  'recompute-minor-flags',
  '0 2 * * *',  -- 02:00 daily (server timezone Europe/Brussels)
  $$SELECT recompute_player_minor_flags();$$
);
```

**Phase 2 stance:** documented but NOT implemented. Phase 2's `players.is_minor` is correct at create/update time; the once-per-year drift (a player crossing 16) is acceptable for v1 because:

- (a) emergency-contact data is harmless on adult records — the CHECK constraint `(NOT is_minor) OR (emergency_contact_name IS NOT NULL AND emergency_contact_phone IS NOT NULL)` allows but does not require NULL emergency contact for adults;
- (b) Phase 5 medical visibility uses age-derivation via `isMinorAt(dob, now())` at call time, not the stale flag.

### 2. Orphan upload sweep (WARNING-08)

```sql
-- Hard delete pending rows older than 5 min with no matching storage object.
-- Run at 03:00 daily, after the minor-flags sweep.
DELETE FROM uploaded_files uf
WHERE uf.scan_status = 'pending'
  AND uf.uploaded_at < now() - INTERVAL '5 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = uf.bucket AND o.name = uf.storage_key
  );
```

### 3. Stuck-scan sweep

Same shape as the orphan sweep but for rows that DO have a storage object — these mean clamd was unreachable and BullMQ exhausted retries. Operator action: triage failed jobs in BullMQ (`pnpm dlq:list`), decide whether to manually re-enqueue or mark the row as `scan_status='error'`. Sweep query is informational only — no automatic deletion, because the storage object may still be a legitimately-uploaded file the operator wants to recover.

```sql
-- Reporting only — does NOT auto-modify rows.
SELECT id, bucket, storage_key, uploaded_at, attempts
FROM uploaded_files
WHERE scan_status = 'pending'
  AND uploaded_at < now() - INTERVAL '30 minutes'
ORDER BY uploaded_at;
```

## Why we chose THIS architecture

- **Async scan via BullMQ (D-21):** ClamAV scans take 1–3 s — synchronous would hit tRPC timeouts under load. Async = upload mutation returns in <200 ms.
- **ClamAV self-hosted (D-22):** GDPR data residency. VirusTotal uploads files to its cloud → unacceptable for profile photos (personal data under GDPR Art. 4).
- **Service-role server-side upload only:** client never talks to Supabase Storage directly; magic-bytes is the gate. Direct browser uploads would bypass server validation. The service-role key NEVER reaches the browser bundle — `import 'server-only'` directive on `src/server/storage/client.ts` is the compiler-enforced barrier (Pitfall 4).
- **base64-in-JSON transport (RESEARCH §Open Q 2):** keeps the tRPC layer homogeneous; 33% inflation is acceptable for 2 MB files. Phase 5 may revisit for 5 MB medical PDFs.
- **DB row FIRST, then storage (RESEARCH §Open Q 3):** orphan DB rows are queryable and recoverable; orphan storage objects require a bucket scan.

## v1 transactional email — disabled by design

Phase 2 does **not** send any account-activation or upload-related emails. The product owner decided on 2026-05-13 to remove Resend from the v1 build path:

- `RESEND_API_KEY` is set to `re_dev_disabled` in all v1 environments (Coolify Secrets + `.env.example`).
- The TD activates new accounts **manually via the admin UI** (Phase 1 user-management panel — `01-15-td-admin-ui-user-management`).
- Transactional email (verify, password-reset, magic-link, share-link) is reconsidered for **v2** under a separate research spike.
- The `lib/email.ts` interface stays in the codebase but its implementation logs a `WARN` and returns a fixed `{ sent: false, reason: 'email-disabled-v1' }` shape so callers don't crash. The pino log entry is the audit trail.

Operators should NOT regress this by enabling Resend in v1 without product-owner sign-off — the consent-text legal review per locale (RISK-I18N-LEGAL) is a Phase 8 release-gate, and emailing under that risk in v1 is what the decision avoids.

## What to do when X happens

| "I want to..."                       | "Do this..."                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a new bucket (Phase 5)           | Extend `MIME_BY_BUCKET` in `magic-bytes.ts`; add bucket bootstrap in a new migration; add RLS policies on `storage.objects` (see `0007_phase2_rls_policies.sql` for the pattern) |
| Increase the size limit              | Update `MAX_PROFILE_PHOTO_BYTES` in `file.ts` **AND** `playerCreateInput.contentBase64.max(...)` in the Zod schema **AND** the Caddy `request_body { max_size }` block. Update all three in the same PR. |
| Add a new MIME type                  | Update `MIME_BY_BUCKET[bucket]`; ensure `file-type` npm package supports it; update `messages/{nl,en,fr}.json` `errors.file.mime.*` keys if a new user-facing label is needed |
| Test ClamAV is alive                 | `pnpm test tests/integration/malware-scan` (covers happy path + EICAR detection)                                                                  |
| Rotate the service-role key          | See `## Service-role key — rotation procedure (WARNING-15)` above                                                                                  |
| Revoke `DIRECT_DATABASE_URL` post-migration | See `## DIRECT_DATABASE_URL revocation (post-migration)` above                                                                              |
| Verify the storage bucket exists     | `psql "$DIRECT_DATABASE_URL" -c "SELECT id, public FROM storage.buckets WHERE id='profiles'"` — expect 1 row, `public=f`                          |
| Trigger a manual freshclam refresh   | `docker exec <clamav_container> freshclam` then re-run the EICAR smoke                                                                            |
| Debug a stuck pending scan           | Check BullMQ DLQ; check clamd reachability with the EICAR smoke; if clamd is fine, inspect the worker logs for OOM or timeout signals             |

## References

- `02-CONTEXT.md` D-21..D-25 — async/sync, ClamAV vs VirusTotal, fail-fast ordering, TTL, storage path conventions
- `02-RESEARCH.md` §Pitfalls 3/4/5/8 — signature staleness, service-role leak, body-parser limits, signed-URL caching
- `02-RESEARCH.md` §Open Questions 2/3 — base64-vs-multipart, DB-first ordering
- `02-14-MIGRATION-LOG.md` — staging push log; canonical record for the schema state Phase 2 ships against
- `docs/migration-runbook.md` — Drizzle migration governance (MIG-01..05)
- `docs/erasure-strategy.md` — what happens to uploaded_files rows on GDPR Art. 17 erasure (Class B — anonymize the `actor` audit pointer, hard-delete the storage object via Phase 7 procedure)
- `docs/observability.md` — log redaction; emergency-contact fields and uploaded-file metadata redaction lists
