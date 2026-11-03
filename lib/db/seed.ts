/**
 * Seed the database from the bundled Apex CSV exports.
 *
 * Called once, on first boot, right after the schema is created (see
 * `bootstrap.ts`). Both files live in `lib/db/seed-data/`.
 *
 * Import policy: text values are trimmed and empty strings become `NULL`;
 * boolean-ish columns are normalised to real booleans (`Yes`/`N`/`true`/… →
 * `true`/`false`, and blanks or unrecognised values → `NULL`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/auth/password";
import { csvToRecords } from "./csv";
import {
  toCampaign,
  toCounty,
  toFillingForSomeoneElse,
  toLeadStage,
  toNullableBoolean,
  toNullableDate,
  toNullableText,
  toRelationship,
  toStateCode,
  toUsPhone,
  toUserRole,
} from "./normalize";
import { getDb, getRawDb, type AppDatabase } from "./index";
import {
  leads,
  users,
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

/** Insert the 15 demo users, hashing the shared password for each. */
function seedUsers(db: AppDatabase): number {
  const records = csvToRecords(readSeedFile("users.csv"));

  const rows: NewUser[] = records.map((record) => {
    const role: UserRole = toUserRole(record.role);

    return {
      name: toNullableText(record.name) ?? "Unknown",
      email: (toNullableText(record.email) ?? "").toLowerCase(),
      role,
      passwordHash: hashPassword(DEFAULT_DEMO_PASSWORD),
      createdAt: new Date(),
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
      const matterId = toNullableText(record.matter_id)!;
      const assignedEmail = (record.assigned_to ?? "").trim().toLowerCase();
      const onBehalf = toFillingForSomeoneElse(record.filling_for);

      // State and county must come from our fixed reference lists; anything we
      // can't identify fails the import loudly rather than storing junk.
      const stateCode = toStateCode(record.state);
      if (!stateCode) {
        throw new Error(
          `[db] Lead ${matterId}: unrecognised state ${JSON.stringify(record.state)}. ` +
            `Valid states live in lib/us-states.ts.`,
        );
      }
      const rawCounty = toNullableText(record.county);
      const county = rawCounty ? toCounty(stateCode, rawCounty) : null;
      if (rawCounty && !county) {
        throw new Error(
          `[db] Lead ${matterId}: unrecognised county ${JSON.stringify(record.county)} ` +
            `for ${stateCode}. Valid counties live in lib/us-counties.ts.`,
        );
      }

      // The export stores the submitter's details in `first_name`…`email`
      // regardless of who was injured. Redistribute so:
      //   - `injured*` always describes the injured person, and
      //   - `filler*` holds the submitter only when that is someone else.
      const filler = onBehalf
        ? {
            fillerFirstName: toNullableText(record.first_name),
            fillerLastName: toNullableText(record.last_name),
            fillerPhone: toUsPhone(record.phone),
            fillerEmail: toNullableText(record.email),
          }
        : {
            fillerFirstName: null,
            fillerLastName: null,
            fillerPhone: null,
            fillerEmail: null,
          };

      const injured = onBehalf
        ? {
            injuredFirstName: toNullableText(record.injured_first_name),
            injuredLastName: toNullableText(record.injured_last_name),
            injuredPhone: toUsPhone(record.injured_phone),
            injuredEmail: toNullableText(record.injured_email),
            relationshipToInjured: toRelationship(
              record.relationship_to_injured,
            ),
          }
        : {
            injuredFirstName: toNullableText(record.first_name),
            injuredLastName: toNullableText(record.last_name),
            injuredPhone: toUsPhone(record.phone),
            injuredEmail: toNullableText(record.email),
            relationshipToInjured: null,
          };

      return {
        matterId,
        createdAt: toNullableDate(record.created_at),
        campaign: toCampaign(record.campaign),
        stage: toLeadStage(record.stage),
        assignedToId: userIdByEmail.get(assignedEmail) ?? null,

        ...filler,
        isFillingForSomeoneElse: onBehalf,
        ...injured,

        dateOfAccident: toNullableDate(record.date_of_accident),
        state: stateCode,
        county,
        postcode: toNullableText(record.postcode),
        injuryDetails: toNullableText(record.how_were_you_hurt),
        accidentDetails: toNullableText(record.briefly_describe_accident),

        // Normalise the export's messy boolean text (`Yes`/`N`/`true`/…).
        isAtFault: toNullableBoolean(record.were_you_at_fault),
        hasAttorney: toNullableBoolean(record.do_you_have_an_attorney),
        hasReceivedSettlement: toNullableBoolean(
          record.have_you_received_settlement,
        ),

        source: toNullableText(record.source),
        ipaddress: toNullableText(record.ipaddress),
        trustedform: toNullableText(record.trustedform),
        jornaya: toNullableText(record.jornaya),

        brightwaterLeadId: toNullableText(record.brightwater_lead_id),
        sentToFirmAt: toNullableDate(record.sent_to_firm_at),
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
