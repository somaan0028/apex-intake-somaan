/**
 * `api_tokens` model — long-lived personal access tokens for external agents.
 *
 * The browser authenticates with a short-lived cookie session (`sessions`); an
 * external AI harness connecting to the MCP server cannot hold a cookie, so it
 * presents one of these instead as `Authorization: Bearer <token>`.
 *
 * A token belongs to one user and carries **no permissions of its own**. The MCP
 * route resolves it back to a fresh `users` row on every request and builds the
 * tool set for that actor, so the agent can do exactly what its owner can and
 * nothing more — and a role change, a revoked token, or a deleted user takes
 * effect on the very next call rather than being frozen into the token.
 *
 * Only the SHA-256 hash is stored, mirroring `sessions`, so a leaked table cannot
 * be replayed as a credential. The raw token is shown to its owner once.
 */
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the owner called this token, e.g. "Claude Desktop". */
    name: text("name").notNull(),
    /** SHA-256 (hex) of the raw token — the only form ever stored. */
    tokenHash: text("token_hash").notNull(),
    /** Leading characters of the raw token, shown in the UI to tell tokens apart. */
    prefix: text("prefix").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    /** When the token was last presented, refreshed at most once a minute. */
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    /** Optional hard stop; `null` means the token does not expire. */
    expiresAt: integer("expires_at", { mode: "timestamp" }),
  },
  (table) => [
    // Lookups are by hash, so this is the hot path.
    uniqueIndex("api_tokens_token_hash_unique").on(table.tokenHash),
    index("api_tokens_user_id_idx").on(table.userId),
  ],
);

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
