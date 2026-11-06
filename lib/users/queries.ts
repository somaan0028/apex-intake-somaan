/**
 * Queries for the intake team (`users`).
 *
 * The users grid is server-driven: searching, filtering, sorting, and paging all
 * happen in SQL, and the grid is handed one page at a time. Nothing here ever
 * selects `password_hash`.
 */
import { and, asc, count, eq, inArray, ne, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "@/lib/db";
import {
  allOf,
  planListPage,
  searchCondition,
  type ListPageResult,
} from "@/lib/db/list-query";
import { leads, users, type UserRole } from "@/lib/db/schema";
import { can, type Actor } from "@/lib/rbac";
import type { TableQuery } from "@/lib/table-query";

/** A user as the UI consumes it (no credential material). */
export type UserRow = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  /** Stored filename of the profile photo, or `null` for initials. */
  avatarPath: string | null;
  createdAt: Date;
  /** How many active leads this user currently owns (Disqualified excluded). */
  assignedLeadCount: number;
};

/** Sort keys the grid exposes (see the columns in `users-table.tsx`). */
type UserSortKey = "name" | "email" | "role" | "createdAt";

/** Columns the grid may sort by; anything else falls back to the default. */
const SORT_COLUMNS: Record<UserSortKey, AnySQLiteColumn> = {
  name: users.name,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
};

/** The grid's natural order. */
export const USERS_DEFAULT_SORT = { id: "name", desc: false } as const;

/** One page of users for `query`, plus the total number of matching rows. */
export function listUsers(query: TableQuery): ListPageResult<UserRow> {
  const db = getDb();

  // Search is the only narrowing control the Users page offers; any stale
  // `filter.*` in the URL is deliberately ignored rather than applied blindly.
  const conditions: Array<SQL | undefined> = [
    searchCondition(query.search, [users.name, users.email]),
  ];

  const plan = planListPage({
    db,
    table: users,
    where: allOf(conditions),
    query,
    sortColumns: SORT_COLUMNS,
    defaultSort: USERS_DEFAULT_SORT,
  });

  const rows = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      avatarPath: users.avatarPath,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(plan.where)
    .orderBy(plan.orderBy)
    .limit(plan.limit)
    .offset(plan.offset)
    .all();

  // Count only the users on this page, in one grouped query. A correlated
  // subquery per row would be correct too, but this keeps the page bounded.
  // Disqualified is a closed stage, so it is left out exactly like the
  // Overview's "Assigned to you" card: the number is active workload.
  const counts =
    rows.length === 0
      ? []
      : db
          .select({ userId: leads.assignedToId, value: count() })
          .from(leads)
          .where(
            and(
              inArray(
                leads.assignedToId,
                rows.map((row) => row.id),
              ),
              ne(leads.stage, "DISQUALIFIED"),
            ),
          )
          .groupBy(leads.assignedToId)
          .all();
  const countByUser = new Map(
    counts.map((row) => [row.userId, row.value] as const),
  );

  return {
    rows: rows.map((row) => ({
      ...row,
      assignedLeadCount: countByUser.get(row.id) ?? 0,
    })),
    total: plan.total,
    page: plan.page,
    sort: plan.sort,
  };
}

/**
 * Id + name of everyone a lead can be assigned to (used by the leads filters).
 *
 * Scoped to what the actor can actually see: admins get the whole team, an agent
 * only themselves (the UI adds the "Unassigned" option), so the filter never
 * offers a choice that would always come back empty.
 */
export function listAssignees(
  actor: Actor,
): Array<{ id: number; name: string }> {
  return listAssignableUsers(actor).map(({ id, name }) => ({ id, name }));
}

/**
 * Everyone the actor may reference or act on, with contact details.
 *
 * Same scope as `listAssignees` — admins see the whole team, an agent only
 * themselves. The users grid itself stays admin-only; this is the subset that
 * assignment and `@`-mentions are allowed to expose.
 */
export function listAssignableUsers(actor: Actor): Array<{
  id: number;
  name: string;
  email: string;
  role: UserRole;
}> {
  const db = getDb();
  const columns = {
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
  };

  if (can(actor.role, "leads.view.all")) {
    return db.select(columns).from(users).orderBy(asc(users.name)).all();
  }
  return db.select(columns).from(users).where(eq(users.id, actor.id)).all();
}

/**
 * How many admins exist. Feeds the "never leave the desk without an admin" rule
 * (`canDeleteUser` / `canChangeUserRole`), both to disable controls and to gate
 * the mutation on the server.
 */
export function countAdmins(): number {
  return (
    getDb()
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, "ADMIN"))
      .get()?.value ?? 0
  );
}

/** How many leads are currently assigned to `userId` (blocks a dangling delete). */
export function countAssignedLeads(userId: number): number {
  return (
    getDb()
      .select({ value: count() })
      .from(leads)
      .where(eq(leads.assignedToId, userId))
      .get()?.value ?? 0
  );
}
