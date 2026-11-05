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
import { writeBrightwaterAttempt, type BrightwaterAttempt } from "./log";
import { buildBrightwaterPayload, type BrightwaterLead } from "./payload";

/** Outcome of a submission attempt. Never throws for an expected failure. */
export type BrightwaterSendResult =
  | { ok: true; leadId: string | null; processTime: number | null }
  | {
      ok: false;
      error: string;
      code?: number;
      /** Brightwater's own rejection text, when it returned one. */
      response?: string;
    };

/**
 * Send one lead to Brightwater and report the result.
 *
 * A `code` other than `1` is a rejection; its `response` text is surfaced as the
 * error so the operator sees Brightwater's own reason (e.g. "HLR rejection").
 *
 * Every outbound attempt is written to `data/brightwater-logs/` first (see
 * `log.ts`). Pre-flight refusals — a payload that cannot be built, or a missing
 * token — make no request and are not logged.
 */
export async function sendLeadToBrightwater(
  lead: BrightwaterLead,
  options: { leadId?: number | null } = {},
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

  const attemptedAt = new Date().toISOString();
  const startedAt = Date.now();
  const requestBody = new URLSearchParams(payload.fields).toString();
  const base: Pick<BrightwaterAttempt, "attemptedAt" | "leadId" | "request"> = {
    attemptedAt,
    leadId: options.leadId ?? null,
    request: {
      method: "POST",
      url: BRIGHTWATER_SUBMIT_URL,
      contentType: "application/x-www-form-urlencoded",
      body: requestBody,
      fields: payload.fields,
    },
  };

  let response: Response;
  try {
    response = await fetch(BRIGHTWATER_SUBMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-candidate": token,
      },
      body: requestBody,
      signal: AbortSignal.timeout(BRIGHTWATER_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const message = describeNetworkError(error);
    await writeBrightwaterAttempt({
      ...base,
      response: null,
      outcome: "network_error",
      error: message,
    });
    return { ok: false, error: message };
  }

  const raw = await response.text();
  const responseRecord = {
    status: response.status,
    body: raw,
    durationMs: Date.now() - startedAt,
  };
  const body = parseJson(raw);

  if (!response.ok) {
    const error = `Brightwater returned HTTP ${response.status}.`;
    await writeBrightwaterAttempt({
      ...base,
      response: responseRecord,
      outcome: "http_error",
      error,
    });
    return { ok: false, error };
  }

  const parsed = asBrightwaterResponse(body);
  if (!parsed) {
    const error = "Brightwater returned an unexpected response.";
    await writeBrightwaterAttempt({
      ...base,
      response: responseRecord,
      outcome: "unexpected_response",
      error,
    });
    return { ok: false, error };
  }

  if (parsed.code !== 1) {
    const error =
      parsed.response || `Brightwater rejected the lead (code ${parsed.code}).`;
    await writeBrightwaterAttempt({
      ...base,
      response: responseRecord,
      outcome: "rejected",
      error,
    });
    return {
      ok: false,
      code: parsed.code,
      // Only a provider rejection carries a "why". Network and HTTP failures
      // leave this unset so the activity log can call them unexpected errors.
      response: parsed.response.trim() || undefined,
      error,
    };
  }

  const leadId = parsed.leadId === null ? null : String(parsed.leadId);
  const processTime = parsed.processTime ?? null;
  await writeBrightwaterAttempt({
    ...base,
    response: responseRecord,
    outcome: "accepted",
    brightwaterLeadId: leadId,
    processTime,
  });

  return { ok: true, leadId, processTime };
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
