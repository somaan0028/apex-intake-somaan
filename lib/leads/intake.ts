/**
 * Public intake submission: the payload the form posts and the endpoint stores.
 *
 * Field names deliberately mirror the `leads` columns so building the payload is
 * a direct mapping (see `buildIntakeSubmission` in the form's `types.ts`) and the
 * endpoint can insert almost verbatim.
 *
 * `validateIntakeSubmission` is the server-side source of truth: the endpoint is
 * public, so nothing from the client is trusted. It canonicalises every value
 * (state code, county spelling, phone, dates) and returns field-level errors.
 */
import { CASE_TYPES, RELATIONSHIPS, type Relationship } from "@/lib/db/schema";
import { toCounty, toStateCode, toUsPhone } from "@/lib/db/normalize";
import { isValidEmail, normalizePostcode } from "@/lib/validation";
import {
  EMPTY_UTM,
  MAX_UTM_LENGTH,
  caseTypeFromCampaign,
  leadSourceFromUtm,
  type UtmParams,
} from "./utm";

/** Guard against outsized free-text payloads. */
const MAX_TEXT_LENGTH = 5000;

/** Human-readable names for validation keys, used to summarise failures. */
export const INTAKE_FIELD_LABELS: Record<string, string> = {
  isFillingForSomeoneElse: "Who this is for",
  caseType: "Case type",
  dateOfAccident: "Date of accident",
  state: "State",
  county: "County",
  postcode: "ZIP code",
  accidentDetails: "What happened",
  injuryDetails: "Injuries",
  isAtFault: "At-fault question",
  hasAttorney: "Attorney question",
  hasReceivedSettlement: "Settlement question",
  injuredFirstName: "Injured person's first name",
  injuredLastName: "Injured person's last name",
  injuredPhone: "Injured person's phone",
  injuredEmail: "Injured person's email",
  relationshipToInjured: "Relationship",
  fillerFirstName: "Your first name",
  fillerLastName: "Your last name",
  fillerPhone: "Your phone",
  fillerEmail: "Your email",
  form: "Submission",
};

export interface IntakeSubmission {
  /** Mirrors `leads.is_filling_for_someone_else`. */
  isFillingForSomeoneElse: boolean;
  /** Mirrors `leads.case_type`. A known code, or a raw campaign value. */
  caseType: string;
  /** `YYYY-MM-DD`. */
  dateOfAccident: string | null;
  state: string;
  county: string | null;
  postcode: string | null;
  accidentDetails: string;
  injuryDetails: string | null;
  isAtFault: boolean;
  hasAttorney: boolean;
  hasReceivedSettlement: boolean;
  injuredFirstName: string;
  injuredLastName: string;
  injuredPhone: string;
  injuredEmail: string;
  relationshipToInjured: Relationship | null;
  fillerFirstName: string | null;
  fillerLastName: string | null;
  fillerPhone: string | null;
  fillerEmail: string | null;
  /** Mirrors `leads.source`, resolved from `utm_source` (empty when absent). */
  source: string | null;
  /** Mirrors `leads.medium` (`utm_medium`), stored verbatim. */
  medium: string | null;
  /** Mirrors `leads.content` (`utm_content`), stored verbatim. */
  content: string | null;
}

export type IntakeValidation =
  | { ok: true; data: IntakeSubmission }
  | { ok: false; errors: Record<string, string> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Build a canonical `YYYY-MM-DD` from numeric parts, or `null` if impossible. */
function buildIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Parse a date cell into a canonical `YYYY-MM-DD`. Accepts ISO (`2026-01-15`)
 * and US (`1/15/2026`) input — the latter covers browsers that fall back to a
 * text input for `<input type="date">`.
 */
function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) return buildIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) return buildIsoDate(Number(us[3]), Number(us[1]), Number(us[2]));
  return null;
}

/** Untrusted `tracking` block: keep only the four known params, bounded and trimmed. */
function parseTracking(input: unknown): UtmParams {
  if (!isRecord(input)) return EMPTY_UTM;
  const read = (value: unknown): string | null => {
    const trimmed = asTrimmedString(value);
    return trimmed === "" ? null : trimmed.slice(0, MAX_UTM_LENGTH);
  };
  return {
    source: read(input.source),
    campaign: read(input.campaign),
    medium: read(input.medium),
    content: read(input.content),
  };
}

