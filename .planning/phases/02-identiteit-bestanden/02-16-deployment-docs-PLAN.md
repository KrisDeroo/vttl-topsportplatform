---
phase: 02-identiteit-bestanden
plan_id: 02-16-deployment-docs
plan: 16
type: execute
wave: 9
depends_on: [02-15-tests, 02-14-blocking-schema-push]
files_modified:
  - docs/file-upload-pipeline.md
  - docs/deployment.md
autonomous: true
requirements:
  - VALID-04
  - OPS-01

must_haves:
  truths:
    - "docs/file-upload-pipeline.md documents: full upload→scan→clean lifecycle, ClamAV sidecar config, freshclam cron, magic-bytes registry, App Router body-size limits (Zod + Caddy — BLOCKER-04, NOT Pages-Router bodyParser config), base64-vs-multipart transport choice, Phase 8 cron sweeps (recompute_player_minor_flags + orphan sweep — BLOCKER-10)"
    - "docs/deployment.md extended with: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + CLAMAV_HOST + CLAMAV_PORT env vars, ClamAV sidecar service block for Coolify, App Router body-size limits (Zod + Caddy), freshclam schedule"
    - "Operator knows how to test ClamAV health via EICAR string"
    - "Operator knows where the service-role key lives and how to rotate it"
  artifacts:
    - path: "docs/file-upload-pipeline.md"
      provides: "developer + operator reference for Phase 2 file pipeline"
      contains: "ClamAV"
      min_lines: 80
    - path: "docs/deployment.md"
      provides: "extended Coolify deployment doc"
      contains: "clamav"
  key_links:
    - from: "docs/file-upload-pipeline.md"
      to: "src/server/workers/jobs/malware-scan.ts (02-06)"
      via: "doc references the worker job and its config"
      pattern: "malware-scan\\.ts"
---

<objective>
Ship the two operator-facing docs that close Phase 2:

1. **`docs/file-upload-pipeline.md`** (new): single-page reference for the upload→scan→clean lifecycle. Audience: developers debugging upload issues + operators tuning ClamAV.
2. **`docs/deployment.md`** (extend Phase 1): add the Phase 2 environment variables and the ClamAV sidecar service definition for Coolify.

Output: 1 new doc + 1 extended doc.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@.planning/phases/02-identiteit-bestanden/02-04-storage-magic-bytes-helpers-PLAN.md
@.planning/phases/02-identiteit-bestanden/02-06-malware-scan-worker-PLAN.md
@docs/migration-runbook.md
@CLAUDE.md

