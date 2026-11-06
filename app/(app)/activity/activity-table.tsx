"use client";

/**
 * The Activity grid.
 *
 * A read-only audit view: no row click, no editor, and no column menu. The
 * structured filters are Performed by (a small select, shown only when the
 * viewer can see other people's rows), Affected Lead (a name search, because
 * the lead list is far too long for a select), and a date range that matches
 * the leads page.
 */
import { createColumnHelper } from "@tanstack/react-table";
import Link from "next/link";
import { FilterX, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DataTable, useTableQuerySync } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table/features";
import {
  DATE_RANGE_ANY_OPTIONS,
  DateRangeFilter,
} from "@/components/date-range-filter";
import { searchActivityLeads } from "@/lib/activities/actions";
import type {
  ActivityPerformerOption,
  ActivityRow,
} from "@/lib/activities/queries";
import { formatDate, formatDateTime } from "@/lib/format";
import type { TableQuery } from "@/lib/table-query";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const columnHelper = createColumnHelper<
  typeof dataTableFeatures,
  ActivityRow
>();

/**
 * Timestamps are formatted for the viewer's own time zone, which is only known
 * in the browser. The first client render must match the server, so it shows
 * the pinned calendar date; once hydrated, the full date and time appear.
 */
function LocalDateTime({ value }: { value: Date }) {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return (
    <span className="whitespace-nowrap text-muted-foreground">
      {hydrated ? formatDateTime(value) : formatDate(value)}
    </span>
  );
}

const columns = columnHelper.columns([
  columnHelper.accessor("createdAt", {
    header: "Date & time",
    cell: (info) => <LocalDateTime value={info.getValue()} />,
  }),
  columnHelper.accessor("doerName", {
    header: "Performed by",
    enableSorting: false,
    cell: (info) => (
      <div className="flex items-center gap-2.5">
        <UserAvatar
          size="sm"
          userId={info.row.original.doerId}
          name={info.getValue()}
          avatarPath={info.row.original.doerAvatarPath}
        />
        <span className="font-medium">{info.getValue()}</span>
      </div>
    ),
  }),
  columnHelper.accessor("description", {
    header: "Description",
    enableSorting: false,
  }),
  columnHelper.accessor("affectedLeadName", {
    header: "Lead Involved",
    enableSorting: false,
    cell: (info) => {
      const { leadId, leadExists, leadVisible, affectedLeadName } =
        info.row.original;
      if (!affectedLeadName) return "—";
      // Only a lead that still exists and is visible to the viewer gets a link;
      // the leads grid can then open it directly.
      if (!leadId || !leadExists || !leadVisible) return affectedLeadName;
      return (
        <Link
          href={`/leads?lead=${leadId}`}
          className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {affectedLeadName}
        </Link>
      );
    },
  }),
  columnHelper.accessor("isAi", {
    header: "Through AI",
    enableSorting: false,
    cell: (info) => (info.getValue() ? "Yes" : "No"),
  }),
]);

const getRowId = (activity: ActivityRow) => String(activity.id);

/**
 * The tint a filter control carries while it is narrowing the list, matching
 * the Date range control: neutral controls stay transparent, and only an
 * active value gets the primary wash.
 */
const ACTIVE_FILTER_CLASS =
  "border-primary/50 bg-primary/10 hover:bg-primary/15 dark:bg-primary/20 dark:hover:bg-primary/25";

/** The date-range preset represented by the current filters. */
function rangePreset(value: string | undefined): string {
  return value === "24h" ||
    value === "3d" ||
    value === "7d" ||
    value === "30d" ||
    value === "custom"
    ? value
    : "any";
}

/** Seven days ago, as the custom range's default lower bound. */
function defaultFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().slice(0, 10);
}

