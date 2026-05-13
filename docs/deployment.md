# Deployment — Coolify on Hetzner

Operator runbook for deploying VTTL Topsportplatform. Hosting target is **Coolify** (self-hosted Heroku-alike) on a **Hetzner CX31** instance in Germany. Postgres + Storage are **Supabase Pro** in **`eu-west-1` (Dublin)**.

> The original PROJECT.md mentioned `eu-central-1` (Frankfurt) — when the actual Supabase project was provisioned, it landed in `eu-west-1`. Both EU/GDPR jurisdictions, no functional impact. Use `eu-west-1` in all operator-facing material going forward.

## Architecture

```
                       ┌──────────────────────────────────────┐
                       │  Coolify (Hetzner CX31, Germany)     │
                       │                                      │
   Internet ──HTTPS──► │  Caddy (built-in reverse proxy)      │
                       │   │                                  │
                       │   ├──► vttl-web (pnpm start)         │
                       │   │     Next.js 15 — HTTP + tRPC     │
                       │   │                                  │
                       │   └──► vttl-worker (pnpm worker)     │
                       │         BullMQ consumer              │
                       │           ├─► consent-notify queue   │
                       │           └─► malware-scan queue     │
                       │                                      │
                       │  vttl-clamav (Phase 2 sidecar)       │
                       │    clamav/clamav:stable on :3310     │
                       │                                      │
                       │  vttl-redis (managed via Coolify)    │
                       │    Redis 7 for BullMQ + Upstash      │
                       │                                      │
                       └──────────────────────────────────────┘
                                  │
                                  │ Postgres over TLS
                                  ▼
                       ┌──────────────────────────────────────┐
                       │  Supabase Pro (eu-west-1, Dublin)    │
                       │   - Postgres 16 + RLS                │
                       │   - Storage (profiles, medical bucks)│
                       │   - Realtime (Phase 6 messaging)     │
                       └──────────────────────────────────────┘
```

## Phase 1 baseline

The `web` and `worker` services are deployed from the same monorepo. Coolify reads the Dockerfile (or Nixpacks) and produces two container images. Both pull from the same Coolify Secrets namespace.

### Phase 1 environment variables

| Var                          | Source                                                | Used by                                  |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| `DATABASE_URL`               | Supabase Pro → Connection Pooler (port 6543, RLS-enabled, bound to `app_user`)            | App runtime — tRPC routers via `src/server/db/client.ts` |
| `DIRECT_DATABASE_URL`        | Supabase Pro → Direct connection (port 5432, session-mode, bound to `postgres` owner)      | Drizzle Kit migration runner ONLY — see WARNING-15 |
| `BETTER_AUTH_SECRET`         | `openssl rand -base64 32`                             | Better Auth session signing               |
| `BETTER_AUTH_URL`            | Production: `https://vttl.example`; staging: `https://staging.vttl.example` | Better Auth canonical origin              |
| `MEDICAL_ENCRYPTION_KEY`     | `openssl rand -base64 32`                             | pgcrypto column encryption (medical_events) |
| `UPSTASH_REDIS_REST_URL`     | Upstash EU → Redis REST endpoint                      | Rate-limit middleware (SEC-07..09)        |
| `UPSTASH_REDIS_REST_TOKEN`   | Upstash EU → REST token                               | Rate-limit middleware                     |
| `REDIS_URL`                  | Coolify internal redis service (`redis://vttl-redis:6379`) | BullMQ (consent-notify queue) — Phase 1 |
| `SENTRY_DSN`                 | Sentry EU project                                     | Pino + Next.js error capture (PII-stripped via `beforeSend`) |
| `LOGFLARE_API_KEY`           | Logflare EU                                           | pino log shipper                         |
| `LOGFLARE_SOURCE`            | Logflare source id                                    | pino log shipper                         |
| `RESEND_API_KEY`             | **`re_dev_disabled`** in v1 — see below              | Email helper (no-op in v1)               |

> **v1 transactional email decision (2026-05-13):** `RESEND_API_KEY=re_dev_disabled` in all v1 environments. The TD activates new accounts manually via the admin UI (Phase 1 user-management panel). The `lib/email.ts` helper logs a `WARN` and returns `{ sent: false, reason: 'email-disabled-v1' }` instead of calling Resend. Transactional email is reconsidered for v2 under a separate research spike. Do NOT enable Resend in v1 without product-owner sign-off — the consent-text legal review per locale (RISK-I18N-LEGAL) is a Phase 8 release gate.

