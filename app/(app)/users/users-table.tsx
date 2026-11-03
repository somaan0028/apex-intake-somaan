"use client";

/**
 * The Users grid.
 *
 * The server does the querying; this component owns the *URL contract*. It
 * receives the query the server used, hands it to the grid, and writes any
 * change back to the URL — which re-renders the page and refetches.
 *
 * Columns, the filter descriptors, and the row-id accessor live at module scope:
 * TanStack Table treats a new identity for any of them as a configuration change.
 */
import { useCallback, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable, type DataTableFilter } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table/features";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { formatDate, initials } from "@/lib/format";
import { tableQueryToParams, type TableQuery } from "@/lib/table-query";
import { USER_ROLES, type UserRole } from "@/lib/db/schema";
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
    allLabel: "All roles",
    ariaLabel: "Filter by role",
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
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleQueryChange = useCallback(
    (next: TableQuery) => {
      const params = tableQueryToParams(next).toString();
      startTransition(() => {
        router.replace(params ? `${pathname}?${params}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router],
  );

  return (
    <DataTable
      columns={columns}
      data={users}
      rowCount={total}
      query={query}
      onQueryChange={handleQueryChange}
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
