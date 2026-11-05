/**
 * Shared SQL helpers for server-side list queries.
 *
 * Every grid in the app filters, sorts, and pages in SQL, so the fiddly parts —
 * building a search clause, validating URL-derived filter values, resolving an
 * allow-listed sort, clamping the page, and counting the total — live here once
 * instead of being re-derived per table.
 */
import { and, asc, count, desc, eq, isNull, like, or, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { AppDatabase } from "@/lib/db";
import {
  parseFilterValues,
  type ListPageResult,
  type TableQuery,
  type TableSort,
} from "@/lib/table-query";

/** `col LIKE %term%`, OR'd across `columns`; `undefined` when there is no term. */
export function searchCondition(
  term: string,
  columns: AnySQLiteColumn[],
): SQL | undefined {
  const words = term.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;

  // Each word must match at least one column. Matching word by word is what
  // lets a full name ("Jane Doe") find a row whose parts live in separate
  // columns — a single `LIKE %Jane Doe%` matches neither.
  const conditions = words.map((word) => {
    const pattern = `%${word}%`;
    return or(...columns.map((column) => like(column, pattern)));
  });

  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

/**
 * Reads a filter value only when it passes the caller's allow-list predicate.
 *
 * Filter values arrive from the URL, so nothing reaches the SQL unvalidated.
 */
export function readFilter<T extends string>(
  query: TableQuery,
  id: string,
  isAllowed: (value: string) => value is T,
): T | null {
  const value = query.filters[id];
  return value !== undefined && isAllowed(value) ? value : null;
}

/**
 * Reads every allowed choice from a multi-value filter.
 *
 * The URL carries multi-select values as a comma-separated list; anything that
 * is not on the caller's allow-list is discarded rather than reaching the SQL.
 */
export function readFilterList<T extends string>(
  query: TableQuery,
  id: string,
  isAllowed: (value: string) => value is T,
): T[] {
  return parseFilterValues(query.filters[id]).filter(isAllowed);
}

/** Combines conditions with AND, dropping the empty ones. */
export function allOf(conditions: Array<SQL | undefined>): SQL | undefined {
  const present = conditions.filter((condition): condition is SQL => !!condition);
  return present.length ? and(...present) : undefined;
}

/**
 * Turns a tri-state boolean filter (`yes` / `no` / `unknown`) into a condition.
 *
 * The nullable boolean columns store `null` for "unknown", so an absent or
 * unrecognised value simply adds no condition.
 */
export function booleanFilter(
  query: TableQuery,
  id: string,
  column: AnySQLiteColumn,
): SQL | undefined {
  switch (query.filters[id]) {
    case "yes":
      return eq(column, true);
    case "no":
      return eq(column, false);
    case "unknown":
      return isNull(column);
    default:
      return undefined;
  }
}

export interface PagePlan {
  where: SQL | undefined;
  orderBy: SQL;
  limit: number;
  offset: number;
  /** The page actually returned, clamped to the last page. */
  page: number;
  /** The sort actually applied (the default when the requested one is invalid). */
  sort: TableSort;
  /** Total rows matching `where`, ignoring the window. */
  total: number;
}

/**
 * Resolves everything a page slice needs: the total count, a clamped page, an
 * allow-listed ORDER BY, and the LIMIT/OFFSET window.
 *
 * The caller runs the actual SELECT, since the selected columns differ per
 * table. A sort id that is not in `sortColumns` (a hand-edited URL) falls back
 * to `defaultSort` — both column and direction — rather than reaching the SQL.
 */
export function planListPage<TSortKey extends string>(options: {
  db: AppDatabase;
  table: AnySQLiteTable;
  where: SQL | undefined;
  query: TableQuery;
  sortColumns: Record<TSortKey, AnySQLiteColumn>;
  defaultSort: { id: TSortKey; desc: boolean };
}): PagePlan {
  const { db, table, where, query, sortColumns, defaultSort } = options;

  const total =
    db.select({ value: count() }).from(table).where(where).get()?.value ?? 0;

  // A hand-edited URL can point past the end; land on the last real page so the
  // grid never reports a range like "26–15 of 15".
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(Math.max(query.page, 1), pageCount);

  const requested = query.sort;
  const validRequested =
    requested && requested.id in sortColumns ? requested : null;
  const sortId = validRequested
    ? (validRequested.id as TSortKey)
    : defaultSort.id;
  const sortDesc = validRequested ? validRequested.desc : defaultSort.desc;
  const sortColumn = sortColumns[sortId];
  const orderBy = sortDesc ? desc(sortColumn) : asc(sortColumn);

  return {
    where,
    orderBy,
    limit: query.pageSize,
    offset: (page - 1) * query.pageSize,
    page,
    sort: { id: sortId, desc: sortDesc },
    total,
  };
}

/** Convenience alias so `list*` modules can name their return type. */
export type { ListPageResult };
