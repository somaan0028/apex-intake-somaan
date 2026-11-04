import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import {
  ACTIVITIES_DEFAULT_SORT,
  activityLeadFilterLabel,
  listActivities,
  listActivityPerformers,
} from "@/lib/activities/queries";
import { loadTablePage } from "@/lib/table-query";
import { ActivityTable } from "./activity-table";

export const metadata: Metadata = {
  title: "Activity · Apex Intake Desk",
};

/** Positive integer from a URL filter, or `null`. */
function positiveId(value: string | undefined): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The desk's audit trail. Admins see every activity; everyone else sees only
 * the rows they performed. The page itself is open to every role — the query
 * applies the scope, not a redirect.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireUser();

  const { query, rows, total } = await loadTablePage(
    searchParams,
    { defaultSort: ACTIVITIES_DEFAULT_SORT },
    (parsed) => listActivities(parsed, user),
  );

  const selectedLeadId = positiveId(query.filters.leadId);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground">
          Changes made to leads and users, newest first.
        </p>
      </div>

      <ActivityTable
        activities={rows}
        total={total}
        query={query}
        performers={listActivityPerformers(user)}
        selectedLeadLabel={activityLeadFilterLabel(user, selectedLeadId)}
      />
    </div>
  );
}
