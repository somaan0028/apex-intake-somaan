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
import { isValidEmail, normalizePostcode } from "@/lib/validation";
import { csvToRecords } from "./csv";
import {
  toCaseType,
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
import { buildDupMatchString } from "../leads/dup-matcher";
import { rebuildDuplicateGroups } from "../leads/dup-groups";

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
    const name = toNullableText(record.name);
    const email = (toNullableText(record.email) ?? "").toLowerCase();
    const role: UserRole = toUserRole(record.role);

    if (!name) {
      throw new Error("[db] User seed row is missing a name.");
    }
    if (!isValidEmail(email)) {
      throw new Error(
        `[db] User ${email || "(blank)"}: invalid email address in users.csv.`,
      );
    }

    return {
      name,
      email,
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

      // ZIP codes go through the same canonicaliser the public form and the
      // detail dialog use, so an export with junk fails the import loudly
      // instead of putting an invalid postcode in the table.
      const rawPostcode = toNullableText(record.postcode);
      const postcode = rawPostcode ? normalizePostcode(rawPostcode) : null;
      if (rawPostcode && !postcode) {
        throw new Error(
          `[db] Lead ${matterId}: invalid ZIP code ${JSON.stringify(record.postcode)}. ` +
            `Expected 12345, 123456789 or 12345-6789.`,
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

      // The injured person's identity is always required; the submitter's is
      // required whenever the form was filled in for someone else. Contact
      // details must be usable, so a bad export cell fails the import instead
      // of silently becoming NULL (or, worse, storing junk).
      if (!injured.injuredFirstName || !injured.injuredLastName) {
        throw new Error(
          `[db] Lead ${matterId}: the injured person's first and last name are required.`,
        );
      }
      if (!injured.injuredEmail || !isValidEmail(injured.injuredEmail)) {
        throw new Error(
          `[db] Lead ${matterId}: invalid injured email ${JSON.stringify(
            onBehalf ? record.injured_email : record.email,
          )}.`,
        );
      }
      // A phone is optional in the export (a few on-behalf rows have none),
      // but a value that is present must be a usable 10-digit number.
      const rawInjuredPhone = onBehalf ? record.injured_phone : record.phone;
      if (toNullableText(rawInjuredPhone) && !injured.injuredPhone) {
        throw new Error(
          `[db] Lead ${matterId}: invalid injured phone ${JSON.stringify(
            rawInjuredPhone,
          )}.`,
        );
      }
      if (onBehalf) {
        if (!filler.fillerFirstName || !filler.fillerLastName) {
          throw new Error(
            `[db] Lead ${matterId}: the submitter's first and last name are required when filing for someone else.`,
          );
        }
        if (!filler.fillerEmail || !isValidEmail(filler.fillerEmail)) {
          throw new Error(
            `[db] Lead ${matterId}: invalid submitter email ${JSON.stringify(
              record.email,
            )}.`,
          );
        }
        if (toNullableText(record.phone) && !filler.fillerPhone) {
          throw new Error(
            `[db] Lead ${matterId}: invalid submitter phone ${JSON.stringify(
              record.phone,
            )}.`,
          );
        }
        if (!injured.relationshipToInjured) {
          throw new Error(
            `[db] Lead ${matterId}: unrecognised relationship ${JSON.stringify(
              record.relationship_to_injured,
            )}. Valid relationships live in lib/db/schema/leads.ts.`,
          );
        }
      }

      const rawDate = toNullableText(record.date_of_accident);
      const dateOfAccident = toNullableDate(record.date_of_accident);
      if (rawDate && !dateOfAccident) {
        throw new Error(
          `[db] Lead ${matterId}: invalid accident date ${JSON.stringify(
            record.date_of_accident,
          )}.`,
        );
      }
      if (dateOfAccident) {
        const now = new Date();
        const todayUtc = Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
        );
        if (dateOfAccident.getTime() > todayUtc) {
          throw new Error(
            `[db] Lead ${matterId}: accident date ${JSON.stringify(
              record.date_of_accident,
            )} is in the future.`,
          );
        }
      }

      return {
        matterId,
        createdAt: toNullableDate(record.created_at),
        caseType: toCaseType(record.campaign),
        stage: toLeadStage(record.stage),
        assignedToId: userIdByEmail.get(assignedEmail) ?? null,

        ...filler,
        isFillingForSomeoneElse: onBehalf,
        ...injured,

        dateOfAccident,
        state: stateCode,
        county,
        postcode,
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
        journaya: toNullableText(record.journaya),

        // The comparison string is part of the imported record; grouping runs
        // once after the whole file has been inserted.
        dupMatchString: buildDupMatchString(
          injured.injuredFirstName,
          injured.injuredLastName,
          injured.injuredEmail,
          injured.injuredPhone,
        ),

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

  const result = run();

  // The only full fuzzy pass in normal operation: once, after the import has
  // committed. Inline checks handle leads that arrive later. Grouping is
  // auxiliary, so a matcher failure must not stop the app from booting with
  // the imported data intact.
  try {
    rebuildDuplicateGroups();
  } catch (error) {
    console.error(
      "[db] Duplicate grouping failed; leads were imported ungrouped.",
      error,
    );
  }

  return result;
}
