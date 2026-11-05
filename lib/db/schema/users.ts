/**
 * `users` model — the intake team (admins + agents).
 *
 * Owns the table definition, its role constants, and the inferred row types.
 */
import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** The two roles supported by the single-tenant intake desk. */
export const USER_ROLES = ["ADMIN", "USER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Passwords are never stored in plain text: `password_hash` holds a single
 * self-describing scrypt string (`scrypt$params$salt$hash`) that embeds the
 * per-user salt (see `lib/auth/password.ts`).
 */
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    /** `'ADMIN'` or `'USER'`; constrained by a CHECK below. */
    role: text("role").$type<UserRole>().notNull().default("USER"),
    passwordHash: text("password_hash").notNull(),
    /**
     * Filename of the user's uploaded profile photo inside the private avatar
     * directory (see `lib/users/avatar-storage.ts`). Never a URL: the file is
     * served through an authenticated route, not from `public/`.
     */
    avatarPath: text("avatar_path"),
    /**
     * Personal preferences as a JSON object. It is a blob rather than a column
     * per setting so future preferences (Overview stats, notification choices)
     * can be added without a migration. Readers go through
     * `normalizePreferences`, which fills defaults and validates the shape.
     */
    preferences: text("preferences", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check("users_role_check", sql`${table.role} in ('ADMIN', 'USER')`),
    check(
      "users_preferences_json_check",
      sql`json_valid(${table.preferences})`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