### Phase 1 deploy steps

1. Coolify → New Application → Git source: `git@github.com:vttl-be/topsport.git`.
2. Set the build command to `pnpm build` and the start commands per service (`pnpm start` for `web`, `pnpm worker` for `worker`).
3. Add Secrets per the Phase 1 table above. Mark them `Build & Runtime` so they reach the Node process.
4. Hook up the Coolify-managed `redis` service (Redis 7, persisted volume).
5. Deploy. Coolify's built-in Caddy handles HTTPS via Let's Encrypt.
6. Smoke check: `curl https://<host>/api/health/ready` returns `{ status: "ok", db: "ok", redis: "ok" }`.

### Backups

Supabase Pro provides daily snapshots + PITR (up to 7 days). For DR, the operator confirms PITR on the Supabase Dashboard → Database → Backups page. Restore drill cadence: monthly (Phase 8 OPS-09).

---

## Phase 2 additions (Identity & Files)

Phase 2 adds the file upload pipeline (profile photos) and the ClamAV malware-scan sidecar. The `web` and `worker` services both grow new env dependencies; a new `clamav` sidecar service is introduced.

### New environment variables (Coolify Secrets)

| Var                          | Source                                                                  | Used by                                                       |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `SUPABASE_URL`               | Supabase Dashboard → Project Settings → API → Project URL               | `src/server/storage/client.ts` (web + worker)                  |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase Dashboard → Project Settings → API → service_role secret       | `src/server/storage/client.ts` (web + worker)                  |
| `CLAMAV_HOST`                | Sidecar service name (default `clamav`)                                 | `src/server/workers/jobs/malware-scan.ts` (worker only)        |
| `CLAMAV_PORT`                | clamd TCP port (default `3310`)                                         | `src/server/workers/jobs/malware-scan.ts` (worker only)        |

All four are **server-only** — no `NEXT_PUBLIC_` prefix. Set in Coolify's Secrets UI for both the `web` and `worker` services (the worker needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to download files for scanning; the web service needs them for upload + signed URL minting). `CLAMAV_HOST/PORT` are only consumed by the worker — adding them to web is harmless but unnecessary.

#### Service-role key rotation (WARNING-15)

Rotate `SUPABASE_SERVICE_ROLE_KEY` post-Phase-8 release or on any suspected exposure. Procedure:

1. Generate new key in Supabase Dashboard → API → service_role → Rotate.
2. Update Coolify Secrets `SUPABASE_SERVICE_ROLE_KEY` for both web + worker.
3. Redeploy both services (Coolify rolling deploy).
4. Run the post-rotation smoke check in `docs/file-upload-pipeline.md` §Service-role key rotation.

There is a ~5-second window where in-flight signed URLs minted with the old key remain valid — Supabase rotates the storage JWT secret atomically with the service-role key in most configurations; if your project has them de-coupled, old signed URLs survive until their 1 h TTL.

#### `DIRECT_DATABASE_URL` revocation (post-migration)

`DIRECT_DATABASE_URL` carries the Supabase **owner** credential (bypasses RLS, bypasses the pooler). After any migration push it should NOT live on `web` or `worker` runtime services. Procedure (also documented in `02-14-MIGRATION-LOG.md`):

```
1. coolify env unset DIRECT_DATABASE_URL --app vttl-web
2. coolify env unset DIRECT_DATABASE_URL --app vttl-worker
3. Confirm via   coolify env list --app vttl-web | grep -i direct   returns nothing
4. Restart both apps to pick up the smaller env set
```

`DATABASE_URL` (transaction pooler on port 6543, bound to `app_user` — RLS-enabled) stays — that's the runtime path. Migration runs (`npx drizzle-kit migrate`) are gated by a separate ad-hoc Coolify job that loads `DIRECT_DATABASE_URL` from a tmpfile env, runs, and exits. The runtime services never see the owner credential.

### ClamAV sidecar service

Add a new service to the Coolify project (or extend the `docker-compose.yml` if running compose directly):

