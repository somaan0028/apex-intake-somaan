/**
 * Potential-duplicate grouping.
 *
 * `dup_group_id` is a random token shared by a cluster of similar leads. The
 * invariant is strict: a lead has a group id **only while the cluster has two
 * or more members**. Unique leads and dismissed leads always have `null`.
 *
 * Matching is triggered in exactly three places:
 *   1. a full rebuild after the CSV import (the only O(n²) pass),
 *   2. a new lead arriving through the public intake endpoint,
 *   3. an edit that changes the injured person's name, email or phone.
 *
 * There is no periodic sweep. That is what lets "Mark as Not Duplicate" stick:
 * the dismissed lead is still compared against future leads, but nothing
 * revisits it on its own.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { buildDupMatchString, isPotentialDuplicate } from "./dup-matcher";

/** Token prefix makes a group id recognisable in URLs and logs. */
const GROUP_PREFIX = "dup_";

function newGroupId(): string {
  return `${GROUP_PREFIX}${randomUUID()}`;
}

/** Split an array into fixed-size chunks (SQLite bind-variable safety). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One lead's matching inputs, loaded from the database. */
interface MatchableLead {
  id: number;
  dupMatchString: string | null;
  dupGroupId: string | null;
  injuredFirstName: string | null;
  injuredLastName: string | null;
  injuredEmail: string | null;
  injuredPhone: string | null;
}

const MATCHABLE_COLUMNS = {
  id: leads.id,
  dupMatchString: leads.dupMatchString,
  dupGroupId: leads.dupGroupId,
  injuredFirstName: leads.injuredFirstName,
  injuredLastName: leads.injuredLastName,
  injuredEmail: leads.injuredEmail,
  injuredPhone: leads.injuredPhone,
};

/** The match string for a row, computing it when the stored copy is missing. */
function matchStringFor(lead: MatchableLead): string {
  return (
    lead.dupMatchString ??
    buildDupMatchString(
      lead.injuredFirstName,
      lead.injuredLastName,
      lead.injuredEmail,
      lead.injuredPhone,
    )
  );
}

/**
 * Enforce the "no group of one" invariant after a member leaves `groupId`.
 * Called after a dismissal, a moving edit, or a delete.
 */
export function reconcileDupGroup(groupId: string | null): void {
  if (!groupId) return;

  const remaining = getDb()
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.dupGroupId, groupId))
    .all();

  if (remaining.length === 1) {
    getDb()
      .update(leads)
      .set({ dupGroupId: null })
      .where(eq(leads.id, remaining[0].id))
      .run();
  }
}

/**
 * Re-check one lead against every other lead and reconcile its group.
 *
 * This is the incremental path used by intake and by identity edits. It is
 * O(n) in the number of leads, not O(n²).
 */
export function recheckLead(leadId: number): void {
  const db = getDb();

  const lead = db
    .select(MATCHABLE_COLUMNS)
    .from(leads)
    .where(eq(leads.id, leadId))
    .get();
  if (!lead) return;

  const matchString = buildDupMatchString(
    lead.injuredFirstName,
    lead.injuredLastName,
    lead.injuredEmail,
    lead.injuredPhone,
  );

  // Keep the stored comparison string in step with the editable fields.
  if (matchString !== lead.dupMatchString) {
    db.update(leads)
      .set({ dupMatchString: matchString })
      .where(eq(leads.id, leadId))
      .run();
  }

  const others = db
    .select(MATCHABLE_COLUMNS)
    .from(leads)
    .all()
    .filter((row) => row.id !== leadId);

  const matches = others.filter((row) =>
    isPotentialDuplicate(matchString, matchStringFor(row)),
  );

  // No peer: the lead is unique. Leave the old group, then make sure it did
  // not become a group of one.
  if (matches.length === 0) {
    if (lead.dupGroupId) {
      db.update(leads)
        .set({ dupGroupId: null })
        .where(eq(leads.id, leadId))
        .run();
      reconcileDupGroup(lead.dupGroupId);
    }
    return;
  }

  // Prefer the lead's current group when it still matches one of its members;
  // this avoids churning ids when an edit does not break the cluster.
  const matchedGroupIds = [
    ...new Set(
      matches
        .map((row) => row.dupGroupId)
        .filter((value): value is string => value !== null),
    ),
  ];
  const target =
    lead.dupGroupId &&
    matches.some((row) => row.dupGroupId === lead.dupGroupId)
      ? lead.dupGroupId
      : (matchedGroupIds[0] ?? newGroupId());

  const previousGroupId = lead.dupGroupId;
  const matchedIds = matches.map((row) => row.id);

  db.transaction(() => {
    // A lead can match members of several existing clusters; merge them all
    // into the target before assigning the new membership.
    const mergeIds = matchedGroupIds.filter((id) => id !== target);
    for (const batch of chunk(mergeIds, 300)) {
      db.update(leads)
        .set({ dupGroupId: target })
        .where(inArray(leads.dupGroupId, batch))
        .run();
    }

    for (const batch of chunk([leadId, ...matchedIds], 300)) {
      db.update(leads)
        .set({ dupGroupId: target })
        .where(inArray(leads.id, batch))
        .run();
    }
  });

  if (previousGroupId && previousGroupId !== target) {
    reconcileDupGroup(previousGroupId);
  }
}

