"use client";

/**
 * The Leads grid.
 *
 * Columns, the row-id accessor, the default visibility, and the badge maps live
 * at module scope (a new identity for any of them is a table configuration
 * change for TanStack). The filters are built per render because the assignee
 * options come from the database; `filters` is render-only, so it does not need
 * a stable identity.
 *
 * Default view is the intake summary: who was hurt, how to reach them, the case
 * and its stage, who owns it, when it came in, and who submitted it. Everything
 * else — contact name, source, location, and the qualifying answers — is
 * available from the Columns menu. The new-ish filters start hidden and can be
 * turned on from the Filters menu.
 */
import { createColumnHelper } from "@tanstack/react-table";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import {
  CalendarDays,
  Columns3,
  Download,
  EllipsisVertical,
  Eye,
  FilterX,
  GripVertical,
  Heart,
  Loader2,
  Mail,
  Phone,
  SlidersHorizontal,
  Table2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  DataTable,
  MultiSelectFilter,
  useTableQuerySync,
  type DataTableFilter,
} from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table/features";
import {
  DATE_RANGE_ANY_OPTIONS,
  DateRangeFilter,
} from "@/components/date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  CASE_TYPE_LABELS,
  LEAD_STAGE_LABELS,
  assigneeLabel,
  caseTypeLabel,
  stateLabel,
} from "@/lib/labels";
import { formatDate } from "@/lib/format";
import {
  CASE_TYPES,
  LEAD_STAGES,
  type CaseType,
  type LeadStage,
} from "@/lib/db/schema";
import type { AuthUser } from "@/lib/auth/session";
import { saveLeadFields } from "@/lib/leads/actions";
import {
  UNASSIGNED,
  SENT_LEAD_LOCKED_MESSAGE,
  defaultAddedFrom,
  type LeadsView,
} from "@/lib/leads/constants";
import type { LeadFieldPatch } from "@/lib/leads/editable";
import {
  KANBAN_DEFAULT_LANE_SIZE,
  KANBAN_LANE_STEP,
  KANBAN_MAX_LANE_SIZE,
  isKanbanLaneParam,
  kanbanLaneParam,
} from "@/lib/leads/kanban";
import type { LeadRow, LeadsBoard } from "@/lib/leads/queries";
import {
  readPersistedState,
  readSavedViews,
  viewSignature,
  viewStateToParams,
  writePersistedState,
  writeSavedViews,
  type LeadViewState,
  type SavedLeadView,
} from "@/lib/leads/saved-views";
import { viewPreferenceCookie } from "@/lib/leads/view-preference";
import {
  can,
  canAssignLead,
  canChangeLeadStage,
  canEditLead,
  isLeadStageLocked,
} from "@/lib/rbac";
import {
  BOOLEAN_FILTER_OPTIONS,
  filtersFromKey,
  filtersKey,
  parseFilterValues,
  tableQueryToParams,
  type TableQuery,
} from "@/lib/table-query";
import { cn } from "@/lib/utils";
import { LeadDialog } from "./lead-dialog";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** Exhaustive maps, so a new stage/case type is a compile error until styled. */
const STAGE_BADGE: Record<LeadStage, BadgeVariant> = {
  NEW: "secondary",
  CONTACTED: "secondary",
  QUALIFIED: "default",
  RETAINED: "default",
  SENT_TO_FIRM: "outline",
  DISQUALIFIED: "destructive",
};

const CASE_TYPE_BADGE: Record<CaseType, BadgeVariant> = {
  MVA: "default",
  MASS_TORT: "secondary",
  OTHER: "outline",
};

const STAGE_OPTIONS = LEAD_STAGES.map((value) => ({
  label: LEAD_STAGE_LABELS[value],
  value,
}));

const LEADS_SORT_OPTIONS = [
  { label: "Newest to Oldest", value: "newest" },
  { label: "Oldest to Newest", value: "oldest" },
];

/** Sentinel for "no filter" in the compact panel's selects. */
const ANY_FILTER_VALUE = "__any__";

/** Optimistic inline values for a row, cleared once the grid catches up. */
interface RowOverride {
  stage?: LeadStage;
  assignedToId?: number | null;
}

/**
 * The view a restore navigation is currently applying. Persistence waits until
 * the page actually matches it: React's development double-mount runs the
 * restore effect twice, and the second pass must not read (or write) the
 * defaults the first pass has not navigated away from yet.
 */
let pendingRestore: LeadViewState | null = null;

interface LeadTableContextValue {
  viewer: AuthUser;
  assignees: Array<{ id: number; name: string }>;
  overrides: Record<number, RowOverride>;
  saving: Record<number, boolean>;
  save: (
    lead: LeadRow,
    patch: Pick<LeadFieldPatch, "stage" | "assignedToId">,
  ) => Promise<boolean>;
}

const LeadTableContext = createContext<LeadTableContextValue | null>(null);

function useLeadTable(): LeadTableContextValue {
  const value = useContext(LeadTableContext);
  if (!value) throw new Error("LeadTableContext is missing.");
  return value;
}

/** The row with its inline overrides applied, for opening the dialog. */
function applyOverride(
  lead: LeadRow,
  override: RowOverride | undefined,
): LeadRow {
  if (!override) return lead;
  return {
    ...lead,
    ...(override.stage !== undefined ? { stage: override.stage } : {}),
    ...(override.assignedToId !== undefined
      ? { assignedToId: override.assignedToId }
      : {}),
  };
}

