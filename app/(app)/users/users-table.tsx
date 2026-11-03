"use client";

/**
 * The Users grid.
 *
 * Columns, the filter descriptors, and the row-id accessor live at module scope:
 * TanStack Table treats a new identity for any of them as a configuration change.
 * The URL sync comes from the shared `useTableQuerySync` hook.
 */
import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  useTableQuerySync,
  type DataTableFilter,
} from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table/features";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { formatDate, initials } from "@/lib/format";
import { USER_ROLES, type UserRole } from "@/lib/db/schema";
import type { TableQuery } from "@/lib/table-query";
import type { UserRow } from "@/lib/users/queries";

const columnHelper = createColumnHelper<typeof dataTableFeatures, UserRow>();

const columns = columnHelper.columns([
  columnHelper.accessor("name", {
    header: "Name",
    cell: (info) => (
      <div className="flex items-center gap-2.5">
        <Avatar size="sm">
          <AvatarFallback>{initials(info.getValue())}</AvatarFallback>
        </Avatar>
        <span className="font-medium">{info.getValue()}</span>
      </div>
    ),
  }),
  columnHelper.accessor("email", {
    header: "Email",
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor("role", {
    header: "Role",
    cell: (info) => (
      <Badge variant={info.getValue() === "ADMIN" ? "default" : "secondary"}>
        {USER_ROLE_LABELS[info.getValue()]}
      </Badge>
    ),
  }),
  columnHelper.accessor("createdAt", {
    header: "Added",
    cell: (info) => (
      <span className="text-muted-foreground">{formatDate(info.getValue())}</span>
    ),
  }),
]);

const filters: DataTableFilter[] = [
  {
    columnId: "role",
    label: "Role",
    allLabel: "Any",
    options: USER_ROLES.map((role: UserRole) => ({
      label: USER_ROLE_LABELS[role],
      value: role,
    })),
  },
];

/** Stable row id so sorting/filtering preserves row identity. */
const getRowId = (user: UserRow) => String(user.id);

export function UsersTable({
  users,
  total,
  query,
}: {
  users: UserRow[];
  total: number;
  query: TableQuery;
}) {
  const { isPending, onQueryChange } = useTableQuerySync();

  return (
    <DataTable
      columns={columns}
      data={users}
      rowCount={total}
      query={query}
      onQueryChange={onQueryChange}
      isPending={isPending}
      getRowId={getRowId}
      ariaLabel="Users"
      searchPlaceholder="Search users…"
      filters={filters}
      emptyMessage="No users yet."
      emptyFilteredMessage="No users match your search."
    />
  );
}
