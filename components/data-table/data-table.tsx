"use client";

/**
 * A reusable, server-driven data grid.
 *
 * TanStack Table is headless here: it owns the *state* (pagination, sorting,
 * column filters, column visibility) and this component renders semantic
 * `<table>` markup plus the toolbar and pager. No row processing happens in the
 * browser — the table runs in manual mode, so it renders exactly the rows the
 * server handed it and the caller fetches the next set.
 *
 * State ownership
 * ---------------
 * Pagination, sorting, and column filters are controlled: they arrive in `query`
 * (which the caller mirrors to the URL) and every change is reported through
 * `onQueryChange`. The table state is therefore a read-only projection of the
 * URL. Column visibility is table-owned, since it never affects the request.
 *
 * Two things need care:
 *  - The controlled slices are compared shallowly by the React adapter, so they
 *    are memoized on primitive keys below. Recreating them every render would
 *    look like a change on every render and loop.
 *  - The search box is buffered locally and debounced, because it is a text
 *    input: driving its value straight from the URL would drop keystrokes while
 *    the request is in flight, and would fire one request per character.
 */
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type ReactTable,
  type RowData,
  type SortDirection,
  type SortingState,
  functionalUpdate,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ListFilter,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  filtersFromKey,
  filtersKey,
  PAGE_SIZE_OPTIONS,
  type TableQuery,
} from "@/lib/table-query";
import { dataTableFeatures, type DataTableFeatures } from "./features";

/** One choice in a declarative column filter. */
export interface DataTableFilterOption {
  label: string;
  value: string;
}

/** A select-based filter bound to a single column. */
export interface DataTableFilter {
  /** Id of the column to filter (the accessor key, unless overridden). */
  columnId: string;
  /** Short name, shown in the Filters menu and used as the control's label. */
  label: string;
  /** Text for the "no filter" choice, e.g. "All roles". */
  allLabel: string;
  options: DataTableFilterOption[];
}

export interface DataTableProps<TData extends RowData> {
  /** Stable column defs (module scope or memoized). */
  columns: Array<ColumnDef<DataTableFeatures, TData, unknown>>;
  /** The current page of rows, already filtered/sorted/sliced by the server. */
  data: TData[];
  /** Total rows matching `query` across every page (the server's count). */
  rowCount: number;
  /** The query `data` corresponds to. Mirrored to the URL by the caller. */
  query: TableQuery;
  /** Called with the next query when the user pages, sorts, or filters. */
  onQueryChange: (next: TableQuery) => void;
  /** True while the server is fetching the next page. */
  isPending?: boolean;
  /** Accessible name for the underlying `<table>`. */
  ariaLabel?: string;
  /** Stable row id, so sorting/filtering keeps row identity. */
  getRowId?: (row: TData, index: number) => string;
  /** Placeholder for the global search box. */
  searchPlaceholder?: string;
  /** Declarative select filters rendered beside the search box. */
  filters?: DataTableFilter[];
  /**
   * Filter controls hidden on first render, e.g. `{ hasAttorney: false }`.
   * Anything not listed starts visible; the Filters menu toggles them.
   */
  defaultFilterVisibility?: Record<string, boolean>;
  /**
   * Columns hidden on first render, e.g. `{ source: false }`. Anything not
   * listed starts visible, and the user can still toggle any of them.
   */
  defaultColumnVisibility?: ColumnVisibilityState;
  /** Shown when the table has no rows at all. */
  emptyMessage?: string;
  /** Shown when filters exclude every row. */
  emptyFilteredMessage?: string;
  /** Page sizes offered in the footer. */
  pageSizeOptions?: number[];
}

/** Sentinel for the "no filter" choice in a column filter select. */
const ALL_FILTER_VALUE = "__all__";

/** How long to wait after the last keystroke before querying the server. */
const SEARCH_DEBOUNCE_MS = 350;

