/**
 * Service-layer conflict redaction (D-57 + D-57b).
 *
 * The Postgres SECURITY DEFINER function `overlapping_events_for_users`
 * bypasses RLS to return ALL overlaps for the candidate participants
 * (cross-scope scheduling correctness — D-57). This module decides per
 * overlap row whether the calling user should see the FULL detail (title +
 * location + type label) or REDACTED detail (only type label + participant
 * name + time range).
 *
 * Redaction policy (D-57):
 *   detailMode = 'full' when ANY of:
 *     - caller.role is 'technical_director' or 'medical_staff'
 *     - caller is the creator of the conflicting event
 *       (created_by = caller.userId)
 *     - caller is a participant of the conflicting event
 *       (callerIsParticipantInConflicting === true)
 *   detailMode = 'redacted' otherwise.
 *
 * Redacted response shape (NEVER returns description, NEVER returns
 * extension-table columns — see Pitfall 6):
 *   {
 *     eventId: string | null,    // null when redacted to prevent enumeration
 *     participant: string,        // always returned — caller knows they
 *                                 // added them
 *     startsAt: Date,
 *     endsAt: Date,
 *     typeCode: string,           // always returned — needed for the
 *                                 // {typeLabel} placeholder
 *     detailMode: 'full' | 'redacted',
 *     title: string | null,       // null when redacted
 *     location: string | null,    // null when redacted
 *   }
 *
 * The UI then composes the copy from D-57b:
 *   nl: `**{participant}** is al geboekt voor {detail} {start}–{end}.
 *        Toch opslaan?`
 *   en: `**{participant}** is already booked for {detail} {start}–{end}.
 *        Save anyway?`
 *   fr: `**{participant}** est déjà réservé pour {detail} {start}–{end}.
 *        Enregistrer quand même ?`
 *
 * Where `{detail}`:
 *   detailMode='full'     → `**{title}** ({typeLabel})`
 *   detailMode='redacted' → `een **{typeLabel}**` (nl) / `a **{typeLabel}**`
 *                           (en) / `un **{typeLabel}**` (fr)
 *
 * Reference: .planning/phases/03-kalender/03-CONTEXT.md D-57 + D-57b
 *            .planning/phases/03-kalender/03-RESEARCH.md §Pattern 4 +
 *            §Example 3
 *            drizzle/0011_phase3_calendar_rls_policies.sql
 *            overlapping_events_for_users()
 */
import type { Role } from '@/server/auth/permissions';

/** A row from the SECURITY DEFINER `overlapping_events_for_users()` function. */
export interface OverlapRow {
  eventId: string;
  userId: string;
  typeCode: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  createdBy: string;
}

/** Caller context fed into the redaction decision. */
export interface CallerForRedaction {
  userId: string;
  role: Role;
}

/** Whether the caller is a participant of the conflicting event. Computed
 *  by the caller (one SQL probe per overlap row) and passed in. The
 *  redaction function itself stays a pure function — no DB access. */
export interface OverlapWithMembership extends OverlapRow {
  callerIsParticipantInConflicting: boolean;
}

/** Redacted conflict shape returned to the client. */
export interface RedactedConflict {
  eventId: string | null;
  /** Resolved display name — caller passes it in (they already know it). */
  participant: string;
  startsAt: Date;
  endsAt: Date;
  typeCode: string;
  detailMode: 'full' | 'redacted';
  title: string | null;
  location: string | null;
}

/**
 * Pure function: returns the RedactedConflict shape for one overlap row.
 *
 * Inputs are explicit — no DB access; the calling code (calendar.ts router
 * or tests) supplies `callerIsParticipantInConflicting` after running the
 * membership probe and `participantDisplayName` after resolving the user's
 * display name.
 */
export function redactConflict(
  row: OverlapWithMembership,
  caller: CallerForRedaction,
  participantDisplayName: string,
): RedactedConflict {
  const fullVisibility =
    caller.role === 'technical_director' ||
    caller.role === 'medical_staff' ||
    row.createdBy === caller.userId ||
    row.callerIsParticipantInConflicting;

  if (fullVisibility) {
    return {
      eventId: row.eventId,
      participant: participantDisplayName,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      typeCode: row.typeCode,
      detailMode: 'full',
      title: row.title,
      location: row.location,
    };
  }

  return {
    // eventId blanked when redacted — prevents enumeration of out-of-scope
    // event ids.
    eventId: null,
    participant: participantDisplayName,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    typeCode: row.typeCode,
    detailMode: 'redacted',
    title: null,
    location: null,
  };
}

/**
 * Convenience: bulk-redact an array of overlap rows.
 */
export function redactConflicts(
  rows: ReadonlyArray<OverlapWithMembership>,
  caller: CallerForRedaction,
  displayNameByUserId: Record<string, string>,
): RedactedConflict[] {
  return rows.map((row) =>
    redactConflict(row, caller, displayNameByUserId[row.userId] ?? row.userId),
  );
}

/**
 * Decide whether to call this row a conflict at all. v1 D-57 returns ALL
 * overlaps (including TD's own creations) — UI just shows them. This helper
 * exists so future phases can filter out self-conflicts (e.g. a meeting at
 * the same time as another meeting both created by the caller — debatably
 * not a "real" conflict).
 *
 * Phase 3 returns true for every row — keep contract permissive.
 */
export function shouldFlagAsConflict(_row: OverlapRow): boolean {
  return true;
}
