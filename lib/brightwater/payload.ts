/**
 * Map an Apex lead onto Brightwater's field names.
 *
 * Brightwater receives the **injured person's** details, so this reads the
 * `injured*` columns only — never the filler's, even when the form was submitted
 * by someone else.
 *
 * Everything is optional in the target API except `email`, `firstname` and
 * `phone1`, so unknown (`null`) values are omitted rather than sent as blanks.
 * The function returns a validation error instead of throwing, so the caller can
 * surface a descriptive message before spending a network round trip.
 */
import { STATE_NAME_BY_CODE } from "@/lib/us-states";
import { isValidEmail } from "@/lib/validation";
import { BRIGHTWATER_SOURCE, BRIGHTWATER_TRACKING } from "./contract";

/** The lead facts the payload needs; a full `Lead` row satisfies this. */
export interface BrightwaterLead {
  injuredFirstName: string | null;
  injuredLastName: string | null;
  injuredEmail: string | null;
  injuredPhone: string | null;
  state: string | null;
  county: string | null;
  postcode: string | null;
  ipaddress: string | null;
  trustedform: string | null;
  journaya: string | null;
  dateOfAccident: Date | null;
  injuryDetails: string | null;
  accidentDetails: string | null;
  isAtFault: boolean | null;
  hasAttorney: boolean | null;
  hasReceivedSettlement: boolean | null;
}

export type BrightwaterPayload =
  | { ok: true; fields: Record<string, string> }
  | { ok: false; error: string };

/** Digits only — Brightwater wants a bare US number (`4052258371`). */
function digitsOnly(value: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Tri-state answer as text; `null` (unknown) is omitted by the caller. */
function yesNo(value: boolean | null): string | null {
  if (value === null) return null;
  return value ? "Yes" : "No";
}

/** `YYYY-MM-DD` in UTC; timestamps are stored as Unix seconds and map to a date. */
function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function buildBrightwaterPayload(
  lead: BrightwaterLead,
): BrightwaterPayload {
  const firstname = (lead.injuredFirstName ?? "").trim();
  const email = (lead.injuredEmail ?? "").trim();
  const phone1 = digitsOnly(lead.injuredPhone);

  const missing: string[] = [];
  if (!firstname) missing.push("first name");
  if (!isValidEmail(email)) missing.push("valid email");
  if (phone1.length !== 10) missing.push("phone");
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Brightwater requires the injured person's ${joinList(missing)}.`,
    };
  }

  const accidentDate = isoDate(lead.dateOfAccident);
  const attorney = yesNo(lead.hasAttorney);
  const atFault = yesNo(lead.isAtFault);
  const settlement = yesNo(lead.hasReceivedSettlement);
  // Brightwater expects the state's name, while the desk stores its code.
  const state = lead.state
    ? (STATE_NAME_BY_CODE[lead.state.trim().toUpperCase()] ?? lead.state)
    : null;

  const fields: Record<string, string> = {
    // Required
    email,
    firstname,
    phone1,

    // Always-on tracking
    c1: BRIGHTWATER_TRACKING.c1,
    subid: BRIGHTWATER_TRACKING.subid,
    source: BRIGHTWATER_SOURCE,

    // Injured person
    ...withValue("lastname", lead.injuredLastName),

    // Location & attribution
    ...withValue("state", state),
    ...withValue("county", lead.county),
    ...withValue("postcode", lead.postcode),
    ...withValue("ipaddress", lead.ipaddress),
    ...withValue("trustedform", lead.trustedform),
    ...withValue("journaya", lead.journaya),

    // Case facts
    ...withValue("were_you_at_fault", atFault),
    ...withValue("do_you_have_an_attorney", attorney),
    ...withValue("have_you_received_settlement", settlement),
    ...withValue("how_were_you_hurt", lead.injuryDetails),
    ...withValue("briefly_describe_accident", lead.accidentDetails),

    // Accident date: the year and month ride in their own fields, so
    // `date_of_accident` carries only the two-digit day.
    ...withValue("date_of_accident", accidentDate?.slice(8, 10)),
    ...withValue("injury_year", accidentDate?.slice(0, 4)),
    ...withValue("injury_month", accidentDate?.slice(5, 7)),
  };

  return { ok: true, fields };
}

/** Include a field only when it has a non-empty value. */
function withValue(
  key: string,
  value: string | null | undefined,
): Record<string, string> {
  const trimmed = (value ?? "").trim();
  return trimmed ? { [key]: trimmed } : {};
}

/** `["email"]` -> `"email"`, `["first name","phone"]` -> `"first name and phone"`. */
function joinList(values: string[]): string {
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
