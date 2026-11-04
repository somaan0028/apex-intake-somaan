/**
 * Queries for the leads grid.
 *
 * Same shape as `lib/users/queries.ts` — search, allow-listed filters, sorting,
 * and paging all in SQL, one page at a time. The shared plumbing lives in
 * `lib/db/list-query.ts`.
 */
import { eq, getTableColumns, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "@/lib/db";
import { can, type Actor } from "@/lib/rbac";
import {
  allOf,
  booleanFilter,
  planListPage,
  readFilter,
  searchCondition,
  type ListPageResult,
} from "@/lib/db/list-query";
import {
  CASE_TYPES,
  LEAD_STAGES,
  leads,
  users,
  type CaseType,
  type Lead,
  type LeadStage,
} from "@/lib/db/schema";
import type { TableQuery } from "@/lib/table-query";
import { LEAD_SOURCES, UNASSIGNED, type LeadSource } from "./constants";

/**
 * Attribution/tracking fields, visible only to viewers holding
 * `leads.view.attribution`. For everyone else they are omitted from the row
 * entirely rather than sent as nulls.
 */
const ATTRIBUTION_KEYS = [
  "ipaddress",
  "trustedform",
  "jornaya",
  "source",
] as const;
type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];

/**
 * A lead as the grid *and* the detail dialog consume it: its columns plus the
 * joined assignee's display name. It satisfies `LeadSubject`, so the dialog can
 * run the same RBAC policies the server does.
 *
 * The attribution fields are optional: `listLeads` only includes them for
 * viewers allowed to see them, so for anyone else the keys are absent.
 */
export type LeadRow = Omit<Lead, AttributionKey> & {
  assignedToName: string | null;
} & Partial<Pick<Lead, AttributionKey>>;

/** Copies a row without its attribution keys (for viewers who may not see them). */
function withoutAttribution(row: LeadRow): LeadRow {
  const copy = { ...row };
  for (const key of ATTRIBUTION_KEYS) delete copy[key];
  return copy;
}

/**
 * Sort keys the grid exposes. Typing the map as a complete `Record` makes a
 * sortable column that is missing from the allow-list a compile error (which is
 * exactly how the `source` column slipped through the first time).
 */
type LeadSortKey =
  | "injuredLastName"
  | "caseType"
  | "stage"
  | "assignedTo"
  | "createdAt"
  | "source"
  | "state"
  | "county";

/** Columns the grid may sort by. */
const SORT_COLUMNS: Record<LeadSortKey, AnySQLiteColumn> = {
  injuredLastName: leads.injuredLastName,
  caseType: leads.caseType,
  stage: leads.stage,
  // Sorts by the joined agent name; the select below carries the same join.
  assignedTo: users.name,
  createdAt: leads.createdAt,
  source: leads.source,
  state: leads.state,
  county: leads.county,
};

/** Newest leads first — the natural order for an intake queue. */
export const LEADS_DEFAULT_SORT = { id: "createdAt", desc: true } as const;

function isLeadSource(value: string): value is LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(value);
}

function isCaseType(value: string): value is CaseType {
  return (CASE_TYPES as readonly string[]).includes(value);
}

function isLeadStage(value: string): value is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(value);
}

/**
 * The row-level visibility filter for `actor`, mirroring `canViewLead`.
 *
 * Admins see everything; an agent sees the unassigned pool plus their own leads.
 * A role granted no view capability sees nothing — a `false` condition, not "no
 * condition" (which SQL would read as *every* row).
 */
export function leadsVisibilityCondition(actor: Actor): SQL | undefined {
  if (can(actor.role, "leads.view.all")) return undefined;

  const conditions: SQL[] = [];
  if (can(actor.role, "leads.view.unassigned")) {
    conditions.push(isNull(leads.assignedToId));
  }
  if (can(actor.role, "leads.view.assigned")) {
    conditions.push(eq(leads.assignedToId, actor.id));
  }
  return conditions.length ? or(...conditions) : sql`0`;
}

/** One page of leads for `query` that `actor` is allowed to see, plus the total. */
export function listLeads(
  query: TableQuery,
  actor: Actor,
): ListPageResult<LeadRow> {
  const db = getDb();
  const showAttribution = can(actor.role, "leads.view.attribution");

  // Search spans the matter id and the injured person's contact details.
  const conditions: Array<SQL | undefined> = [
    leadsVisibilityCondition(actor),
    searchCondition(query.search, [
      leads.matterId,
      leads.injuredFirstName,
      leads.injuredLastName,
      leads.injuredEmail,
      leads.injuredPhone,
    ]),
  ];

  const caseType = readFilter(query, "caseType", isCaseType);
  if (caseType) conditions.push(eq(leads.caseType, caseType));

  const stage = readFilter(query, "stage", isLeadStage);
  if (stage) conditions.push(eq(leads.stage, stage));

  // Source is attribution data: filtering by it would leak which leads came from
  // where, so the condition is only applied for viewers allowed to see it.
  const source = showAttribution
    ? readFilter(query, "source", isLeadSource)
    : null;
  if (source) conditions.push(eq(leads.source, source));

  // The assignee filter carries either a user id or the "unassigned" sentinel.
  const assignee = query.filters.assignedTo;
  if (assignee === UNASSIGNED) {
    conditions.push(isNull(leads.assignedToId));
  } else if (assignee) {
    const id = Number(assignee);
    if (Number.isInteger(id) && id > 0) {
      conditions.push(eq(leads.assignedToId, id));
    }
  }

  // Tri-state qualifying answers (yes / no / unknown).
  conditions.push(booleanFilter(query, "isAtFault", leads.isAtFault));
  conditions.push(booleanFilter(query, "hasAttorney", leads.hasAttorney));
  conditions.push(
    booleanFilter(query, "hasReceivedSettlement", leads.hasReceivedSettlement),
  );

  // Sorting by source is the same side-channel as filtering by it; fall back to
  // the default order rather than order by a column the viewer can't see.
  const pageQuery =
    showAttribution || query.sort?.id !== "source"
      ? query
      : { ...query, sort: null };

  const plan = planListPage({
    db,
    table: leads,
    where: allOf(conditions),
    query: pageQuery,
    sortColumns: SORT_COLUMNS,
    defaultSort: LEADS_DEFAULT_SORT,
  });

  const selected = db
    .select({ ...getTableColumns(leads), assignedToName: users.name })
    .from(leads)
    .leftJoin(users, eq(leads.assignedToId, users.id))
    .where(plan.where)
    .orderBy(plan.orderBy)
    .limit(plan.limit)
    .offset(plan.offset)
    .all();

  // Omit the attribution fields for viewers who may not see them — the values
  // never leave the server, so the grid and dialog have nothing to render.
  const rows = showAttribution
    ? selected
    : selected.map(withoutAttribution);

  return { rows, total: plan.total, page: plan.page, sort: plan.sort };
}
