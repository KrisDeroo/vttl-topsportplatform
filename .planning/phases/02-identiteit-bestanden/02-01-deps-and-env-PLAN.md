---
phase: 02-identiteit-bestanden
plan_id: 02-01-deps-and-env
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - pnpm-lock.yaml
  - src/lib/env.ts
  - .env.example
  - src/lib/log-redact-paths.ts
autonomous: true
requirements:
  - VALID-04
  - FILE-01

must_haves:
  truths:
    - "`@supabase/supabase-js@^2` and `clamscan@^2` are installed and resolvable"
    - "env.ts validates SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLAMAV_HOST, CLAMAV_PORT as server-only"
    - "pino redact list covers `*.emergencyContactPhone`, `*.emergency_contact_phone`, `*.emergency_contact_name`"
    - ".env.example documents the 4 new vars with example values + provenance hint"
  artifacts:
    - path: "package.json"
      provides: "deps for Phase 2 file pipeline"
      contains: "@supabase/supabase-js"
    - path: "src/lib/env.ts"
      provides: "validated env binding for Supabase Storage + ClamAV"
      contains: "SUPABASE_SERVICE_ROLE_KEY"
    - path: ".env.example"
      provides: "developer onboarding for Phase 2 env"
      contains: "CLAMAV_HOST"
    - path: "src/lib/log-redact-paths.ts"
      provides: "pino redact list expanded for emergency-contact fields"
      contains: "emergency_contact_phone"
  key_links:
    - from: "src/server/storage/client.ts (created in 02-04)"
      to: "src/lib/env.ts"
      via: "imports SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from `env`"
      pattern: "env\\.SUPABASE_SERVICE_ROLE_KEY"
    - from: "src/server/workers/jobs/malware-scan.ts (created in 02-06)"
      to: "src/lib/env.ts"
      via: "imports CLAMAV_HOST + CLAMAV_PORT from `env`"
      pattern: "env\\.CLAMAV_HOST"
---

