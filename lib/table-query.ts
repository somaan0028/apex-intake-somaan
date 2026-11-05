/**
 * The serializable query that drives a server-side data table.
 *
 * A `TableQuery` is the single source of truth for a grid: it lives in the URL
 * (so pages are shareable and the back button works), the server uses it to
 * build the SQL, and the client renders its controls from it. Because both
 * sides agree on this shape, the client never needs to parse — only serialize.
 *
 * URL shape (defaults are omitted to keep links short):
 *
 *     /leads?page=2&pageSize=25&sort=createdAt&sortDir=desc&search=price&filter.stage=NEW
 */

/** A single-column sort. Server-side grids sort by one column at a time. */
export interface TableSort {
  /** Column id (the accessor key unless the column overrides `id`). */
  id: string;
  desc: boolean;
}

export interface TableQuery {
  /** 1-based page number. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Active sort, or `null` when the grid has no natural order. */
  sort: TableSort | null;
  /** Global search text. */
  search: string;
  /** Per-column filter values, keyed by column id. */
  filters: Record<string, string>;
}

/** What every `list*` server query returns. */
export interface ListPageResult<T> {
  rows: T[];
  /** Total rows matching the query, ignoring the page window. */
  total: number;
  /** The page actually returned, clamped to the last page. */
  page: number;
  /** The sort actually applied (the table's default when the URL's is invalid). */
  sort: TableSort;
}

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS: number[] = [10, 25, 50, 100];

/**
 * Values a filter over a *nullable* boolean column can take.
 *
 * The app's boolean columns are normalised to SQLite `0`/`1` where `null` means
 * "unknown", so filtering one is tri-state rather than two-state. One label map
 * here drives both the filter options and the server's validation.
 */
const BOOLEAN_FILTER_LABELS = {
  yes: "Yes",
  no: "No",
  unknown: "Unknown",
} as const;

export type BooleanFilterValue = keyof typeof BOOLEAN_FILTER_LABELS;

export const BOOLEAN_FILTER_VALUES = Object.keys(
  BOOLEAN_FILTER_LABELS,
) as BooleanFilterValue[];

export const BOOLEAN_FILTER_OPTIONS: Array<{ label: string; value: string }> =
  BOOLEAN_FILTER_VALUES.map((value) => ({
    label: BOOLEAN_FILTER_LABELS[value],
    value,
  }));

/** Prefix that marks a URL param as a column filter (`filter.role=ADMIN`). */
const FILTER_PREFIX = "filter.";

const PAGE_PARAM = "page";
const PAGE_SIZE_PARAM = "pageSize";
const SORT_PARAM = "sort";
const SORT_DIR_PARAM = "sortDir";
const SEARCH_PARAM = "search";

/** Either `URLSearchParams` (client) or a page's `searchParams` object (server). */
export type TableQuerySource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

/** Flattens either supported param source into `[key, value]` pairs. */
function toEntries(source: TableQuerySource): Array<[string, string]> {
  if (source instanceof URLSearchParams) return [...source.entries()];

  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    entries.push([key, Array.isArray(value) ? (value[0] ?? "") : value]);
  }
  return entries;
}

/**
 * Parse a query from URL params, clamping anything missing or malformed back to
 * a safe default so a hand-edited URL can never reach the database unchecked.
 */
export function parseTableQuery(
  source: TableQuerySource,
  options: { defaultPageSize?: number; defaultSort?: TableSort } = {},
): TableQuery {
  const entries = toEntries(source);
  const read = (key: string): string | undefined =>
    entries.find(([entryKey]) => entryKey === key)?.[1];

  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const pageSizeValue = Number(read(PAGE_SIZE_PARAM));
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeValue)
    ? pageSizeValue
    : defaultPageSize;

  const pageValue = Number(read(PAGE_PARAM));
  const page =
    Number.isFinite(pageValue) && pageValue >= 1 ? Math.floor(pageValue) : 1;

  const sortId = read(SORT_PARAM);
  const sort: TableSort | null = sortId
    ? { id: sortId, desc: read(SORT_DIR_PARAM) === "desc" }
    : (options.defaultSort ?? null);

  const filters: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key.startsWith(FILTER_PREFIX) || value === "") continue;
    const id = key.slice(FILTER_PREFIX.length);
    if (id) filters[id] = value;
  }

  return { page, pageSize, sort, search: read(SEARCH_PARAM) ?? "", filters };
}

/**
 * Split a filter value into its comma-separated choices.
 *
 * Multi-select filters serialize as `filter.stage=NEW,CONTACTED`. A normal
 * single-value filter is simply a one-element list, so callers can use the same
 * parser. Empty entries, surrounding spaces, and duplicates are dropped.
 */
export function parseFilterValues(
  value: string | undefined | null,
): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** Serialize a query back to URL params, omitting values equal to the defaults. */
export function tableQueryToParams(query: TableQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.page > 1) params.set(PAGE_PARAM, String(query.page));
  if (query.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set(PAGE_SIZE_PARAM, String(query.pageSize));
  }
  if (query.sort) {
    params.set(SORT_PARAM, query.sort.id);
    params.set(SORT_DIR_PARAM, query.sort.desc ? "desc" : "asc");
  }
  if (query.search) params.set(SEARCH_PARAM, query.search);

  for (const [id, value] of Object.entries(query.filters)) {
    if (value) params.set(`${FILTER_PREFIX}${id}`, value);
  }

  return params;
}

/**
 * Parse a page's `searchParams`, run its list query, and hand back the query the
 * grid should render.
 *
 * The list query clamps an out-of-range page and falls back to the table's
 * default sort, so the returned query is the one the rows actually correspond
 * to — that keeps the pager, the sort indicators, and the rows agreeing.
 */
export async function loadTablePage<T>(
  searchParams: Promise<TableQuerySource>,
  options: { defaultSort?: TableSort },
  load: (query: TableQuery) => ListPageResult<T>,
): Promise<{ query: TableQuery; rows: T[]; total: number }> {
  const parsed = parseTableQuery(await searchParams, options);
  const { rows, total, page, sort } = load(parsed);
  return { query: { ...parsed, page, sort }, rows, total };
}

/**
 * An order-independent, content-based key for a filter record.
 *
 * The table's controlled state must be referentially stable between renders, so
 * components memoize the filter slice on this key rather than on the record
 * object (which is recreated by every server render).
 */
export function filtersKey(filters: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Rebuild a filter record from `filtersKey` output. */
export function filtersFromKey(key: string): Record<string, string> {
  return Object.fromEntries(JSON.parse(key) as Array<[string, string]>);
}
