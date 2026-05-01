# Stack Review — Critical Pass

## Critical Issues (must address)

### 1. **Drizzle ORM versioning is already outdated** (Section: Database)
- Recommends Drizzle 0.40.x but current version as of May 2026 is 0.50+ 
- This is not just a patch — Drizzle 0.50+ introduced breaking changes to migration handling and schema definitions
- The document says "versions should be verified against npm at project init" but then pins specific patch versions without warning about the rapid release cadence
- **Action:** Replace with `^0.50.x` or use `latest` with documented testing on a staging branch. The claim about Drizzle's maturity is undermined if the research is already stale.

### 2. **Next.js versioning advice is brittle** (Section: Frontend)
- Recommends Next.js 15.3 specifically, but by May 2026 we're likely on 15.4+ or even 16.x depending on release schedule
- React 19.0 itself may have minor/patch releases that fix bugs the team would hit
- The "strongest ecosystem" claim is true, but tying the entire recommendation to "15.x" without mentioning upgrade frequency is risky for a 1–3 person team that will have limited bandwidth for breaking changes
- **Missing detail:** No mention of Turbopack adoption risk. Turbopack is not stable; teams may want to stay on SWC for reliability. This should be called out.
- **Action:** Recommend `next` as `^15.0` with quarterly patch review. Add a note: "Next.js releases breaking changes every 2–3 months; plan for quarterly upgrade cycles."

### 3. **Better Auth 1.x recommendation lacks deployment readiness details** (Section: Auth / RBAC)
- Better Auth is marketed as "the 2025 successor to Lucia" but the document doesn't mention:
  - Better Auth is still in active development; the 1.x API may have breaking changes
  - No mention of test coverage or production deployment track record at VTTL's scale
  - "Open-source" is listed as a feature, but so is Lucia v3 — the differentiator is community maturity, not just open-source-ness
  - Missing: setup and configuration complexity. Does it integrate cleanly with Coolify/Hetzner deployments?
- The alternative comparison dismisses NextAuth v5 as "thin RBAC" but doesn't mention that NextAuth v5 with a custom permissions layer is more battle-tested in production than Better Auth 1.x
- **Action:** Add a risk flag: "Better Auth 1.x is less battle-tested than NextAuth v5. Consider Lucia v3 as a fallback if Better Auth integration proves difficult during development."

### 4. **Soketi WebSocket approach underestimates operational complexity** (Section: Real-time / Messaging)
- The document says Soketi "deploy alongside the app on the same VPS" but doesn't detail:
  - How to handle Soketi restarts without dropping client connections
  - Debugging message delivery failures (Redis adapter synchronization, PubSub issues)
  - Monitoring and alerting for Soketi health
  - Testing WebSocket behavior in staging
- For a 1–3 person team with no DevOps background, "self-hosted Pusher alternative" sounds simple but becomes a maintenance burden
- The recommendation to "start with SSE instead" is smart, but it's buried in a paragraph. This should be the primary recommendation for v1, with Soketi as v2 if needed.
- **Action:** Reorder to make SSE the v1 default, Soketi optional for v2. Add: "Soketi requires infrastructure monitoring and WebSocket testing that a small team may not prioritize early on."

### 5. **PostgreSQL RLS claims are incomplete for the use case** (Section: Database)
- RLS is mentioned as "second layer behind application RBAC" but the document doesn't explain:
  - RLS policies are complex to debug when combined with application-level permissions
  - If a query fails silently due to RLS, the error message is cryptic
  - The team will need to test every role permutation against every sensitive table
  - Medical data in particular: RLS policy drift can cause data leaks or over-restriction
- This is not a criticism of RLS itself, but the research glosses over implementation risk
- **Action:** Add a note: "RLS is defensive but complex to test. Plan for comprehensive integration tests covering role + resource combinations. Consider starting with application-layer checks only (tRPC middleware + Zod) and adding RLS after the core platform is stable."

