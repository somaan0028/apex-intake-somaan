/**
 * `leads` model — a lead captured for one of our case types.
 *
 * Design notes
 * ------------
 * The source CSV is a Lawmatics export, so the boolean-ish columns arrive as
 * messy free text (`Yes`/`No`/`Y`/`N`/`true`/`false`, mixed case). They are
 * normalised on import to real booleans, stored as SQLite `0`/`1` (`null` =
 * unknown), and exposed to the app as `boolean | null`.
 *
 * Person columns are split by role, not by "who submitted":
 *   - `injured*` — always the injured person.
 *   - `filler*`  — the person who filled in the form, and only when that is
 *                  someone other than the injured person (otherwise `null`).
 * `isFillingForSomeoneElse` distinguishes the two cases.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users";

/** Case types the desk handles. Stored as canonical codes (labels in `lib/labels.ts`). */
export const CASE_TYPES = ["MVA", "MASS_TORT", "OTHER"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** The ordered pipeline stages. `DISQUALIFIED` closes a lead. */
export const LEAD_STAGES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "RETAINED",
  "SENT_TO_FIRM",
  "DISQUALIFIED",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Fixed set of relationships the filler can have to the injured person. */
export const RELATIONSHIPS = [
  "SPOUSE",
  "PARENT",
  "STEP_PARENT",
  "CHILD",
  "STEP_CHILD",
  "SIBLING",
  "GRANDPARENT",
  "GRANDCHILD",
  "AUNT_UNCLE",
  "NIECE",
  "NEPHEW",
  "COUSIN",
  "IN_LAW",
  "FRIEND",
  "COLLEAGUE",
  "NEIGHBOR",
  "OTHER",
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const leads = sqliteTable(
  "leads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** External matter id from Lawmatics, e.g. `APX-10001`. Unique when present;
     *  public form submissions leave it empty. */
    matterId: text("matter_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    /**
     * Case type. Normally a canonical code from `CASE_TYPES`, but an ad
     * campaign the desk doesn't recognise (`utm_campaign`) is stored verbatim,
     * so the raw campaign value is never lost. Read it through
     * `caseTypeLabel()` rather than indexing a label map directly.
     */
    caseType: text("case_type"),
    /** Pipeline stage; defaults to `NEW`. */
    stage: text("stage").$type<LeadStage>().notNull().default("NEW"),
    /** Intake agent currently owning the lead (null = unassigned). */
    assignedToId: integer("assigned_to_id").references(() => users.id),

    // --- Person who filled in the form (only when different from the injured) ---
    fillerFirstName: text("filler_first_name"),
    fillerLastName: text("filler_last_name"),
    fillerPhone: text("filler_phone"),
    fillerEmail: text("filler_email"),
    /** True when the form was filled out for someone other than the injured. */
    isFillingForSomeoneElse: integer("is_filling_for_someone_else", {
      mode: "boolean",
    })
      .notNull()
      .default(false),

    // --- Injured person (always populated) ---
    injuredFirstName: text("injured_first_name"),
    injuredLastName: text("injured_last_name"),
    injuredPhone: text("injured_phone"),
    injuredEmail: text("injured_email"),
    /** The filler's relationship to the injured person (on-behalf leads only). */
    relationshipToInjured: text(
      "relationship_to_injured",
    ).$type<Relationship>(),

    // --- Accident / case facts ---
    /** Accident date, stored as a Unix timestamp (seconds). */
    dateOfAccident: integer("date_of_accident", { mode: "timestamp" }),
    state: text("state"),
    county: text("county"),
    postcode: text("postcode"),
    injuryDetails: text("injury_details"),
    accidentDetails: text("accident_details"),

    // --- Case-qualifying booleans (stored as SQLite 0/1; null = unknown) ---
    isAtFault: integer("is_at_fault", { mode: "boolean" }),
    hasAttorney: integer("has_attorney", { mode: "boolean" }),
    hasReceivedSettlement: integer("has_received_settlement", {
      mode: "boolean",
    }),

    // --- Attribution / tracking ---
    source: text("source"),
    /** `utm_medium` from the ad that brought the visitor in, stored verbatim. */
    medium: text("medium"),
    /** `utm_content` from the ad that brought the visitor in, stored verbatim. */
    content: text("content"),
    ipaddress: text("ipaddress"),
    trustedform: text("trustedform"),
    journaya: text("journaya"),

    // --- Potential-duplicate detection ---
    /**
     * Normalised `name|email|phone` of the injured person, used by the fuzzy
     * matcher. Internal only — it is stripped before a row reaches the client.
     */
    dupMatchString: text("dup_match_string"),
    /**
     * Random token shared by leads in the same potential-duplicate cluster.
     * Non-null only while the cluster has two or more members.
     */
    dupGroupId: text("dup_group_id"),

    // --- Brightwater submission state ---
    /** Lead id returned by Brightwater on a successful send. */
    brightwaterLeadId: text("brightwater_lead_id"),
    /** Unix timestamp (seconds) of the (at most one) successful send. */
    sentToFirmAt: integer("sent_to_firm_at", { mode: "timestamp" }),
  },
  (table) => [
    // Matter ids are unique among imported leads; web submissions leave the
    // field empty, and several empty values must not collide.
    uniqueIndex("leads_matter_id_unique")
      .on(table.matterId)
      .where(sql`${table.matterId} <> ''`),
    index("leads_stage_idx").on(table.stage),
    index("leads_assigned_to_idx").on(table.assignedToId),
    index("leads_case_type_idx").on(table.caseType),
    index("leads_filler_email_idx").on(table.fillerEmail),
    index("leads_dup_group_id_idx").on(table.dupGroupId),
    // Enforce the fixed relationship set at the storage level (NULL is allowed).
    check(
      "leads_relationship_check",
      sql`${table.relationshipToInjured} in (${sql.join(
        RELATIONSHIPS.map((value) => sql.raw(`'${value}'`)),
        sql`, `,
      )})`,
    ),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