function stopRow(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * The CSV download URL for the grid's current state.
 *
 * Page and page size are deliberately dropped: the export always covers every
 * lead under the filters, not the visible slice. `view` is carried explicitly so
 * the server makes the same stage-filter decision the page did.
 */
function leadsExportHref(query: TableQuery, view: LeadsView): string {
  const params = tableQueryToParams(query);
  params.delete("page");
  params.delete("pageSize");
  params.set("view", view);
  const search = params.toString();
  return `/api/leads/export${search ? `?${search}` : ""}`;
}

function leadName(lead: LeadRow): string {
  const name = [lead.injuredFirstName, lead.injuredLastName]
    .filter(Boolean)
    .join(" ");
  return name || "lead";
}

/** Columns hidden on first render; the Columns menu can reveal them. */
const DEFAULT_COLUMN_VISIBILITY = {
  bookmarked: false,
  contactName: false,
  source: false,
  state: false,
  county: false,
  isAtFault: false,
  hasAttorney: false,
  hasReceivedSettlement: false,
  potentialDuplicate: false,
  submitted: false,
};

/** Filter controls hidden on first render; the Filters menu can reveal them. */
const DEFAULT_FILTER_VISIBILITY = {
  bookmarked: true,
  submitted: true,
  isAtFault: false,
  hasAttorney: false,
  hasReceivedSettlement: false,
};

const EMPTY = <span className="text-muted-foreground">—</span>;

/** Tri-state answer: `null` renders as a dash, like every other empty cell. */
function TriStateCell({ value }: { value: boolean | null }) {
  if (value === null) return EMPTY;
  return <span>{value ? "Yes" : "No"}</span>;
}

const columnHelper = createColumnHelper<typeof dataTableFeatures, LeadRow>();

const columns = columnHelper.columns([
  columnHelper.accessor("injuredLastName", {
    header: "Injured person",
    cell: ({ row }) => {
      const name = [row.original.injuredFirstName, row.original.injuredLastName]
        .filter(Boolean)
        .join(" ");
      return (
        <span className="inline-flex items-center gap-1.5 font-medium">
          {name || "—"}
          {row.original.dupGroupId ? (
            <span
              role="img"
              aria-label="Potential duplicate"
              title="Potential duplicate"
              className="shrink-0"
            >
              <TriangleAlert
                className="size-3.5 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
            </span>
          ) : null}
        </span>
      );
    },
  }),
  columnHelper.accessor("injuredEmail", {
    header: "Email",
    enableSorting: false,
    cell: (info) => {
      const value = info.getValue();
      return (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">{value ?? "—"}</span>
          <CopyButton value={value} label="Email" />
        </div>
      );
    },
  }),
  columnHelper.accessor("injuredPhone", {
    header: "Phone",
    enableSorting: false,
    cell: (info) => {
      const value = info.getValue();
      return (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">{value ?? "—"}</span>
          <CopyButton value={value} label="Phone" />
        </div>
      );
    },
  }),
  columnHelper.accessor("caseType", {
    header: "Case type",
    cell: (info) => {
      const value = info.getValue();
      return value ? (
        <Badge variant={CASE_TYPE_BADGE[value as CaseType] ?? "outline"}>
          {caseTypeLabel(value)}
        </Badge>
      ) : (
        EMPTY
      );
    },
  }),
  columnHelper.accessor("stage", {
    header: "Stage",
    cell: ({ row }) => <StageCell lead={row.original} />,
  }),
  // The id is `assignedTo` (not `assignedToName`) so the assignee filter, which
  // carries a user id, can hold its state on this column.
  columnHelper.accessor("assignedToName", {
    id: "assignedTo",
    header: "Assigned to",
    cell: ({ row }) => <AssigneeCell lead={row.original} />,
  }),
  columnHelper.accessor("createdAt", {
    header: "Date",
    cell: (info) => (
      <span className="text-muted-foreground">
        {formatDate(info.getValue())}
      </span>
    ),
  }),
  columnHelper.accessor("isFillingForSomeoneElse", {
    header: "Submitted by",
    enableSorting: false,
    cell: (info) => (info.getValue() ? "Someone else" : "Self"),
  }),
  columnHelper.display({
    id: "contactName",
    header: "Contact name",
    cell: ({ row }) => {
      const name = [row.original.fillerFirstName, row.original.fillerLastName]
        .filter(Boolean)
        .join(" ");
      return name || EMPTY;
    },
  }),
  columnHelper.accessor("source", {
    header: "Source",
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue() ?? "—"}</span>
    ),
  }),
  columnHelper.accessor("state", {
    header: "State",
    cell: (info) => <span>{stateLabel(info.getValue()) || "—"}</span>,
  }),
  columnHelper.accessor("county", {
    header: "County",
    cell: (info) => <span>{info.getValue() ?? "—"}</span>,
  }),
  columnHelper.accessor("isAtFault", {
    header: "At fault",
    enableSorting: false,
    cell: (info) => <TriStateCell value={info.getValue()} />,
  }),
  columnHelper.accessor("hasAttorney", {
    header: "Has attorney",
    enableSorting: false,
    cell: (info) => <TriStateCell value={info.getValue()} />,
  }),
  columnHelper.accessor("hasReceivedSettlement", {
    header: "Received settlement",
    enableSorting: false,
    cell: (info) => <TriStateCell value={info.getValue()} />,
  }),
  // The "Duplicates" filter is hosted by this (hidden by default) column.
  columnHelper.accessor((row) => row.dupGroupId !== null, {
    id: "potentialDuplicate",
    header: "Potential duplicate",
    enableSorting: false,
    cell: (info) => (info.getValue() ? "Yes" : EMPTY),
  }),
  // The "Bookmarked" filter is hosted by this column. It is never a visible
  // table column or a Columns-menu choice; the filter control is the whole
  // feature.
  columnHelper.accessor("bookmarked", {
    header: "Bookmarked",
    enableSorting: false,
    enableHiding: false,
    cell: (info) => (info.getValue() ? "Yes" : EMPTY),
  }),
  // The "Submitted" filter is hosted by this hidden column, same pattern.
  columnHelper.accessor((row) => row.isFillingForSomeoneElse, {
    id: "submitted",
    header: "Submitted",
    enableSorting: false,
    enableHiding: false,
    cell: (info) => {
      const value = info.getValue();
      return value === null ? EMPTY : <span>{value ? "Other" : "Self"}</span>;
    },
  }),
]);

/** Stable row id so sorting/filtering preserves row identity. */
const getRowId = (lead: LeadRow) => String(lead.id);

/** Labels for the mobile Columns checklist, derived from the column defs. */
const COLUMN_OPTIONS = columns
  .filter((column) => column.enableHiding !== false)
  .map((column) => {
    const id =
      column.id ??
      ("accessorKey" in column && typeof column.accessorKey === "string"
        ? column.accessorKey
        : "");
    return {
      id,
      label: typeof column.header === "string" ? column.header : id,
    };
  })
  .filter((option) => option.id);

/** Filter descriptors; assignee options depend on the loaded team. */
function buildFilters(
  assignees: Array<{ id: number; name: string }>,
  viewerId: number,
): DataTableFilter[] {
  return [
    {
      columnId: "caseType",
      label: "Case type",
      allLabel: "Any",
      multiple: true,
      options: CASE_TYPES.map((value) => ({
        label: CASE_TYPE_LABELS[value],
        value,
      })),
    },
    {
      columnId: "stage",
      label: "Stage",
      allLabel: "Any",
      multiple: true,
      options: LEAD_STAGES.map((value) => ({
        label: LEAD_STAGE_LABELS[value],
        value,
      })),
    },
    {
      columnId: "assignedTo",
      label: "Assigned to",
      allLabel: "Anyone",
      multiple: true,
      options: [
        { label: "Unassigned", value: UNASSIGNED },
        ...assignees.map((assignee) => ({
          label: assigneeLabel(assignee, viewerId),
          value: String(assignee.id),
        })),
      ],
    },
    {
      columnId: "potentialDuplicate",
      label: "Duplicates",
      allLabel: "Show All",
      options: [
        { label: "Potential Duplicates", value: "yes" },
        { label: "Unique", value: "no" },
      ],
    },
    {
      // Personal to the signed-in user: "Yes" never includes anyone else's
      // bookmarks. Visible by default because it is a primary way back to a
      // lead someone is working on.
      columnId: "bookmarked",
      label: "Bookmarked",
      allLabel: "Any",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    },
    {
      // Whether the injured person filed the form themselves or someone else
      // did. The lead's `isFillingForSomeoneElse` boolean backs it.
      columnId: "submitted",
      label: "Submitted",
      allLabel: "Any",
      options: [
        { label: "Self", value: "self" },
        { label: "Other", value: "other" },
      ],
    },
    {
      columnId: "isAtFault",
      label: "At fault",
      allLabel: "Any",
      options: BOOLEAN_FILTER_OPTIONS,
    },
    {
      columnId: "hasAttorney",
      label: "Has attorney",
      allLabel: "Any",
      options: BOOLEAN_FILTER_OPTIONS,
    },
    {
      columnId: "hasReceivedSettlement",
      label: "Received settlement",
      allLabel: "Any",
      options: BOOLEAN_FILTER_OPTIONS,
    },
  ];
}

