import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import {
  ACTIVITIES_DEFAULT_SORT,
  activityLeadFilterLabel,
  listActivities,
  listActivityPerformers,
} from "@/lib/activities/queries";
import { loadTablePage } from "@/lib/table-query";
import { can } from "@/lib/rbac";
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
  // Only a role that can see every row has anything to narrow by doer.
  const seesAllActivity = can(user.role, "activities.view.all");

  const { query, rows, total } = await loadTablePage(
    searchParams,
    { defaultSort: ACTIVITIES_DEFAULT_SORT },
    (parsed) => listActivities(parsed, user),
  );

  const selectedLeadId = positiveId(query.filters.leadId);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {seesAllActivity ? "Activity" : "My Activity"}
        </h1>
        <p className="text-muted-foreground">
          {seesAllActivity
            ? "Important actions that took place in the application"
            : "Important actions that you took in the application"}
        </p>
      </div>

      <ActivityTable
        activities={rows}
        total={total}
        query={query}
        performers={seesAllActivity ? listActivityPerformers(user) : []}
        showPerformerFilter={seesAllActivity}
        selectedLeadLabel={activityLeadFilterLabel(user, selectedLeadId)}
      />
    </div>
  );
}
