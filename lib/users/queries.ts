/**
 * Queries for the intake team (`users`).
 *
 * The users grid is server-driven: searching, filtering, sorting, and paging all
 * happen in SQL, and the grid is handed one page at a time. Nothing here ever
 * selects `password_hash`.
 */
import { asc, eq, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "@/lib/db";
import {
  allOf,
  planListPage,
  readFilter,
  searchCondition,
  type ListPageResult,
} from "@/lib/db/list-query";
import { USER_ROLES, users, type UserRole } from "@/lib/db/schema";
import type { TableQuery } from "@/lib/table-query";

/** A user as the UI consumes it (no credential material). */
export type UserRow = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Date;
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

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/** One page of users for `query`, plus the total number of matching rows. */
export function listUsers(query: TableQuery): ListPageResult<UserRow> {
  const db = getDb();

  const conditions: Array<SQL | undefined> = [
    searchCondition(query.search, [users.name, users.email]),
  ];

  const role = readFilter(query, "role", isUserRole);
  if (role) conditions.push(eq(users.role, role));

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
      createdAt: users.createdAt,
    })
    .from(users)
    .where(plan.where)
    .orderBy(plan.orderBy)
    .limit(plan.limit)
    .offset(plan.offset)
    .all();

  return { rows, total: plan.total, page: plan.page, sort: plan.sort };
}

/** Id + name of everyone a lead can be assigned to (used by the leads filters). */
export function listAssignees(): Array<{ id: number; name: string }> {
  return getDb()
    .select({ id: users.id, name: users.name })
    .from(users)
    .orderBy(asc(users.name))
    .all();
}
