/**
 * `activities` model — an append-only audit log of the work done in the desk.
 *
 * Rows are written by the shared services, never by the UI, so an action taken
 * through the grid, the detail dialog, the assistant, or MCP produces the same
 * event. Descriptions are generated on the server from the activity type and
 * its details (see `lib/activities/record.ts`); they never contain a person's
 * name, because names can change after the fact.
 *
 * The actor/lead references are plain integers rather than foreign keys. This
 * is deliberate: an audit log must survive the deletion of a user, and deleting
 * a user should not be blocked by their history. Readers resolve the ids with a
 * left join and fall back to "Deleted user" / "Deleted lead".
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Every activity the app records. Stored verbatim in `activities.type`. */
export const ACTIVITY_TYPES = [
  "lead:stage_update",
  "lead:claimed",
  "lead:released",
  "lead:assigned",
  "lead:unassigned",
  "lead:send_to_firm",
  "user:added",
  "user:deleted",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activities = sqliteTable(
  "activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").$type<ActivityType>().notNull(),
    /** One line, generated from the type and its details. */
    description: text("description").notNull(),
    /** The person who performed it (for AI work, the person it acted for). */
    doerId: integer("doer_id").notNull(),
    /** True when the action came through the AI/MCP tool layer. */
    isAi: integer("is_ai", { mode: "boolean" }).notNull().default(false),
    /** The lead this activity is about, when there is one. */
    leadId: integer("lead_id"),
    /** The affected/assigned user, when there is one. */
    userId: integer("user_id"),
    /** Unix timestamp (seconds). */
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // An agent's feed is "my activity, newest first".
    index("activities_doer_created_idx").on(table.doerId, table.createdAt),
    index("activities_lead_id_idx").on(table.leadId),
    index("activities_created_at_idx").on(table.createdAt),
    // Keep the stored type to the codes the app knows about.
    check(
      "activities_type_check",
      sql`${table.type} in (${sql.join(
        ACTIVITY_TYPES.map((value) => sql.raw(`'${value}'`)),
        sql`, `,
      )})`,
    ),
  ],
);

export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
