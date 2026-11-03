/**
 * Value normalizers for the CSV import.
 *
 * The seed files are exports from Lawmatics (the CRM Apex is migrating off), so
 * cells arrive messy: mixed case, abbreviations, and boolean-looking free text.
 * These helpers turn raw cells into the shapes the schema actually expects.
 */
import {
  CAMPAIGNS,
  LEAD_STAGES,
  RELATIONSHIPS,
  USER_ROLES,
  type Campaign,
  type LeadStage,
  type Relationship,
  type UserRole,
} from "./schema";
import { COUNTIES_BY_STATE } from "../us-counties";
import { US_STATES } from "../us-states";

/** Trim surrounding whitespace; empty or whitespace-only becomes `null`. */
export function toNullableText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

const TRUE_VALUES = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["false", "f", "no", "n", "0"]);

/**
 * Interpret a boolean-ish cell. Handles the variations seen in the export —
 * `Yes`/`No`, `Y`/`N`, `true`/`false`, `1`/`0`, in any case.
 *
 * Returns `null` for blanks and anything unrecognised (i.e. "unknown" rather
 * than guessing).
 */
export function toNullableBoolean(
  value: string | null | undefined,
): boolean | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "") return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

/**
 * The export stores the self/other choice as text: `Myself` vs
 * `On behalf of someone else`. Collapse it to the boolean the schema stores
 * (`true` = filled out for someone else). Missing/unrecognised → `false`.
 */
export function toFillingForSomeoneElse(
  value: string | null | undefined,
): boolean {
  return (value ?? "").trim().toLowerCase().includes("behalf");
}

/** Canonical enum key: trim, upper-case, and spaces/hyphens → underscores. */
function canonicalKey(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** Normalise a raw campaign cell (`MVA`, `Mass Tort`, `mass-tort`, …). */
export function toCampaign(value: string | null | undefined): Campaign | null {
  const key = canonicalKey(value);
  return (CAMPAIGNS as readonly string[]).includes(key)
    ? (key as Campaign)
    : null;
}

/** Normalise a raw stage cell (`New`, `Sent to Firm`, `sent_to_firm`, …). */
export function toLeadStage(value: string | null | undefined): LeadStage {
  const key = canonicalKey(value);
  return (LEAD_STAGES as readonly string[]).includes(key)
    ? (key as LeadStage)
    : "NEW";
}

/** Normalise a raw role cell (`admin`, `Admin`, …). */
export function toUserRole(value: string | null | undefined): UserRole {
  const key = canonicalKey(value);
  return (USER_ROLES as readonly string[]).includes(key)
    ? (key as UserRole)
    : "USER";
}

/**
 * Normalise a raw relationship cell to the fixed set (`Spouse` → `SPOUSE`,
 * `other family member` → `OTHER_FAMILY`, …). Unrecognised → `null`.
 */
export function toRelationship(
  value: string | null | undefined,
): Relationship | null {
  const key = canonicalKey(value);
  return (RELATIONSHIPS as readonly string[]).includes(key)
    ? (key as Relationship)
    : null;
}

/**
 * Normalise a US phone number to `(XXX) XXX-XXXX`.
 * Accepts `919-555-0124`, `(303) 555-0168`, `7755550144`, `+1 267 555 0102`,
 * `916.555.0170`, … Returns `null` when it isn't a 10-digit US number.
 */
export function toUsPhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/**
 * Parse a date cell into a `Date` (stored as a Unix timestamp in seconds).
 * The export mixes `MM/DD/YYYY` and ISO (`YYYY-MM-DD`, or a full timestamp);
 * blanks and unparseable values become `null`.
 */
export function toNullableDate(
  value: string | null | undefined,
): Date | null {
  const raw = (value ?? "").trim();
  if (raw === "") return null;

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (us) {
    const date = new Date(
      Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const STATE_BY_CODE = new Map(
  US_STATES.map((state) => [state.code.toLowerCase(), state.code]),
);
const STATE_BY_NAME = new Map(
  US_STATES.map((state) => [state.name.toLowerCase(), state.code]),
);

/**
 * Resolve a state cell to the canonical two-letter code — accepts either a code
 * (`CA`, `ca`) or a full name (`California`, `california`). Blank/unknown → `null`.
 */
export function toStateCode(value: string | null | undefined): string | null {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "") return null;
  return STATE_BY_CODE.get(key) ?? STATE_BY_NAME.get(key) ?? null;
}

const countyLookups = new Map<string, Map<string, string>>();

function countyLookup(stateCode: string): Map<string, string> {
  let lookup = countyLookups.get(stateCode);
  if (!lookup) {
    lookup = new Map(
      (COUNTIES_BY_STATE[stateCode] ?? []).map((name) => [
        name.toLowerCase(),
        name,
      ]),
    );
    countyLookups.set(stateCode, lookup);
  }
  return lookup;
}

/**
 * Resolve a county cell against the state's fixed list, returning the canonical
 * spelling (`"orange"` → `"Orange"`). Blank/unknown → `null`.
 */
export function toCounty(
  stateCode: string | null | undefined,
  value: string | null | undefined,
): string | null {
  const code = (stateCode ?? "").trim().toUpperCase();
  const key = (value ?? "").trim().toLowerCase();
  if (code === "" || key === "") return null;
  return countyLookup(code).get(key) ?? null;
}