/**
 * Recompute every match string and regroup the whole table.
 *
 * Used once after the CSV import (and by the backfill script). It clears all
 * group ids first, then assigns ids only to clusters of two or more. Running it
 * again later will re-link pairs that an admin dismissed, because dismissal is
 * represented solely by an empty group id.
 */
export function rebuildDuplicateGroups(): {
  leads: number;
  groups: number;
} {
  const db = getDb();
  const rows: MatchableLead[] = db
    .select(MATCHABLE_COLUMNS)
    .from(leads)
    .all();

  const strings = new Map<number, string>();
  const byId = new Map<number, MatchableLead>();
  for (const row of rows) {
    strings.set(row.id, matchStringFor(row));
    byId.set(row.id, row);
  }

  // Union-find over every pair. This is the one deliberately quadratic pass;
  // it only runs for the initial import or an explicit backfill.
  const parent = new Map<number, number>();
  for (const row of rows) parent.set(row.id, row.id);

  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;

    // Path compression keeps the pair scan from degenerating into long walks.
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (isPotentialDuplicate(strings.get(rows[i].id)!, strings.get(rows[j].id)!)) {
        union(rows[i].id, rows[j].id);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (const row of rows) {
    const root = find(row.id);
    const members = clusters.get(root);
    if (members) members.push(row.id);
    else clusters.set(root, [row.id]);
  }

  // A cluster keeps its most-used existing id when it still has one, so a
  // backfill does not churn ids that may already be in a copied URL.
  const assignments: Array<{ groupId: string; ids: number[] }> = [];
  let groups = 0;
  let linkedLeads = 0;

  for (const members of clusters.values()) {
    if (members.length < 2) continue;

    const counts = new Map<string, number>();
    for (const id of members) {
      const existing = byId.get(id)?.dupGroupId;
      if (existing) counts.set(existing, (counts.get(existing) ?? 0) + 1);
    }
    const existing = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const groupId = existing ?? newGroupId();

    assignments.push({ groupId, ids: members });
    groups++;
    linkedLeads += members.length;
  }

  db.transaction(() => {
    for (const row of rows) {
      const next = strings.get(row.id)!;
      if (row.dupMatchString !== next) {
        db.update(leads)
          .set({ dupMatchString: next })
          .where(eq(leads.id, row.id))
          .run();
      }
    }

    // Start from a clean slate so no stale or singleton group survives.
    db.update(leads)
      .set({ dupGroupId: null })
      .where(isNotNull(leads.dupGroupId))
      .run();

    for (const assignment of assignments) {
      for (const batch of chunk(assignment.ids, 300)) {
        db.update(leads)
          .set({ dupGroupId: assignment.groupId })
          .where(inArray(leads.id, batch))
          .run();
      }
    }
  });

  return { leads: linkedLeads, groups };
}
