/**
 * The shared TanStack Table v9 feature registry.
 *
 * Every table in the app is built from this one `tableFeatures` object so the
 * feature plugins are registered once and stay consistent. Keeping it at module
 * scope matters: TanStack Table treats a fresh `features` object as a different
 * table configuration and invalidates the row models.
 *
 * Searching, filtering, sorting, and pagination all run on the server, so this
 * registry deliberately registers *state and API* features only — no
 * `create*RowModel` slots and no `filterFns`/`sortFns` registries. The tables run
 * with `manualFiltering`, `manualSorting`, and `manualPagination`, which makes
 * the table render exactly the rows it is handed instead of re-processing them.
 *
 * The global search box is a plain debounced input rather than table state, so
 * `globalFilteringFeature` is intentionally absent.
 */
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

export const dataTableFeatures = tableFeatures({
  // Filter state + `column.getFilterValue()` / `column.setFilterValue()`.
  columnFilteringFeature,

  // Sort state + `column.getToggleSortingHandler()`.
  rowSortingFeature,

  // Page state + `rowCount`-driven page math.
  rowPaginationFeature,

  // Per-table column show/hide (pure UI state, never sent to the server).
  columnVisibilityFeature,
});

/** The concrete feature set, used to type column defs and table props. */
export type DataTableFeatures = typeof dataTableFeatures;
