# GDPR Erasure Strategy (GDPR-06, GDPR-07, CRIT-5)

This document defines what happens to user data when a data subject exercises Article 17 (right to erasure). It exists because Belgian law has two overlapping requirements that contradict each other if you implement either one naively:

- **GDPR Article 17** — the data subject can demand erasure of their personal data.
- **GDPR Article 5(2) + Article 7(3)** — the controller MUST be able to demonstrate the lawfulness of past processing, including which consent text the data subject saw and when.
- **Belgian Patient Rights Act** — medical records are subject to a 30-year retention obligation (OPS-10 in REQUIREMENTS.md), with patient-requested deletion permitted under specific conditions.

A single "delete user" function that cascades through every table breaks the consent-proof requirement. A single "anonymize" function that updates everything in place leaks medical data through linkage. We resolve the tension by splitting tables into three classes with different erasure semantics. The design is encoded into the schema's foreign-key cascade rules so that any deviation from the procedure surfaces as a Postgres `RESTRICT` error rather than silent data loss.

## Class A — Hard delete on erasure (medical_*)

**Tables:** `medical_events`, `medical_documents`, plus the subject-side reference in `medical_access_audit`.

**Rationale:** Article 9 special-category data has no aggregate-statistics value once detached from its subject — anonymized medical events cannot inform rankings or training plans. Belgian law allows medical records to be deleted on patient request when (a) the legal retention period has elapsed, or (b) earlier with explicit consent of the patient, AND (c) no ongoing treatment or insurance dispute requires retention. The TD erasure UI (Phase 7) collects an attestation from the data subject before invoking the Class-A path.

**Implementation:**

```sql
-- Hard delete the medical content itself.
DELETE FROM medical_documents WHERE player_user_id = $user;
DELETE FROM medical_events WHERE player_user_id = $user;

-- The audit trail of WHO accessed WHAT survives the data subject's erasure.
-- This is a legal-hold requirement: if a coach accessed a medical event in
-- 2024 and the player erases their record in 2026, the access record must
-- still exist for the 2024 audit period. We anonymize the subject pointer
-- but keep the row.
UPDATE medical_access_audit
   SET subject_player_id = NULL
 WHERE subject_player_id = $user;
```

The CASCADE rule on `medical_documents.medical_event_id → medical_events(id)` means deleting the parent event also deletes attached scans/PDFs in the same statement (no orphaned binaries). The `RESTRICT` rule on `medical_events.player_user_id → users(id)` is the safety net that forces the erasure procedure to delete medical rows BEFORE the user row — if you skip it, Postgres throws a foreign-key violation.

## Class B — Anonymize (most personal data)

**Tables:** `users`, `sessions`, `accounts`, `audit_log` (actor side), and most domain tables added in Phase 2+ (training participations, evaluations, ranking entries, tournament results, ambitions).

**Rationale:** Aggregate statistics survive after PII removal. A historical ranking entry without a name still teaches us the distribution of Belgian youth rankings in 2024. A training participation count without an identifier still informs academy-level analytics. Anonymization preserves these aggregates while removing the data subject's identifiability.

**Implementation:**

```sql
-- Replace user PII with anonymized markers.
UPDATE users
   SET email            = 'erased-' || id || '@vttl.invalid',
       name             = 'Erased User',
       image            = NULL,
       date_of_birth    = NULL,
       active           = false,
       deactivated_at   = now(),
       preferred_locale = 'nl'  -- enum NOT NULL — keep the default
 WHERE id = $user;

-- Sessions and OAuth provider links are pure auth state — hard delete.
DELETE FROM sessions WHERE user_id = $user;
DELETE FROM accounts WHERE user_id = $user;

-- Audit log: anonymize the actor pointer but keep the row. The action record
-- itself (login, role change, medical access) remains for the security
-- accountability audit; the attribution to a specific user is destroyed.
UPDATE audit_log
   SET actor_user_id = NULL
 WHERE actor_user_id = $user;
```

The marker email pattern `erased-<uuid>@vttl.invalid` is intentional: `.invalid` is reserved by RFC 6761 so the address can never collide with a real domain. The UUID suffix prevents linkage between two erased users (no two erased users share the same email). `NULL` would also work but `NULL` complicates uniqueness constraints elsewhere; the marker pattern preserves the not-null invariant.

## Class C — Preserve as legal record (consent_records)

**Tables:** `consent_records`, `parent_child_links`.

**Rationale:** GDPR Article 5(2) — the accountability principle — requires the controller to be able to demonstrate lawful processing. Article 7(1) further requires us to be able to show "in a clearly distinguishable manner" that consent was freely given, specific, informed and unambiguous. Deleting the consent record destroys our defense for actions taken in the past while consent was valid.

