/**
 * Overview metrics.
 *
 * Every count is scoped by `leadsVisibilityCondition`, so the numbers on the
 * Overview page describe exactly the leads the viewer is allowed to see — an
 * agent's totals never include leads they could not open in the grid. That is
 * why these live on the server rather than being counted in the browser from a
 * fetched page of rows.
 *
 * The counts answer the questions someone opening this app actually has: how
 * much is in front of me, what is unclaimed, what is new, and what is waiting on
 * an action.
 */
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNull,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/lib/db";
import { LEAD_STAGES, leads, type CaseType, type LeadStage } from "@/lib/db/schema";
import type { Actor } from "@/lib/rbac";
import { leadsVisibilityCondition } from "./queries";

/** How far back "new" reaches on the Overview page. */
const RECENT_WINDOW_DAYS = 7;

export interface LeadMetrics {
  /** Every lead the viewer can see. */
  total: number;
  /** Count per stage, in pipeline order (every stage present, zeroes included). */
  byStage: Record<LeadStage, number>;
  /** No owner yet — the open pool anyone can claim. */
  unassigned: number;
  /** Owned by the viewer. */
  assignedToMe: number;
  /** Arrived in the last `RECENT_WINDOW_DAYS` days. */
  newThisWeek: number;
  /** MVA leads sitting at Retained that have not been sent on yet. */
  readyToSend: number;
  /** Already delivered to the partner firm. */
  sentToFirm: number;
}

/** Count the visible leads matching `conditions`. */
function countVisible(actor: Actor, ...conditions: Array<SQL | undefined>): number {
  return (
    getDb()
      .select({ value: count() })
      .from(leads)
      .where(and(leadsVisibilityCondition(actor), ...conditions))
      .get()?.value ?? 0
  );
}

/**
 * The Overview page's numbers for one viewer.
 *
 * `byStage` is filled from a single grouped query; the rest are narrow counts.
 * All of them are cheap against the indexes on `stage`, `assigned_to_id` and
 * `created_at`, and this is a single-user desktop app, so the extra round trips
 * buy much simpler code than one clever union would.
 */
export function leadMetrics(actor: Actor): LeadMetrics {
  const stageRows = getDb()
    .select({ stage: leads.stage, value: count() })
    .from(leads)
    .where(leadsVisibilityCondition(actor))
    .groupBy(leads.stage)
    .all();

  // Start every stage at zero so the pipeline chart never has gaps.
  const byStage = Object.fromEntries(
    LEAD_STAGES.map((stage) => [stage, 0]),
  ) as Record<LeadStage, number>;
  for (const row of stageRows) byStage[row.stage] = row.value;

  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return {
    total: stageRows.reduce((sum, row) => sum + row.value, 0),
    byStage,
    unassigned: countVisible(actor, isNull(leads.assignedToId)),
    assignedToMe: countVisible(actor, eq(leads.assignedToId, actor.id)),
    newThisWeek: countVisible(actor, gte(leads.createdAt, since)),
    readyToSend: countVisible(
      actor,
      eq(leads.stage, "RETAINED"),
      eq(leads.caseType, "MVA"),
      isNull(leads.sentToFirmAt),
    ),
    sentToFirm: byStage.SENT_TO_FIRM,
  };
}

/** A single recent lead, for the Overview page's intake list. */
export interface RecentLead {
  id: number;
  injuredName: string | null;
  caseType: CaseType | null;
  stage: LeadStage;
  createdAt: Date | null;
}

/**
 * The newest visible leads, for the "latest intake" list.
 *
 * Deliberately a handful of columns rather than a `LeadRow`: this is a glance,
 * and it must not become a second place where attribution can leak.
 */
export function recentLeads(actor: Actor, limit = 5): RecentLead[] {
  return getDb()
    .select({
      id: leads.id,
      injuredFirstName: leads.injuredFirstName,
      injuredLastName: leads.injuredLastName,
      caseType: leads.caseType,
      stage: leads.stage,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(leadsVisibilityCondition(actor))
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      injuredName:
        [row.injuredFirstName, row.injuredLastName].filter(Boolean).join(" ") ||
        null,
      caseType: row.caseType,
      stage: row.stage,
      createdAt: row.createdAt,
    }));
}
