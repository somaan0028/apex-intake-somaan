import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { type LeadsView } from "@/lib/leads/constants";
import { LEADS_DEFAULT_SORT, listLeads } from "@/lib/leads/queries";
import { loadTablePage } from "@/lib/table-query";
import { listAssignees } from "@/lib/users/queries";
import { LeadsTable } from "./leads-table";

export const metadata: Metadata = {
  title: "Leads · Apex Intake Desk",
};

/** The Kanban board needs the whole filtered set, not one table page. */
const KANBAN_PAGE_SIZE = 1000;

/** The earliest date a fresh visit shows: seven days ago. */
function defaultAddedFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Same shape as the users page: the URL is the query, the server does the
 * filtering/sorting/paging, and the grid renders one page plus the total.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // The session drives row-level scoping: an agent only sees the unassigned pool
  // plus their own leads (see `leadsVisibilityCondition`).
  const user = await requireUser();
  const params = await searchParams;
  // Kanban is the default; the table is an explicit `view=table`.
  const view: LeadsView = params.view === "table" ? "table" : "kanban";
  const sortExplicit = params.sort === "createdAt";
  const queryParams = { ...params };
  if (view === "kanban") {
    // The board groups by stage, so an inherited stage filter would silently
    // hide every other column.
    delete queryParams["filter.stage"];
  }
  // The lower bound is never optional: start with the last week so a fresh
  // visit does not load the entire backlog.
  if (!queryParams["filter.addedFrom"]) {
    queryParams["filter.addedFrom"] = defaultAddedFrom();
  }
  const { query, rows, total } = await loadTablePage(
    Promise.resolve(queryParams),
    { defaultSort: LEADS_DEFAULT_SORT },
    (parsed) =>
      listLeads(
        view === "kanban"
          ? { ...parsed, page: 1, pageSize: KANBAN_PAGE_SIZE }
          : parsed,
        user,
      ),
  );
  const assignees = listAssignees(user);

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
        viewer={user}
        view={view}
        sortExplicit={sortExplicit}
      />
    </div>
  );
}
