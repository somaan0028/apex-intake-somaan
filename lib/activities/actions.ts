"use server";

/**
 * Server Actions for the Activity page.
 *
 * The lead search behind the Affected Lead filter goes through the leads grid's
 * own query, so the picker can only offer leads the signed-in user can see.
 */
import { and, count, desc, eq } from "drizzle-orm";
import { ForbiddenError } from "@/lib/auth/authorize";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { activities, users } from "@/lib/db/schema";
import { listLeads } from "@/lib/leads/queries";
import { requireVisibleLead } from "@/lib/leads/service";
import {
  LEAD_HISTORY_TYPES,
  type LeadHistoryRow,
  type LeadHistoryType,
} from "./history";
import { leadLabel } from "./queries";

/** How many lead matches the picker shows at once. */
const LEAD_SEARCH_LIMIT = 8;

/** Whether the actor may read this lead's history. */
async function canReadLeadHistory(
  leadId: number,
  type: LeadHistoryType,
): Promise<boolean> {
  const actor = await requireUser();
  if (!Number.isInteger(leadId) || leadId <= 0) return false;
  if (!(LEAD_HISTORY_TYPES as readonly string[]).includes(type)) return false;
  try {
    requireVisibleLead(actor, leadId);
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}

/**
 * How many rows a history dialog would show. Fetched when the lead dialog
 * opens so the trigger can say whether opening it is useful.
 */
export async function getLeadActivityCount(
  leadId: number,
  type: LeadHistoryType,
): Promise<number> {
  if (!(await canReadLeadHistory(leadId, type))) return 0;

  return (
    getDb()
      .select({ value: count() })
      .from(activities)
      .where(and(eq(activities.leadId, leadId), eq(activities.type, type)))
      .get()?.value ?? 0
  );
}

/**
 * History for one lead, for the small "view past changes" / "view attempts"
 * dialogs. Access follows lead visibility: if you can open the lead, you can
 * read its recorded history, even if an admin was the doer.
 */
export async function getLeadActivities(
  leadId: number,
  type: LeadHistoryType,
): Promise<LeadHistoryRow[]> {
  if (!(await canReadLeadHistory(leadId, type))) return [];

  return getDb()
    .select({
      id: activities.id,
      description: activities.description,
      doerId: activities.doerId,
      doerName: users.name,
      doerAvatarPath: users.avatarPath,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .leftJoin(users, eq(activities.doerId, users.id))
    .where(and(eq(activities.leadId, leadId), eq(activities.type, type)))
    .orderBy(desc(activities.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      description: row.description,
      doerId: row.doerId,
      doerName: row.doerName ?? "Deleted user",
      doerAvatarPath: row.doerAvatarPath,
      createdAt: row.createdAt,
    }));
}

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
