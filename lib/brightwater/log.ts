/**
 * Durable debug log for Brightwater submissions.
 *
 * Every outbound attempt writes one JSON file under `data/brightwater-logs/`
 * (beside the SQLite database, never in `public/`). The file records exactly
 * what was posted — the form-urlencoded body and the parsed fields — plus the
 * response, so a rejected or malformed submission can be inspected later.
 *
 * The `x-candidate` token is a secret and is deliberately never written here.
 * Logging is best-effort: a failure to write must never change the send result.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDatabasePath } from "@/lib/db";

/** One submission attempt, as written to disk. */
export interface BrightwaterAttempt {
  /** ISO timestamp of the attempt. */
  attemptedAt: string;
  /** The local lead id, when the caller supplied it. */
  leadId: number | null;
  request: {
    method: "POST";
    url: string;
    contentType: string;
    /** The exact form-urlencoded body sent on the wire. */
    body: string;
    /** The same body as a key/value object, easier to read. */
    fields: Record<string, string>;
  };
  /** `null` when no response arrived (timeout, DNS, connection refused). */
  response: {
    status: number;
    /** The raw response text, before any JSON parsing. */
    body: string;
    durationMs: number;
  } | null;
  outcome:
    | "accepted"
    | "rejected"
    | "http_error"
    | "unexpected_response"
    | "network_error";
  /** The operator-facing error, for the failed outcomes. */
  error?: string;
  /** Brightwater's lead id on an accepted send. */
  brightwaterLeadId?: string | null;
  /** Brightwater's processing time on an accepted send. */
  processTime?: number | null;
}

/** The log directory, resolved beside the configured database file. */
export function getBrightwaterLogDir(): string {
  return path.join(path.dirname(getDatabasePath()), "brightwater-logs");
}

/**
 * Write one attempt and return its path, or `null` if the write failed.
 * Callers await this so the file exists by the time the request settles, but
 * a logging failure is swallowed rather than surfaced to the operator.
 */
export async function writeBrightwaterAttempt(
  attempt: BrightwaterAttempt,
): Promise<string | null> {
  try {
    const dir = getBrightwaterLogDir();
    await mkdir(dir, { recursive: true });
    // Colons are illegal in Windows filenames, so flatten the ISO timestamp.
    const stamp = attempt.attemptedAt.replace(/[:.]/g, "-");
    const suffix = randomUUID().slice(0, 8);
    const file = path.join(dir, `${stamp}_${suffix}.json`);
    await writeFile(file, `${JSON.stringify(attempt, null, 2)}\n`, "utf8");
    return file;
  } catch {
    return null;
  }
}
