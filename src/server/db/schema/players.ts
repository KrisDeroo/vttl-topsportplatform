/**
 * players + age_category_history (Phase 2).
 *
 * Design notes:
 *  - `players.user_id` IS the primary key (D-26): a player IS a user with
 *    extra fields; no separate surrogate id. RLS policies in 02-05 call
 *    `players_visible_to(caller_id, caller_role)` (Phase 1 SECURITY DEFINER,
 *    returns users.id) and the IN-clause works because user_id === users.id.
 *  - `is_minor` is denormalised from users.is_minor (Phase 1 helper
 *    `isMinorAt(dob, now)` recomputes it on player.create + player.update;
 *    see Pitfall 2 in 02-RESEARCH). The CHECK constraint references the
 *    local column so it can evaluate without joining users.
 *  - `profile_photo_file_id` → uploaded_files.id ON DELETE SET NULL (D-29):
 *    deleting a file row clears the reference, never blocks deletion.
 *  - `age_category` + `category_year` are explicit columns (PLAYER-04, D-31).
 *    Initial values are set by deriveAgeCategory() in player.create.
 *  - `age_category_history` keeps an audit trail of category transitions
 *    (DOM-CAT-01); `getAgeCategoryAt(playerId, date)` uses the composite
 *    index for index-only scans (Pattern 2 in 02-RESEARCH).
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §B + §C
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 1
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import { uploadedFiles } from './files';
import { academy, ageCategories, status } from './lookups';

export const players = pgTable(
  'players',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    gender: text('gender').notNull(), // 'male' | 'female' | 'x' (Zod-validated at tRPC boundary)
    school: text('school'),
    // ─── Address (D-27, flat columns) ───
    street: text('street').notNull(),
    streetNumber: text('street_number'),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    province: text('province').notNull(),
    country: text('country').notNull().default('BE'),
    phone: text('phone'),
    email: text('email'),
    // ─── Sport (PLAYER-02) ───
    club: text('club'), // free text (PLAYER-03)
    statusCode: text('status_code')
      .notNull()
      .references(() => status.code, { onDelete: 'restrict' }),
    academyCode: text('academy_code')
      .notNull()
      .references(() => academy.code, { onDelete: 'restrict' }),
    ageCategoryCode: text('age_category')
      .notNull()
      .references(() => ageCategories.code, { onDelete: 'restrict' }),
    categoryYear: integer('category_year').notNull(),
    // ─── Minor & emergency (D-28, PLAYER-06) ───
    isMinor: boolean('is_minor').notNull(),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    emergencyContactRelation: text('emergency_contact_relation'),
    // ─── Photo (D-29) ───
    profilePhotoFileId: uuid('profile_photo_file_id').references(
      () => uploadedFiles.id,
      { onDelete: 'set null' },
    ),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
    updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    check(
      'players_minor_emergency_contact',
      sql`(NOT ${t.isMinor}) OR (${t.emergencyContactName} IS NOT NULL AND ${t.emergencyContactPhone} IS NOT NULL)`,
    ),
    index('idx_players_academy').on(t.academyCode),
    index('idx_players_status').on(t.statusCode),
  ],
);

export const ageCategoryHistory = pgTable(
  'age_category_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.userId, { onDelete: 'cascade' }),
    ageCategoryCode: text('age_category_code')
      .notNull()
      .references(() => ageCategories.code, { onDelete: 'restrict' }),
    categoryYear: integer('category_year').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    setBy: uuid('set_by').references(() => users.id),
    setAt: tstz('set_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    unique('uniq_age_history_player_effective_from').on(t.playerId, t.effectiveFrom),
    check(
      'age_history_effective_to_after_from',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    index('idx_age_history_lookup').on(t.playerId, t.effectiveFrom.desc(), t.effectiveTo),
  ],
);

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type AgeCategoryHistoryRow = typeof ageCategoryHistory.$inferSelect;
export type NewAgeCategoryHistoryRow = typeof ageCategoryHistory.$inferInsert;
