import type { Metadata } from "next";
import { loadTablePage } from "@/lib/table-query";
import { USERS_DEFAULT_SORT, listUsers } from "@/lib/users/queries";
import { UsersTable } from "./users-table";

export const metadata: Metadata = {
  title: "Users · Apex Intake Desk",
};

/**
 * The grid is driven entirely by the URL: this page parses the query string,
 * runs the (filtered, sorted, paged) query, and hands the grid that one page
 * plus the total count. Every control in the grid writes back to the URL.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { query, rows, total } = await loadTablePage(
    searchParams,
    { defaultSort: USERS_DEFAULT_SORT },
    listUsers,
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground">
          Everyone with access to the intake desk.
        </p>
      </div>
      <UsersTable users={rows} total={total} query={query} />
    </div>
  );
}