Article 7(3) is the relevant carve-out: "the data subject shall have the right to withdraw his or her consent at any time. The withdrawal of consent shall not affect the lawfulness of processing based on consent before its withdrawal." This is the legal basis for marking the record withdrawn but preserving it.

**Implementation:**

```sql
-- Mark consent withdrawn — DO NOT delete the row.
UPDATE consent_records
   SET withdrawn_at = now()
 WHERE user_id = $user
   AND withdrawn_at IS NULL;

-- consent_text_snapshot, sha256, policy_version, locale, given_at all
-- preserved (per Phase 1 decisions D-04..D-07).
```

`parent_child_links` rows referencing the user can be hard-deleted ONLY when both parent and child are erased. As long as one party still exists in the system, the link is preserved (anonymized on the erased side via the FK to the anonymized `users` row). This protects the surviving party's audit trail — a parent who erases their account should not be able to retroactively destroy the proof that they once consented to processing on behalf of their child.

## Cascade rules summary

This table is the contract between the schema (Plan 02–04) and this strategy. Any deviation requires updating both this doc AND the schema migration in the same PR.

| Table | Foreign Key | onDelete | Class | Notes |
|-------|-------------|----------|-------|-------|
| `medical_events.player_user_id` | `users(id)` | `RESTRICT` | A | Forces hard delete BEFORE user |
| `medical_documents.player_user_id` | `users(id)` | `RESTRICT` | A | Forces hard delete BEFORE user |
| `medical_documents.medical_event_id` | `medical_events(id)` | `CASCADE` | A | Attached files follow parent |
| `medical_access_audit.subject_player_id` | `users(id)` | `SET NULL` | A* | Audit trail survives subject erasure |
| `parent_child_links.parent_user_id` | `users(id)` | `RESTRICT` | C | Surviving party's audit trail |
| `parent_child_links.child_user_id` | `users(id)` | `RESTRICT` | C | Surviving party's audit trail |
| `sessions.user_id` | `users(id)` | `CASCADE` | B | Pure auth state — drop with user |
| `accounts.user_id` | `users(id)` | `CASCADE` | B | OAuth links — drop with user |
| `consent_records.user_id` | `users(id)` | `RESTRICT` | C | Legal record — never auto-delete |
| `audit_log.actor_user_id` | `users(id)` | `SET NULL` | B* | Action survives, attribution removed |

The `RESTRICT` rules force the erasure procedure to follow the explicit class-A → class-B → class-C order, surfacing any deviation as a Postgres error rather than silent data loss. The `SET NULL` rules on the audit-trail tables deliberately weaken the FK semantics so the audit row can outlive the user.

## Implementation timeline

- **Phase 1 (this phase):** documents the strategy + cascade rules in schema (Plan 02–04). UI design pending.
- **Phase 7 (Synthese):** `/mijn-gegevens` export UI (GDPR-05) + TD erasure UI (GDPR-06) implemented as multi-step server actions wrapping the SQL above. Each erasure runs inside a single transaction (BEGIN…COMMIT) so a failure mid-procedure doesn't leave a half-erased user.
- **Phase 8:** DPIA + erasure runbook reviewed by external counsel. Belgian DPA breach-notification template wired up. The marker email format and the `withdrawn_at` semantics may be adjusted based on counsel's review — this doc is the staging ground for that conversation.

## Open questions for legal review

These are flagged here so the Phase 8 legal-review checklist can address them rather than discovering them during the DPIA:

1. **Confirmation of the 30-year retention** for medical records under the Belgian Patient Rights Act vs. earlier deletion under explicit patient consent — what evidence does the patient need to provide?
2. **Cross-jurisdictional access** for French-speaking users in Wallonia — does the same Class-A treatment apply, or does Walloon law diverge?
3. **Minor athletes** under 16: when the minor turns 16 and provides their own consent (D-07 transition), what becomes of the guardian's consent record? Current design preserves it as historical proof, but legal counsel may require explicit handover language in the consent text.
4. **Marker email collision risk** with `.invalid` TLD — RFC 6761 reserves it but some MTAs may still attempt delivery; confirm Resend's handling.

## References

- `.planning/REQUIREMENTS.md` §GDPR — full requirement list including GDPR-06, GDPR-07.
- `.planning/PITFALLS-ADDITIONS.md` §CRIT-5 — the original "erasure not designed" pitfall this doc closes.
- `.planning/phases/01-fundament/01-CONTEXT.md` D-04..D-07 — `consent_records` snapshot decisions that inform Class C.
- `docs/migration-runbook.md` — every migration that adds a new personal-data column needs an erasure-class assignment in this doc before merge.
- Belgian Wet 30 juli 2018 — national GDPR implementation.
- Belgian Patient Rights Act — 30-year medical retention obligation.
