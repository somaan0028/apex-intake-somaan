/**
 * Browser-only saved views for the leads page.
 *
 * A view is everything a person would otherwise rebuild by hand: the table or
 * board, the active filter values, the search text, the sort, which filter
 * controls and columns are showing, and which stages are hidden. None of this
 * reaches the server; it lives in `localStorage` on this browser and disappears
 * if the person clears their site data.
 */
import {
  tableQueryToParams,
  type TableQuery,
  type TableSort,
} from "@/lib/table-query";
import type { LeadsView } from "./constants";

/** The part of the page a saved view restores. */
export interface LeadViewState {
  view: LeadsView;
  filters: Record<string, string>;
  search: string;
  sort: TableSort | null;
  /** Filter controls on/off, e.g. `{ hasAttorney: false }`. */
  filterVisibility: Record<string, boolean>;
  /** Column on/off, e.g. `{ source: false }`. */
  columnVisibility: Record<string, boolean>;
  /** Stage columns hidden on the Kanban board. */
  hiddenStages: string[];
}

export interface SavedLeadView extends LeadViewState {
  id: string;
  name: string;
  createdAt: number;
}

/** The last place the person left off, restored on their next visit. */
export interface PersistedLeadState extends LeadViewState {
  activeViewId: string | null;
  page: number;
  pageSize: number;
}

const VIEWS_KEY = "apex.leads.views.v1";
// v2 drops the last-view state written while the leads date filter defaulted to
// 7 days, so an existing browser starts with the cleared ("Any time") filter.
// Named saved views stay on their own key and are untouched.
const STATE_KEY = "apex.leads.state.v2";

function sortedEntries(
  record: Record<string, string | boolean>,
): Array<[string, string | boolean]> {
  return Object.entries(record)
    .filter(([, value]) => value !== "" && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * A stable fingerprint of a view. Two views with the same fingerprint show the
 * same thing, so the heart stays red only while the page still matches the
 * saved view it came from.
 */
export function viewSignature(state: LeadViewState): string {
  return JSON.stringify({
    view: state.view,
    filters: sortedEntries(state.filters),
    search: state.search.trim(),
    sort: state.sort ? [state.sort.id, state.sort.desc] : null,
    filterVisibility: sortedEntries(state.filterVisibility),
    columnVisibility: sortedEntries(state.columnVisibility),
    hiddenStages: [...state.hiddenStages].sort(),
  });
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readSavedViews(): SavedLeadView[] {
  if (typeof window === "undefined") return [];
  const value = parse<SavedLeadView[]>(localStorage.getItem(VIEWS_KEY));
  return Array.isArray(value)
    ? value.filter((view) => view && typeof view.id === "string")
    : [];
}

export function writeSavedViews(views: SavedLeadView[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}

export function readPersistedState(): PersistedLeadState | null {
  if (typeof window === "undefined") return null;
  const value = parse<PersistedLeadState>(localStorage.getItem(STATE_KEY));
  if (!value || (value.view !== "table" && value.view !== "kanban"))
    return null;
  return {
    ...value,
    filters: value.filters ?? {},
    search: value.search ?? "",
    sort: value.sort ?? null,
    filterVisibility: value.filterVisibility ?? {},
    columnVisibility: value.columnVisibility ?? {},
    hiddenStages: value.hiddenStages ?? [],
    activeViewId: value.activeViewId ?? null,
    page: value.page ?? 1,
    pageSize: value.pageSize ?? 10,
  };
}

export function writePersistedState(state: PersistedLeadState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

/** Turn a view back into the leads URL. Kanban is the default, so it is omitted. */
export function viewStateToParams(
  state: LeadViewState,
  paging: { page?: number; pageSize?: number } = {},
): URLSearchParams {
  const query: TableQuery = {
    page: paging.page ?? 1,
    pageSize: paging.pageSize ?? 10,
    sort: state.sort,
    search: state.search,
    filters: state.filters,
  };
  const params = tableQueryToParams(query);
  if (state.view === "table") params.set("view", "table");
  return params;
}
