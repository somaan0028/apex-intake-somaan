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
export const USER_ROLES = ["admin", "user"] as const;
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
    /** `'admin'` or `'user'`; constrained by a CHECK below. */
    role: text("role").$type<UserRole>().notNull().default("user"),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check("users_role_check", sql`${table.role} in ('admin', 'user')`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