<objective>
Install the two new Phase 2 runtime dependencies (`@supabase/supabase-js`, `clamscan`) and wire the four new server-only env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLAMAV_HOST`, `CLAMAV_PORT`) through `src/lib/env.ts` so every downstream Phase 2 plan can `import { env }` and get type-checked access. Also expand pino's redact-paths list so emergency-contact fields never leak into logs.

Purpose: kill the "where does Supabase init?" / "is ClamAV configured?" foot-gun before any router or worker code lands. Per RESEARCH §Runtime State Inventory line 708.

Output: package.json updated, pnpm install committed lockfile, env.ts + .env.example aligned, redact list audited.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@CLAUDE.md

<interfaces>
<!-- Phase 1 env shape that this plan extends. From src/lib/env.ts. -->

```typescript
// existing src/lib/env.ts (Phase 1) — append new keys, do not edit existing
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DIRECT_DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    // ... existing keys unchanged ...
    MEDICAL_ENCRYPTION_KEY: z.string().min(32),
    // NEW (this plan):
    // SUPABASE_URL: z.string().url(),
    // SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
    // CLAMAV_HOST: z.string().min(1).default('clamav'),
    // CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  },
  client: { ... unchanged ... },
  runtimeEnv: { ... append matching process.env entries ... },
  ...
});
```

<!-- Phase 1 redact-paths from src/lib/log-redact-paths.ts (already covers phone, email, password, medical_*). Plan appends emergency_contact_* paths. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Install @supabase/supabase-js + clamscan and lock</name>
  <read_first>
    - package.json (current deps; Phase 1 ships `bullmq@^5.76`, `file-type@^22`, `drizzle-orm@^0.45` — confirm these are pinned)
    - pnpm-lock.yaml top-level (sanity: lockfile exists)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Standard Stack §Supporting (NEW) — version pins `@supabase/supabase-js@^2.105.3`, `clamscan@^2.4.0`
  </read_first>
  <files>
    package.json
    pnpm-lock.yaml
  </files>
  <action>
    Run the single dependency install:

    ```bash
    pnpm add @supabase/supabase-js@^2 clamscan@^2
    ```

    Verify the resulting `package.json` has, under `dependencies`:
    - `"@supabase/supabase-js": "^2.105.3"` (or newer; carat lets pnpm choose latest 2.x)
    - `"clamscan": "^2.4.0"`

    Do NOT install dev-time @types/clamscan (the package ships its own types per RESEARCH).
    Do NOT install `react-dropzone` (forbidden by D-41 + CLAUDE.md "Forbidden" list).
    Do NOT install `@tanstack/react-table` (deferred to Phase 7 per RESEARCH §Standard Stack §Supporting line 181).

    Then run `pnpm install` (no-op if `pnpm add` already locked) and confirm lockfile updated.
  </action>
  <verify>
    <automated>grep -q '"@supabase/supabase-js"' package.json && grep -q '"clamscan"' package.json && ! grep -q '"react-dropzone"' package.json && ! grep -q '"@tanstack/react-table"' package.json && test -f pnpm-lock.yaml && pnpm install --frozen-lockfile 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '"@supabase/supabase-js"' package.json` returns 1 (exactly one entry in dependencies)
    - `grep -c '"clamscan"' package.json` returns 1
    - `grep -q '"react-dropzone"' package.json` exits non-zero (confirms forbidden dep absent)
    - `pnpm install --frozen-lockfile` exits 0
    - `node -e "require.resolve('@supabase/supabase-js')"` succeeds
    - `node -e "require.resolve('clamscan')"` succeeds
  </acceptance_criteria>
  <done>Both deps resolvable from the working tree; lockfile pinned.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Extend src/lib/env.ts with Supabase + ClamAV vars and document in .env.example</name>
  <read_first>
    - src/lib/env.ts (entire file — pattern for adding server-only keys + matching runtimeEnv entry)
    - .env.example (current content; do not rewrite, only append)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Files to Create / Modify §Modify line 1158
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-22 (CLAMAV TCP defaults — port 3310 on `clamav` host)
  </read_first>
  <files>
    src/lib/env.ts
    .env.example
  </files>
  <action>
    In `src/lib/env.ts`, inside the `server` zod object, append these keys (preserving alphabetical-ish ordering — group after `MEDICAL_ENCRYPTION_KEY`):

    ```typescript
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
    CLAMAV_HOST: z.string().min(1).default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    ```

    Then mirror them into `runtimeEnv`:

    ```typescript
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CLAMAV_HOST: process.env.CLAMAV_HOST,
    CLAMAV_PORT: process.env.CLAMAV_PORT,
    ```

    Rationale block in the JSDoc header at the top of the file: add one bullet under "Two Redis URLs":

    ```
    *  - SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (D-22, FILE-01): server-only
    *    Supabase Storage client used by file.upload + signed URL generation.
    *    NEVER bundle into client — see src/server/storage/client.ts header.
    *  - CLAMAV_HOST/CLAMAV_PORT (D-22): TCP socket for clamd; default
    *    'clamav':3310 matches the Coolify sidecar service name.
    ```

    In `.env.example`, append a new section at the end:

    ```
    # ── Supabase Storage (Phase 2, FILE-01) ─────────────────────────────
    # Service-role key bypasses Storage RLS — NEVER expose to client bundle.
    # Source: Supabase Dashboard -> Project Settings -> API -> service_role secret
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR...

    # ── ClamAV (Phase 2, VALID-04) ──────────────────────────────────────
    # Coolify sidecar service exposes clamd on TCP 3310 (D-22).
    # In dev without a sidecar, set CLAMAV_HOST=localhost and run
    # `docker run --rm -p 3310:3310 clamav/clamav:stable` for ad-hoc testing.
    CLAMAV_HOST=clamav
    CLAMAV_PORT=3310
    ```

    Do NOT add any NEXT_PUBLIC_SUPABASE_* keys (RESEARCH §Runtime State Inventory line 708 confirms the server-only path).
    Do NOT change `skipValidation` semantics.
  </action>
  <verify>
    <automated>grep -q "SUPABASE_SERVICE_ROLE_KEY: z\.string()\.min(40)" src/lib/env.ts && grep -q "CLAMAV_HOST: z\.string()" src/lib/env.ts && grep -q "CLAMAV_PORT: z\.coerce\.number()" src/lib/env.ts && grep -c "SUPABASE_URL" src/lib/env.ts | grep -q "^[23]$" && grep -q "^SUPABASE_URL=" .env.example && grep -q "^CLAMAV_HOST=" .env.example && ! grep -q "NEXT_PUBLIC_SUPABASE" src/lib/env.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/lib/env.ts` contains all 4 keys in BOTH the `server` and `runtimeEnv` blocks (8 mentions in total spread across the file)
    - `npx tsc --noEmit` exits 0
    - `.env.example` has a `# ── Supabase Storage` header and a `# ── ClamAV` header with the 4 KEY=value placeholders
    - `grep -v '^#' src/lib/env.ts | grep -c "NEXT_PUBLIC_SUPABASE"` returns 0 (no client-exposed Supabase keys)
  </acceptance_criteria>
  <done>Phase 2 code can `import { env } from '@/lib/env'` and reach `env.SUPABASE_SERVICE_ROLE_KEY` + `env.CLAMAV_HOST` with full type inference; missing-in-production fails at boot.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Expand log-redact-paths.ts to cover emergency-contact fields</name>
  <read_first>
    - src/lib/log-redact-paths.ts (entire file — Phase 1 already redacts phone/email/medical_*; this plan adds emergency_contact_*)
    - .planning/phases/01-fundament/01-CONTEXT.md §D-05 (or wherever Phase 1 documented the redact pattern)
    - tests/unit/log-redact-paths.test.ts (current shape — Phase 2 will extend this test in 02-15)
  </read_first>
  <files>
    src/lib/log-redact-paths.ts
  </files>
  <action>
    Append three new path patterns to the existing `REDACT_PATHS` const (or equivalent export). Pino redact accepts both camelCase and snake_case paths because the JSON shape can carry either; cover both forms.

    Add these path strings (preserve the existing array structure):

    ```
    '*.emergencyContactName',
    '*.emergencyContactPhone',
    '*.emergencyContactRelation',
    '*.emergency_contact_name',
    '*.emergency_contact_phone',
    '*.emergency_contact_relation',
    ```

    Rationale comment above the additions:

    ```typescript
    // Phase 2 (PLAYER-06): emergency contacts are minor-protected personal
    // data — never log raw values. Both casings covered because Drizzle
    // returns snake_case from raw queries and camelCase via the typed client.
    ```

    Do NOT add `*.address` / `*.street` / etc — addresses are not classed as redact-required per Phase 1 convention; they appear in audit logs as `newValues` and are part of the legitimate audit record.
    Do NOT change the existing entries.
  </action>
  <verify>
    <automated>grep -c "emergencyContactPhone\|emergency_contact_phone" src/lib/log-redact-paths.ts | grep -qE "^[2-9]" && grep -c "emergencyContactRelation\|emergency_contact_relation" src/lib/log-redact-paths.ts | grep -qE "^[2-9]" && npx tsc --noEmit 2>&1 | grep -v "^$" | (! grep -i error)</automated>
  </verify>
  <acceptance_criteria>
    - All six new path strings present (3 camelCase + 3 snake_case)
    - No existing redact entry removed (diff is purely additive)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Pino's redact engine drops emergency-contact values from every structured log line; CI test (extended in 02-15) will assert it.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Worker process ↔ env | Service-role key only readable by server runtime; Coolify Secrets enforces non-client scope |