/** Validate + canonicalise an untrusted intake payload. */
export function validateIntakeSubmission(input: unknown): IntakeValidation {
  if (!isRecord(input)) {
    return { ok: false, errors: { form: "Expected a JSON object." } };
  }

  const errors: Record<string, string> = {};

  // --- Who the form is for -------------------------------------------------
  const isFillingForSomeoneElse = asBoolean(input.isFillingForSomeoneElse);
  if (isFillingForSomeoneElse === null) {
    errors.isFillingForSomeoneElse = "Please choose who this form is for.";
  }
  const forSomeoneElse = isFillingForSomeoneElse === true;

  // --- Ad tracking ---------------------------------------------------------
  // Never fatal: bad or missing tracking must not stop someone submitting.
  const tracking = parseTracking(input.tracking);

  // --- Case type -----------------------------------------------------------
  const rawCaseType = asTrimmedString(input.caseType);
  const submittedCaseType = (CASE_TYPES as readonly string[]).includes(
    rawCaseType,
  )
    ? rawCaseType
    : null;
  if (!submittedCaseType) errors.caseType = "Please choose a case type.";

  // A campaign decides the case type when we recognise it (the form has already
  // preselected it, but the user may have changed it, so their choice wins).
  // An unrecognised campaign is stored as-is, which is why `case_type` is not
  // constrained to the enum.
  const campaignCaseType = caseTypeFromCampaign(tracking.campaign);
  const caseType = campaignCaseType
    ? submittedCaseType
    : (tracking.campaign ?? submittedCaseType);

  // --- Location ------------------------------------------------------------
  const state = toStateCode(asTrimmedString(input.state));
  if (!state) errors.state = "Please choose a valid US state.";

  const rawCounty = asTrimmedString(input.county);
  let county: string | null = null;
  if (rawCounty && state) {
    county = toCounty(state, rawCounty);
    if (!county) errors.county = "Please choose a county from the list.";
  }

  const rawPostcode = asTrimmedString(input.postcode);
  let postcode: string | null = null;
  if (rawPostcode) {
    postcode = normalizePostcode(rawPostcode);
    if (!postcode) errors.postcode = "Enter a valid ZIP code.";
  }

  // --- Date ----------------------------------------------------------------
  const rawDate = asTrimmedString(input.dateOfAccident);
  const today = new Date().toISOString().slice(0, 10);
  const parsedDate = rawDate ? normalizeDate(rawDate) : null;
  let dateOfAccident: string | null = null;
  if (!rawDate) {
    errors.dateOfAccident = "Please provide the date.";
  } else if (!parsedDate) {
    errors.dateOfAccident = "Enter a valid date.";
  } else if (parsedDate > today) {
    errors.dateOfAccident = "The date can't be in the future.";
  } else {
    dateOfAccident = parsedDate;
  }

  // --- Descriptions --------------------------------------------------------
  const accidentDetails = asTrimmedString(input.accidentDetails);
  if (accidentDetails.length < 5) {
    errors.accidentDetails = "Please describe what happened.";
  } else if (accidentDetails.length > MAX_TEXT_LENGTH) {
    errors.accidentDetails = "That description is too long.";
  }
  const injuryDetails = asTrimmedString(input.injuryDetails) || null;
  if (injuryDetails && injuryDetails.length > MAX_TEXT_LENGTH) {
    errors.injuryDetails = "That description is too long.";
  }

  // --- Qualifying questions ------------------------------------------------
  const isAtFault = asBoolean(input.isAtFault);
  const hasAttorney = asBoolean(input.hasAttorney);
  const hasReceivedSettlement = asBoolean(input.hasReceivedSettlement);
  if (isAtFault === null) errors.isAtFault = "Please answer this question.";
  if (hasAttorney === null) errors.hasAttorney = "Please answer this question.";
  if (hasReceivedSettlement === null) {
    errors.hasReceivedSettlement = "Please answer this question.";
  }

  // --- Injured person (always required) ------------------------------------
  const injuredFirstName = asTrimmedString(input.injuredFirstName);
  const injuredLastName = asTrimmedString(input.injuredLastName);
  const injuredPhone = toUsPhone(asTrimmedString(input.injuredPhone));
  const injuredEmail = asTrimmedString(input.injuredEmail);
  if (!injuredFirstName) errors.injuredFirstName = "First name is required.";
  if (!injuredLastName) errors.injuredLastName = "Last name is required.";
  if (!injuredPhone) errors.injuredPhone = "Enter a valid phone number.";
  if (!isValidEmail(injuredEmail)) {
    errors.injuredEmail = "Enter a valid email address.";
  }

  // --- Relationship (only meaningful when filing for someone else) ---------
  let relationshipToInjured: Relationship | null = null;
  if (forSomeoneElse) {
    const rawRelationship = asTrimmedString(input.relationshipToInjured);
    if ((RELATIONSHIPS as readonly string[]).includes(rawRelationship)) {
      relationshipToInjured = rawRelationship as Relationship;
    } else {
      errors.relationshipToInjured = "Please choose your relationship to them.";
    }
  }

  // --- Filler (required when filing for someone else; null for self) --------
  let fillerFirstName: string | null = null;
  let fillerLastName: string | null = null;
  let fillerPhone: string | null = null;
  let fillerEmail: string | null = null;
  if (forSomeoneElse) {
    const first = asTrimmedString(input.fillerFirstName);
    const last = asTrimmedString(input.fillerLastName);
    const phone = toUsPhone(asTrimmedString(input.fillerPhone));
    const email = asTrimmedString(input.fillerEmail);
    if (!first) errors.fillerFirstName = "First name is required.";
    if (!last) errors.fillerLastName = "Last name is required.";
    if (!phone) errors.fillerPhone = "Enter a valid phone number.";
    if (!isValidEmail(email)) {
      errors.fillerEmail = "Enter a valid email address.";
    }
    if (first && last && phone && isValidEmail(email)) {
      fillerFirstName = first;
      fillerLastName = last;
      fillerPhone = phone;
      fillerEmail = email;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // Every required value passed the checks above.
  return {
    ok: true,
    data: {
      isFillingForSomeoneElse: forSomeoneElse,
      caseType: caseType as string,
      dateOfAccident,
      state: state as string,
      county,
      postcode,
      accidentDetails,
      injuryDetails,
      isAtFault: isAtFault as boolean,
      hasAttorney: hasAttorney as boolean,
      hasReceivedSettlement: hasReceivedSettlement as boolean,
      injuredFirstName,
      injuredLastName,
      injuredPhone: injuredPhone as string,
      injuredEmail,
      relationshipToInjured,
      fillerFirstName,
      fillerLastName,
      fillerPhone,
      fillerEmail,
      source: leadSourceFromUtm(tracking.source),
      medium: tracking.medium,
      content: tracking.content,
    },
  };
}
