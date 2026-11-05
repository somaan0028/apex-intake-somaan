import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import type { LeadsView } from "@/lib/leads/constants";
import { parseKanbanLimits } from "@/lib/leads/kanban";
import { normalizeLeadsQueryParams } from "@/lib/leads/query-params";
import {
  LEADS_DEFAULT_SORT,
  listKanbanBoard,
  listLeads,
  type LeadRow,
  type LeadsBoard,
} from "@/lib/leads/queries";
import {
  LEADS_VIEW_COOKIE,
  isLeadsView,
} from "@/lib/leads/view-preference";
import {
  loadTablePage,
  parseTableQuery,
  type TableQuery,
} from "@/lib/table-query";
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
  // The session drives row-level scoping: an agent only sees the unassigned pool
  // plus their own leads (see `leadsVisibilityCondition`).
  const user = await requireUser();
  const params = await searchParams;
  // The view is a preference, not a filter: an explicit URL value wins, then
  // the cookie from the last switch, then Kanban for a brand-new visitor.
  const viewParam = typeof params.view === "string" ? params.view : null;
  const preferredView = (await cookies()).get(LEADS_VIEW_COOKIE)?.value ?? null;
  const view: LeadsView = isLeadsView(viewParam)
    ? viewParam
    : isLeadsView(preferredView)
      ? preferredView
      : "kanban";
  const sortExplicit = params.sort === "createdAt";
  const queryParams = normalizeLeadsQueryParams(params, view);
  const assignees = listAssignees(user);
  const limits = parseKanbanLimits(params);

  let query: TableQuery;
  let rows: LeadRow[] = [];
  let total: number;
  let board: LeadsBoard | undefined;

  if (view === "kanban") {
    // The board is six independent windows over the same filtered set. The
    // server never pages it as a whole; each lane asks for its own slice.
    const parsed = parseTableQuery(queryParams, {
      defaultSort: LEADS_DEFAULT_SORT,
    });
    board = listKanbanBoard({ ...parsed, page: 1 }, user, limits);
    query = { ...parsed, page: 1, sort: board.sort };
    total = board.total;
  } else {
    const page = await loadTablePage(
      Promise.resolve(queryParams),
      { defaultSort: LEADS_DEFAULT_SORT },
      (parsed) => listLeads(parsed, user),
    );
    query = page.query;
    rows = page.rows;
    total = page.total;
  }

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
        board={board}
        laneLimits={limits}
        query={query}
        assignees={assignees}
        viewer={user}
        view={view}
        sortExplicit={sortExplicit}
      />
    </div>
  );
}