| Application logs ↔ pino redactor | Untrusted user input (emergency contact name/phone) crosses into log capture path |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01-ENV-LEAK | Information Disclosure | `SUPABASE_SERVICE_ROLE_KEY` env var | mitigate | Declared only under `server` block in `src/lib/env.ts` (T3 env library refuses to bundle into client). No `NEXT_PUBLIC_` prefix anywhere. `import 'server-only'` directive on the future `src/server/storage/client.ts` adds Next.js-side guard (Pitfall 4, planned in 02-04). |
| T-02-01-LOG-PII | Information Disclosure | pino structured logs containing emergency-contact phone | mitigate | Add three camelCase + three snake_case redact paths in this plan; covered by unit test extension in 02-15. |
| T-02-01-CLAMAV-EXPOSURE | Tampering | CLAMAV_HOST/PORT env (could be set to attacker-controlled host) | accept | Operator controls Coolify Secrets; misconfiguration produces scan failures, not file acceptance (scan returns error → BullMQ retry → eventual `infected` mark). Documented in 02-16 deployment doc. |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `pnpm install --frozen-lockfile` exits 0
- `node -e "require('@supabase/supabase-js'); require('clamscan'); console.log('ok')"` prints `ok`
- `grep -c "SUPABASE_SERVICE_ROLE_KEY" src/lib/env.ts` returns ≥ 2 (server + runtimeEnv)
- `.env.example` documents all 4 new vars
</verification>

<success_criteria>
- Two new deps installed and locked
- Four new env vars validated at boot (typed access via `env.*`)
- Three emergency-contact field families redacted by pino
- Zero changes to existing Phase 1 env keys
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-01-SUMMARY.md` with the canonical 1-paragraph summary, listing exact versions installed and the 4 env-var keys.
</output>
