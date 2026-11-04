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
import { useMemo, useState } from "react";
import {
  DataTable,
  useTableQuerySync,
  type DataTableFilter,
} from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table/features";
import { Badge } from "@/components/ui/badge";
import { CASE_TYPE_LABELS, LEAD_STAGE_LABELS, assigneeLabel } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import {
  CASE_TYPES,
  LEAD_STAGES,
  type CaseType,
  type LeadStage,
} from "@/lib/db/schema";
import type { AuthUser } from "@/lib/auth/session";
import { LEAD_SOURCES, UNASSIGNED } from "@/lib/leads/constants";
import type { LeadRow } from "@/lib/leads/queries";
import { can } from "@/lib/rbac";
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
        <Badge variant={CASE_TYPE_BADGE[value]}>{CASE_TYPE_LABELS[value]}</Badge>
      ) : (
        EMPTY
      );
    },
  }),
  columnHelper.accessor("stage", {
    header: "Stage",
    cell: (info) => (
      <Badge variant={STAGE_BADGE[info.getValue()]}>
        {LEAD_STAGE_LABELS[info.getValue()]}
      </Badge>
    ),
  }),
  // The id is `assignedTo` (not `assignedToName`) so the assignee filter, which
  // carries a user id, can hold its state on this column.
  columnHelper.accessor("assignedToName", {
    id: "assignedTo",
    header: "Assigned to",
    cell: (info) => info.getValue() ?? EMPTY,
  }),
  columnHelper.accessor("createdAt", {
    header: "Date",
    cell: (info) => (
      <span className="text-muted-foreground">{formatDate(info.getValue())}</span>
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
    cell: (info) => <span>{info.getValue() ?? "—"}</span>,
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

  return (
    <>
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
        onRowClick={(lead) => setSelected(lead)}
      />

      <LeadDialog
        lead={selected}
        onClose={() => setSelected(null)}
        viewer={viewer}
        assignees={assignees}
      />
    </>
  );
}