/**
 * Brightwater submission client.
 *
 * Server-only: it reads `CANDIDATE_TOKEN` from the environment and performs the
 * outbound request. It does **not** touch the database — persisting the result
 * (`brightwater_lead_id`, `sent_to_firm_at`) is the caller's job, so this stays a
 * pure "send and report" service that is easy to test and reuse.
 *
 * The request is a form-urlencoded POST with the campaign/source identifiers on
 * the query string and the candidate token in the `x-candidate` header.
 */
import {
  BRIGHTWATER_SUBMIT_URL,
  BRIGHTWATER_TIMEOUT_MS,
  asBrightwaterResponse,
} from "./contract";
import {
  buildBrightwaterPayload,
  type BrightwaterLead,
} from "./payload";

/** Outcome of a submission attempt. Never throws for an expected failure. */
export type BrightwaterSendResult =
  | { ok: true; leadId: string | null; processTime: number | null }
  | { ok: false; error: string; code?: number };

/**
 * Send one lead to Brightwater and report the result.
 *
 * A `code` other than `1` is a rejection; its `response` text is surfaced as the
 * error so the operator sees Brightwater's own reason (e.g. "HLR rejection").
 */
export async function sendLeadToBrightwater(
  lead: BrightwaterLead,
): Promise<BrightwaterSendResult> {
  const payload = buildBrightwaterPayload(lead);
  if (!payload.ok) return payload;

  const token = process.env.CANDIDATE_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      error: "Brightwater is not configured: CANDIDATE_TOKEN is missing.",
    };
  }

  let response: Response;
  try {
    response = await fetch(BRIGHTWATER_SUBMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-candidate": token,
      },
      body: new URLSearchParams(payload.fields).toString(),
      signal: AbortSignal.timeout(BRIGHTWATER_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, error: describeNetworkError(error) };
  }

  const raw = await response.text();
  const body = parseJson(raw);

  if (!response.ok) {
    return {
      ok: false,
      error: `Brightwater returned HTTP ${response.status}.`,
    };
  }

  const parsed = asBrightwaterResponse(body);
  if (!parsed) {
    return {
      ok: false,
      error: "Brightwater returned an unexpected response.",
    };
  }

  if (parsed.code !== 1) {
    return {
      ok: false,
      code: parsed.code,
      error:
        parsed.response ||
        `Brightwater rejected the lead (code ${parsed.code}).`,
    };
  }

  return {
    ok: true,
    leadId: parsed.leadId === null ? null : String(parsed.leadId),
    processTime: parsed.processTime ?? null,
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Brightwater did not respond in time.";
  }
  return "Could not reach Brightwater. Please try again.";
}
