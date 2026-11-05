/**
 * One-off potential-duplicate backfill.
 *
 * Fills `dup_match_string` for every lead and performs the single full fuzzy
 * pass that assigns `dup_group_id` to clusters of two or more. Run it once
 * after applying the schema migration to an existing database:
 *
 *   npm run leads:dedupe
 *
 * Do not schedule it: because a dismissal is represented only by an empty
 * group id, a repeated full rebuild would re-link pairs an admin dismissed.
 */
import { count } from "drizzle-orm";
import { ensureDatabase } from "../lib/db/bootstrap";
import { getDb } from "../lib/db/index";
import { leads } from "../lib/db/schema";
import { rebuildDuplicateGroups } from "../lib/leads/dup-groups";

// Apply pending migrations (and seed a brand-new database) before touching rows.
ensureDatabase();

const total =
  getDb().select({ value: count() }).from(leads).get()?.value ?? 0;
const result = rebuildDuplicateGroups();

console.log(
  `[dup] ${result.groups} potential-duplicate group(s), ` +
    `${result.leads} of ${total} lead(s) linked.`,
);
