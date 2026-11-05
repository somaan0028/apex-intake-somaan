/**
 * CSV export of the leads grid.
 *
 * The browser links here with the grid's current query (`filter.*`, `search`,
 * `sort`, `view`). The route validates the session against the database, then
 * runs the same `listLeads` query the grid uses with no page window, so the
 * download contains every lead under the current filters — never just the
 * visible page or the loaded Kanban cards.
 */
import { getCurrentUser } from "@/lib/auth/session";
import { buildLeadsCsv } from "@/lib/leads/csv";
import {
  normalizeLeadsQueryParams,
  type LeadsSearchParams,
} from "@/lib/leads/query-params";
import { LEADS_DEFAULT_SORT, listLeadsForExport } from "@/lib/leads/queries";
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

  // The filters travel in the URL, so the export needs no view preference.
  const query = parseTableQuery(normalizeLeadsQueryParams(params), {
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