```yaml
# ClamAV antivirus daemon (D-22)
clamav:
  image: clamav/clamav:stable
  restart: unless-stopped
  networks:
    - app                                      # Coolify private network ONLY
  environment:
    CLAMAV_NO_FRESHCLAMD: "false"              # daily signature refresh
    CLAMAV_NO_CLAMD: "false"
    CLAMD_STARTUP_TIMEOUT: "1800"              # initial DB build ~10 min
  volumes:
    - clamav_data:/var/lib/clamav
  healthcheck:
    test: ["CMD", "clamdcheck.sh"]
    interval: 1m
    timeout: 30s
    retries: 5
    start_period: 15m                          # let initial freshclam finish

volumes:
  clamav_data:
```

The container **must NOT** bind the TCP port to the public interface — only the private Coolify network. clamd does not authenticate (Pitfall — RESEARCH §Security Domain T-02-06-CLAMD-PUBLIC), so reachability must be limited to the worker container. In Coolify, leaving the `ports:` block out of the service definition is enough; the daemon is reachable on `clamav:3310` from any other service on the same private network.

### Resource sizing (RESEARCH A5)

ClamAV uses ~700 MB RSS once signatures are loaded. Hetzner CX31 (8 GB RAM) sizing:

| Component            | Steady-state RSS |
| -------------------- | ---------------- |
| `vttl-web` (Next.js) | ~1 GB            |
| `vttl-worker`        | ~500 MB          |
| `vttl-redis`         | ~200 MB          |
| `vttl-clamav`        | ~700 MB          |
| Caddy + OS overhead  | ~500 MB          |
| **Total**            | ~2.9 GB          |

That leaves ~5 GB headroom on a CX31. If ClamAV OOMs (rare — it only spikes during signature reload) fall back to a separate CX11 box (€4/mo, 4 GB RAM) on the same Hetzner network and update `CLAMAV_HOST` to point at its private IP.

### Request body size limit (App Router) — BLOCKER-04

