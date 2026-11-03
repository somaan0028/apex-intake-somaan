/**
 * `leads` model — a lead captured by a campaign or the public intake form.
 *
 * Design notes
 * ------------
 * SQLite has no native boolean type, and Brightwater's integration spec declares
 * fields such as `were_you_at_fault` / `do_you_have_an_attorney` /
 * `have_you_received_settlement` as free text ("any value allowed"). We therefore
 * store them as `TEXT` exactly as they arrive (trimmed), never coerced to 0/1.
 *
 * The submitter (`firstName` … `email`) is the "contact of record". When the form
 * is filled in on behalf of someone else, the injured person's details live in the
 * `injured*` columns.
 */
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users";

/** The ordered pipeline stages. `Disqualified` closes a lead. */
export const LEAD_STAGES = [
  "New",
  "Contacted",
  "Qualified",
  "Retained",
  "Sent to Firm",
  "Disqualified",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const leads = sqliteTable(
  "leads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** External matter id from Lawmatics, e.g. `APX-10001`. Unique per lead. */
    matterId: text("matter_id").notNull(),
    createdAt: text("created_at"),
    /** Campaign the lead was captured under, e.g. `MVA` or `Mass Tort`. */
    campaign: text("campaign"),
    /** Pipeline stage; defaults to `New`. */
    stage: text("stage").$type<LeadStage>().notNull().default("New"),
    /** Intake agent currently owning the lead (null = unassigned). */
    assignedToId: integer("assigned_to_id").references(() => users.id),

    // --- Contact of record (the person who submitted the form) ---
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    email: text("email"),
    /** `Myself` or `On behalf of someone else`. */
    fillingFor: text("filling_for"),

    // --- Injured person (only populated for "on behalf of" leads) ---
    injuredFirstName: text("injured_first_name"),
    injuredLastName: text("injured_last_name"),
    injuredPhone: text("injured_phone"),
    injuredEmail: text("injured_email"),
    relationshipToInjured: text("relationship_to_injured"),

    // --- Accident / case facts ---
    /** Free text: the source data mixes `MM/DD/YYYY` and ISO formats. */
    dateOfAccident: text("date_of_accident"),
    state: text("state"),
    county: text("county"),
    postcode: text("postcode"),
    howWereYouHurt: text("how_were_you_hurt"),
    brieflyDescribeAccident: text("briefly_describe_accident"),

    // --- Booleans stored as free text (spec: "any value allowed") ---
    wereYouAtFault: text("were_you_at_fault"),
    doYouHaveAnAttorney: text("do_you_have_an_attorney"),
    haveYouReceivedSettlement: text("have_you_received_settlement"),

    // --- Attribution / tracking ---
    source: text("source"),
    ipaddress: text("ipaddress"),
    trustedform: text("trustedform"),
    jornaya: text("jornaya"),

    // --- Brightwater submission state ---
    /** Lead id returned by Brightwater on a successful send. */
    brightwaterLeadId: text("brightwater_lead_id"),
    /** ISO timestamp of the (at most one) successful send. */
    sentToFirmAt: text("sent_to_firm_at"),
  },
  (table) => [
    uniqueIndex("leads_matter_id_unique").on(table.matterId),
    index("leads_stage_idx").on(table.stage),
    index("leads_assigned_to_idx").on(table.assignedToId),
    index("leads_campaign_idx").on(table.campaign),
    index("leads_email_idx").on(table.email),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