export function ActivityTable({
  activities,
  total,
  query,
  performers,
  showPerformerFilter,
  selectedLeadLabel,
}: {
  activities: ActivityRow[];
  total: number;
  query: TableQuery;
  performers: ActivityPerformerOption[];
  /** Only an admin can see other people's rows, so only they can filter by doer. */
  showPerformerFilter: boolean;
  selectedLeadLabel: string | null;
}) {
  const { isPending, onQueryChange } = useTableQuerySync();
  const preset = rangePreset(query.filters.dateWithin);
  // On a phone the filters live in a side sheet so the search box and one
  // Options button are all the toolbar shows.
  const [filtersOpen, setFiltersOpen] = useState(false);

  function changePreset(next: string) {
    const filters: Record<string, string> = { ...query.filters };
    if (next === "any") {
      delete filters.dateWithin;
      delete filters.dateFrom;
      delete filters.dateTo;
    } else {
      filters.dateWithin = next;
      if (next === "custom") {
        if (!filters.dateFrom) filters.dateFrom = defaultFrom();
      } else {
        delete filters.dateFrom;
        delete filters.dateTo;
      }
    }
    onQueryChange({ ...query, page: 1, filters });
  }

  function changeDateRange(from: string, to: string) {
    if (!from) return;
    const filters: Record<string, string> = {
      ...query.filters,
      dateWithin: "custom",
      dateFrom: from,
    };
    if (to) filters.dateTo = to;
    else delete filters.dateTo;
    onQueryChange({ ...query, page: 1, filters });
  }

  function changePerformer(id: number | null) {
    const filters: Record<string, string> = { ...query.filters };
    if (id) filters.performedBy = String(id);
    else delete filters.performedBy;
    onQueryChange({ ...query, page: 1, filters });
  }

  // What Clear Filters would actually clear: every visible filter value plus
  // the search. The date range is one filter, whichever shape it takes, and
  // "All Time" is not active.
  const dateFilterActive =
    preset !== "any" ||
    Boolean(query.filters.dateFrom) ||
    Boolean(query.filters.dateTo);
  const activeFilterCount =
    Object.keys(query.filters).filter((key) => {
      if (["dateWithin", "dateFrom", "dateTo"].includes(key)) return false;
      // A User never sees the doer filter, so a stray value is not counted.
      if (key === "performedBy" && !showPerformerFilter) return false;
      return Boolean(query.filters[key]);
    }).length +
    (dateFilterActive ? 1 : 0) +
    (query.search ? 1 : 0);

  const filterCountBadge =
    activeFilterCount > 0 ? (
      <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
        {activeFilterCount}
      </span>
    ) : null;

  function clearFilters() {
    onQueryChange({ ...query, page: 1, search: "", filters: {} });
  }

  // The filters share the toolbar row on desktop, with Clear Filters pushed to
  // the right; on a phone the same controls stack inside the Options sheet.
  // Order matters: date, then doer, then affected lead.
  const filterControls = (
    <>
      <DateRangeFilter
        label="Date"
        options={DATE_RANGE_ANY_OPTIONS}
        preset={preset}
        from={query.filters.dateFrom ?? defaultFrom()}
        to={query.filters.dateTo ?? ""}
        onPresetChange={changePreset}
        onChange={changeDateRange}
      />

      {showPerformerFilter ? (
        <PerformedByFilter
          selectedId={positiveId(query.filters.performedBy)}
          performers={performers}
          onChange={changePerformer}
        />
      ) : null}

      <LeadSearchFilter
        selectedId={positiveId(query.filters.leadId)}
        selectedLabel={selectedLeadLabel}
        onSelect={(id) => {
          onQueryChange({
            ...query,
            page: 1,
            filters: { ...query.filters, leadId: String(id) },
          });
        }}
        onClear={() => {
          const filters = { ...query.filters };
          delete filters.leadId;
          onQueryChange({ ...query, page: 1, filters });
        }}
      />
    </>
  );

  const headerFilters = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {filterControls}
    </div>
  );

  const mobileControls = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="xl:hidden"
      onClick={() => setFiltersOpen(true)}
    >
      <SlidersHorizontal aria-hidden />
      Filters
      {filterCountBadge}
    </Button>
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={activities}
        rowCount={total}
        query={query}
        onQueryChange={onQueryChange}
        isPending={isPending}
        getRowId={getRowId}
        ariaLabel="Activity"
        searchPlaceholder="Search by description"
        toolbarFilters={headerFilters}
        mobileControls={mobileControls}
        toolbarActions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearFilters}
          >
            <FilterX aria-hidden />
            <span className="hidden sm:inline">Clear Filters</span>
            {filterCountBadge}
          </Button>
        }
        showColumnMenu={false}
        emptyMessage="No activity yet."
        emptyFilteredMessage="No activity matches your filters."
      />

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-[92vw] gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Narrow the activity list without leaving the page.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Filters</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={clearFilters}
              >
                <FilterX aria-hidden />
                Clear
                {filterCountBadge}
              </Button>
            </div>

            <div className="flex flex-col items-stretch gap-3">
              {filterControls}
            </div>
          </div>

          <SheetFooter className="border-t">
            <Button
              type="button"
              className="w-full"
              onClick={() => setFiltersOpen(false)}
            >
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function positiveId(value: string | undefined): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Sentinel for "any doer" in the Performed by select. */
const ANY_PERFORMER = "__any__";

