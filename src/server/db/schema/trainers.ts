/**
 * trainers (Phase 2).
 *
 * Same 1:0..1-to-users pattern as players (D-26). Trainer↔academy is N:N
 * via the existing `academy_memberships` junction with `role='trainer'`
 * (D-35) — no new junction table here. RLS in 02-05 calls
 * `players_visible_to()` for trainer-scoped player reads.
 *
 * Trainer profile shape mirrors players (D-26..D-27) minus the emergency
 * contact (trainers are always adults — that's a PLAYER-06 concern, never
 * TRAINER-01..02). Sport qualifications per TRAINER-02:
 *  - `diploma_code` — FK to the new `trainer_diploma` lookup (5 codes)
 *  - `has_pedagogical_qualification` — boolean toggle, default false
 *
 * Profile photo (D-29) reuses the same `profile_photo_file_id` →
 * `uploaded_files.id ON DELETE SET NULL` pattern as players.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §B + §D
 */
import { boolean, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import { uploadedFiles } from './files';
import { trainerDiploma } from './lookups';

export const trainers = pgTable(
  'trainers',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    gender: text('gender').notNull(),
    // ─── Address (D-27, flat columns) ───
    street: text('street').notNull(),
    streetNumber: text('street_number'),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    province: text('province').notNull(),
    country: text('country').notNull().default('BE'),
    phone: text('phone'),
    email: text('email'),
    // ─── Sport qualifications (TRAINER-02, D-38) ───
    diplomaCode: text('diploma_code')
      .notNull()
      .references(() => trainerDiploma.code, { onDelete: 'restrict' }),
    hasPedagogicalQualification: boolean('has_pedagogical_qualification')
      .notNull()
      .default(false),
    // ─── Photo (D-29) ───
    profilePhotoFileId: uuid('profile_photo_file_id').references(
      () => uploadedFiles.id,
      { onDelete: 'set null' },
    ),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
    updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  },
  (t) => [index('idx_trainers_diploma').on(t.diplomaCode)],
);

export type Trainer = typeof trainers.$inferSelect;
export type NewTrainer = typeof trainers.$inferInsert;
