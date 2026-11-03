/**
 * Seed the database from the bundled Apex CSV exports.
 *
 * Called once, on first boot, right after the schema is created (see
 * `bootstrap.ts`). Both files live in `lib/db/seed-data/`.
 *
 * Import policy (agreed): values are trimmed and otherwise stored exactly as
 * provided; empty strings become `NULL`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/auth/password";
import { csvToRecords, toNullableText } from "./csv";
import { getDb, getRawDb, type AppDatabase } from "./index";
import {
  LEAD_STAGES,
  leads,
  users,
  type LeadStage,
  type NewLead,
  type NewUser,
  type UserRole,
} from "./schema";

/** Password shared by every seeded demo account (per the assessment brief). */
export const DEFAULT_DEMO_PASSWORD = "apex-demo-2026";

/** Keep each multi-row INSERT well under SQLite's bound-variable limit. */
const INSERT_CHUNK_SIZE = 25;

/** Folder that holds the bundled CSV seed files (alongside this module). */
const SEED_DATA_DIR = path.join(process.cwd(), "lib", "db", "seed-data");

interface SeedResult {
  users: number;
  leads: number;
}

/** Read one of the CSV seed files from `SEED_DATA_DIR`. */
function readSeedFile(fileName: string): string {
  return readFileSync(path.join(SEED_DATA_DIR, fileName), "utf8");
}

/** Split an array into fixed-size chunks (for chunked bulk inserts). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Coerce a raw stage value to a known pipeline stage (falls back to `New`). */
function coerceStage(value: string | null): LeadStage {
  const candidate = value?.trim();
  return (LEAD_STAGES as readonly string[]).includes(candidate ?? "")
    ? (candidate as LeadStage)
    : "New";
}

/** Insert the 15 demo users, hashing the shared password for each. */
function seedUsers(db: AppDatabase): number {
  const records = csvToRecords(readSeedFile("users.csv"));

  const rows: NewUser[] = records.map((record) => {
    const role: UserRole = toNullableText(record.role) === "admin" ? "admin" : "user";

    return {
      name: toNullableText(record.name) ?? "Unknown",
      email: (toNullableText(record.email) ?? "").toLowerCase(),
      role,
      passwordHash: hashPassword(DEFAULT_DEMO_PASSWORD),
      createdAt: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    db.insert(users).values(rows).run();
  }
  return rows.length;
}

/** Insert all leads, resolving `assigned_to` emails to user ids. */
function seedLeads(db: AppDatabase): number {
  const records = csvToRecords(readSeedFile("leads.csv"));

  // Build an email -> user id lookup for resolving assignees.
  const userIdByEmail = new Map(
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .all()
      .map((user) => [user.email.toLowerCase(), user.id] as const),
  );

  const rows: NewLead[] = records
    // `matter_id` is the required business key; skip malformed rows defensively.
    .filter((record) => toNullableText(record.matter_id) !== null)
    .map((record) => {
      const assignedEmail = (record.assigned_to ?? "").trim().toLowerCase();

      return {
        matterId: toNullableText(record.matter_id)!,
        createdAt: toNullableText(record.created_at),
        campaign: toNullableText(record.campaign),
        stage: coerceStage(toNullableText(record.stage)),
        assignedToId: userIdByEmail.get(assignedEmail) ?? null,

        firstName: toNullableText(record.first_name),
        lastName: toNullableText(record.last_name),
        phone: toNullableText(record.phone),
        email: toNullableText(record.email),
        fillingFor: toNullableText(record.filling_for),

        injuredFirstName: toNullableText(record.injured_first_name),
        injuredLastName: toNullableText(record.injured_last_name),
        injuredPhone: toNullableText(record.injured_phone),
        injuredEmail: toNullableText(record.injured_email),
        relationshipToInjured: toNullableText(record.relationship_to_injured),

        dateOfAccident: toNullableText(record.date_of_accident),
        state: toNullableText(record.state),
        county: toNullableText(record.county),
        postcode: toNullableText(record.postcode),
        howWereYouHurt: toNullableText(record.how_were_you_hurt),
        brieflyDescribeAccident: toNullableText(record.briefly_describe_accident),

        // Free-text booleans, stored verbatim (never coerced).
        wereYouAtFault: toNullableText(record.were_you_at_fault),
        doYouHaveAnAttorney: toNullableText(record.do_you_have_an_attorney),
        haveYouReceivedSettlement: toNullableText(record.have_you_received_settlement),

        source: toNullableText(record.source),
        ipaddress: toNullableText(record.ipaddress),
        trustedform: toNullableText(record.trustedform),
        jornaya: toNullableText(record.jornaya),

        brightwaterLeadId: toNullableText(record.brightwater_lead_id),
        sentToFirmAt: toNullableText(record.sent_to_firm_at),
      };
    });

  for (const batch of chunk(rows, INSERT_CHUNK_SIZE)) {
    db.insert(leads).values(batch).run();
  }
  return rows.length;
}

/**
 * Seed users and leads inside a single transaction. Uses the raw connection's
 * synchronous transaction wrapper so a failure rolls the whole import back.
 */
export function seedDatabase(db: AppDatabase = getDb()): SeedResult {
  const run = getRawDb().transaction(() => ({
    users: seedUsers(db),
    leads: seedLeads(db),
  }));

  return run();
}
