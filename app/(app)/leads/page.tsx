import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight } from "lucide-react";
import { AlertBar } from "@/components/alert-bar";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import type { LeadsView } from "@/lib/leads/constants";
import { parseKanbanLimits } from "@/lib/leads/kanban";
import { potentialDuplicateCount } from "@/lib/leads/metrics";
import { normalizeLeadsQueryParams } from "@/lib/leads/query-params";
import {
  LEADS_DEFAULT_SORT,
  getLeadForActor,
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
  const queryParams = normalizeLeadsQueryParams(params);
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

  const potentialDuplicates = potentialDuplicateCount(user);
  // A deep link (for example from the Activity grid) asks for one lead to be
  // opened on arrival. It is loaded on its own so it works in either view even
  // when the current filters or lane window would not include it.
  const requestedLeadId =
    typeof params.lead === "string" && /^\d+$/.test(params.lead)
      ? Number(params.lead)
      : null;
  const initialLead =
    requestedLeadId !== null ? getLeadForActor(requestedLeadId, user) : null;
  // The callout is a way in, so it steps aside once the person is already
  // looking at the duplicates it points to.
  const duplicatesViewActive = params["filter.potentialDuplicate"] === "yes";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-muted-foreground">
            All leads available to you
          </p>
        </div>
        {/* The callout stays as context; once the duplicate filter is on it says
            how many are being shown and drops the now-pointless button. */}
        {potentialDuplicates > 0 ? (
          <AlertBar
            tone="warning"
            className="shrink-0"
            action={
              duplicatesViewActive ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/leads?filter.potentialDuplicate=yes" />}
                >
                  Show
                  <ArrowRight />
                </Button>
              )
            }
          >
            <span className="font-medium">
              {potentialDuplicates} potential duplicate lead
              {potentialDuplicates === 1 ? "" : "s"}
            </span>{" "}
            {duplicatesViewActive
              ? "being shown"
              : potentialDuplicates === 1
                ? "needs review"
                : "need review"}
          </AlertBar>
        ) : null}
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
        initialLead={initialLead}
        preserveFilters={params.preserveFilters === "true"}
      />
    </div>
  );
}