export function LeadsTable({
  leads,
  total,
  board,
  laneLimits,
  query,
  assignees,
  viewer,
  view,
  preserveFilters,
}: {
  leads: LeadRow[];
  total: number;
  /** Per-stage windows for the Kanban board; absent in the table view. */
  board?: LeadsBoard;
  /** How many cards each lane has loaded, read from the URL by the page. */
  laneLimits: Record<LeadStage, number>;
  query: TableQuery;
  assignees: Array<{ id: number; name: string }>;
  /** The signed-in user, so the detail dialog can run the RBAC policies. */
  viewer: AuthUser;
  /** Table or Kanban; the server loads six lane windows for the board. */
  view: LeadsView;
  /**
   * Restore the filters saved in this browser. Only the sidebar's Leads link
   * asks for it; any other landing on `/leads` starts with cleared filters.
   */
  preserveFilters: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isPending, onQueryChange } = useTableQuerySync();
  const [viewPending, startViewTransition] = useTransition();
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [overrides, setOverrides] = useState<Record<number, RowOverride>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  // A stage move can push a card outside its target lane's loaded window. Keep
  // the card visible until the filters change, so dragging never silently makes
  // it disappear.
  const [pinned, setPinned] = useState<
    Array<{ scope: string; row: LeadRow }>
  >([]);
  const [hiddenStages, setHiddenStages] = useState<LeadStage[]>([]);
  const [filterVisibility, setFilterVisibility] = useState<
    Record<string, boolean>
  >(() => ({ ...DEFAULT_FILTER_VISIBILITY }));
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => ({ ...DEFAULT_COLUMN_VISIBILITY }));
  const [savedViews, setSavedViews] = useState<SavedLeadView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewsReady, setViewsReady] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [viewName, setViewName] = useState("");

  // Attribution (source + tracking ids) is admin-only. The server already blanks
  // the values; dropping the column and its filter keeps the grid from offering
  // something the viewer can't see.
  const canSeeAttribution = can(viewer.role, "leads.view.attribution");
  const visibleColumns = useMemo(
    () =>
      canSeeAttribution
        ? columns
        : columns.filter(
            (column) =>
              !("accessorKey" in column && column.accessorKey === "source"),
          ),
    [canSeeAttribution],
  );

  const filterKey = filtersKey(query.filters);
  const currentFilters = useMemo(() => filtersFromKey(filterKey), [filterKey]);
  // A pin only belongs to the board state that produced it. Filters, search,
  // sort or a view switch start a new scope and drop stale cards automatically.
  const pinScope = [
    view,
    filterKey,
    query.search,
    query.sort?.id ?? "",
    query.sort?.desc ? "desc" : "asc",
  ].join("|");

  // Restore browser-local state from the last visit. The UI preferences (which
  // filters and columns show, hidden stages, saved views) always come back; the
  // filter values themselves only return when the link asks for them with
  // `preserveFilters=true`, which only the sidebar's Leads item does. A plain
  // `/leads` landing deliberately starts with cleared filters.
  // Everything here is browser-local; nothing is sent to the server.
  /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage on mount is the external-system case */
  useEffect(() => {
    const stored = readPersistedState();
    if (stored) {
      setFilterVisibility(stored.filterVisibility);
      setColumnVisibility({
        ...DEFAULT_COLUMN_VISIBILITY,
        ...stored.columnVisibility,
      });
      setHiddenStages(stored.hiddenStages as LeadStage[]);
      setActiveViewId(stored.activeViewId);
    }
    setSavedViews(readSavedViews());
    setViewsReady(true);

    // A URL that already carries filters is an explicit request (a shared link,
    // a stat card, or the back button), so it always wins over storage.
    const params = new URLSearchParams(window.location.search);
    const hasState = [...params.keys()].some(
      (key) =>
        key.startsWith("filter.") ||
        ["view", "search", "sort", "sortDir", "page", "pageSize"].includes(key),
    );
    if (stored && preserveFilters && !hasState) {
      pendingRestore = {
        view: stored.view,
        filters: stored.filters,
        search: stored.search,
        sort: stored.sort,
        filterVisibility: stored.filterVisibility,
        columnVisibility: stored.columnVisibility,
        hiddenStages: stored.hiddenStages,
      };
      const next = viewStateToParams(stored, {
        page: stored.page,
        pageSize: stored.pageSize,
      }).toString();
      startViewTransition(() => {
        router.replace(next ? `${pathname}?${next}` : pathname, {
          scroll: false,
        });
      });
    } else if (stored && !params.has("view") && stored.view !== view) {
      // The URL carries explicit filters/search/sort/paging, so keep those, but
      // the view is a preference rather than a filter. Apply the last view
      // without restoring any of the other stored state.
      params.set("view", stored.view);
      startViewTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    }
    // Runs on mount and whenever the sidebar's preserve flag changes. The other
    // values captured here are only read, so they are not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preserveFilters]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sortId = query.sort?.id;
  const sortDesc = query.sort?.desc;
  useEffect(() => {
    if (!viewsReady) return;
    // Hold writes until the restore navigation lands; otherwise the bare page's
    // defaults would overwrite the state we are restoring from.
    if (pendingRestore) {
      const restored = viewSignature({
        view,
        filters: currentFilters,
        search: query.search,
        sort: sortId ? { id: sortId, desc: Boolean(sortDesc) } : null,
        filterVisibility,
        columnVisibility,
        hiddenStages,
      });
      if (restored !== viewSignature(pendingRestore)) return;
      pendingRestore = null;
    }
    // A "View similar" drill-down is transient: do not make it the state a
    // later bare /leads visit restores.
    const persistedFilters = { ...currentFilters };
    delete persistedFilters.dupGroup;

    // Keep the server-visible preference in step with the view actually shown,
    // including restores and saved views.
    document.cookie = viewPreferenceCookie(view);

    writePersistedState({
      view,
      filters: persistedFilters,
      search: query.search,
      sort: sortId ? { id: sortId, desc: Boolean(sortDesc) } : null,
      filterVisibility,
      columnVisibility,
      hiddenStages,
      activeViewId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }, [
    viewsReady,
    view,
    currentFilters,
    query.search,
    query.page,
    query.pageSize,
    sortId,
    sortDesc,
    filterVisibility,
    columnVisibility,
    hiddenStages,
    activeViewId,
  ]);

  const currentViewState: LeadViewState = {
    view,
    filters: currentFilters,
    search: query.search,
    sort: query.sort ?? null,
    filterVisibility,
    columnVisibility,
    hiddenStages,
  };
  const currentSignature = viewSignature(currentViewState);
  const activeView = savedViews.find((item) => item.id === activeViewId);
  // The heart stays red only while the page still matches its saved view.
  const viewActive = Boolean(
    activeView && viewSignature(activeView) === currentSignature,
  );

  function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return;
    const entry: SavedLeadView = {
      ...currentViewState,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: Date.now(),
    };
    const next = [...savedViews, entry];
    setSavedViews(next);
    writeSavedViews(next);
    setActiveViewId(entry.id);
    setSaveOpen(false);
    setViewName("");
    toast.success("View saved", {
      description: "Saved in this browser.",
    });
  }

  function deleteSavedView(id: string) {
    const next = savedViews.filter((item) => item.id !== id);
    setSavedViews(next);
    writeSavedViews(next);
    if (activeViewId === id) setActiveViewId(null);
  }

  function applySavedView(saved: SavedLeadView) {
    setFilterVisibility(saved.filterVisibility);
    setColumnVisibility({
      ...DEFAULT_COLUMN_VISIBILITY,
      ...saved.columnVisibility,
    });
    setHiddenStages(saved.hiddenStages as LeadStage[]);
    setActiveViewId(saved.id);
    setListOpen(false);
    const next = viewStateToParams(saved).toString();
    startViewTransition(() => {
      router.replace(next ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    });
  }

  /** Clear the active filter values and search; saved views are untouched. */
  function clearFilters() {
    setActiveViewId(null);
    onQueryChange({
      ...query,
      page: 1,
      search: "",
      filters: {},
    });
  }

  /**
   * Inline stage/assignee save. The row updates immediately, the control is
   * disabled until the action returns, and a rejection puts the old value back.
   */
  async function save(
    lead: LeadRow,
    patch: Pick<LeadFieldPatch, "stage" | "assignedToId">,
  ): Promise<boolean> {
    const id = lead.id;
    const previousRow = applyOverride(lead, overrides[id]);
    setOverrides((previous) => ({
      ...previous,
      [id]: { ...previous[id], ...patch },
    }));
    setSaving((previous) => ({ ...previous, [id]: true }));

    // A moved card may rank outside the target lane's window, so pin it to this
    // board state. It is dropped automatically once the server sends it back in
    // a lane, or when the filters/search/sort change.
    if (view === "kanban" && patch.stage !== undefined) {
      const nextStage = patch.stage;
      setPinned((previous) => [
        ...previous.filter((item) => item.row.id !== id),
        { scope: pinScope, row: { ...previousRow, stage: nextStage } },
      ]);
    }

    const result = await saveLeadFields(id, patch);

    setSaving((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });

    if (!result.ok) {
      setPinned((previous) => previous.filter((item) => item.row.id !== id));
      setOverrides((previous) => {
        const next = { ...previous };
        const current = { ...next[id] };
        for (const key of Object.keys(patch) as Array<keyof RowOverride>) {
          delete current[key];
        }
        if (Object.keys(current).length === 0) delete next[id];
        else next[id] = current;
        return next;
      });
      toast.error("Could not save the lead", {
        description: result.error ?? "Please try again.",
      });
      return false;
    }

    return true;
  }

  // Reflect the date sort actually in force (the default is newest first), so
  // the control never reads "Default" while the grid is already date-sorted.
  const sortValue =
    query.sort?.id === "createdAt"
      ? query.sort.desc
        ? "newest"
        : "oldest"
      : "";

  const addedWithin = query.filters.addedWithin;
  const addedPreset =
    addedWithin === "any" ||
    addedWithin === "24h" ||
    addedWithin === "3d" ||
    addedWithin === "7d" ||
    addedWithin === "30d" ||
    addedWithin === "custom"
      ? addedWithin
      : query.filters.addedFrom || query.filters.addedTo
        ? "custom"
        : "any";

  /** Change the board sort without touching the date filter. */
  function changeSort(value: string) {
    if (!value) return;
    onQueryChange({
      ...query,
      page: 1,
      sort: { id: "createdAt", desc: value === "newest" },
    });
  }

  /** Switch between the rolling presets and the custom pickers. */
  function changeAddedPreset(preset: string) {
    const filters: Record<string, string> = {
      ...query.filters,
      addedWithin: preset,
    };
    if (preset === "custom") {
      if (!filters.addedFrom) filters.addedFrom = defaultAddedFrom();
    } else {
      delete filters.addedFrom;
      delete filters.addedTo;
    }
    onQueryChange({ ...query, page: 1, filters });
  }

  /** Apply the custom added-date range; the lower bound is required. */
  function changeDateRange(from: string, to: string) {
    if (!from) return;
    const filters: Record<string, string> = {
      ...query.filters,
      addedWithin: "custom",
      addedFrom: from,
    };
    if (to) filters.addedTo = to;
    else delete filters.addedTo;
    onQueryChange({ ...query, page: 1, filters });
  }

  /** Switch views without losing the search, filters or sort. */
  function changeView(next: LeadsView) {
    if (next === view) return;
    const params = new URLSearchParams(window.location.search);
    // Always name the view explicitly: the choice must survive navigation and
    // must win over the stored preference for this page.
    params.set("view", next);
    if (next === "kanban") {
      // The board has no global pages; start at the top if the user returns.
      params.delete("page");
      // The board groups by stage, so the stage filter makes no sense there.
      params.delete("filter.stage");
    } else {
      // Lane windows are transient board state, not part of the grid query.
      for (const key of [...params.keys()]) {
        if (isKanbanLaneParam(key)) params.delete(key);
      }
    }
    // Record the preference immediately, before the next navigation can read it.
    document.cookie = viewPreferenceCookie(next);
    const search = params.toString();
    startViewTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    });
  }

  /**
   * Expand one stage lane by a page of cards. The limit lives in the URL so the
   * back button collapses it again and a reload keeps the lane open.
   */
  function showMoreCards(stage: LeadStage) {
    const current = laneLimits[stage] ?? KANBAN_DEFAULT_LANE_SIZE;
    const next = Math.min(current + KANBAN_LANE_STEP, KANBAN_MAX_LANE_SIZE);
    if (next === current) return;
    const params = new URLSearchParams(window.location.search);
    params.set(kanbanLaneParam(stage), String(next));
    const search = params.toString();
    startViewTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    });
  }

  // The board is already grouped by stage, so its filter is noise there.
  const boardFilters = buildFilters(assignees, viewer.id).filter(
    (filter) => !(view === "kanban" && filter.columnId === "stage"),
  );

  const dateFilter = (
    <DateRangeFilter
      label="Added"
      options={DATE_RANGE_ANY_OPTIONS}
      preset={addedPreset}
      from={query.filters.addedFrom ?? defaultAddedFrom()}
      to={query.filters.addedTo ?? ""}
      onPresetChange={changeAddedPreset}
      onChange={changeDateRange}
    />
  );

  /** Write one filter value from the compact panel. */
  function setFilterValue(columnId: string, value: string) {
    const filters: Record<string, string> = { ...query.filters };
    if (value) filters[columnId] = value;
    else delete filters[columnId];
    onQueryChange({ ...query, page: 1, filters });
  }

  // What Clear Filters would actually clear: every filter value plus the search.
  // The Added range is one filter, whichever shape it takes, and "All Time" is
  // not active.
  const dateFilterActive = Boolean(addedWithin) && addedWithin !== "any";
  const activeFilterCount =
    Object.keys(query.filters).filter(
      (key) =>
        !["addedWithin", "addedFrom", "addedTo"].includes(key) &&
        query.filters[key],
    ).length +
    (dateFilterActive ? 1 : 0) +
    (query.search ? 1 : 0);

  /** Shared badge so the Options and Clear Filters triggers agree. */
  const filterCountBadge =
    activeFilterCount > 0 ? (
      <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
        {activeFilterCount}
      </span>
    ) : null;

  const columnOptions = COLUMN_OPTIONS.filter(
    (option) => canSeeAttribution || option.id !== "source",
  );

  const mobileControls = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="xl:hidden"
      onClick={() => setControlsOpen(true)}
    >
      <SlidersHorizontal aria-hidden />
      Options
      {filterCountBadge}
      {viewActive ? (
        <Heart
          aria-label="Saved view active"
          className="size-3.5 fill-red-500 text-red-500"
        />
      ) : null}
    </Button>
  );

  const stageMenu =
    view === "kanban" ? (
      <StageVisibilityMenu
        hidden={hiddenStages}
        onToggle={(stage, visible) =>
          setHiddenStages((previous) =>
            visible
              ? previous.filter((value) => value !== stage)
              : [...previous, stage],
          )
        }
        onReset={() => setHiddenStages([])}
      />
    ) : null;

  const viewToggle = (
    <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
      <Button
        type="button"
        size="icon-sm"
        variant={view === "table" ? "secondary" : "ghost"}
        className="h-7 w-7"
        aria-label="Table view"
        title="Table view"
        aria-pressed={view === "table"}
        onClick={() => changeView("table")}
      >
        <Table2 />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant={view === "kanban" ? "secondary" : "ghost"}
        className="h-7 w-7"
        aria-label="Kanban view"
        title="Kanban view"
        aria-pressed={view === "kanban"}
        onClick={() => changeView("kanban")}
      >
        <Columns3 />
      </Button>
    </div>
  );

  const contextValue: LeadTableContextValue = {
    viewer,
    assignees,
    overrides,
    saving,
    save,
  };

  return (
    <LeadTableContext.Provider value={contextValue}>
      {query.filters.dupGroup ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Showing potential duplicates for this lead.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearFilters}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={visibleColumns}
        data={leads}
        rowCount={total}
        query={query}
        onQueryChange={onQueryChange}
        isPending={isPending || viewPending}
        getRowId={getRowId}
        ariaLabel="Leads"
        searchPlaceholder="Search by name, email, or phone"
        filters={boardFilters}
        defaultFilterVisibility={DEFAULT_FILTER_VISIBILITY}
        defaultColumnVisibility={DEFAULT_COLUMN_VISIBILITY}
        filterVisibility={filterVisibility}
        onFilterVisibilityChange={setFilterVisibility}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        emptyMessage="No leads yet."
        emptyFilteredMessage="No leads match your filters."
        mobileControls={mobileControls}
        toolbarFilters={dateFilter}
        filtersMenu
        filtersMenuCount={activeFilterCount}
        toolbarActions={
          <div className="flex items-center gap-2">
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
          </div>
        }
        headerLeading={
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">
              Sort
            </span>
            <Select
              items={LEADS_SORT_OPTIONS}
              value={sortValue || null}
              onValueChange={(value) => {
                if (value) changeSort(value);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-44"
                aria-label="Sort leads by date added"
              >
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                {LEADS_SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        headerActions={
          <div className="flex flex-wrap items-center gap-2">
            {viewToggle}
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setListOpen(true)}
              >
                Saved Views
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="View actions"
                      title="View actions"
                    />
                  }
                >
                  <EllipsisVertical
                    className={cn("size-4", viewActive && "text-red-500")}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setViewName("");
                        setSaveOpen(true);
                      }}
                    >
                      <Heart
                        className={cn(
                          "size-4",
                          viewActive && "fill-red-500 text-red-500",
                        )}
                      />
                      Save View
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      render={
                        <a href={leadsExportHref(query, view)} download />
                      }
                    >
                      <Download />
                      Download CSV
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        }
        columnMenu={stageMenu}
        showColumnMenu={view === "table"}
        renderContent={
          view === "kanban" ? (
            viewsReady && board ? (
              <LeadsKanban
                lanes={board.lanes}
                counts={board.counts}
                laneLimits={laneLimits}
                pinned={pinned
                  .filter((item) => item.scope === pinScope)
                  .map((item) => item.row)}
                hiddenStages={hiddenStages}
                onOpen={(lead) => setSelected(lead)}
                onShowMore={showMoreCards}
              />
            ) : (
              // The saved stages live in localStorage, so the server cannot know
              // them on the first paint. Hold the board until the mount effect
              // has read them, or every stage would flash before the saved
              // selection applies.
              <KanbanSkeleton />
            )
          ) : undefined
        }
        onRowClick={
          view === "table"
            ? (lead) => setSelected(applyOverride(lead, overrides[lead.id]))
            : undefined
        }
      />

      <Sheet open={controlsOpen} onOpenChange={setControlsOpen}>
        <SheetContent side="right" className="w-[92vw] gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>View and filters</SheetTitle>
            <SheetDescription>
              Change what this page shows without leaving it.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
            <section className="space-y-2">
              <p className="text-sm font-medium">View</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={view === "table" ? "secondary" : "outline"}
                  aria-pressed={view === "table"}
                  onClick={() => changeView("table")}
                >
                  <Table2 aria-hidden />
                  Table
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={view === "kanban" ? "secondary" : "outline"}
                  aria-pressed={view === "kanban"}
                  onClick={() => changeView("kanban")}
                >
                  <Columns3 aria-hidden />
                  Kanban
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <label
                htmlFor="mobile-board-sort"
                className="text-sm font-medium"
              >
                Sort
              </label>
              <Select
                items={LEADS_SORT_OPTIONS}
                value={sortValue || null}
                onValueChange={(value) => {
                  if (value) changeSort(value);
                }}
              >
                <SelectTrigger
                  id="mobile-board-sort"
                  className="w-full"
                  aria-label="Sort leads by date added"
                >
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  {LEADS_SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section className="space-y-2">
              <p className="text-sm font-medium">Saved views</p>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setControlsOpen(false);
                  setListOpen(true);
                }}
              >
                Browse saved views
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {savedViews.length}
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setControlsOpen(false);
                  setViewName("");
                  setSaveOpen(true);
                }}
              >
                <Heart
                  aria-hidden
                  className={cn(
                    "size-4",
                    viewActive && "fill-red-500 text-red-500",
                  )}
                />
                Save current view
              </Button>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Filters</p>
                <div className="flex items-center gap-1">
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
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    nativeButton={false}
                    render={
                      <a href={leadsExportHref(query, view)} download />
                    }
                    aria-label="Download filtered leads as CSV"
                    title="Download filtered leads as CSV"
                  >
                    <Download aria-hidden />
                  </Button>
                </div>
              </div>

              {dateFilter}

              {boardFilters.map((filter) => {
                const current = query.filters[filter.columnId] ?? "";
                const values = [
                  { label: filter.allLabel, value: ANY_FILTER_VALUE },
                  ...filter.options,
                ];
                return (
                  <div key={filter.columnId} className="space-y-1.5">
                    <label
                      htmlFor={`mobile-filter-${filter.columnId}`}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {filter.label}
                    </label>
                    {filter.multiple ? (
                      <MultiSelectFilter
                        triggerId={`mobile-filter-${filter.columnId}`}
                        allLabel={filter.allLabel}
                        options={filter.options}
                        selected={parseFilterValues(current)}
                        onChange={(next) =>
                          setFilterValue(filter.columnId, next.join(","))
                        }
                        className="w-full"
                      />
                    ) : (
                      <Select
                        items={values}
                        value={current || ANY_FILTER_VALUE}
                        onValueChange={(value) =>
                          setFilterValue(
                            filter.columnId,
                            !value || value === ANY_FILTER_VALUE ? "" : value,
                          )
                        }
                      >
                        <SelectTrigger
                          id={`mobile-filter-${filter.columnId}`}
                          className={cn(
                            "w-full",
                            current &&
                              "border-primary/50 bg-primary/10 hover:bg-primary/15 dark:bg-primary/20 dark:hover:bg-primary/25",
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ANY_FILTER_VALUE}>
                            {filter.allLabel}
                          </SelectItem>
                          {filter.options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
            </section>

            {view === "table" ? (
              <section className="space-y-2">
                <p className="text-sm font-medium">Columns</p>
                <div className="space-y-1">
                  {columnOptions.map((option) => (
                    <label
                      key={option.id}
                      className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm"
                    >
                      <Checkbox
                        checked={columnVisibility[option.id] !== false}
                        onCheckedChange={(checked) =>
                          setColumnVisibility({
                            ...columnVisibility,
                            [option.id]: checked === true,
                          })
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </section>
            ) : (
              <section className="space-y-2">
                <p className="text-sm font-medium">Stages</p>
                <div className="space-y-1">
                  {LEAD_STAGES.map((stage) => (
                    <label
                      key={stage}
                      className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm"
                    >
                      <Checkbox
                        checked={!hiddenStages.includes(stage)}
                        onCheckedChange={(checked) =>
                          setHiddenStages((previous) =>
                            checked === true
                              ? previous.filter((value) => value !== stage)
                              : [...previous, stage],
                          )
                        }
                      />
                      {LEAD_STAGE_LABELS[stage]}
                    </label>
                  ))}
                </div>
              </section>
            )}
          </div>

          <SheetFooter className="border-t">
            <Button
              type="button"
              className="w-full"
              onClick={() => setControlsOpen(false)}
            >
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <LeadDialog
        lead={selected}
        onClose={() => {
          setSelected(null);
          // The dialog revalidates the grid as it saves, so its values are the
          // freshest source once it closes.
          setOverrides({});
        }}
        viewer={viewer}
        assignees={assignees}
      />

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveCurrentView();
            }}
          >
            <DialogHeader>
              <DialogTitle>Save view</DialogTitle>
              <DialogDescription>
                This view configurationis stored in this browser.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label htmlFor="saved-view-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="saved-view-name"
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
                placeholder="e.g. Unassigned MVAs this week"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaveOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!viewName.trim()}>
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Saved views</DialogTitle>
            <DialogDescription>
              Presets for filters, sorting and visibility options.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {savedViews.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No saved views yet. Set the page up the way you like and save the view for quick future use.
              </p>
            ) : (
              savedViews.map((saved) => (
                <div
                  key={saved.id}
                  className="flex items-center gap-1 rounded-lg border px-2 py-1.5 hover:bg-muted/50"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => applySavedView(saved)}
                  >
                    <span className="block truncate text-sm font-medium">
                      {saved.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {saved.view === "table" ? "Table" : "Kanban"}
                      {saved.id === activeViewId ? " · current" : ""}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${saved.name}`}
                    onClick={() => deleteSavedView(saved.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </LeadTableContext.Provider>
  );
}

/** The stage badge, or a compact select when the viewer may change it. */
function StageCell({ lead }: { lead: LeadRow }) {
  const { viewer, overrides, saving, save } = useLeadTable();
  const override = overrides[lead.id];
  const stage = override?.stage ?? lead.stage;
  const assignedToId =
    override?.assignedToId !== undefined
      ? override.assignedToId
      : lead.assignedToId;
  const subject = { ...lead, stage, assignedToId };
  const editable = canEditLead(viewer, subject);
  const isSaving = Boolean(saving[lead.id]);

  // Sent to Firm is final: show the badge rather than a control that the
  // service would refuse anyway.
  if (!editable || isLeadStageLocked({ stage })) {
    return (
      <Badge variant={STAGE_BADGE[stage]}>{LEAD_STAGE_LABELS[stage]}</Badge>
    );
  }

  return (
    <div className="flex items-center gap-1.5" onKeyDown={stopRow}>
      <Select
        items={STAGE_OPTIONS}
        value={stage}
        onValueChange={(value) => {
          if (!value) return;
          void save(lead, { stage: value as LeadStage });
        }}
        disabled={isSaving}
      >
        <SelectTrigger
          size="sm"
          className="h-7 w-36"
          aria-label={`Stage for ${leadName(lead)}`}
          onClick={stopRow}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STAGE_OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={
                option.value !== stage &&
                !canChangeLeadStage(viewer, subject, option.value)
              }
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isSaving ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : null}
    </div>
  );
}

/** The assignee selector for admins, the claim/release button for agents. */
function AssigneeCell({
  lead,
  compact = false,
}: {
  lead: LeadRow;
  compact?: boolean;
}) {
  const { viewer, assignees, overrides, saving, save } = useLeadTable();
  const override = overrides[lead.id];
  const assignedToId =
    override?.assignedToId !== undefined
      ? override.assignedToId
      : lead.assignedToId;
  const subject = { ...lead, assignedToId };
  const isSaving = Boolean(saving[lead.id]);
  const canAssignAny = can(viewer.role, "leads.assign.any");
  const canClaim = canAssignLead(viewer, subject, viewer.id);
  const canRelease = canAssignLead(viewer, subject, null);

  function claim() {
    if (isSaving) return;
    void save(lead, { assignedToId: viewer.id });
  }

  function release() {
    if (isSaving) return;
    void save(lead, { assignedToId: null });
  }

  if (canAssignAny) {
    const options = [
      { label: "Unassigned", value: UNASSIGNED },
      ...assignees.map((assignee) => ({
        label: assigneeLabel(assignee, viewer.id),
        value: String(assignee.id),
      })),
    ];

    return (
      <div className="flex items-center gap-1.5" onKeyDown={stopRow}>
        <Select
          items={options}
          value={assignedToId === null ? UNASSIGNED : String(assignedToId)}
          onValueChange={(value) => {
            if (!value) return;
            void save(lead, {
              assignedToId: value === UNASSIGNED ? null : Number(value),
            });
          }}
          disabled={isSaving}
        >
          <SelectTrigger
            size="sm"
            className={cn("h-7", compact ? "w-full" : "w-40")}
            aria-label={`Assignee for ${leadName(lead)}`}
            onClick={stopRow}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSaving ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : null}
      </div>
    );
  }

  if (assignedToId === viewer.id && canRelease) {
    return (
      <div className="flex items-center gap-1.5" onKeyDown={stopRow}>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={isSaving}
          onClick={(event) => {
            event.stopPropagation();
            release();
          }}
        >
          Release
        </Button>
        {isSaving ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : null}
      </div>
    );
  }

  if (assignedToId === null && canClaim) {
    return (
      <div className="flex items-center gap-1.5" onKeyDown={stopRow}>
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={isSaving}
          onClick={(event) => {
            event.stopPropagation();
            claim();
          }}
        >
          Claim
        </Button>
        {isSaving ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : null}
      </div>
    );
  }

  const name =
    assignedToId === null
      ? null
      : (assignees.find((assignee) => assignee.id === assignedToId)?.name ??
        lead.assignedToName);
  return name ? <span>{name}</span> : EMPTY;
}

/** Column accents for the board, matching the stage colours in globals.css. */
const STAGE_COLOR: Record<LeadStage, string> = {
  NEW: "var(--stage-new)",
  CONTACTED: "var(--stage-contacted)",
  QUALIFIED: "var(--stage-qualified)",
  RETAINED: "var(--stage-retained)",
  SENT_TO_FIRM: "var(--stage-sent_to_firm)",
  DISQUALIFIED: "var(--stage-disqualified)",
};

/**
 * The board's first-paint stand-in.
 *
 * Stage visibility is browser-local, so the server render cannot know which
 * columns to show. Drawing the columns from `hiddenStages` immediately would
 * flash every stage before the restore effect runs; this keeps the space and
 * shows no stage names until the saved state is ready.
 */
function KanbanSkeleton() {
  return (
    <div className="flex min-h-[calc(100svh-13rem)] items-start gap-2.5 overflow-hidden pr-4 pb-2 xl:min-h-[calc(100svh-17rem)]">
      <p role="status" className="sr-only">
        Loading your board…
      </p>
      {LEAD_STAGES.map((stage) => (
        <div
          key={stage}
          aria-hidden
          className="flex min-w-52 flex-1 flex-col gap-2 rounded-xl border bg-muted/20 p-2.5"
        >
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * The Kanban board.
 *
 * The server hands us a bounded window per stage plus the true count of every
 * stage, so a column can say "165" while painting the newest 10. Cards are drag
 * targets: dropping one on another column calls the same `save` used by the
 * table and dialog, which applies the stage change optimistically and quietly
 * reverts it if the server refuses.
 */
function LeadsKanban({
  lanes,
  counts,
  laneLimits,
  pinned,
  hiddenStages,
  onOpen,
  onShowMore,
}: {
  lanes: Record<LeadStage, LeadRow[]>;
  counts: Record<LeadStage, number>;
  laneLimits: Record<LeadStage, number>;
  /** Cards moved this session that the target lane's window does not contain. */
  pinned: LeadRow[];
  hiddenStages: LeadStage[];
  onOpen: (lead: LeadRow) => void;
  onShowMore: (stage: LeadStage) => void;
}) {
  const { viewer, overrides, saving, save } = useLeadTable();
  const [dragId, setDragId] = useState<number | null>(null);
  const [hoverStage, setHoverStage] = useState<LeadStage | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrame = useRef<number | null>(null);
  const autoScrollPoint = useRef<{
    x: number;
    y: number;
    direction: number;
  } | null>(null);
  const pointerLead = useRef<LeadRow | null>(null);

  const effective = (lead: LeadRow): LeadRow =>
    applyOverride(lead, overrides[lead.id]);

  // Only the loaded cards can be dragged; the lane windows bound this list.
  const loaded = LEAD_STAGES.flatMap((stage) => lanes[stage] ?? []);
  const loadedIds = new Set(loaded.map((lead) => lead.id));
  // A moved card the server did not return in a lane stays visible until the
  // board scope changes, so it never appears to vanish mid-drag.
  const pinnedCards = pinned.filter((lead) => !loadedIds.has(lead.id));
  const tracked = [...loaded, ...pinnedCards];

  /**
   * The stage column under a screen point. Native HTML drag events carry no
   * usable position for this, so the pointer drag (touch and mouse on the
   * handle) hit-tests the DOM instead.
   */
  function stageAtPoint(x: number, y: number): LeadStage | null {
    const element = document.elementFromPoint(x, y);
    const column = element?.closest<HTMLElement>("[data-stage]");
    const value = column?.dataset.stage;
    return value && (LEAD_STAGES as readonly string[]).includes(value)
      ? (value as LeadStage)
      : null;
  }

  function stopAutoScroll() {
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
    autoScrollPoint.current = null;
  }

  /** Keep the board scrolling while a drag is held near either edge. */
  function autoScrollTick() {
    const scroller = boardRef.current;
    const point = autoScrollPoint.current;
    if (!scroller || !point || point.direction === 0) {
      autoScrollFrame.current = null;
      return;
    }
    setHoverStage(stageAtPoint(point.x, point.y));
    const before = scroller.scrollLeft;
    scroller.scrollLeft = before + point.direction * 8;
    // Stop at the ends instead of spinning frames that change nothing.
    if (scroller.scrollLeft === before) {
      autoScrollFrame.current = null;
      return;
    }
    autoScrollFrame.current = requestAnimationFrame(autoScrollTick);
  }

  /** One move path for native drops and pointer drags, refusals included. */
  function moveLead(lead: LeadRow, stage: LeadStage) {
    const subject = effective(lead);
    if (subject.stage === stage) return;

    if (isLeadStageLocked(subject)) {
      toast.error("Can't move this lead", {
        description: SENT_LEAD_LOCKED_MESSAGE,
      });
      return;
    }

    if (
      stage === "SENT_TO_FIRM" &&
      subject.sentToFirmAt === null &&
      subject.brightwaterLeadId === null
    ) {
      toast.error("Can't move this lead", {
        description: "Send it to the firm before marking it 'Sent to Firm'.",
      });
      return;
    }

    if (!canChangeLeadStage(viewer, subject, stage)) {
      toast.error("Can't move this lead", {
        description: `You can't move it to ${LEAD_STAGE_LABELS[stage]}.`,
      });
      return;
    }

    void save(lead, { stage });
  }

  function startPointerDrag(
    lead: LeadRow,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (saving[lead.id]) return;
    if (isLeadStageLocked(effective(lead))) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerLead.current = lead;
    setDragId(lead.id);
  }

  function movePointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!pointerLead.current) return;
    const { clientX: x, clientY: y } = event;
    setHoverStage(stageAtPoint(x, y));

    const scroller = boardRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    // A narrow edge band scrolls the board; the rest must not move under the
    // finger or a drop would land on a column the person never chose.
    const edge = 32;
    const withinBoard = y >= rect.top && y <= rect.bottom;
    const direction = !withinBoard
      ? 0
      : x < rect.left + edge
        ? -1
        : x > rect.right - edge
          ? 1
          : 0;
    autoScrollPoint.current = { x, y, direction };
    if (direction !== 0 && autoScrollFrame.current === null) {
      autoScrollFrame.current = requestAnimationFrame(autoScrollTick);
    }
  }

  function endPointerDrag(
    lead: LeadRow,
    event: ReactPointerEvent<HTMLButtonElement>,
    drop: boolean,
  ) {
    if (pointerLead.current?.id !== lead.id) return;
    const stage = drop ? stageAtPoint(event.clientX, event.clientY) : null;
    pointerLead.current = null;
    stopAutoScroll();
    setDragId(null);
    setHoverStage(null);
    if (stage) moveLead(lead, stage);
  }

  const visibleStages = LEAD_STAGES.filter(
    (stage) => !hiddenStages.includes(stage),
  );

  // Apply optimistic stage overrides before grouping, so a card that has just
  // been dropped in another lane moves there (and updates both counters)
  // immediately, while the server round-trip is still in flight.
  const byStage = new Map<LeadStage, LeadRow[]>();
  for (const stage of LEAD_STAGES) byStage.set(stage, []);
  const displayedCounts = { ...counts };
  for (const stage of LEAD_STAGES) {
    for (const lead of lanes[stage] ?? []) {
      const row = effective(lead);
      byStage.get(row.stage)?.push(row);
      if (row.stage !== stage) {
        displayedCounts[stage] = Math.max(0, displayedCounts[stage] - 1);
        displayedCounts[row.stage] += 1;
      }
    }
  }
  // Pinned cards are already staged when the move was made; the server counts
  // include them once the action revalidates, so they only need a place to sit.
  for (const row of pinnedCards) byStage.get(row.stage)?.push(row);

  const dragged =
    dragId === null ? null : tracked.find((lead) => lead.id === dragId);
  const draggedSubject = dragged ? effective(dragged) : null;

  if (visibleStages.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No stages are showing. Use the Stages menu to bring one back.
      </p>
    );
  }

  return (
    <>
      <div
        ref={boardRef}
        className="flex min-h-[calc(100svh-13rem)] items-start gap-2.5 overflow-x-auto pr-4 pb-2 xl:min-h-[calc(100svh-17rem)]"
      >
        {visibleStages.map((stage) => {
          const cards = byStage.get(stage) ?? [];
          const laneTotal = displayedCounts[stage] ?? 0;
          const remaining = Math.max(0, laneTotal - cards.length);
          const laneLimit =
            laneLimits[stage] ?? KANBAN_DEFAULT_LANE_SIZE;
          const atCeiling = laneLimit >= KANBAN_MAX_LANE_SIZE;
          const canDrop = Boolean(
            draggedSubject &&
            draggedSubject.stage !== stage &&
            canChangeLeadStage(viewer, draggedSubject, stage) &&
            (stage !== "SENT_TO_FIRM" ||
              draggedSubject.sentToFirmAt !== null ||
              draggedSubject.brightwaterLeadId !== null),
          );

          return (
            <section
              key={stage}
              data-stage={stage}
              className={cn(
                "flex min-w-52 flex-1 flex-col overflow-hidden rounded-xl border bg-muted/20 transition-colors",
                hoverStage === stage && canDrop && "border-ring bg-accent/30",
                hoverStage === stage &&
                  draggedSubject &&
                  !canDrop &&
                  "border-destructive/50 bg-destructive/5",
              )}
              onDragOver={(event) => {
                // Always allow the drop event so a refused drop can explain why.
                // `dropEffect: none` would cancel the drop before `onDrop` runs.
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (hoverStage !== stage) setHoverStage(stage);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node)
                ) {
                  setHoverStage(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                setHoverStage(null);
                setDragId(null);

                const id = Number(event.dataTransfer.getData("text/plain"));
                const lead = tracked.find((row) => row.id === id);
                if (!lead) return;

                moveLead(lead, stage);
              }}
            >
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: STAGE_COLOR[stage] }}
                  />
                  <span className="text-sm font-medium">
                    {LEAD_STAGE_LABELS[stage]}
                  </span>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {laneTotal}
                </span>
              </div>

              <div className="flex flex-col gap-2 p-2">
                {cards.length === 0 ? (
                  <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                    No leads here.
                  </p>
                ) : (
                  cards.map((lead) => {
                    const name =
                      [lead.injuredFirstName, lead.injuredLastName]
                        .filter(Boolean)
                        .join(" ") || "Unnamed lead";
                    const isSaving = Boolean(saving[lead.id]);
                    const locked = isLeadStageLocked(lead);

                    return (
                      <article
                        key={lead.id}
                        draggable={!isSaving && !locked}
                        onDragStart={(event) => {
                          const target = event.target as HTMLElement;
                          // Do not drag when the gesture starts on a control.
                          if (
                            target.closest("button, [data-slot=select-trigger]")
                          ) {
                            event.preventDefault();
                            return;
                          }
                          event.dataTransfer.setData(
                            "text/plain",
                            String(lead.id),
                          );
                          event.dataTransfer.effectAllowed = "move";
                          setDragId(lead.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setHoverStage(null);
                        }}
                        className={cn(
                          "cursor-grab rounded-lg border bg-card p-2.5 shadow-xs transition-opacity active:cursor-grabbing",
                          dragId === lead.id && "opacity-50",
                          isSaving && "opacity-80",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                              <span className="truncate">{name}</span>
                              {lead.dupGroupId ? (
                                <span
                                  role="img"
                                  aria-label="Potential duplicate"
                                  title="Potential duplicate"
                                  className="shrink-0"
                                >
                                  <TriangleAlert
                                    className="size-3.5 text-amber-600 dark:text-amber-400"
                                    aria-hidden
                                  />
                                </span>
                              ) : null}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {lead.caseType ? (
                                <Badge variant="outline">
                                  {caseTypeLabel(lead.caseType)}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Open ${name}`}
                              onClick={() => onOpen(effective(lead))}
                            >
                              <Eye />
                            </Button>
                            {/* Touch has no native HTML drag, so this handle owns
                              the pointer gesture and hit-tests the columns. */}
                            <button
                              type="button"
                              data-drag-handle
                              aria-label={`Drag ${name} to another stage`}
                              title={locked ? SENT_LEAD_LOCKED_MESSAGE : "Drag to move"}
                              disabled={isSaving || locked}
                              onPointerDown={(event) =>
                                startPointerDrag(lead, event)
                              }
                              onPointerMove={movePointerDrag}
                              onPointerUp={(event) =>
                                endPointerDrag(lead, event, true)
                              }
                              onPointerCancel={(event) =>
                                endPointerDrag(lead, event, false)
                              }
                              onLostPointerCapture={() => {
                                if (!pointerLead.current) return;
                                pointerLead.current = null;
                                stopAutoScroll();
                                setDragId(null);
                                setHoverStage(null);
                              }}
                              className="-my-1 -mr-1 flex size-9 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <GripVertical className="size-4" aria-hidden />
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 grid min-w-0 gap-1 text-xs text-muted-foreground">
                          <p className="flex min-w-0 items-center gap-1.5">
                            <Mail className="size-3.5 shrink-0" />
                            <span
                              className="min-w-0 flex-1 truncate"
                              title={lead.injuredEmail ?? undefined}
                            >
                              {lead.injuredEmail ?? "—"}
                            </span>
                          </p>
                          <p className="flex min-w-0 items-center gap-1.5">
                            <Phone className="size-3.5 shrink-0" />
                            <span
                              className="min-w-0 flex-1 truncate"
                              title={lead.injuredPhone ?? undefined}
                            >
                              {lead.injuredPhone ?? "—"}
                            </span>
                          </p>
                          <p className="flex min-w-0 items-center gap-1.5">
                            <CalendarDays className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              Added {formatDate(lead.createdAt)}
                            </span>
                          </p>
                        </div>

                        <div className="mt-3 border-t pt-2">
                          <AssigneeCell lead={lead} compact />
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {remaining > 0 ? (
                <div className="border-t p-2">
                  {atCeiling ? (
                    <p className="px-1 py-1 text-center text-xs text-muted-foreground">
                      Showing the first {cards.length} of {laneTotal}. Narrow the
                      board with search or filters to see the rest.
                    </p>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => onShowMore(stage)}
                    >
                      Show {Math.min(KANBAN_LANE_STEP, remaining)} more
                      <span className="text-muted-foreground">
                        ({remaining} remaining)
                      </span>
                    </Button>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {/* The finger hides the card on touch, so name the stage it will land on. */}
      {draggedSubject ? (
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
        >
          <p className="rounded-full border bg-background/95 px-4 py-2 text-sm font-medium shadow-lg">
            {hoverStage && hoverStage !== draggedSubject.stage
              ? `Move to ${LEAD_STAGE_LABELS[hoverStage]}`
              : "Drag onto a stage"}
          </p>
        </div>
      ) : null}
    </>
  );
}

/** Show or hide stage columns without touching the underlying lead data. */
function StageVisibilityMenu({
  hidden,
  onToggle,
  onReset,
}: {
  hidden: LeadStage[];
  onToggle: (stage: LeadStage, visible: boolean) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal aria-hidden />
        <span className="hidden sm:inline">Stages</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Stages</DropdownMenuLabel>
          {LEAD_STAGES.map((stage) => (
            <DropdownMenuCheckboxItem
              key={stage}
              checked={!hidden.includes(stage)}
              onCheckedChange={(checked) => onToggle(stage, checked)}
            >
              {LEAD_STAGE_LABELS[stage]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onReset}>Show all stages</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
