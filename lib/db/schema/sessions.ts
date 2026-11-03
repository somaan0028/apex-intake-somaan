/**
 * `sessions` model — server-side login sessions.
 *
 * Only the SHA-256 hash of the session token is stored, never the token itself,
 * so a leaked table cannot be replayed as a cookie. Tokens are opaque 256-bit
 * random values; the raw token lives only in the user's httpOnly cookie.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 (hex) hash of the opaque session token. */
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ISO-8601 expiry timestamp. */
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