<interfaces>
<!-- Phase 1 doc structure (docs/migration-runbook.md, docs/observability.md) — short, operator-focused, code-block heavy. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Write docs/file-upload-pipeline.md</name>
  <read_first>
    - docs/migration-runbook.md (Phase 1 — style reference)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md (entire — pulls from §System Architecture Diagram + §Pitfalls 3/4/5/8 + §Open Questions 2/3)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-21..D-25
  </read_first>
  <files>
    docs/file-upload-pipeline.md
  </files>
  <action>
    ```markdown
    # File Upload Pipeline (Phase 2)

    Single source of truth for how a file gets from the browser to a clean,
    signed-URL-retrievable state. Audience: developers debugging upload bugs
    + operators tuning the ClamAV sidecar.

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
                                   5. uploadedFiles INSERT
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
    - `src/server/trpc/routers/file.ts` — orchestration (upload + getSignedUrl)
    - `src/server/storage/magic-bytes.ts` — MIME whitelist registry
    - `src/server/storage/profile-photo.ts` — UUID storage key minting
    - `src/server/storage/signed-url.ts` — 1h TTL + Content-Disposition
    - `src/server/workers/jobs/malware-scan.ts` — clamd TCP scan worker

    ## Magic-bytes registry (MIME whitelist per bucket)

    Edit `src/server/storage/magic-bytes.ts` `MIME_BY_BUCKET`. Phase 2:

    | Bucket | Allowed MIME | Allowed via magic-bytes |
    |--------|--------------|-------------------------|
    | `profiles` | `image/jpeg`, `image/png` | JPEG SOI + EXIF, PNG signature |

    Phase 4 will add `evaluations` (PDF + images); Phase 5 will add `medical` (PDF + images).

    ## Request body size limit (App Router) — BLOCKER-04

    **Important:** the `export const config = { api: { bodyParser: { sizeLimit: '5mb' } } }`
    convention is **Pages Router**. The VTTL platform runs **App Router**
    (`src/app/api/trpc/[trpc]/route.ts` uses `fetchRequestHandler`), where
    that export has **no effect**. Don't add it — it gives operators a false
    sense of extra protection.

    Real defenses are layered:

    | Layer | Enforcement | Where |
    |-------|-------------|-------|
    | Zod input cap | `contentBase64.max(3 * 1024 * 1024)` (~2.25 MB raw) — fails fast with VALIDATION error | `src/server/trpc/schemas/file.ts` (02-07) |
    | Reverse-proxy cap | Caddy `request_body { max_size 5MB }` — drops request before it reaches Node | Coolify proxy config (this doc, ##Proxy section below) |
    | Runtime cap | Next.js App Router defaults the Node runtime body to whatever the platform allows — typically ~10 MB on Coolify | implicit |
    | Rate limit | SEC-08 — 10 uploads/min/user via `rateLimit` middleware | Phase 1 |

    Phase 5 medical PDFs (5 MB raw → ~6.66 MB base64) will need the Zod cap
    and Caddy cap raised; revisit when Phase 5 lands.

    ### Coolify Caddy proxy snippet
    ```caddyfile
    # Per-app section in Coolify's proxy config
    request_body {
      max_size 5MB
    }
    ```
    Without this, a malicious client can post a 100 MB body and Node will
    process it before Zod validates — wasted CPU + RAM. The Caddy gate
    rejects with HTTP 413 before any request handler runs.

    ## ClamAV daemon (D-22)

    Deployment: Coolify sidecar service running `clamav/clamav:stable`. The
    worker (`pnpm worker`) connects via TCP to `${CLAMAV_HOST}:${CLAMAV_PORT}`
    (defaults `clamav:3310`).

    ### Health check

    ```bash
    # EICAR test buffer — industry-standard non-malicious AV test string.
    # If signatures are fresh AND clamd is reachable, scan returns
    # isInfected=true.
    echo -n 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' \
      | curl -sX POST --data-binary @- "http://${CLAMAV_HOST}:${CLAMAV_PORT}/scan"
    # (clamd's wire protocol is INSTREAM, not HTTP — use `clamdscan` CLI from
    # the host instead, or rely on the Phase 2 integration test in
    # tests/integration/malware-scan.test.ts which exercises the path.)
    ```

    Quick smoke test via the integration test:

    ```bash
    pnpm test tests/integration/malware-scan
    ```

    ### Signature freshness (Pitfall 3)

    `clamav/clamav:stable` bundles a `freshclam` cron that refreshes daily.
    Verify in Coolify logs:

    ```bash
    # Inside the clamav sidecar container:
    tail -f /var/log/clamav/freshclam.log
    # Expect a daily "ClamAV update process started" entry.
    ```

    If signatures are stale, manually trigger:

    ```bash
    docker exec <clamav_container> freshclam
    ```

    ### Failure modes

    | Symptom | Likely cause | Fix |
    |---------|--------------|-----|
    | `scan_status='pending'` for >30s | clamd unreachable; check Coolify sidecar logs | restart sidecar |
    | EICAR test returns `isInfected: false` | stale signatures | run `freshclam` |
    | "ECONNREFUSED" in worker logs | wrong `CLAMAV_HOST` | check Coolify env |
    | Stuck `pending` rows accumulating | retries exhausted | cron sweep TODO (Phase 8 OPS routine — see `## Phase 8 cron sweeps` below) |

    ## Signed URL TTL (D-24)

    Profile photos: **1 hour** TTL, `Content-Disposition: attachment`. RBAC
    check runs BEFORE URL minting (D-24 — never rely on TTL alone).

    Client guidance: refresh signed URL at 50 min mark; TanStack Query
    `staleTime: 50 * 60 * 1000` (Pitfall 8 mitigation).

    ## Audit trail (GDPR-04)

    Every file mutation writes an `audit_log` row:
    - `file.upload` — at successful upload+queue
    - `file.signed_url_issued` — at every URL mint
    - `file.delete` — at TD-driven soft-delete (`supersededAt = now()`)
    - `file.delete_storage_failed` — when TD requested removeStorage and the
      Supabase API call failed (audit-only; the DB row is already
      soft-deleted)

    PII (original_filename, raw bytes) are intentionally NOT in audit_log per
    `src/lib/log-redact-paths.ts` convention.

    ## Orphan cleanup (deferred to Phase 8)

    Two orphan scenarios:
    - **DB row, no storage object**: upload mutation failed between INSERT and
      storage.upload. The tRPC mutation in 02-09 surfaces an
      `INTERNAL_SERVER_ERROR` and writes a `file.upload_storage_failed` audit
      row (WARNING-08 mitigation). Cron detection: `scan_status='pending'
      AND uploaded_at < now() - 5 minutes` AND no matching `storage.objects`
      row by `name = storage_key`.
    - **Storage object, no DB row**: should not happen (DB INSERT precedes
      storage upload), but a worst-case cron could scan
      `storage.objects.bucket_id='profiles'` and JOIN against
      `uploaded_files` to flag.

    Phase 8 OPS routine (deferred).

    ## Phase 8 cron sweeps (deferred but planned now)

    The following sweeps live in `pg_cron` (Supabase Pro enables pg_cron in the
    `extensions` schema; jobs are declared as Drizzle migration files in Phase 8
    per MIG-01 discipline). They are listed here so operators know what's
    coming and so Phase 2 doesn't accidentally implement them ad-hoc.

    ### 1. `recompute_player_minor_flags()` — BLOCKER-10

    `players.is_minor` is a denormalised boolean computed at create/update time
    from `dateOfBirth` (`isMinorAt(dob, now)`). It does NOT auto-flip on the
    player's 18th birthday — `updateSelf` doesn't touch DOB, and no other code
    path runs daily. A 17-year-old created last year stays `is_minor=true`
    forever unless a TD manually updates them.

    **Risk:** downstream consumers (parent permissions, consent flow, future
    medical visibility) make wrong decisions about freshly-18 players.

    **Phase 8 sweep:**
    ```sql
    -- Runs nightly at 02:00 Europe/Brussels (server time UTC+1 / UTC+2).
    -- Recomputes is_minor for every player whose DOB makes them ≥ 16 today.
    -- Belgian Patient Rights Act minor threshold is 16; align is_minor with
    -- that even though the JS helper `isMinorAt` uses the same constant.
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
      '0 2 * * *',
      $$SELECT recompute_player_minor_flags();$$
    );
    ```

    **Phase 2 stance:** documented but NOT implemented. Phase 2's
    `players.is_minor` is correct at create/update time; the once-per-year
    drift (a player crossing 18) is acceptable for v1 because: (a) emergency
    contact data is harmless on adult records (the CHECK constraint allows
    NULL emergency contact for non-minors but doesn't require it to be NULL);
    (b) Phase 5 medical visibility uses age-derivation via `isMinorAt(dob,
    now)` at call time, not the stale flag.

    ### 2. Orphan upload sweep (WARNING-08)

    See `## Orphan cleanup` above. Sweep query:
    ```sql
    DELETE FROM uploaded_files uf
    WHERE uf.scan_status = 'pending'
      AND uf.uploaded_at < now() - INTERVAL '5 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = uf.bucket AND o.name = uf.storage_key
      );
    ```

    ### 3. Stuck-scan sweep

    Same shape as orphan sweep but for rows that DO have a storage object —
    these mean clamd was unreachable and BullMQ exhausted retries. Operator
    action: triage failed jobs in BullMQ, decide whether to manually re-enqueue
    or mark as `error`.

    ## Why we chose THIS architecture

    - **Async scan via BullMQ (D-21)**: ClamAV scans take 1–3 s — synchronous would hit tRPC timeouts under load. Async = upload mutation returns in <200 ms.
    - **ClamAV self-hosted (D-22)**: GDPR data residency. VirusTotal uploads files to cloud → unacceptable for profile photos (personal data under GDPR Art. 4).
    - **Service-role server-side upload only**: client never talks to Supabase Storage directly; magic-bytes is the gate. Direct browser uploads would bypass server validation.
    - **base64-in-JSON transport (RESEARCH §Open Q 2)**: keeps the tRPC layer homogeneous; 33% inflation is acceptable for 2 MB files. Phase 5 may revisit for 5 MB medical PDFs.
    - **DB row FIRST, then storage (RESEARCH §Open Q 3)**: orphan DB rows are queryable and recoverable; orphan storage objects require a bucket scan.

    ## What to do when X happens

    | "I want to..." | "Do this..." |
    |----------------|--------------|
    | Add a new bucket (Phase 4/5) | Extend `MIME_BY_BUCKET` in magic-bytes.ts; add bucket bootstrap to a new migration; add RLS policies on storage.objects |
    | Increase the size limit | Update `MAX_PROFILE_PHOTO_BYTES` in `file.ts` + `playerCreateInput.contentBase64.max(...)` in zod schema + body-parser sizeLimit |
    | Add a new MIME type | Update `MIME_BY_BUCKET[bucket]`; ensure `file-type` package supports it; update fr/en/nl error keys if needed |
    | Test ClamAV is alive | `pnpm test tests/integration/malware-scan` |
    | Rotate the service-role key | Generate new key in Supabase Dashboard → API → service_role → rotate → update Coolify Secrets `SUPABASE_SERVICE_ROLE_KEY` → redeploy the `worker` and `web` services |
    | Verify storage bucket exists | `psql "$DIRECT_DATABASE_URL" -c "SELECT id, public FROM storage.buckets WHERE id='profiles'"` |
    ```
  </action>
  <verify>
    <automated>test -f docs/file-upload-pipeline.md && grep -q "ClamAV" docs/file-upload-pipeline.md && grep -q "MIME_BY_BUCKET" docs/file-upload-pipeline.md && grep -q "EICAR" docs/file-upload-pipeline.md && grep -q "freshclam" docs/file-upload-pipeline.md && grep -q "Pitfall 3" docs/file-upload-pipeline.md && grep -q "service-role key" docs/file-upload-pipeline.md</automated>
  </verify>
  <acceptance_criteria>
    - Doc covers: lifecycle diagram, magic-bytes registry, body-parser, ClamAV setup, health check, signature freshness, signed URL TTL, audit trail, orphan cleanup, architecture rationale, "what to do when X"
    - References the 4 source files in `src/server/storage/` + `src/server/workers/jobs/malware-scan.ts`
    - EICAR string included for AV smoke test
  </acceptance_criteria>
  <done>Operators have a single page covering everything Phase 2 file-related.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Extend docs/deployment.md with ClamAV sidecar + Phase 2 env</name>
  <read_first>
    - docs/deployment.md (Phase 1 — current Coolify deployment doc)
    - .planning/phases/02-identiteit-bestanden/02-01-deps-and-env-PLAN.md (env vars added)
  </read_first>
  <files>
    docs/deployment.md
  </files>
  <action>
    Append a new section to `docs/deployment.md`. Preserve existing Phase 1 content.

    Add at the bottom:

    ```markdown
    ## Phase 2 additions (Identity & Files)

    ### New environment variables (Coolify Secrets)

    | Var | Source | Used by |
    |-----|--------|---------|
    | `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL | `src/server/storage/client.ts` |
    | `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → service_role secret | `src/server/storage/client.ts` |
    | `CLAMAV_HOST` | Sidecar service name (default `clamav`) | `src/server/workers/jobs/malware-scan.ts` |
    | `CLAMAV_PORT` | clamd TCP port (default `3310`) | same |

    All four are **server-only** — no `NEXT_PUBLIC_` prefix. Set in Coolify's
    Secrets UI for both the `web` and `worker` services (the worker needs
    `SUPABASE_URL/SERVICE_ROLE_KEY` to download files for scanning; the web
    service needs them for upload + signed URL minting).

    **Rotation:** rotate `SUPABASE_SERVICE_ROLE_KEY` post-Phase-8 release or on
    any suspected exposure. Procedure: generate new key in Supabase Dashboard
    → update Coolify Secrets → redeploy web + worker. There is a ~5-second
    window where in-flight signed URLs minted with the old key remain valid.

    ### ClamAV sidecar service

    Add to Coolify project (or extend the `docker-compose.yml` if running
    docker-compose directly):

    ```yaml
    # ClamAV antivirus daemon (D-22)
    clamav:
      image: clamav/clamav:stable
      restart: unless-stopped
      networks:
        - app                                    # Coolify private network
      environment:
        CLAMAV_NO_FRESHCLAMD: "false"            # daily signature refresh
        CLAMAV_NO_CLAMD: "false"
        CLAMD_STARTUP_TIMEOUT: "1800"            # initial DB build ~10 min
      volumes:
        - clamav_data:/var/lib/clamav
      healthcheck:
        test: ["CMD", "clamdcheck.sh"]
        interval: 1m
        timeout: 30s
        retries: 5
        start_period: 15m                        # let initial freshclam finish

    volumes:
      clamav_data:
    ```

    The container must NOT bind the TCP port to the public interface — only
    the private Coolify network. clamd does not authenticate (Pitfall — RESEARCH
    §Security Domain T-02-06-CLAMD-PUBLIC) so reachability must be limited.

    ### Resource sizing (RESEARCH A5)

    ClamAV uses ~700 MB RSS once signatures are loaded. Hetzner CX31 (8 GB
    RAM) is sized for app (~1 GB) + worker (~500 MB) + Postgres
    (managed-elsewhere on Supabase) + ClamAV (~700 MB) = comfortable margin.
    If ClamAV OOMs, fall back to a separate CX11 box (€4/mo, 4 GB RAM) and
    update `CLAMAV_HOST` to point at its private IP.

    ### Request body size limit (App Router) — BLOCKER-04

    The App Router does NOT honour `export const config = { api: { bodyParser } }`
    (that's Pages Router syntax). Real defenses, in order:

    1. **Zod schema cap** — `contentBase64.max(3 * 1024 * 1024)` in
       `src/server/trpc/schemas/file.ts` (02-07). Rejects with VALIDATION
       error before any handler logic runs.
    2. **Coolify Caddy proxy cap** — `request_body { max_size 5MB }`. Drops
       oversize requests with HTTP 413 before Node sees them.
    3. **SEC-08 rate limit** — 10 uploads/min/user (Phase 1 `rateLimit`
       middleware).

    See `## Request body size limit (App Router)` in `docs/file-upload-pipeline.md` for the layered model and the Caddy snippet.

    ### Worker process

    Coolify deploys two services from the same repo:
    - `web` → `pnpm start` (Next.js HTTP server)
    - `worker` → `pnpm worker` (BullMQ consumer — Phase 1 consent-notify
      queue + Phase 2 malware-scan queue)

    Both share the same env vars; the worker uses `REDIS_URL` (ioredis TCP)
    AND `SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + CLAMAV_HOST + CLAMAV_PORT`.

    ### Phase 2 smoke tests post-deploy

    After applying migrations 0006/0007/0008 (Plan 02-14) and deploying the
    web + worker services:

    ```bash
    # 1. Health endpoints (Phase 1 — confirm DB + Redis still reachable)
    curl https://<staging>/api/health/ready
    # expect 200

    # 2. Upload smoke test (via TD-authenticated session)
    # (manual: log in, navigate to /nl/players/new, upload a JPEG, confirm
    # scan completes within 30 s)

    # 3. ClamAV reachability
    docker exec <web_container> nc -zv $CLAMAV_HOST $CLAMAV_PORT
    # expect "succeeded"

    # 4. Buckets exist
    psql "$DIRECT_DATABASE_URL" -c "SELECT id, public FROM storage.buckets WHERE id='profiles'"
    # expect 1 row, public=f
    ```

    ### Rollback

    If Phase 2 needs to be rolled back from staging:
    1. Coolify: redeploy the previous `main` commit (Phase 1).
    2. Database: run `drizzle/0008_phase2_lookup_seed.rollback.md` →
       `0007_phase2_rls_policies.rollback.md` →
       `0006_phase2_profiles_and_files.rollback.md` (in reverse order).
    3. The `clamav` sidecar can stay running indefinitely; it's not consuming
       resources without Phase 2 traffic.
    ```
  </action>
  <verify>
    <automated>grep -q "Phase 2 additions" docs/deployment.md && grep -q "SUPABASE_SERVICE_ROLE_KEY" docs/deployment.md && grep -q "CLAMAV_HOST" docs/deployment.md && grep -q "clamav/clamav:stable" docs/deployment.md && grep -q "freshclam" docs/deployment.md && grep -q "5mb" docs/deployment.md</automated>
  </verify>
  <acceptance_criteria>
    - Phase 2 section appended (Phase 1 content intact)
    - 4 env vars documented with provenance
    - Coolify sidecar service YAML provided
    - Smoke tests + rollback path documented
  </acceptance_criteria>
  <done>Deployment doc reflects Phase 2 reality.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Doc accuracy ↔ operator action | An incorrect command in this doc could cause production damage |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-16-EXPOSED-SECRET-IN-LOG | Information Disclosure | Operator copies a `psql` log containing secrets into the doc | accept | Doc explicitly says "paste OUTPUT, not env" (per 02-14 plan); reviewer auditing the SUMMARY for accidents |
| T-02-16-WRONG-FIX-PROCEDURE | Availability / Tampering | "Service-role key rotation" steps incomplete → production drops mid-rotation | mitigate | Doc covers the 5-second window explicitly; testing path covered by Phase 8 OPS routines |
</threat_model>

<verification>
- Both docs render in any markdown viewer
- Cross-references to code paths resolve (`src/server/storage/client.ts` etc. exist)
- No production secrets in the doc
</verification>

<success_criteria>
- file-upload-pipeline.md is the single-page operator + developer reference
- deployment.md reflects all 4 new env vars + ClamAV sidecar
- Rollback path documented at the deployment level
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-16-SUMMARY.md` listing the doc additions and any TODOs deferred to Phase 8 (orphan cleanup cron, body-parser revisit for medical PDFs).
</output>
