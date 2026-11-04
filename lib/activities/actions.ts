"use server";

/**
 * Server Actions for the Activity page.
 *
 * The lead search behind the Affected Lead filter goes through the leads grid's
 * own query, so the picker can only offer leads the signed-in user can see.
 */
import { requireUser } from "@/lib/auth/session";
import { listLeads } from "@/lib/leads/queries";
import { leadLabel } from "./queries";

/** How many lead matches the picker shows at once. */
const LEAD_SEARCH_LIMIT = 8;

/** Search the leads this user may see, by name, email, phone or matter id. */
export async function searchActivityLeads(
  term: string,
): Promise<Array<{ id: number; label: string }>> {
  const actor = await requireUser();
  const search = term.trim();
  if (!search) return [];

  return listLeads(
    {
      page: 1,
      pageSize: LEAD_SEARCH_LIMIT,
      sort: null,
      search,
      filters: {},
    },
    actor,
  ).rows.map((lead) => ({ id: lead.id, label: leadLabel(lead) }));
}
