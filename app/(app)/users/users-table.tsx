"use client";

/**
 * The Users grid.
 *
 * Columns and the row-id accessor live at module scope: TanStack Table treats a
 * new identity for either as a configuration change. There is no filter or
 * column selector here — a search box and the Add user button are all the page
 * needs — so the toolbar stays on one line. The URL sync comes from the shared
 * `useTableQuerySync` hook.
 */
import { createColumnHelper } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable, useTableQuerySync } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table/features";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/rbac";
import type { AuthUser } from "@/lib/auth/session";
import type { TableQuery } from "@/lib/table-query";
import type { UserRow } from "@/lib/users/queries";
import { UserDialog, type UserDialogState } from "./user-dialog";

const columnHelper = createColumnHelper<typeof dataTableFeatures, UserRow>();

const columns = columnHelper.columns([
  columnHelper.accessor("name", {
    header: "Name",
    cell: (info) => (
      <div className="flex items-center gap-2.5">
        <UserAvatar
          size="sm"
          userId={info.row.original.id}
          name={info.getValue()}
          avatarPath={info.row.original.avatarPath}
        />
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
  columnHelper.accessor("assignedLeadCount", {
    header: "Assigned leads",
    cell: (info) => (
      // The row itself opens the edit dialog; the link must navigate only.
      <Link
        href={`/leads?filter.assignedTo=${info.row.original.id}&filter.addedWithin=any`}
        className="font-medium underline underline-offset-4 hover:text-foreground"
        aria-label={`View leads assigned to ${info.row.original.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor("createdAt", {
    header: "Added",
    cell: (info) => (
      <span className="text-muted-foreground">
        {formatDate(info.getValue())}
      </span>
    ),
  }),
]);

const getRowId = (user: UserRow) => String(user.id);

export function UsersTable({
  users,
  total,
  query,
  viewer,
  adminCount,
}: {
  users: UserRow[];
  total: number;
  query: TableQuery;
  /** The signed-in admin (the page already gated on `users.manage`). */
  viewer: AuthUser;
  /** Number of admins, so the last one can't be deleted or demoted. */
  adminCount: number;
}) {
  const { isPending, onQueryChange } = useTableQuerySync();
  const [dialog, setDialog] = useState<UserDialogState | null>(null);

  return (
    <>
      <DataTable
        columns={columns}
        data={users}
        rowCount={total}
        query={query}
        onQueryChange={onQueryChange}
        isPending={isPending}
        getRowId={getRowId}
        ariaLabel="Users"
        searchPlaceholder="Search by name or email"
        inlineToolbar
        showColumnMenu={false}
        emptyMessage="No users yet."
        emptyFilteredMessage="No users match your search."
        onRowClick={(user) => setDialog({ mode: "edit", user })}
        toolbarActions={
          can(viewer.role, "users.manage") ? (
            <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
              <Plus />
              Add user
            </Button>
          ) : null
        }
      />

      <UserDialog
        state={dialog}
        onClose={() => setDialog(null)}
        viewer={viewer}
        adminCount={adminCount}
      />
    </>
  );
}
