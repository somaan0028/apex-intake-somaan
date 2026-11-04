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
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type SyntheticEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DataTable,
  useTableQuerySync,
  type DataTableFilter,
} from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table/features";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { LEAD_SOURCES, UNASSIGNED } from "@/lib/leads/constants";
import type { LeadFieldPatch } from "@/lib/leads/editable";
import type { LeadRow } from "@/lib/leads/queries";
import {
  can,
  canAssignLead,
  canChangeLeadStage,
  canEditLead,
} from "@/lib/rbac";
import { BOOLEAN_FILTER_OPTIONS, type TableQuery } from "@/lib/table-query";
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

/** Optimistic inline values for a row, cleared once the grid catches up. */
interface RowOverride {
  stage?: LeadStage;
  assignedToId?: number | null;
}

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

function leadName(lead: LeadRow): string {
  const name = [lead.injuredFirstName, lead.injuredLastName]
    .filter(Boolean)
    .join(" ");
  return name || "lead";
}

/** Columns hidden on first render; the Columns menu can reveal them. */
const DEFAULT_COLUMN_VISIBILITY = {
  contactName: false,
  source: false,
  state: false,
  county: false,
  isAtFault: false,
  hasAttorney: false,
  hasReceivedSettlement: false,
};

/** Filter controls hidden on first render; the Filters menu can reveal them. */
const DEFAULT_FILTER_VISIBILITY = {
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
      return <span className="font-medium">{name || "—"}</span>;
    },
  }),
  columnHelper.accessor("injuredEmail", {
    header: "Email",
    enableSorting: false,
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue() ?? "—"}</span>
    ),
  }),
  columnHelper.accessor("injuredPhone", {
    header: "Phone",
    enableSorting: false,
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue() ?? "—"}</span>
    ),
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
]);

/** Stable row id so sorting/filtering preserves row identity. */
const getRowId = (lead: LeadRow) => String(lead.id);

/** Filter descriptors; assignee options depend on the loaded team. */
function buildFilters(
  assignees: Array<{ id: number; name: string }>,
  viewerId: number,
  showAttribution: boolean,
): DataTableFilter[] {
  return [
    {
      columnId: "caseType",
      label: "Case type",
      allLabel: "Any",
      options: CASE_TYPES.map((value) => ({
        label: CASE_TYPE_LABELS[value],
        value,
      })),
    },
    {
      columnId: "stage",
      label: "Stage",
      allLabel: "Any",
      options: LEAD_STAGES.map((value) => ({
        label: LEAD_STAGE_LABELS[value],
        value,
      })),
    },
    // Source is attribution data; the filter is only offered alongside the column.
    ...(showAttribution
      ? [
          {
            columnId: "source",
            label: "Source",
            allLabel: "Any",
            options: LEAD_SOURCES.map((value) => ({ label: value, value })),
          } satisfies DataTableFilter,
        ]
      : []),
    {
      columnId: "assignedTo",
      label: "Assigned to",
      allLabel: "Anyone",
      options: [
        { label: "Unassigned", value: UNASSIGNED },
        ...assignees.map((assignee) => ({
          label: assigneeLabel(assignee, viewerId),
          value: String(assignee.id),
        })),
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
  query,
  assignees,
  viewer,
}: {
  leads: LeadRow[];
  total: number;
  query: TableQuery;
  assignees: Array<{ id: number; name: string }>;
  /** The signed-in user, so the detail dialog can run the RBAC policies. */
  viewer: AuthUser;
}) {
  const { isPending, onQueryChange } = useTableQuerySync();
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [overrides, setOverrides] = useState<Record<number, RowOverride>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

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

  /**
   * Inline stage/assignee save. The row updates immediately, the control is
   * disabled until the action returns, and a rejection puts the old value back.
   */
  async function save(
    lead: LeadRow,
    patch: Pick<LeadFieldPatch, "stage" | "assignedToId">,
  ): Promise<boolean> {
    const id = lead.id;
    setOverrides((previous) => ({
      ...previous,
      [id]: { ...previous[id], ...patch },
    }));
    setSaving((previous) => ({ ...previous, [id]: true }));

    const result = await saveLeadFields(id, patch);

    setSaving((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });

    if (!result.ok) {
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

  const contextValue: LeadTableContextValue = {
    viewer,
    assignees,
    overrides,
    saving,
    save,
  };

  return (
    <LeadTableContext.Provider value={contextValue}>
      <DataTable
        columns={visibleColumns}
        data={leads}
        rowCount={total}
        query={query}
        onQueryChange={onQueryChange}
        isPending={isPending}
        getRowId={getRowId}
        ariaLabel="Leads"
        searchPlaceholder="Search leads…"
        filters={buildFilters(assignees, viewer.id, canSeeAttribution)}
        defaultFilterVisibility={DEFAULT_FILTER_VISIBILITY}
        defaultColumnVisibility={DEFAULT_COLUMN_VISIBILITY}
        emptyMessage="No leads yet."
        emptyFilteredMessage="No leads match your filters."
        onRowClick={(lead) =>
          setSelected(applyOverride(lead, overrides[lead.id]))
        }
      />

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

  if (!editable) {
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
function AssigneeCell({ lead }: { lead: LeadRow }) {
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
            className="h-7 w-40"
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