The App Router does **NOT** honour `export const config = { api: { bodyParser } }` (that's Pages Router syntax). Don't put it in `src/app/api/trpc/[trpc]/route.ts` — it does nothing. Real defenses, in order:

1. **Zod schema cap** — `contentBase64.max(3 * 1024 * 1024)` in `src/server/trpc/schemas/file.ts` (Plan 02-07). Rejects with `BAD_REQUEST` (i18n key `errors.file.tooLarge`) before any handler logic runs.
2. **Coolify Caddy proxy cap** — `request_body { max_size 5mb }` (snippet below). Drops oversize requests with HTTP 413 before Node sees them.
3. **SEC-08 rate limit** — 10 uploads/min/user (Phase 1 `rateLimit` middleware).

See `docs/file-upload-pipeline.md` §Request body size limit (App Router) for the full layered model.

#### Caddy `request_body` snippet

Coolify exposes the Caddy proxy config under the application settings → Proxy → Custom Configuration. Add per-app:

```caddyfile
request_body {
  max_size 5mb
}
```

Without this, a malicious client can post a 100 MB body and Node will buffer it before Zod validates — wasted CPU + RAM. The Caddy gate rejects with HTTP 413 before any request handler runs. Phase 5 will need this raised when 5 MB medical PDFs ship (base64 → ~6.66 MB on the wire, so probably 10 MB cap).

### Worker process — Phase 2 additions

Coolify deploys two services from the same repo:

- `web` → `pnpm start` (Next.js HTTP server)
- `worker` → `pnpm worker` (BullMQ consumer)

Phase 2 adds the **malware-scan** queue to the worker. Phase 1 already wired the **consent-notify** queue. Both queues share the same `REDIS_URL`. The worker now requires:

- `REDIS_URL` (Phase 1)
- `DATABASE_URL` (Phase 1) — RLS-enabled connection bound to `app_user`
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (Phase 2) — for downloading files to scan
- `CLAMAV_HOST` + `CLAMAV_PORT` (Phase 2) — TCP socket to the sidecar

### Phase 2 smoke tests post-deploy

After applying migrations 0006/0007/0008 (Plan 02-14) and deploying web + worker + clamav sidecar:

```bash
# 1. Health endpoints (Phase 1 — confirm DB + Redis still reachable)
curl https://<staging>/api/health/ready
# expect 200 with { status: "ok", db: "ok", redis: "ok" }

# 2. ClamAV reachability from worker
docker exec <worker_container> nc -zv $CLAMAV_HOST $CLAMAV_PORT
# expect "succeeded"

# 3. EICAR detection (signatures fresh + clamd alive)
docker exec <clamav_container> sh -c '
  printf "X5O!P%%@AP[4\\PZX54(P^)7CC)7}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H+H*" \
    | clamdscan --stream -
'
# expect: "stream: Win.Test.EICAR_HDB-1 FOUND"

# 4. Storage buckets exist
psql "$DIRECT_DATABASE_URL" -c "SELECT id, public FROM storage.buckets WHERE id='profiles'"
# expect 1 row, public=f

# 5. mark_scan_result function + EXECUTE grant (per 02-14 §13)
psql "$DATABASE_URL" -c "
SELECT proname, prosecdef FROM pg_proc WHERE proname='mark_scan_result';
SELECT has_function_privilege('app_user', 'mark_scan_result(uuid,text,text)', 'EXECUTE');
"
# expect: 1 row prosecdef=t, then has_function_privilege=t

# 6. Upload smoke test (manual via TD-authenticated session)
# log in, navigate to /nl/players/new, upload a JPEG, confirm scan
# completes within 30s and the photo renders via signed URL.
```

### Phase 2 freshclam schedule

`clamav/clamav:stable` bundles a freshclam daemon that refreshes signatures every **24 h** (default `Checks 24` in the bundled `freshclam.conf`). The daemon starts as part of the container's entrypoint; no Coolify cron job is needed. Verify in logs:

```bash
docker exec <clamav_container> tail -f /var/log/clamav/freshclam.log
# Expect a daily "ClamAV update process started" entry
```

If signatures become stale (e.g. after a sidecar restart wipes the cached state), manually trigger:

```bash
docker exec <clamav_container> freshclam
```

After freshclam completes, clamd reloads signatures automatically. Verify with another EICAR scan.

### Rollback

If Phase 2 needs to be rolled back from staging:

1. **Code:** Coolify → redeploy the previous `main` commit (last Phase 1 release tag).
2. **Database (in reverse order):**
   - `drizzle/0008_phase2_lookup_seed.rollback.md`
   - `drizzle/0007_phase2_rls_policies.rollback.md`
   - `drizzle/0006_phase2_profiles_and_files.rollback.md`
3. **Sidecar:** the `clamav` service can stay running indefinitely; it's not consuming resources without Phase 2 traffic. Optionally stop the container via Coolify if RAM is tight.
4. **Storage bucket:** the `profiles` bucket can be left in place — it is empty after rollback if no Phase 2 uploads happened in production, and harmless if any data was written (an empty bucket on a Phase 1 deployment).

---

## Future phase additions

This section is a placeholder for Phase 3+ environment additions. Each phase plan that introduces new runtime infrastructure should append a `## Phase N additions` block here following the Phase 2 template (env vars table, service block, smoke tests, rollback). See:

- Phase 3 (Calendar): no new infrastructure expected — uses existing Postgres + tRPC.
- Phase 5 (Medical + Evaluations): `medical/` + `evaluations/` Storage buckets enabled in the magic-bytes registry; the Caddy `request_body` cap and Zod content limit raised to accommodate 5 MB PDFs.
- Phase 6 (Messaging): Supabase Realtime channels opened; no new env vars.
- Phase 8 (Quality & Release): `pg_cron` job declarations land (including `recompute_player_minor_flags()` — see `docs/file-upload-pipeline.md` §Phase 8 cron sweeps); SPF/DKIM/DMARC for the `vttl.be` domain if v2 re-enables email; restore-drill cadence formalized.

## References

- `docs/migration-runbook.md` — Drizzle migration governance (MIG-01..05)
- `docs/erasure-strategy.md` — GDPR Art. 17 cascade rules per table class
- `docs/observability.md` — log retention, redact paths, slow-query thresholds
- `docs/file-upload-pipeline.md` — Phase 2 file pipeline reference (companion to this doc)
- `02-14-MIGRATION-LOG.md` — staging push log; canonical state record for Phase 2 schema