/** The Performed by filter: a regular select over the doers in view. */
function PerformedByFilter({
  selectedId,
  performers,
  onChange,
}: {
  selectedId: number | null;
  performers: ActivityPerformerOption[];
  onChange: (id: number | null) => void;
}) {
  const items = [
    { label: "Anyone", value: ANY_PERFORMER },
    ...performers.map((performer) => ({
      label: performer.label,
      value: String(performer.id),
    })),
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">
        Performed by
      </span>
      <Select
        items={items}
        value={selectedId ? String(selectedId) : ANY_PERFORMER}
        onValueChange={(value) =>
          onChange(!value || value === ANY_PERFORMER ? null : Number(value))
        }
      >
        <SelectTrigger
          size="sm"
          className={cn("w-fit", selectedId && ACTIVE_FILTER_CLASS)}
          aria-label="Performed by"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The Affected Lead filter: type a name, pick a match.
 *
 * Matches come from the same visibility-scoped lead query as the main grid, so
 * the picker can never offer a lead the viewer cannot open.
 */
function LeadSearchFilter({
  selectedId,
  selectedLabel,
  onSelect,
  onClear,
}: {
  selectedId: number | null;
  selectedLabel: string | null;
  onSelect: (id: number, label: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [resultState, setResultState] = useState<{
    term: string;
    items: Array<{ id: number; label: string }>;
  }>({ term: "", items: [] });

  const query = term.trim();
  const searching = query.length > 0 && resultState.term !== query;
  const results = resultState.term === query ? resultState.items : [];

  useEffect(() => {
    if (!query) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void searchActivityLeads(query)
        .then((matches) => {
          if (!cancelled) setResultState({ term: query, items: matches });
        })
        .catch(() => {
          if (!cancelled) setResultState({ term: query, items: [] });
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">
        Affected lead
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                // Neutral: no fill, exactly like the Date control. The outline
                // variant's `bg-background` made this one look permanently
                // active beside it.
                "max-w-56 justify-start gap-2 bg-transparent font-normal",
                selectedId && ACTIVE_FILTER_CLASS,
              )}
            />
          }
        >
          <Search aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {selectedId ? (selectedLabel ?? `Lead #${selectedId}`) : "Any lead"}
          </span>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-80 p-2.5">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search leads by name, email, or phone"
            aria-label="Search leads by name, email, or phone"
            autoFocus
          />
          <div className="max-h-64 overflow-y-auto">
            {searching ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Searching…
              </p>
            ) : results.length ? (
              <ul className="py-1">
                {results.map((lead) => (
                  <li key={lead.id}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => {
                        onSelect(lead.id, lead.label);
                        setOpen(false);
                        setTerm("");
                      }}
                    >
                      {lead.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {query ? "No matching leads." : "Type a name to search."}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {selectedId ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear affected lead filter"
          onClick={onClear}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
