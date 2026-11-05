/**
 * `lead_bookmarks` model — personal, many-to-many bookmarks for leads.
 *
 * A bookmark belongs to exactly one user and one lead. It is deliberately not a
 * shared flag: two people can bookmark the same lead, and one person's filter
 * never reveals what anyone else has bookmarked.
 *
 * Both foreign keys cascade, so deleting a lead or a user removes the
 * bookmarks that point at it. The composite primary key is
 * `(user_id, lead_id)`, which makes a repeated bookmark a no-op rather than a
 * duplicate row.
 */
import { index, integer, primaryKey, sqliteTable } from "drizzle-orm/sqlite-core";
import { leads } from "./leads";
import { users } from "./users";

export const leadBookmarks = sqliteTable(
  "lead_bookmarks",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    /** Unix timestamp (seconds) the bookmark was created. */
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.leadId] }),
    // Cascade/cleanup lookups by lead run without a user id.
    index("lead_bookmarks_lead_id_idx").on(table.leadId),
  ],
);

export type LeadBookmark = typeof leadBookmarks.$inferSelect;
export type NewLeadBookmark = typeof leadBookmarks.$inferInsert;
