/**
 * CSV export of the leads grid.
 *
 * The browser links here with the grid's current query (`filter.*`, `search`,
 * `sort`, `view`). The route validates the session against the database, then
 * runs the same `listLeads` query the grid uses with no page window, so the
 * download contains every lead under the current filters — never just the
 * visible page or the loaded Kanban cards.
 */
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import type { LeadsView } from "@/lib/leads/constants";
import { buildLeadsCsv } from "@/lib/leads/csv";
import {
  normalizeLeadsQueryParams,
  type LeadsSearchParams,
} from "@/lib/leads/query-params";
import { LEADS_DEFAULT_SORT, listLeadsForExport } from "@/lib/leads/queries";
import {
  LEADS_VIEW_COOKIE,
  isLeadsView,
} from "@/lib/leads/view-preference";
import { can } from "@/lib/rbac";
import { parseTableQuery } from "@/lib/table-query";

export async function GET(request: Request) {
  // `proxy.ts` only checks that a cookie exists; the real session check belongs
  // next to the data.
  const viewer = await getCurrentUser();
  if (!viewer) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const params: LeadsSearchParams = Object.fromEntries(
    url.searchParams.entries(),
  );

  // The board drops the stage filter, so decide the view exactly as the page
  // does: explicit URL value, then the preference cookie, then Kanban.
  const explicitView = url.searchParams.get("view");
  const preferredView = (await cookies()).get(LEADS_VIEW_COOKIE)?.value ?? null;
  const view: LeadsView = isLeadsView(explicitView)
    ? explicitView
    : isLeadsView(preferredView)
      ? preferredView
      : "kanban";

  const query = parseTableQuery(normalizeLeadsQueryParams(params, view), {
    defaultSort: LEADS_DEFAULT_SORT,
  });
  const rows = listLeadsForExport(query, viewer);
  const csv = buildLeadsCsv(rows, {
    includeAttribution: can(viewer.role, "leads.view.attribution"),
  });

  const today = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${today}.csv"`,
      // The file reflects this viewer's live filter and visibility scope.
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
