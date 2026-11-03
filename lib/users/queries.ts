/**
 * Queries for the intake team (`users`).
 *
 * The users grid is server-driven: searching, filtering, sorting, and paging all
 * happen in SQL, and the grid is handed one page at a time. Nothing here ever
 * selects `password_hash`.
 *
 * Every value that reaches the SQL comes from the URL, so each one is validated
 * against a fixed allow-list first (sort columns, roles, page size).
 */
import { and, asc, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
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

export interface UsersResult {
  rows: UserRow[];
  /** Total rows matching the query, ignoring the page window. */
  total: number;
  /** The page actually returned, clamped to the last page when out of range. */
  page: number;
}

/** Columns the grid may sort by; anything else falls back to `name`. */
const SORT_COLUMNS = {
  name: users.name,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
};

function isSortColumn(value: string): value is keyof typeof SORT_COLUMNS {
  return value in SORT_COLUMNS;
}

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/**
 * One page of users for `query`, plus the total number of matching rows (so the
 * client can compute the page count without a second request).
 */
export function listUsers(query: TableQuery): UsersResult {
  const db = getDb();

  // --- WHERE: global search across name/email, plus the role filter ---
  const conditions: SQL[] = [];

  const search = query.search.trim();
  if (search) {
    const pattern = `%${search}%`;
    const match = or(like(users.name, pattern), like(users.email, pattern));
    if (match) conditions.push(match);
  }

  const role = query.filters.role;
  if (role && isUserRole(role)) conditions.push(eq(users.role, role));

  const where = conditions.length ? and(...conditions) : undefined;

  const total =
    db.select({ value: count() }).from(users).where(where).get()?.value ?? 0;

  // A hand-edited URL can point past the end; land on the last real page so the
  // grid never reports a range like "26–15 of 15".
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(Math.max(query.page, 1), pageCount);

  // --- ORDER BY: allow-listed column and direction ---
  const sortKey =
    query.sort && isSortColumn(query.sort.id) ? query.sort.id : "name";
  const sortColumn = SORT_COLUMNS[sortKey];
  const orderBy = query.sort?.desc ? desc(sortColumn) : asc(sortColumn);

  // --- LIMIT/OFFSET: one page ---
  const rows = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(orderBy)
    .limit(query.pageSize)
    .offset((page - 1) * query.pageSize)
    .all();

  return { rows, total, page };
}