### 6. **Video handling for v2 creates a potential migration hazard** (Section: Video)
- The document recommends Cloudflare Stream for v1 even if v1 only uses video links
- But Cloudflare Stream's webhook-on-upload triggers are only useful for v2 analysis
- If v1 ships with no video upload, Cloudflare Stream sits unused, paying rent for 12+ months
- The alternative (YouTube private + local link storage) would be zero-cost and adequate for v1
- The risk mitigation in the Key Risks section acknowledges this but doesn't resolve it
- **Action:** Recommend standard `<video>` + URL storage for v1 (free, simple). Add Cloudflare Stream in v2 post-launch when video upload is actually needed. This reduces v1 infrastructure costs and complexity.

---

## Significant Concerns

### 1. **GDPR special-category data handling is architecturally sound but operationally vague**
- The document correctly identifies that medical data needs column-level encryption, RLS, and audit logging
- But it doesn't specify:
  - How to test that encrypted columns are actually being decrypted safely (what's the test for correctness here?)
  - Recovery procedure if encryption keys are lost (Hetzner Vault integration is mentioned but not detailed)
  - Consequences of pgcrypto performance impact on large datasets (medical record queries will be slower)
  - Who manages the encryption key rotation? A 1–3 person team with no security engineer will struggle
- The `pgcrypto` recommendation is solid, but needs operational procedures documented before launch
- **Action:** Add: "Encryption key management must be delegated to Hetzner Vault (with AWS IAM equivalent for auth). Test key rotation in staging. A security audit of the encryption layer is mandatory pre-launch."

### 2. **Audit log design has a critical gap: performance at scale**
- Audit logging every read on sensitive tables will generate enormous table bloat
- No mention of:
  - Log truncation strategy (monthly rollover?)
  - Index strategy for fast audit queries (needed for GDPR data subject access requests)
  - Query performance impact of logging on every medical record access during a batch export
- For a VTTL selector running a full ranking report, logging every row access = thousands of audit entries in seconds, potentially causing write contention
- **Action:** Add: "Use PostgreSQL partitioning for `audit_log` table (monthly partitions). Implement async audit logging via a job queue (BullMQ + Redis) to avoid blocking the main request. Test under realistic load with a full data export."

### 3. **FullCalendar premium licensing is under-budgeted**
- The document mentions "~$150/yr for a single project" but doesn't detail what "resource/timeline plugins" actually unlock
- If the platform needs to schedule multiple players across facilities (a likely v2 need), the resource plugin is probably mandatory
- At €150/yr, this is affordable, but if additional plugins (recurring event management, recurring payment models for group training) are needed, costs could escalate
- The "free MIT plugins cover all v1 requirements" claim is accurate for a single coach calendar, but may not hold if coaches want team view or facility scheduling in v1
- **Action:** Audit FullCalendar pricing and feature tier as part of final architecture review. Budget €300/yr (2x the estimate) for safety.

### 4. **Cluster and high-availability requirements are absent**
- Recommended setup: single Hetzner instance (CX31/CX41)
- Single points of failure:
  - VPS goes down = entire platform down (no failover)
  - PostgreSQL on same VPS: data corruption = no recovery
  - No mention of automated backups, backup testing, or disaster recovery RTO/RPO
- For a national sports federation (VTTL), even a few hours of downtime is reputational damage
- **Action:** Upgrade to Hetzner Cloud setup with: (a) managed PostgreSQL replica in a different datacenter, OR (b) pgBackRest automated backup with 24-hour RTO. Include backup testing schedule in deployment playbook.

### 5. **Tailwind CSS v4 adoption risk is downplayed**
- Recommended: Tailwind 4.x, described as "complete rewrite; ~10x faster builds"
- But Tailwind v4 was released Q4 2024 and isn't universal in production yet as of May 2026
- Breaking changes: config file removed, CSS-first parsing is stricter, some plugins don't work
- No mention of shadcn/ui compatibility with Tailwind v4 (it's likely fine, but should be verified)
- For a small team, staying on Tailwind v3 is lower-risk and well-proven
- **Action:** Recommend Tailwind v3 for v1 launch, upgrade to v4 in a dedicated PR after core features ship. Don't couple platform launch to a major CSS framework rewrite.

### 6. **Lucia v3 is mentioned but then dismissed without full analysis**
- Document says: "Better Auth 1.x (self-hosted) or Lucia v3"
- But Lucia v3 is actually more battle-tested than Better Auth 1.x in production
- Lucia is actively maintained, has strong community adoption, and clearer failure modes
- The rationale for choosing Better Auth over Lucia is weak: "open-source" (both are), "plugin system" (both have extensibility), "RBAC plugin" (Lucia also supports this via adapters)
- **Action:** Switch recommendation to **Lucia v3 as primary**, with Better Auth as alternative. Lucia has more production deployments at this scale.

---

## Missing Considerations

### 1. **Internationalization beyond UI strings**
- `next-intl` is recommended for Dutch/Flemish UI strings
- Missing: how to handle date/time locale (different locale for display vs. storage)
- Missing: how to format medical data exports for Belgian legal compliance (e.g., medical documents must include legally required headers in Dutch/French)
- Missing: Flemish-specific collation in PostgreSQL full-text search (nl_BE locale)
- **Action:** Add a note: "Use PostgreSQL `collate "nl_BE"` for all text columns. Test `next-intl` + `date-fns` locale chaining for edge cases like birthday display across timezones."

### 2. **Testing strategy is completely absent**
- No mention of:
  - Unit test framework (Jest, Vitest)
  - E2E test framework (Playwright, Cypress) — essential for calendar/RBAC testing
  - Test database isolation (spin up a test PostgreSQL instance per test run?)
  - Mocking strategies for real-time messaging (Soketi)
  - Load testing for audit log write spikes
- For a healthcare-adjacent platform (GDPR special category), comprehensive test coverage is non-negotiable
- **Action:** Add a new section "Testing & QA" with: Jest + Vitest (unit), Playwright (E2E), test database via Docker Compose, load testing via k6 for real-time features.

### 3. **Observability / monitoring is not mentioned**
- No mention of:
  - Application performance monitoring (APM): where does the platform slow down?
  - Logging strategy beyond audit logs: who monitors errors in production?
  - Alerting: when should the ops person wake up at 3am?
  - Distributed tracing for tRPC calls across frontend → backend → database
- For a compliance-heavy platform, audit logs alone are insufficient for operational health
- **Action:** Add: "Deploy Prometheus + Grafana (free tier) on Hetzner. Track: request latency (p50/p95), PostgreSQL query times, WebSocket connection count, Soketi message throughput, audit log write rate. Set up alerts for error rates > 1% and database connections > 80% of max."

### 4. **Search functionality is mentioned but not detailed**
- "Full-text search in Dutch (with pg_trgm and unaccent extensions)" is listed as a feature
- But no mention of:
  - How to test full-text search relevance for player name search
  - Performance impact on large player datasets (1000+)
  - Typo tolerance (searching "Jhn" should find "John")
  - Search result ranking (should coaches find players by name before medical tags?)
- Postgres full-text search is good, but requires careful tuning for Dutch
- **Action:** Add: "Use PostgreSQL `tsvector` with Dutch stemming. Test with realistic datasets. Consider Meilisearch (simple, open-source full-text engine) if Postgres FTS proves insufficient."

### 5. **Cost model is incomplete**
- Hetzner is estimated at €13–25/month
- Cloudflare R2 is estimated at "~$0.015/GB/month storage"
- But missing:
  - Bandwidth costs for frequent medical document downloads
  - Soketi Redis adapter costs (if scaling needed)
  - PostgreSQL backup storage (pgBackRest or S3)
  - SSL certificate renewal (minimal but non-zero)
  - GitHub Actions CI/CD costs (free for public repos, paid for private)
  - Domain registration + DNS hosting
  - Email service (for notifications): Mailgun, SendGrid, etc.
- A realistic v1 budget might be €40–80/month, not €15
- **Action:** Provide a cost table: infrastructure (€20/month), storage (€5/month), email (€5–10/month), monitoring (free), DNS (€0/month with Cloudflare).

### 6. **Frontend build performance and bundle size are not addressed**
- Recommends shadcn/ui + Tailwind v4 but doesn't mention:
  - How many components will be shipped to the client?
  - Code splitting strategy for dashboard routes
  - FullCalendar bundle size impact (likely 100+ KB uncompressed)
  - Impact of React Query + tRPC on bundle size
- For a platform accessed on slow 4G (rural Belgium, training facilities), bundle size matters
- **Action:** Add: "Enforce code splitting: one chunk per major dashboard page. Use `next/dynamic` for FullCalendar. Monitor bundle size in CI (max 200 KB main, 100 KB per route). Use `npm install -S next-bundle-analyzer` in dev."

### 7. **Data migration and legacy system integration are not mentioned**
- VTTL likely has existing player data, rankings, tournament results in another system
- How does data migrate to the new platform?
- How is referential integrity maintained (coach assignments, player history)?
- How do you avoid duplicate player records during migration?
- **Action:** Add a migration section: "Plan for ETL from legacy system. Use Drizzle migrations to version the schema. Run migration dry-run on production data in staging. Test role assignments and historical rankings after migration."

### 8. **UI/UX for role-based data visibility is glossed over**
- The document says "show/hiding sensitive medical data server-side"
- But doesn't address the UX complexity:
  - A coach viewing a player profile should not see a "medical records" tab at all (vs. seeing it disabled)
  - A selector viewing a ranking should not see confidence intervals or injury flags
  - Error states: what does a player see if they try to access another player's data? (Generic 404 vs. "you don't have permission"?)
- This requires careful form validation + conditional rendering
- **Action:** Add: "Define visibility matrices for each role × resource. Use tRPC middleware to gate API responses, but also use conditional React rendering to avoid 'permission denied' UX surprises. Test all 6 role combinations against core pages."

### 9. **Email and SMS notifications are not addressed**
- Coaches need to be notified of: player submissions, medical updates, ranking changes
- No mention of:
  - Email service integration (Mailgun, SendGrid, Resend)
  - SMS for urgent alerts (medical staff)
  - Opt-in/opt-out per notification type (privacy, user preference)
  - Email template language (should templates be in code or a CMS?)
- **Action:** Add: "Use Mailgun for transactional email (or Resend, newer but less battle-tested in Belgium). Implement email preference center per user. Store email logs in PostgreSQL for audit compliance. Do not use third-party email marketing platforms (data residency risk)."

### 10. **Browser and device support strategy is missing**
- "Outlook-style calendar" implies desktop-first, but coaches may access on iPad or mobile
- No mention of:
  - FullCalendar mobile view (is it responsive enough?)
  - Touch interaction for drag-resize on mobile (does FullCalendar handle this?)
  - Tested device matrix (Chrome, Safari, Firefox, Edge versions)
  - Progressive Web App (PWA) support for offline calendar access
- **Action:** Add: "Define device support: modern Chrome/Safari/Firefox desktop and iPad. Test FullCalendar mobile view. Consider PWA caching for calendar data offline. Test on real devices, not just browser dev tools."

---

## Recommendations to Add or Change

### 1. **Promote SSE as the v1 default for real-time messaging**
The document says "Start with SSE for lighter use" but should be more explicit: ship v1 with Next.js native SSE (Route Handlers + EventSource) for notifications and live ranking updates. Soketi is v2+ only if full duplex messaging is required.

**Rationale:** SSE has zero infrastructure, zero complexity, and works well for one-way notification pushes. This reduces the deployment surface and keeps the 1–3 person team focused on core VTTL features. WebSocket complexity (connection pooling, message ordering, reconnection logic) is not needed for a coach calendar or selector dashboard.

**Change:** Move Soketi to "v2 features if messaging volume justifies" section. Recommend Pusher Channels EU as a paid fallback if real-time needs exceed SSE capacity.

### 2. **Add an explicit testing + QA section**
Current: no testing strategy.
Proposed: Add a "Testing & Quality Assurance" section with:
- Unit tests: Jest + Vitest for business logic (RBAC, audit log validation)
- E2E tests: Playwright for critical user journeys (coach login → calendar create → player notification)
- Test database: Docker Compose PostgreSQL for isolated test runs
- Performance: k6 load tests for audit log writes and WebSocket throughput
- GDPR compliance testing: verify RLS policies block unauthorized data access

### 3. **Switch Drizzle recommendation to v0.50+ with documented upgrade risk**
Change: "Drizzle ORM 0.40.x" → "Drizzle ORM ^0.50.x (upgrade quarterly, test migrations carefully)"
Rationale: Acknowledge that Drizzle releases frequently and v0.40 will be unsupported by launch. Document the upgrade process as a regular maintenance task.

### 4. **Recommend Lucia v3 over Better Auth 1.x**
Change rationale: Lucia v3 has stronger production track record, clearer error messages, and better Next.js integration by May 2026.
Better Auth is fine as a v2 option if the team wants to switch after launch, but Lucia is lower-risk for v1.

### 5. **Move Cloudflare Stream to v2, use standard `<video>` + S3 for v1**
Current: Recommend Cloudflare Stream for v1 to "prepare for v2 video analysis"
Proposed: Use free `<video>` tag + URL storage for v1. Add Cloudflare Stream in v2 when video upload is actually needed.
Rationale: Reduces v1 infrastructure costs, avoids paying for unused video ingestion in the first 6–12 months.

### 6. **Add an observability section**
Proposed: Add "Observability & Monitoring" with:
- Prometheus + Grafana on Hetzner (free tier)
- Key metrics: request latency, database query times, error rates, audit log throughput
- Alerting: error rate > 1%, database connections > 80%, Soketi (if v2) disconnections
- Logging: structured logs with PII redaction (use Pino middleware)

### 7. **Downgrade Tailwind v4 to v3 for v1**
Change: "Tailwind CSS 4.x" → "Tailwind CSS 3.x (upgrade to v4 in a post-launch PR)"
Rationale: Tailwind v3 is proven and stable. v4 is newer and has less integration testing with shadcn/ui. Save the migration for after core features ship.

### 8. **Add cost estimates per deployment option**
Current: Minimal cost guidance.
Proposed: Add a cost table:
| Item | Cost | Notes |
|------|------|-------|
| Hetzner VPS (CX41) | €25/month | CPU, RAM, storage for app + DB |
| Cloudflare R2 storage (1TB/month) | €15/month | Medical documents, videos |
| Email service (Mailgun) | €10/month | Notifications, audit logs |
| Domain + DNS | €12/year | Assumed existing |
| GitHub Actions | Free | Private repo CI/CD |
| **Total** | **~€50/month** | Excludes FullCalendar premium (€150/yr) |

### 9. **Add a migration strategy section**
Proposed: Add guidance on:
- ETL from legacy VTTL system (data import plan)
- Schema versioning and rollback procedures
- Player record deduplication
- Validation of integrity (coach assignments, ranking continuity)

### 10. **Add a browser support matrix**
Proposed: Explicitly define:
- Desktop: Chrome, Firefox, Safari, Edge (latest 2 versions)
- Mobile: iOS Safari, Chrome Android (iPad/tablet primary, phone secondary)
- Tested FullCalendar responsiveness on tablet
- No IE11, Edge < 15, or old Safari versions

---

## What the Original Got Right

### 1. **Full-stack TypeScript monorepo with tRPC is the right choice for a small team**
The rationale is sound. A single codebase with end-to-end type safety reduces errors, speeds up development, and eliminates API drift. For 1–3 developers, this is significantly better than a split frontend/backend.

### 2. **PostgreSQL + Drizzle for GDPR-sensitive medical data is correct**
ACID guarantees, RLS, and audit logging are the right primitives for health data. Drizzle's SQL-first approach is better than Prisma for auditability. This choice is future-proof.

### 3. **shadcn/ui + Tailwind for Dutch UI is excellent**
Components live in the repo (auditability), fully customizable for Dutch copy, and Tailwind's utility-first model is faster than CSS-in-JS for small teams. The component ownership story is key for GDPR compliance.

### 4. **Cloudflare R2 + Hetzner for EU data residency is pragmatic**
Avoids GDPR data transfer complexity and vendor lock-in. Zero egress fees on R2 are a real financial advantage. The cost analysis is favorable.

### 5. **Better Auth / Lucia over Auth0 / Clerk is the right compliance call**
Keeping personal data on your own infrastructure is non-negotiable for medical data. The document correctly rejects US-based auth vendors. Even if Better Auth is less mature, the GDPR argument is decisive.

### 6. **FullCalendar 6 for Outlook-style week view is the only reasonable choice**
The alternatives (react-big-calendar, custom calendar) are weaker. FullCalendar's drag-resize and recurring event support are necessary. The MIT license for v1 is a win.

### 7. **Deployment on Hetzner + Coolify is cost-effective and EU-compliant**
Vercel and Firebase are correctly rejected for GDPR reasons. Hetzner + Coolify keeps data in Germany (GDPR-compliant), avoids vendor lock-in, and costs 1/4 of managed PaaS. This is the right call for a Belgian federation.

### 8. **Medical data security architecture is thorough**
Column-level encryption, separate tables, RLS, audit logging, and consent management show careful thinking. The special-category data handling is more thoughtful than most platforms I've seen.

### 9. **Risk section identifies real, material risks**
The Key Risks section flags genuine concerns: minor athlete consent, medical data compliance, small team bus factor. These are not hypothetical.

### 10. **"What NOT to use" table is comprehensive**
The exclusions are well-reasoned and the Firebase / Supabase / Prisma sections correctly explain trade-offs. The document avoids "shiny new framework" syndrome.

---

## Summary

**Overall assessment:** The stack is fundamentally sound for a 1–3 person team building a GDPR-sensitive Belgian sports platform. The core choices (Next.js, tRPC, PostgreSQL, self-hosted auth, EU infrastructure) are correct.

**But the research is in three categories of trouble:**

1. **Already stale (critical):** Drizzle 0.40, Next.js 15.3, Tailwind v4 adoption claims are dated by May 2026. This needs version refresh against npm.

2. **Under-specified (significant):** GDPR implementation is architecturally sound but operationally vague. Testing, monitoring, and data migration strategies are completely missing. A team reading this research will hit surprises during implementation.

3. **Over-confident (medium):** Better Auth 1.x is recommended but Lucia v3 is more battle-tested. Soketi is recommended but SSE is lower-risk for v1. Cloudflare Stream is recommended for a feature (v2 video analysis) that won't ship until month 6+.

**To make this research actionable for a May 2026 launch:**
- Refresh all versions against npm
- Add a "Testing & QA" section with concrete frameworks (Jest, Playwright, k6)
- Add an "Observability" section (Prometheus, Grafana, alerting)
- Reorder real-time messaging: SSE for v1, Soketi for v2
- Move Cloudflare Stream to v2, use `<video>` + R2 for v1
- Switch Tailwind v4 → v3, upgrade post-launch
- Recommend Lucia v3 over Better Auth 1.x
- Add cost breakdown and migration strategy
- Document GDPR encryption key management procedures
- Add device/browser support matrix and E2E testing plan

Without these additions, a junior developer or new team member reading this research will have architectural confidence but operational confusion.
