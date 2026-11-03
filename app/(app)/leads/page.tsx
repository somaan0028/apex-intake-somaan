import type { Metadata } from "next";
import { LEADS_DEFAULT_SORT, listLeads } from "@/lib/leads/queries";
import { loadTablePage } from "@/lib/table-query";
import { listAssignees } from "@/lib/users/queries";
import { LeadsTable } from "./leads-table";

export const metadata: Metadata = {
  title: "Leads · Apex Intake Desk",
};

/**
 * Same shape as the users page: the URL is the query, the server does the
 * filtering/sorting/paging, and the grid renders one page plus the total.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { query, rows, total } = await loadTablePage(
    searchParams,
    { defaultSort: LEADS_DEFAULT_SORT },
    listLeads,
  );
  const assignees = listAssignees();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">
          Every lead captured by the intake desk.
        </p>
      </div>
      <LeadsTable
        leads={rows}
        total={total}
        query={query}
        assignees={assignees}
      />
    </div>
  );
}