export function DataTable<TData extends RowData>({
  columns,
  data,
  rowCount,
  query,
  onQueryChange,
  isPending = false,
  ariaLabel,
  getRowId,
  searchPlaceholder = "Search…",
  filters,
  defaultFilterVisibility = {},
  defaultColumnVisibility = {},
  emptyMessage = "No results.",
  emptyFilteredMessage = "No rows match the current filters.",
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: DataTableProps<TData>) {
  const { page, pageSize, search, filters: filterValues } = query;
  const sortId = query.sort?.id ?? null;
  const sortDesc = query.sort?.desc ?? false;
  const filterKey = filtersKey(filterValues);

  // --- Buffered search box -------------------------------------------------
  const [searchText, setSearchText] = useState(search);
  const [adoptedSearch, setAdoptedSearch] = useState(search);

  // Adopt a search that changed outside this input (back/forward, a reset link).
  if (search !== adoptedSearch) {
    setAdoptedSearch(search);
    setSearchText(search);
  }

  // --- Filter controls the user has chosen to show/hide --------------------
  // UI-only state (unlike the filters themselves, which live in the URL), so it
  // stays local and resets with the page.
  const [filterVisibility, setFilterVisibility] = useState<
    Record<string, boolean>
  >(() => ({ ...defaultFilterVisibility }));
  const visibleFilters = (filters ?? []).filter(
    (filter) => filterVisibility[filter.columnId] !== false,
  );

  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  });

  useEffect(() => {
    if (searchText === search) return;
    const timer = setTimeout(() => {
      onQueryChange({ ...latestQuery.current, search: searchText, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, search, onQueryChange]);

  // --- Controlled table state (memoized; see the note at the top) ----------
  const paginationState = useMemo(
    () => ({ pageIndex: page - 1, pageSize }),
    [page, pageSize],
  );
  const sortingState = useMemo<SortingState>(
    () => (sortId ? [{ id: sortId, desc: sortDesc }] : []),
    [sortId, sortDesc],
  );
  const columnFiltersState = useMemo<ColumnFiltersState>(
    () =>
      Object.entries(filtersFromKey(filterKey)).map(([id, value]) => ({
        id,
        value,
      })),
    [filterKey],
  );
  const controlledState = useMemo(
    () => ({
      pagination: paginationState,
      sorting: sortingState,
      columnFilters: columnFiltersState,
    }),
    [paginationState, sortingState, columnFiltersState],
  );

  const table = useTable<DataTableFeatures, TData>({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    // The server owns the data pipeline; the table only tracks state.
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    rowCount,
    // One sort column at a time keeps the URL and the SQL simple.
    enableMultiSort: false,
    // Column visibility is table-owned, so it is seeded rather than controlled.
    initialState: { columnVisibility: defaultColumnVisibility },
    state: controlledState,
    onPaginationChange: (updater) => {
      const next = functionalUpdate(updater, paginationState);
      onQueryChange({
        ...query,
        // A new page size invalidates the current offset.
        page: next.pageSize === pageSize ? next.pageIndex + 1 : 1,
        pageSize: next.pageSize,
      });
    },
    onSortingChange: (updater) => {
      const first = functionalUpdate(updater, sortingState)[0];
      onQueryChange({
        ...query,
        sort: first ? { id: first.id, desc: Boolean(first.desc) } : null,
        page: 1,
      });
    },
    onColumnFiltersChange: (updater) => {
      const next = functionalUpdate(updater, columnFiltersState);
      const nextFilters: Record<string, string> = {};
      for (const filter of next) {
        if (filter.value === undefined || filter.value === null) continue;
        const value = String(filter.value);
        if (value) nextFilters[filter.id] = value;
      }
      onQueryChange({ ...query, filters: nextFilters, page: 1 });
    },
  });

  const { pagination, columnFilters } = table.state;
  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const isFiltered = columnFilters.length > 0 || search !== "";

  const rangeStart =
    rowCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const rangeEnd = Math.min(rangeStart + rows.length - 1, rowCount);

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {/* Row 1: the search box, and the two menus that control what is shown. */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 pl-8"
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {filters?.length ? (
              <FilterVisibilityMenu
                filters={filters}
                visibility={filterVisibility}
                onToggle={(columnId, visible) =>
                  setFilterVisibility((previous) => ({
                    ...previous,
                    [columnId]: visible,
                  }))
                }
                onReset={() =>
                  setFilterVisibility({ ...defaultFilterVisibility })
                }
              />
            ) : null}
            <ColumnVisibilityMenu table={table} />
          </div>
        </div>

        {/* Row 2: the filter controls, wrapping as needed. */}
        {visibleFilters.length ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {visibleFilters.map((filter) => (
              <ColumnFilter key={filter.columnId} table={table} filter={filter} />
            ))}
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "rounded-xl border transition-opacity",
          isPending && "pointer-events-none opacity-60",
        )}
        aria-busy={isPending}
      >
        <Table aria-label={ariaLabel}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground"
                        >
                          <table.FlexRender header={header} />
                          <SortIcon direction={sorted} />
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {isFiltered ? emptyFilteredMessage : emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-sm text-muted-foreground">
          {rowCount === 0
            ? "No results"
            : `Showing ${rangeStart}–${rangeEnd} of ${rowCount}`}
        </p>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Rows per page
            </span>
            <Select
              items={pageSizeOptions.map((size) => ({
                label: String(size),
                value: String(size),
              }))}
              value={String(pagination.pageSize)}
              onValueChange={(value) => value && table.setPageSize(Number(value))}
            >
              <SelectTrigger
                size="sm"
                className="w-fit"
                aria-label="Rows per page"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <span className="text-sm tabular-nums">
            Page {pageCount === 0 ? 0 : pagination.pageIndex + 1} of {pageCount}
          </span>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage() || isPending}
              aria-label="First page"
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage() || isPending}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage() || isPending}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.lastPage()}
              disabled={!table.getCanNextPage() || isPending}
              aria-label="Last page"
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Up/down chevrons that reflect a column's current sort direction. */
function SortIcon({ direction }: { direction: false | SortDirection }) {
  if (direction === "asc") return <ArrowUp aria-hidden className="size-3.5" />;
  if (direction === "desc")
    return <ArrowDown aria-hidden className="size-3.5" />;
  return (
    <ChevronsUpDown aria-hidden className="size-3.5 text-muted-foreground/50" />
  );
}

/** A single declarative select filter, wired to its column's filter state. */
function ColumnFilter<TData extends RowData>({
  table,
  filter,
}: {
  table: ReactTable<DataTableFeatures, TData>;
  filter: DataTableFilter;
}) {
  const column = table.getColumn(filter.columnId);
  if (!column) return null;

  const selected =
    (column.getFilterValue() as string | undefined) ?? ALL_FILTER_VALUE;

  // `items` lets SelectValue render the human label (not the raw sentinel) in
  // the trigger, including during SSR before the popup items have mounted.
  const items = [
    { label: filter.allLabel, value: ALL_FILTER_VALUE },
    ...filter.options,
  ];

  // Each control carries a visible label: a select only shows its *value*, so
  // without this several filters (all three booleans, for one) read identically.
  const labelId = `${filter.columnId}-filter-label`;

  return (
    <div className="flex items-center gap-2">
      <span
        id={labelId}
        className="text-sm font-medium whitespace-nowrap text-muted-foreground"
      >
        {filter.label}
      </span>
      <Select
        items={items}
        value={selected}
        onValueChange={(value) =>
          column.setFilterValue(
            value === null || value === ALL_FILTER_VALUE ? undefined : value,
          )
        }
      >
        <SelectTrigger size="sm" className="w-fit" aria-labelledby={labelId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER_VALUE}>{filter.allLabel}</SelectItem>
          {filter.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Dropdown that toggles which filter controls are shown. */
function FilterVisibilityMenu({
  filters,
  visibility,
  onToggle,
  onReset,
}: {
  filters: DataTableFilter[];
  visibility: Record<string, boolean>;
  onToggle: (columnId: string, visible: boolean) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <ListFilter aria-hidden />
        <span className="hidden sm:inline">Filters</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Filters</DropdownMenuLabel>
          {filters.map((filter) => (
            <DropdownMenuCheckboxItem
              key={filter.columnId}
              checked={visibility[filter.columnId] !== false}
              onCheckedChange={(checked) => onToggle(filter.columnId, checked)}
            >
              {filter.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onReset}>Reset filters</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Dropdown that toggles the visibility of each hideable column. */
function ColumnVisibilityMenu<TData extends RowData>({
  table,
}: {
  table: ReactTable<DataTableFeatures, TData>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal aria-hidden />
        <span className="hidden sm:inline">Columns</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {/* GroupLabel requires a Menu.Group ancestor. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          {table.getAllLeafColumns().map((column) =>
            column.getCanHide() ? (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(checked) => column.toggleVisibility(checked)}
              >
                {columnLabel(column)}
              </DropdownMenuCheckboxItem>
            ) : null,
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => table.resetColumnVisibility()}>
          Reset columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A column's header text when it is a plain string, else its id. */
function columnLabel<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>,
): string {
  const header = column.columnDef.header;
  return typeof header === "string" ? header : column.id;
}
