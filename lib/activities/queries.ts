/**
 * Reads for the Activity page.
 *
 * Admin sees the whole log; every other role sees only rows they performed.
 * Search is limited to the description (the sentence the recorder generated),
 * and the two structured filters narrow by doer (admin only) and affected lead.
 * Names are resolved with a left join so a deleted user or lead still leaves the
 * event in place, labelled "Deleted user" / "Deleted lead".
 */
import { asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "@/lib/db";
import { allOf, planListPage, searchCondition } from "@/lib/db/list-query";
import { activities, leads, users, type ActivityType } from "@/lib/db/schema";
import type { Actor } from "@/lib/rbac";
import { can, canViewLead } from "@/lib/rbac";
import type { ListPageResult, TableQuery } from "@/lib/table-query";

/** A row as the grid consumes it. */
export interface ActivityRow {
  id: number;
  type: ActivityType;
  description: string;
  isAi: boolean;
  createdAt: Date;
  doerId: number;
  /** "Deleted user" when the actor's row no longer exists. */
  doerName: string;
  /** The doer's stored photo, or `null` for initials / a deleted user. */
  doerAvatarPath: string | null;
  leadId: number | null;
  /** `null` for user-only events; "Deleted lead" when the lead is gone. */
  affectedLeadName: string | null;
}

/** Option in the Performed by filter. */
export interface ActivityPerformerOption {
  id: number;
  label: string;
}

/** The grid's natural order: newest first. */
export const ACTIVITIES_DEFAULT_SORT = { id: "createdAt", desc: true } as const;

const SORT_COLUMNS: Record<"createdAt", AnySQLiteColumn> = {
  createdAt: activities.createdAt,
};

/** The injured person's name, falling back to the matter id. */
export function leadLabel(lead: {
  injuredFirstName: string | null;
  injuredLastName: string | null;
  matterId: string;
}): string {
  const name = [lead.injuredFirstName, lead.injuredLastName]
    .filter(Boolean)
    .join(" ");
  return name || lead.matterId || "Unnamed lead";
}

/** Parse `YYYY-MM-DD`; the end bound covers the whole local day. */
function parseFilterDate(
  value: string | undefined,
  endOfDay = false,
): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Rows the actor may see: everything for an admin, their own otherwise. */
function activitiesScope(actor: Actor): SQL | undefined {
  if (can(actor.role, "activities.view.all")) return undefined;
  return eq(activities.doerId, actor.id);
}

/**
 * The joined columns both the Activity grid and the Overview feed render.
 * Shared so the two readers can never disagree about how a row is shaped.
 */
const ACTIVITY_COLUMNS = {
  id: activities.id,
  type: activities.type,
  description: activities.description,
  isAi: activities.isAi,
  createdAt: activities.createdAt,
  doerId: activities.doerId,
  doerName: users.name,
  doerAvatarPath: users.avatarPath,
  leadId: activities.leadId,
  leadExists: leads.id,
  leadFirstName: leads.injuredFirstName,
  leadLastName: leads.injuredLastName,
  leadMatterId: leads.matterId,
};

interface ActivityJoinRow {
  id: number;
  type: ActivityType;
  description: string;
  isAi: boolean;
  createdAt: Date;
  doerId: number;
  doerName: string | null;
  doerAvatarPath: string | null;
  leadId: number | null;
  leadExists: number | null;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadMatterId: string | null;
}

/** Normalise a joined row, naming deleted actors and leads explicitly. */
function toActivityRow(row: ActivityJoinRow): ActivityRow {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    isAi: row.isAi,
    createdAt: row.createdAt,
    doerId: row.doerId,
    doerName: row.doerName ?? "Deleted user",
    doerAvatarPath: row.doerAvatarPath,
    leadId: row.leadId,
    affectedLeadName:
      row.leadId === null
        ? null
        : row.leadExists === null
          ? "Deleted lead"
          : leadLabel({
              injuredFirstName: row.leadFirstName,
              injuredLastName: row.leadLastName,
              matterId: row.leadMatterId ?? "",
            }),
  };
}

