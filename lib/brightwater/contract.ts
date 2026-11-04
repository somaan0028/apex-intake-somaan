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

/** The full (query-string included) submit URL. Hard-coded per the spec. */
export const BRIGHTWATER_SUBMIT_URL =
  "https://n8n.datosoperations.com/webhook/leadbyte-mock-submit" +
  "?campid=PERSONAL-INJURY-MVA&sid=50&returnjson=yes";

/**
 * Always-on tracking fields. `c1` identifies the campaign; `subid` is the
 * submission source. Both are required on every submission.
 */
export const BRIGHTWATER_TRACKING = {
  c1: "newmva",
  subid: "50",
} as const;

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
