/**
 * Brightwater (partner firm) intake contract.
 *
 * Brightwater accepts a lead as a **form-urlencoded** POST. The campaign and
 * source identifiers ride on the query string; the lead fields are the body.
 * Everything in this module is constant for every submission — the candidate
 * token is the only secret, and it is read from the environment by the client.
 *
 * Only `MVA` leads are ever sent (see `canSendLeadToFirm`).
 */

/**
 * The submit endpoint and the campaign/source identifiers that always ride on
 * its query string.
 *
 * The URL is built with `URLSearchParams` (see `buildBrightwaterSubmitUrl`) so
 * every value is percent-encoded by construction. That matters for `campid`,
 * which currently happens to be URL-safe but must stay safe if it changes.
 */
export const BRIGHTWATER_SUBMIT_BASE_URL =
  "https://n8n.datosoperations.com/webhook/leadbyte-mock-submit";

/** Always-on query-string identifiers, encoded when the submit URL is built. */
export const BRIGHTWATER_SUBMIT_QUERY = {
  campid: "PERSONAL-INJURY-MVA",
  sid: "50",
  returnjson: "yes",
} as const;

/** The full submit URL with its encoded query string. */
export function buildBrightwaterSubmitUrl(): string {
  const url = new URL(BRIGHTWATER_SUBMIT_BASE_URL);
  for (const [key, value] of Object.entries(BRIGHTWATER_SUBMIT_QUERY)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Always-on tracking fields. `c1` identifies the campaign; `subid` is the
 * submission source. Both are required on every submission.
 */
export const BRIGHTWATER_TRACKING = {
  c1: "newmva",
  subid: "50",
} as const;

/**
 * The `source` Brightwater expects on every submission.
 *
 * Brightwater's source identifier is not the attribution value stored on the
 * lead (`leads.source`, which comes from `utm_source`), so the two must not be
 * conflated: this is a fixed brand string rather than lead data.
 */
export const BRIGHTWATER_SOURCE = "www.apexleadsource.com";

/** Abort a hung request rather than hold the dialog open forever. */
export const BRIGHTWATER_TIMEOUT_MS = 15_000;

/**
 * The JSON envelope Brightwater returns.
 *
 * `code === 1` is the only success value; every other code is a rejection and
 * carries a human-readable `response` describing why.
 */
export interface BrightwaterResponse {
  code: number;
  response: string;
  info?: unknown;
  leadId: number | null;
  processTime?: number;
  timestamp?: string;
}

/** Narrow an untrusted JSON body to a `BrightwaterResponse`. */
export function asBrightwaterResponse(
  body: unknown,
): BrightwaterResponse | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.code !== "number") return null;
  return {
    code: record.code,
    response: typeof record.response === "string" ? record.response : "",
    info: record.info,
    leadId: typeof record.leadId === "number" ? record.leadId : null,
    processTime:
      typeof record.processTime === "number" ? record.processTime : undefined,
    timestamp:
      typeof record.timestamp === "string" ? record.timestamp : undefined,
  };
}