/** Positive integer from a filter value, or `null`. */
function positiveId(value: string | undefined): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** One page of activities matching `query` within the actor's scope. */
export function listActivities(
  query: TableQuery,
  actor: Actor,
): ListPageResult<ActivityRow> {
  const db = getDb();

  const conditions: Array<SQL | undefined> = [
    activitiesScope(actor),
    searchCondition(query.search, [activities.description]),
  ];

  // The doer filter is only offered to a viewer who can see other people's
  // rows; ignore it otherwise so a stray URL value cannot hide their own rows.
  const performedBy = positiveId(query.filters.performedBy);
  if (performedBy && can(actor.role, "activities.view.all")) {
    conditions.push(eq(activities.doerId, performedBy));
  }

  const leadId = positiveId(query.filters.leadId);
  if (leadId) conditions.push(eq(activities.leadId, leadId));

  // Date range, matching the leads page: rolling presets or a custom range.
  const dateWithin = query.filters.dateWithin;
  const windowDays =
    dateWithin === "24h"
      ? 1
      : dateWithin === "3d"
        ? 3
        : dateWithin === "7d"
          ? 7
          : dateWithin === "30d"
            ? 30
            : null;
  if (windowDays) {
    const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    conditions.push(gte(activities.createdAt, from));
  } else {
    const from = parseFilterDate(query.filters.dateFrom);
    if (from) conditions.push(gte(activities.createdAt, from));
    const to = parseFilterDate(query.filters.dateTo, true);
    if (to) conditions.push(lte(activities.createdAt, to));
  }

  const plan = planListPage({
    db,
    table: activities,
    where: allOf(conditions),
    query,
    sortColumns: SORT_COLUMNS,
    defaultSort: ACTIVITIES_DEFAULT_SORT,
  });

  const rows = db
    .select(ACTIVITY_COLUMNS)
    .from(activities)
    .leftJoin(users, eq(activities.doerId, users.id))
    .leftJoin(leads, eq(activities.leadId, leads.id))
    .where(plan.where)
    .orderBy(plan.orderBy)
    .limit(plan.limit)
    .offset(plan.offset)
    .all();

  return {
    rows: rows.map(toActivityRow),
    total: plan.total,
    page: plan.page,
    sort: plan.sort,
  };
}

/**
 * The newest rows for the Overview feed, in the same scope as the Activity page:
 * an admin sees the whole log, everyone else only their own actions.
 */
export function recentActivities(actor: Actor, limit = 5): ActivityRow[] {
  return getDb()
    .select(ACTIVITY_COLUMNS)
    .from(activities)
    .leftJoin(users, eq(activities.doerId, users.id))
    .leftJoin(leads, eq(activities.leadId, leads.id))
    .where(activitiesScope(actor))
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(limit)
    .all()
    .map(toActivityRow);
}

/** Distinct doers in the actor's visible activity, for the filter select. */
export function listActivityPerformers(
  actor: Actor,
): ActivityPerformerOption[] {
  const db = getDb();
  const scope = activitiesScope(actor);
  return db
    .selectDistinct({ id: activities.doerId, name: users.name })
    .from(activities)
    .leftJoin(users, eq(activities.doerId, users.id))
    .where(scope)
    .orderBy(asc(users.name))
    .all()
    .map((row) => ({
      id: row.id,
      label: row.name ?? "Deleted user",
    }));
}

/**
 * Resolve the currently selected lead for the filter trigger.
 *
 * Only a lead the actor can still view is named; otherwise the trigger keeps a
 * neutral id. A deleted lead is named as such, matching the grid.
 */
export function activityLeadFilterLabel(
  actor: Actor,
  leadId: number | null,
): string | null {
  if (leadId === null) return null;
  const lead = getDb()
    .select({
      id: leads.id,
      matterId: leads.matterId,
      assignedToId: leads.assignedToId,
      caseType: leads.caseType,
      sentToFirmAt: leads.sentToFirmAt,
      brightwaterLeadId: leads.brightwaterLeadId,
      injuredFirstName: leads.injuredFirstName,
      injuredLastName: leads.injuredLastName,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .get();
  if (!lead) return "Deleted lead";
  if (!canViewLead(actor, lead)) return `Lead #${leadId}`;
  return leadLabel(lead);
}
