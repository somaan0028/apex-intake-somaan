/**
 * Queries for the leads grid.
 *
 * Same shape as `lib/users/queries.ts` — search, allow-listed filters, sorting,
 * and paging all in SQL, one page at a time. The shared plumbing lives in
 * `lib/db/list-query.ts`.
 */
import { eq, isNull, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "@/lib/db";
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
  type LeadStage,
} from "@/lib/db/schema";
import type { TableQuery } from "@/lib/table-query";
import { LEAD_SOURCES, UNASSIGNED, type LeadSource } from "./constants";

/** A lead row as the grid consumes it (assignee name comes from the join). */
export type LeadRow = {
  id: number;
  createdAt: Date | null;
  caseType: CaseType | null;
  stage: LeadStage;
  source: string | null;
  state: string | null;
  county: string | null;
  injuredFirstName: string | null;
  injuredLastName: string | null;
  injuredEmail: string | null;
  injuredPhone: string | null;
  /** True when the form was submitted for someone other than the injured person. */
  isFillingForSomeoneElse: boolean;
  fillerFirstName: string | null;
  fillerLastName: string | null;
  /** Tri-state qualifying answers; `null` means "not recorded". */
  isAtFault: boolean | null;
  hasAttorney: boolean | null;
  hasReceivedSettlement: boolean | null;
  /** Display name of the assigned agent, or `null` when unassigned. */
  assignedToName: string | null;
};

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

/** One page of leads for `query`, plus the total number of matching rows. */
export function listLeads(query: TableQuery): ListPageResult<LeadRow> {
  const db = getDb();

  // Search spans the matter id and the injured person's contact details.
  const conditions: Array<SQL | undefined> = [
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

  const source = readFilter(query, "source", isLeadSource);
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

  const plan = planListPage({
    db,
    table: leads,
    where: allOf(conditions),
    query,
    sortColumns: SORT_COLUMNS,
    defaultSort: LEADS_DEFAULT_SORT,
  });

  const rows = db
    .select({
      id: leads.id,
      createdAt: leads.createdAt,
      caseType: leads.caseType,
      stage: leads.stage,
      source: leads.source,
      state: leads.state,
      county: leads.county,
      injuredFirstName: leads.injuredFirstName,
      injuredLastName: leads.injuredLastName,
      injuredEmail: leads.injuredEmail,
      injuredPhone: leads.injuredPhone,
      isFillingForSomeoneElse: leads.isFillingForSomeoneElse,
      fillerFirstName: leads.fillerFirstName,
      fillerLastName: leads.fillerLastName,
      isAtFault: leads.isAtFault,
      hasAttorney: leads.hasAttorney,
      hasReceivedSettlement: leads.hasReceivedSettlement,
      assignedToName: users.name,
    })
    .from(leads)
    .leftJoin(users, eq(leads.assignedToId, users.id))
    .where(plan.where)
    .orderBy(plan.orderBy)
    .limit(plan.limit)
    .offset(plan.offset)
    .all();

  return { rows, total: plan.total, page: plan.page, sort: plan.sort };
}
